// Day-trade AI: two small logistic-regression models trained on daily price history.
//   • "big"  → probability the NEXT session has a big range (high − low ≥ 1.2 × ATR): stocks "in play"
//   • "up"   → probability the NEXT session closes above its open (an intraday up day)
// Trained from scratch on this site's own data each build (no chatbot, no outside AI service).
// Pure functions: used by scripts/build-static.js, server.js and the tests.

import { atr, sma, rsi } from './indicators.js';

export const FEATURES = [
  ['move', 'Yesterday\'s move (in ATRs)'],
  ['gap', 'Yesterday\'s opening gap (in ATRs)'],
  ['range', 'Yesterday\'s range vs. normal'],
  ['closePos', 'Where it closed in its range (0 = low, 1 = high)'],
  ['rvol', 'Volume vs. 20-day average'],
  ['rsi', 'RSI (momentum)'],
  ['dist20', 'Distance from 20-day average (ATRs)'],
  ['trend', '20-day vs. 50-day average (ATRs)'],
  ['atrPct', 'Daily volatility (ATR %)'],
  ['mom5', '5-day momentum'],
  ['rs5', '5-day strength vs. S&P 500'],
  ['mkt', 'S&P 500 move yesterday'],
];

// Feature row for day i (all information known at day i's close). Returns null if not enough data.
export function featuresAt(c, i, ctx) {
  const { a, s20, s50, r, v20, benchByDay } = ctx;
  if (i < 60 || a[i] == null || s50[i] == null || r[i] == null || !v20[i]) return null;
  const d = c[i], p = c[i - 1], p5 = c[i - 5];
  const atrPct = a[i] / d.close;
  const rng = d.high - d.low;
  const day = new Date(d.t).toISOString().slice(0, 10);
  const b = benchByDay?.get(day);
  const benchRet5 = b?.ret5 ?? 0;
  const mom5 = d.close / p5.close - 1;
  return [
    (d.close - p.close) / a[i],
    (d.open - p.close) / a[i],
    rng / a[i],
    rng > 0 ? (d.close - d.low) / rng : 0.5,
    Math.min(5, (d.volume || 0) / v20[i]),
    (r[i] - 50) / 50,
    (d.close - s20[i]) / a[i],
    (s20[i] - s50[i]) / a[i],
    atrPct * 100,
    mom5 / (atrPct * Math.sqrt(5)),
    (mom5 - benchRet5) * 100,
    (b?.ret1 ?? 0) * 100,
  ];
}

export function indicatorContext(c, bench) {
  const closes = c.map((x) => x.close);
  const benchByDay = new Map();
  if (bench) {
    bench.forEach((x, i) => {
      if (i < 5) return;
      benchByDay.set(new Date(x.t).toISOString().slice(0, 10), { ret1: x.close / bench[i - 1].close - 1, ret5: x.close / bench[i - 5].close - 1 });
    });
  }
  return { a: atr(c, 14), s20: sma(closes, 20), s50: sma(closes, 50), r: rsi(closes, 14), v20: sma(c.map((x) => x.volume || 0), 20), benchByDay };
}

// Training rows from one stock's history: features at day i, labels from day i + 1.
export function samplesFor(c, bench) {
  const ctx = indicatorContext(c, bench);
  const rows = [];
  for (let i = 60; i < c.length - 1; i++) {
    const x = featuresAt(c, i, ctx);
    if (!x) continue;
    const n = c[i + 1];
    rows.push({ x, big: (n.high - n.low) / ctx.a[i] >= 1.2 ? 1 : 0, up: n.close > n.open ? 1 : 0, day: new Date(n.t).toISOString().slice(0, 10) });
  }
  return rows;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

export function standardize(X) {
  const k = X[0].length;
  const mean = new Array(k).fill(0), std = new Array(k).fill(0);
  for (const x of X) for (let j = 0; j < k; j++) mean[j] += x[j] / X.length;
  for (const x of X) for (let j = 0; j < k; j++) std[j] += (x[j] - mean[j]) ** 2 / X.length;
  for (let j = 0; j < k; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

// Full-batch gradient descent with L2 regularization.
export function trainLogistic(X, y, { mean, std }, { iters = 300, lr = 0.5, l2 = 1e-3 } = {}) {
  const k = mean.length, n = X.length;
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));
  const w = new Array(k).fill(0);
  let b = Math.log((y.reduce((a, v) => a + v, 0) + 1) / (n - y.reduce((a, v) => a + v, 0) + 1));
  for (let it = 0; it < iters; it++) {
    const gw = new Array(k).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = Z[i];
      let s = b;
      for (let j = 0; j < k; j++) s += w[j] * z[j];
      const err = sigmoid(s) - y[i];
      gb += err;
      for (let j = 0; j < k; j++) gw[j] += err * z[j];
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < k; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
  }
  return { w, b };
}

export function predict(model, x, { mean, std }) {
  let s = model.b;
  for (let j = 0; j < x.length; j++) s += model.w[j] * ((x[j] - mean[j]) / std[j]);
  return sigmoid(s);
}

// Area under the ROC curve: chance a random positive scores above a random negative (0.5 = coin flip).
export function auc(scores, labels) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rank = 0, sumPos = 0, pos = 0;
  for (const i of idx) { rank++; if (labels[i]) { sumPos += rank; pos++; } }
  const neg = labels.length - pos;
  return pos && neg ? (sumPos - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5;
}

function evaluate(p, y) {
  const n = y.length;
  const base = y.reduce((a, v) => a + v, 0) / n;
  const acc = p.reduce((a, v, i) => a + ((v >= 0.5) === (y[i] === 1) ? 1 : 0), 0) / n;
  const order = p.map((v, i) => i).sort((a, b) => p[b] - p[a]);
  const top = order.slice(0, Math.max(1, Math.floor(n / 10)));
  const topRate = top.reduce((a, i) => a + y[i], 0) / top.length;
  return { n, baseRate: base, accuracy: acc, auc: auc(p, y), top10Rate: topRate };
}

/**
 * Trains both models on every stock's history and tests them on the most recent `holdoutDays`
 * sessions (data the models never saw). histories: [{ symbol, candles }], bench: SPY candles.
 */
export function trainDayModels(histories, bench, { holdoutDays = 40 } = {}) {
  const all = histories.flatMap((h) => samplesFor(h.candles, bench));
  if (all.length < 500) return null;
  const days = [...new Set(all.map((r) => r.day))].sort();
  const cut = days[Math.max(0, days.length - holdoutDays)];
  const train = all.filter((r) => r.day < cut), test = all.filter((r) => r.day >= cut);
  const norm = standardize(train.map((r) => r.x));
  const out = { trainedAt: new Date().toISOString(), samples: train.length, testSamples: test.length, testFrom: cut, features: FEATURES.map(([k, label]) => ({ k, label })), mean: norm.mean, std: norm.std };
  for (const target of ['big', 'up']) {
    const m = trainLogistic(train.map((r) => r.x), train.map((r) => r[target]), norm);
    const p = test.map((r) => predict(m, r.x, norm));
    out[target] = { ...m, metrics: evaluate(p, test.map((r) => r[target])) };
  }
  return out;
}

// Plain-English reasons: which features pushed this prediction up the most.
export function explain(model, target, x, k = 3) {
  const m = model[target];
  const contrib = x.map((v, j) => ({ j, c: m.w[j] * ((v - model.mean[j]) / model.std[j]) }));
  return contrib.sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, k).map(({ j, c }) => ({ label: FEATURES[j][1], up: c > 0 }));
}
