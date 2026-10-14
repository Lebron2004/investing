// Turns daily candles into short-term and long-term scores, key levels and a trade plan.
// The scoring is a transparent rules-based model: every point added or removed comes with a reason.

import {
  sma, ema, rsi, macd, atr, bollinger, annualizedVol, pctChange,
  maxDrawdown, pivots, clusterLevels, last,
} from './indicators.js';

export const RATINGS = [
  { min: 70, label: 'Strong Buy', tone: 'up' },
  { min: 58, label: 'Buy', tone: 'up' },
  { min: 43, label: 'Hold', tone: 'flat' },
  { min: 30, label: 'Sell', tone: 'down' },
  { min: -Infinity, label: 'Strong Sell', tone: 'down' },
];

export function rate(score) {
  return RATINGS.find((r) => score >= r.min);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class Scorecard {
  constructor() { this.score = 50; this.reasons = []; }
  add(points, text) {
    this.score += points;
    this.reasons.push({ points, text });
  }
  result() {
    const score = Math.round(clamp(this.score, 0, 100));
    return { score, ...rate(score), reasons: this.reasons };
  }
}

const fmt = (n) => (n == null ? '—' : n.toFixed(2));
const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

export function computeIndicators(candles) {
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume || 0);
  return {
    closes,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema9: ema(closes, 9),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(candles, 14),
    bb: bollinger(closes, 20, 2),
    vol20: sma(vols, 20),
  };
}

function shortTermScore(candles, ind) {
  const sc = new Scorecard();
  const price = last(ind.closes);
  const s20 = last(ind.sma20), s50 = last(ind.sma50);
  const r = last(ind.rsi14);
  const n = candles.length;
  const rPrev = ind.rsi14[n - 4];
  const h = ind.macd.hist[n - 1], hPrev = ind.macd.hist[n - 2];

  if (s20 != null) {
    price > s20
      ? sc.add(10, `Price ${fmt(price)} is above its 20-day average ${fmt(s20)} (short-term uptrend)`)
      : sc.add(-10, `Price ${fmt(price)} is below its 20-day average ${fmt(s20)} (short-term downtrend)`);
  }
  if (s20 != null && s50 != null) {
    s20 > s50
      ? sc.add(8, '20-day average is above the 50-day (momentum is pointing up)')
      : sc.add(-8, '20-day average is below the 50-day (momentum is pointing down)');
  }
  if (h != null && hPrev != null) {
    if (h > 0 && h > hPrev) sc.add(10, 'MACD is positive and strengthening');
    else if (h > 0) sc.add(4, 'MACD is positive but fading');
    else if (h < 0 && h < hPrev) sc.add(-10, 'MACD is negative and getting weaker');
    else sc.add(-3, 'MACD is negative but starting to recover');
  }
  if (r != null) {
    if (r < 30) sc.add(8, `RSI ${r.toFixed(0)} — oversold, bounce potential (but trend is weak)`);
    else if (r < 45 && rPrev != null && r > rPrev) sc.add(6, `RSI ${r.toFixed(0)} turning up from a low level`);
    else if (r >= 50 && r <= 68) sc.add(6, `RSI ${r.toFixed(0)} — healthy bullish momentum`);
    else if (r > 75) sc.add(-12, `RSI ${r.toFixed(0)} — overbought, pullback risk is high`);
    else if (r > 68) sc.add(-4, `RSI ${r.toFixed(0)} — getting stretched`);
    else sc.add(-3, `RSI ${r.toFixed(0)} — weak momentum`);
  }
  const m1 = pctChange(ind.closes, 21);
  if (m1 != null) {
    if (m1 > 0.03) sc.add(5, `Up ${pct(m1)} over the last month`);
    else if (m1 < -0.05) sc.add(-5, `Down ${pct(m1)} over the last month`);
  }
  const v = candles[n - 1].volume, v20 = last(ind.vol20);
  const up = candles[n - 1].close >= candles[n - 2]?.close;
  if (v && v20 && v > 1.5 * v20) {
    up ? sc.add(5, 'Above-average volume on an up day (buyers are active)')
      : sc.add(-5, 'Above-average volume on a down day (sellers are active)');
  }
  const bu = last(ind.bb.upper), bl = last(ind.bb.lower);
  if (bu != null && price > bu) sc.add(-4, 'Price is above the upper Bollinger Band (stretched)');
  if (bl != null && price < bl) sc.add(4, 'Price is below the lower Bollinger Band (stretched to the downside)');
  return sc.result();
}

