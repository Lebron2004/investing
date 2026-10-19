// Day Trade Desk: turns the AI forecasts + today's intraday action into a short, budget-aware
// list of day-trade ideas with exact entries, stops, targets and share counts. Pure functions.

import { indicatorContext, featuresAt, predict, explain } from './daymodel.js';

// --- Market clock (New York time) ---------------------------------------------------
export function nyClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  let phase;
  if (weekend) phase = 'weekend';
  else if (minutes < 570) phase = 'pre';
  else if (minutes < 600) phase = 'opening';
  else if (minutes < 690) phase = 'morning';
  else if (minutes < 840) phase = 'lunch';
  else if (minutes < 930) phase = 'afternoon';
  else if (minutes < 960) phase = 'power';
  else phase = 'after';
  const open = !weekend && minutes >= 570 && minutes < 960;
  return { day, minutes, weekend, phase, open, minutesToOpen: open || weekend ? null : (minutes < 570 ? 570 - minutes : null), minutesToClose: open ? 960 - minutes : null };
}

export const PHASES = {
  weekend: 'Market closed (weekend)',
  pre: 'Pre-market',
  opening: 'Opening 30 minutes',
  morning: 'Morning session',
  lunch: 'Midday lull',
  afternoon: 'Afternoon session',
  power: 'Power hour',
  after: 'Market closed',
};

// --- Intraday snapshot from 5-minute bars -----------------------------------------------
export function intradaySnapshot(bars, avgDailyVolume) {
  if (!bars?.length) return null;
  let pv = 0, vol = 0, high = -Infinity, low = Infinity;
  for (const b of bars) {
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * (b.volume || 0);
    vol += b.volume || 0;
    high = Math.max(high, b.high);
    low = Math.min(low, b.low);
  }
  const or = bars.slice(0, 6); // first 30 minutes
  const elapsed = Math.min(1, bars.length / 78); // 78 five-minute bars in a session
  return {
    date: new Date(bars[0].t).toISOString().slice(0, 10),
    open: bars[0].open,
    high, low,
    last: bars[bars.length - 1].close,
    vwap: vol > 0 ? pv / vol : null,
    orHigh: Math.max(...or.map((b) => b.high)),
    orLow: Math.min(...or.map((b) => b.low)),
    orComplete: bars.length >= 6,
    volume: vol,
    rvol: avgDailyVolume && elapsed > 0 ? vol / (avgDailyVolume * elapsed) : null,
    elapsed,
    t: bars[bars.length - 1].t,
  };
}

// --- Build step: one record per stock with the AI forecast for the next session ------------
/**
 * stocks: [{ symbol, name, sector, candles, intraday (snapshot or null) }], bench: SPY candles,
 * model: from trainDayModels(), clock: nyClock().
 */
export function buildDeskData(stocks, bench, model, clock = nyClock()) {
  const out = [];
  for (const s of stocks) {
    const c = s.candles;
    if (!c || c.length < 80) continue;
    const ctx = indicatorContext(c, bench);
    // During the session the last daily candle is today's (unfinished), so forecast from the day before.
    const lastDay = new Date(c.at(-1).t).toISOString().slice(0, 10);
    const i = clock.open && lastDay === clock.day ? c.length - 2 : c.length - 1;
    const x = featuresAt(c, i, ctx);
    if (!x) continue;
    const d = c[i];
    const avgVol = ctx.v20[i];
    out.push({
      symbol: s.symbol, name: s.name, sector: s.sector,
      prevClose: d.close, yHigh: d.high, yLow: d.low,
      atr: ctx.a[i], atrPct: ctx.a[i] / d.close,
      avgVol, dollarVol: avgVol * d.close,
      yRvol: avgVol ? (d.volume || 0) / avgVol : null,
      yClosePos: d.high > d.low ? (d.close - d.low) / (d.high - d.low) : 0.5,
      pBig: model ? predict(model.big, x, model) : null,
      pUp: model ? predict(model.up, x, model) : null,
      why: model ? explain(model, 'big', x, 2) : [],
      intraday: clock.open && s.intraday?.date === clock.day ? s.intraday : null,
    });
  }
  return out;
}

