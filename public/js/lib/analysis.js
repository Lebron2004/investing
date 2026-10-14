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

function shortTermScore(candles, ind, extra = {}) {
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
  if (extra.rs3m != null) {
    if (extra.rs3m > 0.05) sc.add(8, `Beating the S&P 500 by ${pct(extra.rs3m)} over 3 months (relative strength)`);
    else if (extra.rs3m < -0.05) sc.add(-8, `Lagging the S&P 500 by ${pct(-extra.rs3m)} over 3 months (relative weakness)`);
  }
  if (extra.setup) sc.add(extra.setup.points, `${extra.setup.label} setup: ${extra.setup.text}`);
  if (extra.daysToEarnings != null && extra.daysToEarnings >= 0 && extra.daysToEarnings <= 7) {
    sc.add(-10, `Earnings report in ${extra.daysToEarnings === 0 ? 'less than a day' : `${extra.daysToEarnings} day${extra.daysToEarnings === 1 ? '' : 's'}`}. A surprise can gap the price right past your stop`);
  }
  return sc.result();
}

// Classifies the current chart pattern into one of the classic swing-trade entries.
export function detectSetup(candles, ind, rs3m = null) {
  const n = candles.length;
  const c = candles[n - 1].close;
  const s20 = last(ind.sma20), s50 = last(ind.sma50), s200 = last(ind.sma200);
  const r = last(ind.rsi14), rPrev = ind.rsi14[n - 3];
  const prior = candles.slice(-21, -1);
  const prevHigh = prior.length ? Math.max(...prior.map((x) => x.high)) : null;
  const v20 = last(ind.vol20);
  const volRatio = v20 ? (candles[n - 1].volume || 0) / v20 : 0;

  if (prevHigh && c > prevHigh && s50 && c > s50 && volRatio > 1.3) {
    return { key: 'breakout', label: 'Breakout', points: 8, hold: '1–4 weeks', level: prevHigh,
      text: `closed above its 20-day high (${fmt(prevHigh)}) on ${volRatio.toFixed(1)}× normal volume`,
      howTo: `Buy near ${fmt(prevHigh)}–${fmt(c)}. If it closes back below ${fmt(prevHigh)}, the breakout failed. Get out.` };
  }
  if (s20 && s50 && s200 && c > s50 && s50 > s200 && Math.abs(c - s20) / s20 < 0.025 && r != null && r >= 38 && r <= 58) {
    return { key: 'pullback', label: 'Pullback', points: 8, hold: '1–4 weeks', level: s20,
      text: `dipped to its 20-day average (${fmt(s20)}) inside an uptrend. A lower-risk entry`,
      howTo: `Buy near ${fmt(s20)}. The trend is your cushion, so wait for a green day if you want confirmation.` };
  }
  if (r != null && rPrev != null && r < 38 && r > rPrev && s200 && c > s200 * 0.95) {
    return { key: 'bounce', label: 'Oversold bounce', points: 5, hold: '3 days – 2 weeks', level: c,
      text: `RSI ${r.toFixed(0)} is oversold and turning up, while price holds near its long-term trend`,
      howTo: 'Smaller position and quicker profits: bounces are shorter than trends. Take Target 1 and tighten the stop.' };
  }
  if (s20 && s50 && c > s20 && s20 > s50 && r != null && r >= 55 && r <= 72 && (rs3m == null || rs3m > 0)) {
    return { key: 'momentum', label: 'Momentum', points: 5, hold: '2–8 weeks', level: s20,
      text: 'riding steadily above its 20- and 50-day averages with healthy RSI',
      howTo: `Ride the trend and trail your stop under the 20-day average (${fmt(s20)}). Buying a small dip is better than chasing a big green day.` };
  }
  return null;
}

export function relativeStrength(closes, benchCloses, bars = 63) {
  if (!benchCloses || benchCloses.length <= bars || closes.length <= bars) return null;
  return pctChange(closes, bars) - pctChange(benchCloses, bars);
}

