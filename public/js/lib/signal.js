// StockWise Signal Line: an ATR trailing line (the classic "SuperTrend" calculation) plus a
// trend filter. The exact same rules ship as a TradingView indicator (public/tools/stockwise-signal.pine)
// and a thinkorswim study (public/tools/stockwise-signal.ts), so all three draw the same line.
//
//   • Line under price, green → uptrend: HOLD. The line is your trailing stop.
//   • Line above price, red   → downtrend: SELL / stay out.
//   • Flip up   → BUY (or WAIT if price is below its 200-day average).
//   • Flip down → SELL.

import { atr, sma, rsi } from './indicators.js';

export const SIGNAL_DEFAULTS = { atrLength: 14, multiplier: 3, trendFilter: true, trendLength: 200 };

export function signalLine(candles, opts = {}) {
  const { atrLength, multiplier, trendFilter, trendLength } = { ...SIGNAL_DEFAULTS, ...opts };
  const n = candles.length;
  const a = atr(candles, atrLength);
  const trend = sma(candles.map((c) => c.close), trendLength);
  const r = rsi(candles.map((c) => c.close), 14);
  const line = new Array(n).fill(null);
  const dir = new Array(n).fill(null);
  const signals = [];
  let upper = null, lower = null, d = -1; // like TradingView's ta.supertrend, start in a downtrend
  for (let i = 0; i < n; i++) {
    if (a[i] == null) continue;
    const c = candles[i];
    const mid = (c.high + c.low) / 2;
    const basicUpper = mid + multiplier * a[i];
    const basicLower = mid - multiplier * a[i];
    const prevClose = candles[i - 1]?.close;
    const prevUpper = upper, prevLower = lower;
    upper = prevUpper == null || basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
    lower = prevLower == null || basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;
    const prevD = d;
    if (prevUpper != null) {
      if (prevD === -1 && c.close > upper) d = 1;
      else if (prevD === 1 && c.close < lower) d = -1;
    }
    dir[i] = d;
    line[i] = d === 1 ? lower : upper;
    if (prevUpper != null && d !== prevD) {
      const trendOk = !trendFilter || (trend[i] != null && c.close > trend[i]);
      signals.push({ i, type: d === 1 ? (trendOk ? 'buy' : 'wait') : 'sell', price: c.close });
    }
    if (d === 1 && r[i] > 75 && r[i - 1] <= 75) signals.push({ i, type: 'hot', price: c.high });
  }

  const i = n - 1;
  const last = signals.filter((s) => s.type !== 'hot').at(-1);
  const trendOk = !trendFilter || (trend[i] != null && candles[i].close > trend[i]);
  let status;
  if (dir[i] == null) status = { action: 'none', label: 'Not enough data' };
  else if (dir[i] === 1) {
    status = last?.i === i && last.type === 'buy' ? { action: 'buy', label: 'BUY' }
      : { action: 'hold', label: trendOk ? 'HOLD' : 'HOLD (weak trend)' };
  } else status = { action: 'sell', label: last?.i === i ? 'SELL' : 'SELL / STAY OUT' };
  status.stop = line[i];
  status.distance = line[i] != null ? (candles[i].close - line[i]) / candles[i].close : null;
  status.since = last ? n - 1 - last.i : null;
  return { line, dir, signals, status };
}