// --- Live update from a real-time quote (Finnhub /quote: c, h, l, o, pc, t) ---------------
export function applyQuote(rec, q, clock = nyClock()) {
  if (!q || !(q.c > 0)) return rec;
  const prev = rec.intraday;
  if (!clock.open) return { ...rec, livePrice: q.c };
  return {
    ...rec,
    livePrice: q.c,
    intraday: {
      ...(prev || {}),
      date: clock.day,
      open: q.o || prev?.open || q.c,
      high: Math.max(q.h || q.c, prev?.high ?? -Infinity),
      low: Math.min(q.l || q.c, prev?.low ?? Infinity),
      last: q.c,
      vwap: prev?.vwap ?? null,
      orHigh: prev?.orHigh ?? null,
      orLow: prev?.orLow ?? null,
      rvol: prev?.rvol ?? null,
      t: q.t * 1000,
      live: true,
    },
  };
}

// --- Ranking + plans for a given budget -------------------------------------------------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const r2 = (n) => Math.round(n * 100) / 100;

export function rankDesk(records, { budget = 1000, riskPct = 0.01, fractional = false, minDollarVol = 50e6, top = 8, marketOpen = false, useUpModel = true } = {}) {
  const round = fractional ? (x) => Math.floor(x * 1000) / 1000 : Math.floor;
  const eligible = [];
  const skipped = { price: 0, liquidity: 0, volatility: 0 };
  for (const r of records) {
    const price = r.intraday?.last ?? r.livePrice ?? r.prevClose;
    if (r.dollarVol < minDollarVol) { skipped.liquidity++; continue; }
    if (r.atrPct < 0.01 || r.atrPct > 0.12) { skipped.volatility++; continue; }
    if (!fractional && price * 3 > budget) { skipped.price++; continue; }
    eligible.push({ ...r, price });
  }
  // Rank the AI's "big mover" probability within today's eligible list.
  const sortedBig = eligible.map((r) => r.pBig ?? 0).sort((a, b) => a - b);
  const pctRank = (v) => (sortedBig.length > 1 ? sortedBig.filter((x) => x < v).length / (sortedBig.length - 1) : 0.5);

  const ideas = eligible.map((r) => {
    const id = r.intraday;
    const chg = id ? id.last / r.prevClose - 1 : 0;
    const moveAtr = chg / r.atrPct;
    const aboveVwap = id?.vwap ? id.last > id.vwap : null;
    const dayPos = id && id.high > id.low ? (id.last - id.low) / (id.high - id.low) : r.yClosePos;
    const parts = {
      ai: pctRank(r.pBig ?? 0),
      upOdds: clamp01(((r.pUp ?? 0.5) - 0.42) / 0.16),
      momentum: id ? clamp01(0.5 + moveAtr / 2) * (aboveVwap === false ? 0.5 : 1) : 0.5,
      activity: clamp01(((id?.rvol ?? r.yRvol ?? 1) - 0.8) / 1.7),
      strength: dayPos,
    };
    // The up-day model only gets a vote when it has proven itself on recent unseen days.
    const score = Math.round(100 * (useUpModel
      ? 0.35 * parts.ai + 0.2 * parts.upOdds + 0.2 * parts.momentum + 0.15 * parts.activity + 0.1 * parts.strength
      : 0.4 * parts.ai + 0.3 * parts.momentum + 0.18 * parts.activity + 0.12 * parts.strength));
    let bias;
    if (id) bias = chg > 0 && aboveVwap !== false ? 'long' : chg < 0 && aboveVwap === false ? 'avoid' : 'watch';
    else bias = useUpModel && (r.pUp ?? 0.5) >= 0.5 ? 'long' : 'watch';
    return { ...r, chg, moveAtr, aboveVwap, dayPos, parts, score, bias, plan: planFor(r, id, { budget, riskPct, round, marketOpen }) };
  }).filter((x) => x.plan);

  const order = { long: 0, watch: 1, avoid: 2 };
  ideas.sort((a, b) => order[a.bias] - order[b.bias] || b.score - a.score);
  return { picks: ideas.filter((x) => x.bias !== 'avoid').slice(0, top), avoid: ideas.filter((x) => x.bias === 'avoid').sort((a, b) => a.chg - b.chg).slice(0, 4), eligible: ideas.length, skipped, total: records.length };
}