// --- Fundamentals ----------------------------------------------------------------

export function grade(score) {
  if (score == null) return null;
  return score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
}

// Scores a company's business on four 0–100 pillars, each with plain-English reasons.
export function fundamentalScore(f, price) {
  if (!f) return null;
  const pillars = {};
  const reasons = [];
  const pillar = (key, label, fn) => {
    let s = 50, any = false;
    const add = (pts, text) => { s += pts; any = true; reasons.push({ points: pts, text, group: label }); };
    fn(add);
    if (any) pillars[key] = Math.round(clamp(s, 0, 100));
  };
  pillar('quality', 'Quality', (add) => {
    const m = f.profitMargin;
    if (m != null) {
      if (m > 0.2) add(20, `Very profitable: keeps ${pct(m)} of revenue as profit`);
      else if (m > 0.1) add(10, `Solid profit margin of ${pct(m)}`);
      else if (m > 0) add(0, `Thin profit margin of ${pct(m)}`);
      else add(-25, `Losing money (profit margin ${pct(m)})`);
    }
    if (f.roe != null) {
      if (f.roe > 0.2) add(15, `High return on equity (${pct(f.roe)}). Management uses capital well`);
      else if (f.roe < 0) add(-15, `Negative return on equity (${pct(f.roe)})`);
    }
    if (f.debtToEquity != null) {
      if (f.debtToEquity < 50) add(10, `Low debt (debt/equity ${(f.debtToEquity / 100).toFixed(2)}×)`);
      else if (f.debtToEquity > 200) add(-15, `Heavy debt (debt/equity ${(f.debtToEquity / 100).toFixed(1)}×)`);
    }
    if (f.freeCashflow != null) {
      f.freeCashflow > 0 ? add(5, 'Generates free cash flow') : add(-10, 'Burning cash (negative free cash flow)');
    }
  });
  pillar('growth', 'Growth', (add) => {
    if (f.revenueGrowth != null) {
      const g = f.revenueGrowth;
      if (g > 0.2) add(25, `Sales growing fast (+${pct(g)} vs. a year ago)`);
      else if (g > 0.08) add(12, `Healthy sales growth (+${pct(g)})`);
      else if (g >= 0) add(0, `Slow sales growth (+${pct(g)})`);
      else add(-20, `Sales shrinking (${pct(g)})`);
    }
    if (f.earningsGrowth != null) {
      const g = f.earningsGrowth;
      if (g > 0.2) add(20, `Earnings growing fast (+${pct(g)})`);
      else if (g > 0.05) add(8, `Earnings growing (+${pct(g)})`);
      else if (g < 0) add(-15, `Earnings falling (${pct(g)})`);
    }
  });
  pillar('value', 'Value', (add) => {
    const pe = f.forwardPE ?? f.trailingPE;
    if (pe == null || pe <= 0) {
      if (f.profitMargin != null && f.profitMargin <= 0) add(-20, 'No P/E: the company isn\'t profitable yet, so the price rests on future hopes');
    } else if (pe < 15) add(20, `Cheap: ${pe.toFixed(1)}× earnings`);
    else if (pe < 25) add(8, `Fairly priced: ${pe.toFixed(1)}× earnings`);
    else if (pe < 40) add(-5, `Pricey: ${pe.toFixed(1)}× earnings`);
    else add(-20, `Expensive: ${pe.toFixed(0)}× earnings. A lot of growth is already priced in`);
    if (f.peg != null && f.peg > 0) {
      if (f.peg < 1) add(15, `PEG ${f.peg.toFixed(2)}: cheap for how fast it's growing`);
      else if (f.peg < 2) add(5, `PEG ${f.peg.toFixed(2)}: reasonable for its growth`);
      else if (f.peg > 3) add(-10, `PEG ${f.peg.toFixed(2)}: expensive even after accounting for growth`);
    }
  });
  pillar('analysts', 'Analysts', (add) => {
    if (f.targetMean != null && price && (f.analystCount == null || f.analystCount >= 3)) {
      const up = f.targetMean / price - 1;
      if (up > 0.2) add(20, `Analysts' average target ${fmt(f.targetMean)} is ${pct(up)} above today's price`);
      else if (up > 0.08) add(8, `Analysts' average target ${fmt(f.targetMean)} is ${pct(up)} higher`);
      else if (up < -0.05) add(-20, `Price is already above analysts' average target (${fmt(f.targetMean)})`);
      else add(0, `Trading close to analysts' average target (${fmt(f.targetMean)})`);
    }
    const rm = f.recommendationMean;
    if (rm != null && (f.analystCount == null || f.analystCount >= 3)) {
      const who = f.analystCount ? `${f.analystCount} analysts` : 'Analysts';
      if (rm <= 1.8) add(15, `${who} rate it a Strong Buy on average`);
      else if (rm <= 2.5) add(5, `${who} rate it a Buy on average`);
      else if (rm > 3) add(-15, `${who} lean toward Sell`);
    }
  });
  const vals = Object.values(pillars);
  if (!vals.length) return null;
  const score = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const upside = f.targetMean && price ? f.targetMean / price - 1 : null;
  return {
    score,
    pillars,
    grades: Object.fromEntries(Object.entries(pillars).map(([k, v]) => [k, grade(v)])),
    reasons,
    upside,
    source: f.source,
  };
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

// ctx.benchmark: S&P 500 (SPY) candles for relative strength.
// ctx.fundamentals: object from lib/fundamentals.js (or null).
export function analyze(candles, ctx = {}) {
  if (!candles || candles.length < 30) throw new Error('Not enough price history to analyze');
  const ind = computeIndicators(candles);
  const price = last(ind.closes);
  const prev = candles[candles.length - 2].close;
  const atrVal = last(ind.atr14) ?? price * 0.02;
  const levels = keyLevels(candles, price, atrVal);
  const benchCloses = ctx.benchmark?.map((c) => c.close);
  const rs3m = relativeStrength(ind.closes, benchCloses, 63);
  const rs6m = relativeStrength(ind.closes, benchCloses, 126);
  const f = ctx.fundamentals || null;
  const daysToEarnings = f?.nextEarnings ? Math.max(0, Math.round((f.nextEarnings - candles[candles.length - 1].t) / 864e5)) : null;
  const setup = detectSetup(candles, ind, rs3m);

  const shortTerm = { ...shortTermScore(candles, ind, { rs3m, setup, daysToEarnings }), setup, hold: setup?.hold || '1–4 weeks' };

  // Long term = half price trend, half business fundamentals (when we have them).
  const trend = longTermScore(candles, ind);
  if (rs6m != null) {
    if (rs6m > 0.1) trend.reasons.push({ points: 0, text: `Outperformed the S&P 500 by ${pct(rs6m)} over 6 months` });
    else if (rs6m < -0.1) trend.reasons.push({ points: 0, text: `Underperformed the S&P 500 by ${pct(-rs6m)} over 6 months` });
  }
  const fund = fundamentalScore(f, price);
  const ltScore = fund ? Math.round(0.5 * trend.score + 0.5 * fund.score) : trend.score;
  const longTerm = {
    ...trend,
    ...rate(ltScore),
    score: ltScore,
    trendScore: trend.score,
    fundScore: fund?.score ?? null,
    grades: fund?.grades ?? null,
    upside: fund?.upside ?? null,
    reasons: [...trend.reasons.map((r) => ({ ...r, group: 'Trend' })), ...(fund?.reasons || [])],
    hold: '1–5 years',
  };

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
    rs3m,
    rs6m,
    daysToEarnings,
    fundamentals: f,
    shortTerm,
    longTerm,
    levels,
    plan: tradePlan(price, atrVal, levels),
    ltPlan: longTermPlan(price, ind),
    indicators: ind,
  };
}
