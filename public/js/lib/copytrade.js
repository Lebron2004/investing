// Copy trading: mirror the stock trades members of Congress disclose, in a paper portfolio.
// Pure functions (used by the Copy Trades page and the tests).
//
// The catch with copying politicians: they have up to 45 days to report a trade, so you can only
// act once it's been filed. Every simulation here buys on the next trading day's open after the
// FILING date, which is what you could really have done. For comparison it also shows the
// (impossible) result of trading on the day they traded, so you can see what the delay costs.

const r2 = (n) => Math.round(n * 100) / 100;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export const AMOUNT_LABEL = (lo, hi) => (hi ? `$${short(lo)}–$${short(hi)}` : `over $${short(lo)}`);
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/**
 * trades: Congress trades ({ member, filed, txDate, ticker, type, lo, hi }), newest or oldest first.
 * candlesOf(symbol): daily candles [{ t, open, close }] or null if prices aren't available.
 * Options: members (names; empty = everyone), start/end ('YYYY-MM-DD'), budget, slicePct (share of the
 * starting budget per new buy), when: 'filed' (realistic) | 'traded' (hindsight), bench: SPY candles.
 */
export function copyPortfolio(trades, candlesOf, { members = [], start, end = null, budget = 1000, slicePct = 0.1, when = 'filed', bench = null } = {}) {
  const pick = new Set(members);
  const dateOf = (t) => (when === 'traded' ? t.txDate : t.filed);
  const events = trades
    .filter((t) => (!pick.size || pick.has(t.member)) && ['buy', 'sell', 'partial'].includes(t.type) && t.ticker)
    .filter((t) => dateOf(t) >= start && (!end || dateOf(t) <= end))
    .sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.type === 'buy') - (b.type === 'buy'));

  let cash = budget;
  const pos = {};       // symbol → { shares, cost }
  const fills = [], skipped = [];
  const series = new Map(); // symbol → { days: [...], byDay: Map(day → candle) }
  const prices = (sym) => {
    if (!series.has(sym)) {
      const c = candlesOf(sym);
      series.set(sym, c?.length ? { days: c.map((x) => dayOf(x.t)), c } : null);
    }
    return series.get(sym);
  };
  // Realistic: the next trading day's open after the filing. Hindsight: the close on the trade day.
  const execution = (sym, date) => {
    const s = prices(sym);
    if (!s) return null;
    const i = when === 'traded' ? s.days.findIndex((d) => d >= date) : s.days.findIndex((d) => d > date);
    if (i < 0) return null;
    const c = s.c[i];
    return { day: s.days[i], price: when === 'traded' ? c.close : c.open };
  };

  for (const e of events) {
    const x = execution(e.ticker, dateOf(e));
    if (!x) { skipped.push({ ...e, reason: prices(e.ticker) ? 'not traded yet' : 'no price data on this site' }); continue; }
    if (e.type === 'buy') {
      const spend = Math.min(cash, budget * slicePct);
      if (spend < 1) { skipped.push({ ...e, reason: 'out of cash' }); continue; }
      const shares = Math.floor((spend / x.price) * 1000) / 1000; // fractional shares
      cash = r2(cash - shares * x.price);
      const p = (pos[e.ticker] ??= { shares: 0, cost: 0 });
      p.shares += shares; p.cost += shares * x.price;
      fills.push({ ...x, symbol: e.ticker, side: 'buy', shares, member: e.member, filed: e.filed, txDate: e.txDate, lag: lagDays(e.txDate, e.filed), amount: AMOUNT_LABEL(e.lo, e.hi) });
    } else {
      const p = pos[e.ticker];
      if (!p?.shares) { skipped.push({ ...e, reason: 'portfolio didn\'t own it' }); continue; }
      const shares = e.type === 'partial' ? Math.floor((p.shares / 2) * 1000) / 1000 : p.shares;
      const avg = p.cost / p.shares;
      cash = r2(cash + shares * x.price);
      p.cost -= avg * shares; p.shares = Math.round((p.shares - shares) * 1000) / 1000;
      if (p.shares <= 0) delete pos[e.ticker];
      fills.push({ ...x, symbol: e.ticker, side: 'sell', shares, member: e.member, filed: e.filed, txDate: e.txDate, lag: lagDays(e.txDate, e.filed), pl: r2((x.price - avg) * shares), amount: AMOUNT_LABEL(e.lo, e.hi) });
    }
  }

  // Daily value: cash + holdings at each day's close, from the start to the end of the data.
  const allDays = [...new Set([...(bench ? bench.map((c) => dayOf(c.t)) : []), ...[...series.values()].filter(Boolean).flatMap((s) => s.days)])]
    .filter((d) => d >= start && (!end || d <= end)).sort();
  const curve = [];
  let ci = 0, held = {}, cashAt = budget;
  const fillsByDay = [...fills].sort((a, b) => a.day.localeCompare(b.day));
  const lastClose = (sym, day) => {
    const s = series.get(sym);
    if (!s) return 0;
    let lo = 0, hi = s.days.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (s.days[mid] <= day) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k >= 0 ? s.c[k].close : 0;
  };
  for (const d of allDays) {
    while (ci < fillsByDay.length && fillsByDay[ci].day <= d) {
      const f = fillsByDay[ci++];
      held[f.symbol] = Math.round(((held[f.symbol] || 0) + (f.side === 'buy' ? f.shares : -f.shares)) * 1000) / 1000;
      cashAt += (f.side === 'buy' ? -1 : 1) * f.shares * f.price;
    }
    curve.push({ day: d, value: r2(cashAt + Object.entries(held).reduce((a, [s, n]) => a + n * lastClose(s, d), 0)) });
  }

  // S&P 500 benchmark: the same money in SPY on the first day.
  let benchCurve = [];
  if (bench?.length && curve.length) {
    const b0 = bench.find((c) => dayOf(c.t) >= curve[0].day);
    if (b0) {
      const shares = budget / b0.close;
      const bByDay = new Map(bench.map((c) => [dayOf(c.t), c.close]));
      let last = b0.close;
      benchCurve = curve.map(({ day }) => { last = bByDay.get(day) ?? last; return { day, value: r2(shares * last) }; });
    }
  }
  const endDay = curve.at(-1)?.day;
  const holdings = Object.entries(pos).map(([symbol, p]) => {
    const price = lastClose(symbol, endDay || '9999');
    return { symbol, shares: p.shares, avg: r2(p.cost / p.shares), price, value: r2(p.shares * price), pl: r2(p.shares * price - p.cost) };
  }).sort((a, b) => b.value - a.value);
  const value = curve.at(-1)?.value ?? budget;
  let peak = budget, maxDD = 0;
  for (const p of curve) { peak = Math.max(peak, p.value); maxDD = Math.max(maxDD, (peak - p.value) / peak); }
  const lags = fills.map((f) => f.lag).filter((v) => v != null);
  return {
    curve, benchCurve, fills, skipped, holdings, cash: r2(cash), value,
    stats: {
      ret: value / budget - 1,
      benchRet: benchCurve.length ? benchCurve.at(-1).value / budget - 1 : null,
      maxDrawdown: maxDD,
      buys: fills.filter((f) => f.side === 'buy').length,
      sells: fills.filter((f) => f.side === 'sell').length,
      avgLag: lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : null,
      from: curve[0]?.day ?? start, to: endDay ?? start,
    },
  };
}

export const lagDays = (tx, filed) => (tx && filed ? Math.round((Date.parse(filed) - Date.parse(tx)) / 864e5) : null);

// Per-member summary for the picker: trades, buys, sells, the stocks they trade most.
export function memberSummary(trades) {
  const m = {};
  for (const t of trades) {
    const x = (m[t.member] ??= { name: t.member, state: t.state, trades: 0, buys: 0, sells: 0, tickers: {}, lastFiled: t.filed, lags: [] });
    x.trades++;
    if (t.type === 'buy') x.buys++; else if (t.type !== 'exchange') x.sells++;
    x.tickers[t.ticker] = (x.tickers[t.ticker] || 0) + 1;
    if (t.filed > x.lastFiled) x.lastFiled = t.filed;
    const lag = lagDays(t.txDate, t.filed);
    if (lag != null) x.lags.push(lag);
  }
  return Object.values(m).map((x) => ({
    ...x,
    top: Object.entries(x.tickers).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t),
    avgLag: x.lags.length ? Math.round(x.lags.reduce((a, b) => a + b, 0) / x.lags.length) : null,
  })).sort((a, b) => b.trades - a.trades);
}