function planFor(r, id, { budget, riskPct, round, marketOpen }) {
  let entry, how, floor;
  if (id) {
    const orH = id.orComplete !== false && id.orHigh ? id.orHigh : id.high;
    const orL = id.orComplete !== false && id.orLow ? id.orLow : id.low;
    const vw = id.vwap ?? (id.high + id.low) / 2;
    if (id.last > orH * 1.001) {
      entry = id.last;
      how = `Already above its opening-range high (${r2(orH)}). Buy a pullback toward VWAP (${r2(vw)}) that holds, not a spike.`;
    } else {
      entry = orH * 1.001;
      how = `Buy only if it breaks above the opening-range high (${r2(orH)}).`;
    }
    floor = Math.max(orL, vw * 0.998);
  } else {
    entry = r.yHigh * 1.001;
    how = marketOpen
      ? `Buy only if it breaks above yesterday's high (${r2(r.yHigh)}) with strong volume.`
      : `Wait for the open. After the first 15 minutes, buy only if it breaks above yesterday's high (${r2(r.yHigh)}).`;
    floor = r.prevClose;
  }
  const risk = Math.min(0.4 * r.atr, Math.max(0.15 * r.atr, entry - floor));
  const stop = entry - risk;
  const riskBudget = budget * riskPct;
  const shares = Math.min(round(riskBudget / risk), round(budget / entry));
  if (!(shares > 0)) return null;
  return { entry: r2(entry), stop: r2(stop), t1: r2(entry + risk), t2: r2(entry + 2 * risk), risk: r2(risk), shares, cost: r2(shares * entry), maxLoss: r2(shares * risk), how };
}

// --- Coaching tips for right now ---------------------------------------------------------
export function deskTips({ clock, market, budget, riskPct, ranked }) {
  const tips = [];
  const t = (tone, text) => tips.push({ tone, text });
  const lossLimit = budget * riskPct * 3;
  switch (clock.phase) {
    case 'pre': t('info', `Pre-market: make your plan now. Pick 2–3 stocks from the list, write down entry, stop and target. Don't trade the first 5 minutes after the 9:30 open. Spreads are wide and moves are random.`); break;
    case 'opening': t('warn', 'Opening 30 minutes: the most volatile part of the day. Let the opening range form, then trade breakouts above its high. Beginners often do best waiting until 10:00.'); break;
    case 'morning': t('good', 'Morning session: usually the best window for day trades. Volume is high and trends are clean.'); break;
    case 'lunch': t('warn', 'Midday lull (11:30–2:00): volume dries up and moves fake out. Be pickier, trade smaller, or just watch.'); break;
    case 'afternoon': t('info', 'Afternoon: trends from the morning often resume. Start planning your exits. Day trades close before 4:00.'); break;
    case 'power': t('warn', `Power hour: big moves into the close. Close every day trade before 4:00 PM (${clock.minutesToClose} min left). Don't hold overnight by accident.`); break;
    case 'after': t('info', 'Market closed. Review today\'s trades (what worked, what didn\'t). The list below is the AI\'s watchlist for the next session.'); break;
    default: t('info', 'Weekend: the list below is the AI\'s watchlist for Monday. Plan entries and stops in advance.');
  }
  if (market?.spy?.intraday) {
    const m = market.spy.intraday;
    const chg = m.last / market.spy.prevClose - 1;
    const above = m.vwap ? m.last > m.vwap : null;
    if (chg > 0.003 && above !== false) t('good', `Market tailwind: the S&P 500 is up ${(chg * 100).toFixed(2)}%${above ? ' and above VWAP' : ''}. Long setups work better on days like this.`);
    else if (chg < -0.003) t('warn', `Market headwind: the S&P 500 is down ${(chg * 100).toFixed(2)}%. Most stocks follow the market, so trade smaller, take profits faster, or sit out.`);
    else t('info', 'The market is flat. Stock-specific movers (high relative volume) are where the action is.');
  }
  t('rule', `Daily loss limit: if you're down ${fmt(lossLimit)} today (3 losing trades), stop trading for the day. Protecting your budget is job #1.`);
  t('rule', `Risk per trade: ${fmt(budget * riskPct)} (${(riskPct * 100).toFixed(1)}% of ${fmt(budget)}). Share counts below already follow this.`);
  if (budget < 25000) t('rule', 'Under $25,000? The Pattern Day Trader rule allows only 3 day trades in 5 business days in a margin account. A cash account avoids it, but you must wait for cash to settle (1 business day) before reusing it.');
  if (ranked && ranked.skipped.price > 0 && budget < 1000) t('info', `${ranked.skipped.price} stocks were filtered out because a few shares would cost more than your budget. Turning on fractional shares adds them back.`);
  return tips;
}

const fmt = (n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
