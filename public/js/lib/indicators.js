// Pure technical-indicator math. Shared by the browser and the Node tests.
// Every function returns an array aligned with its input (null where not enough data yet).

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder's RSI.
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast), s = ema(values, slow);
  const line = values.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
  const start = line.findIndex((v) => v != null);
  const sig = new Array(values.length).fill(null);
  if (start >= 0) {
    const e = ema(line.slice(start), signal);
    e.forEach((v, j) => (sig[start + j] = v));
  }
  const hist = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]));
  return { line, signal: sig, hist };
}

// Average True Range (Wilder smoothing).
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  if (candles.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = [], lower = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
    const win = values.slice(i - period + 1, i + 1);
    const sd = stdev(win);
    upper.push(mid[i] + mult * sd);
    lower.push(mid[i] - mult * sd);
  }
  return { mid, upper, lower };
}

export function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

// Annualized volatility from daily closes.
export function annualizedVol(closes, lookback = 252) {
  const c = closes.slice(-lookback - 1);
  const rets = [];
  for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
  return stdev(rets) * Math.sqrt(252);
}

export function pctChange(closes, bars) {
  if (closes.length <= bars) return null;
  const a = closes[closes.length - 1 - bars], b = closes[closes.length - 1];
  return (b - a) / a;
}

export function maxDrawdown(closes) {
  let peak = -Infinity, mdd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    mdd = Math.min(mdd, (c - peak) / peak);
  }
  return mdd;
}

// Swing highs/lows: a bar whose high (low) is the extreme of `w` bars on each side.
export function pivots(candles, w = 5) {
  const highs = [], lows = [];
  for (let i = w; i < candles.length - w; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

// Merge price levels that sit within `tol` (fraction) of each other. Returns [{price, touches}].
export function clusterLevels(levels, tol = 0.015) {
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p - last.price) / last.price <= tol) {
      last.sum += p; last.touches++; last.price = last.sum / last.touches;
    } else {
      clusters.push({ price: p, sum: p, touches: 1 });
    }
  }
  return clusters.map(({ price, touches }) => ({ price, touches }));
}

export const last = (arr) => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
};