function longTermScore(candles, ind) {
  const sc = new Scorecard();
  const price = last(ind.closes);
  const s50 = last(ind.sma50), s200 = last(ind.sma200);
  const n = candles.length;

  if (s200 != null) {
    price > s200
      ? sc.add(15, `Price is above the 200-day average ${fmt(s200)} (long-term uptrend)`)
      : sc.add(-15, `Price is below the 200-day average ${fmt(s200)} (long-term downtrend)`);
    if (s50 != null) {
      s50 > s200
        ? sc.add(10, '50-day is above the 200-day ("golden cross" regime)')
        : sc.add(-10, '50-day is below the 200-day ("death cross" regime)');
    }
    const s200Prev = ind.sma200[n - 21];
    if (s200Prev != null) {
      s200 > s200Prev
        ? sc.add(8, '200-day average is rising')
        : sc.add(-6, '200-day average is falling');
    }
  } else {
    sc.add(0, 'Less than 200 days of history — long-term trend can\'t be judged yet');
  }
  const y1 = pctChange(ind.closes, Math.min(252, n - 1));
  if (y1 != null) {
    if (y1 > 0.15) sc.add(10, `Strong 1-year return of ${pct(y1)}`);
    else if (y1 > 0) sc.add(5, `Positive 1-year return of ${pct(y1)}`);
    else if (y1 < -0.15) sc.add(-10, `Weak 1-year return of ${pct(y1)}`);
    else sc.add(-4, `Slightly negative 1-year return of ${pct(y1)}`);
  }
  const vol = annualizedVol(ind.closes);
  if (vol < 0.25) sc.add(6, `Low volatility (${pct(vol)} a year) — smoother ride`);
  else if (vol > 0.55) sc.add(-10, `Very high volatility (${pct(vol)} a year) — big swings either way`);
  else if (vol > 0.4) sc.add(-4, `High volatility (${pct(vol)} a year)`);
  const hi52 = Math.max(...candles.slice(-252).map((c) => c.high));
  const off = (price - hi52) / hi52;
  if (off > -0.1) sc.add(5, `Within ${pct(-off)} of its 52-week high (leadership)`);
  else if (off < -0.35) sc.add(-6, `${pct(-off)} below its 52-week high (broken trend)`);
  return { ...sc.result(), volatility: vol, oneYear: y1, offHigh: off };
}

export function keyLevels(candles, price, atrVal) {
  const recent = candles.slice(-180);
  const { highs, lows } = pivots(recent, 5);
  const levels = clusterLevels([...highs, ...lows], 0.015);
  let support = levels.filter((l) => l.price < price * 0.995).sort((a, b) => b.price - a.price);
  let resistance = levels.filter((l) => l.price > price * 1.005).sort((a, b) => a.price - b.price);
  const lo20 = Math.min(...candles.slice(-20).map((c) => c.low));
  const hi20 = Math.max(...candles.slice(-20).map((c) => c.high));
  if (!support.length) support = [{ price: Math.min(lo20, price - atrVal), touches: 1 }];
  if (!resistance.length) resistance = [{ price: Math.max(hi20, price + atrVal), touches: 1 }];
  return { support: support.slice(0, 3), resistance: resistance.slice(0, 3) };
}

// A long-only swing trade plan built around the nearest support and volatility (ATR).
export function tradePlan(price, atrVal, levels) {
  const sup = levels.support[0].price;
  // Buy zone: from just above support up to the current price.
  const zoneLow = Math.max(sup, price - 1.5 * atrVal);
  const entry = price;
  // Stop sits half an ATR under support, kept between 1 and 3 ATR away so it is neither noise nor huge.
  let stop = sup - 0.5 * atrVal;
  stop = Math.min(stop, entry - 1 * atrVal);
  stop = Math.max(stop, entry - 3 * atrVal);
  const risk = entry - stop;
  const res = levels.resistance.map((r) => r.price);
  const t1 = res[0] && res[0] >= entry + risk ? res[0] : entry + 1.5 * risk;
  const t2 = Math.max(entry + 3 * risk, res[1] ?? 0);
  const t3 = entry + 5 * risk;
  return {
    buyZone: [zoneLow, entry],
    entry,
    stop,
    risk,
    riskPct: risk / entry,
    targets: [t1, t2, t3],
    rewardRisk: (t1 - entry) / risk,
  };
}

// Long-term accumulation plan: staggered buys and a clear "thesis broken" exit.
export function longTermPlan(price, ind) {
  const s50 = last(ind.sma50), s200 = last(ind.sma200);
  const tranches = [
    { label: 'Now', price, weight: 0.4 },
    { label: s50 && s50 < price ? 'Pullback to 50-day avg' : '5% pullback', price: s50 && s50 < price ? s50 : price * 0.95, weight: 0.3 },
    { label: s200 && s200 < price ? 'Pullback to 200-day avg' : '12% pullback', price: s200 && s200 < price * 0.97 ? s200 : price * 0.88, weight: 0.3 },
  ];
  const exitBelow = s200 ? Math.min(s200 * 0.95, price * 0.8) : price * 0.8;
  return { tranches, exitBelow, trailingStopPct: 0.2 };
}

export function analyze(candles) {
  if (!candles || candles.length < 30) throw new Error('Not enough price history to analyze');
  const ind = computeIndicators(candles);
  const price = last(ind.closes);
  const prev = candles[candles.length - 2].close;
  const atrVal = last(ind.atr14) ?? price * 0.02;
  const levels = keyLevels(candles, price, atrVal);
  const shortTerm = shortTermScore(candles, ind);
  const longTerm = longTermScore(candles, ind);
  return {
    price,
    change: price - prev,
    changePct: (price - prev) / prev,
    atr: atrVal,
    rsi: last(ind.rsi14),
    sma20: last(ind.sma20),
    sma50: last(ind.sma50),
    sma200: last(ind.sma200),
    maxDrawdown: maxDrawdown(ind.closes.slice(-252)),
    shortTerm,
    longTerm,
    levels,
    plan: tradePlan(price, atrVal, levels),
    ltPlan: longTermPlan(price, ind),
    indicators: ind,
  };
}
