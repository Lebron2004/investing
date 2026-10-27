// Past-day data for AutoPilot's "Test" and "Train" (replaying the bot over recent sessions).
//   • 5-minute bars per stock for the last ~60 sessions (Yahoo's limit for 5-minute data), kept
//     between builds so the history grows over time.
//   • For each day, what the bot would have known that morning: previous close, ATR, average
//     dollar volume and the AI's "big move" probability (from the day before, no peeking).

import { indicatorContext, featuresAt, predict } from '../public/js/lib/daymodel.js';
import { demoIntradayDay } from './demo-intraday.js';

const UA = 'Mozilla/5.0 (StockWise educational app)';
const nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export function nyDayMinute(tMs) {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(tMs)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, m: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// { 'YYYY-MM-DD': [[m, o, h, l, c], ...] } for the regular session, or {} on failure.
export async function fetchIntradayDays(symbol, range = '60d') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=5m&includePrePost=false`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return {};
    const r = (await res.json())?.chart?.result?.[0];
    if (!r?.timestamp) return {};
    const q = r.indicators.quote[0];
    const days = {};
    r.timestamp.forEach((t, i) => {
      const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
      if (o == null || h == null || l == null || c == null) return;
      const { day, m } = nyDayMinute(t * 1000);
      if (m < 570 || m >= 960) return;
      (days[day] ??= []).push([m, r4(o), r4(h), r4(l), r4(c)]);
    });
    return days;
  } catch {
    return {};
  }
}

// Simulated bars for the last `n` daily candles (offline / demo mode).
export function demoIntradayDays(symbol, candles, n = 40) {
  const days = {};
  for (const c of candles.slice(-n)) {
    const day = new Date(c.t).toISOString().slice(0, 10);
    days[day] = demoIntradayDay(`${symbol}${day}`, c).map((b) => b.map((v, i) => (i ? r4(v) : v)));
  }
  return days;
}

// Merge freshly downloaded days into the cached ones, keeping the most recent `keep` sessions.
// Only complete sessions are kept (a day still in progress is dropped until it's finished).
export function mergeDays(cached = {}, fresh = {}, { keep = 120, today = null } = {}) {
  const all = { ...cached, ...fresh };
  const days = Object.keys(all).filter((d) => d !== today && all[d].length >= 60).sort().slice(-keep);
  return Object.fromEntries(days.map((d) => [d, all[d]]));
}

/**
 * The morning-of-day context for every stock and day.
 * stocks: [{ symbol, sector, candles }], bench: SPY candles, model: trainDayModels() result,
 * days: sorted list of sessions to include.
 * Returns { [day]: [[symbol, prevClose, atr, pBig, dollarVol], ...] }.
 */
export function morningRecords(stocks, bench, model, days) {
  const out = Object.fromEntries(days.map((d) => [d, []]));
  const want = new Set(days);
  for (const s of stocks) {
    const c = s.candles;
    if (!c || c.length < 80) continue;
    const ctx = indicatorContext(c, bench);
    for (let i = 1; i < c.length; i++) {
      const day = new Date(c[i].t).toISOString().slice(0, 10);
      if (!want.has(day)) continue;
      const j = i - 1; // the bot only knows up to the previous close
      const x = featuresAt(c, j, ctx);
      if (!x) continue;
      const pBig = model ? predict(model.big, x, model) : 0.5;
      out[day].push([s.symbol, r4(c[j].close), r4(ctx.a[j]), Math.round(pBig * 1e4) / 1e4, Math.round(ctx.v20[j] * c[j].close)]);
    }
  }
  return out;
}
