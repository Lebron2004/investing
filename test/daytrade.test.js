import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainDayModels, standardize, trainLogistic, predict, auc } from '../public/js/lib/daymodel.js';
import { nyClock, intradaySnapshot, buildDeskData, rankDesk, applyQuote, deskTips } from '../public/js/lib/daytrade.js';

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// Synthetic market with volatility clustering: big-range days follow big-range days,
// so a model that learns from yesterday's range should beat a coin flip.
function series(seed, n = 420) {
  const r = rng(seed);
  let p = 50 + seed % 50, vol = 0.015;
  return Array.from({ length: n }, (_, i) => {
    if (r() < 0.08) vol = 0.006 + r() * 0.04; // regime change
    const o = p * (1 + (r() - 0.5) * vol * 0.4);
    const c = o * (1 + (r() - 0.5) * vol * 2);
    const h = Math.max(o, c) * (1 + r() * vol), l = Math.min(o, c) * (1 - r() * vol);
    p = c;
    return { t: Date.UTC(2025, 0, 1) + i * 864e5, open: o, high: h, low: l, close: c, volume: 1e6 * (1 + vol * 40 * r()) };
  });
}

test('logistic regression learns a simple rule', () => {
  const r = rng(7);
  const X = Array.from({ length: 2000 }, () => [r() * 2 - 1, r() * 2 - 1]);
  const y = X.map(([a]) => (a > 0 ? 1 : 0));
  const norm = standardize(X);
  const m = trainLogistic(X, y, norm, { iters: 300 });
  assert.ok(predict(m, [0.8, 0], norm) > 0.8);
  assert.ok(predict(m, [-0.8, 0], norm) < 0.2);
  assert.equal(auc([0.1, 0.9, 0.2, 0.8], [0, 1, 0, 1]), 1);
});

test('day model beats a coin flip on unseen days when volatility clusters', () => {
  const bench = series(1);
  const hist = Array.from({ length: 12 }, (_, k) => ({ symbol: `S${k}`, candles: series(100 + k) }));
  const model = trainDayModels(hist, bench, { holdoutDays: 60 });
  assert.ok(model.samples > 3000);
  assert.ok(model.big.metrics.auc > 0.6, `auc ${model.big.metrics.auc}`);
  assert.ok(model.big.metrics.top10Rate > model.big.metrics.baseRate);
  assert.equal(model.features.length, model.mean.length);
});

test('market clock phases (New York time)', () => {
  assert.equal(nyClock(new Date('2026-10-19T13:00:00Z')).phase, 'pre'); // 9:00 EDT
  assert.equal(nyClock(new Date('2026-10-19T13:45:00Z')).phase, 'opening');
  assert.equal(nyClock(new Date('2026-10-19T14:30:00Z')).phase, 'morning');
  assert.equal(nyClock(new Date('2026-10-19T16:30:00Z')).phase, 'lunch');
  assert.equal(nyClock(new Date('2026-10-19T19:45:00Z')).phase, 'power');
  assert.equal(nyClock(new Date('2026-10-19T21:00:00Z')).phase, 'after');
  assert.equal(nyClock(new Date('2026-10-18T15:00:00Z')).phase, 'weekend');
  assert.equal(nyClock(new Date('2026-10-19T14:30:00Z')).open, true);
});

test('intraday snapshot: VWAP, opening range, relative volume', () => {
  const bars = Array.from({ length: 12 }, (_, i) => ({ t: Date.UTC(2026, 9, 19, 13, 30 + i * 5), open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000 }));
  const s = intradaySnapshot(bars, 78 * 1000);
  assert.equal(s.orHigh, 106); // first 6 bars
  assert.equal(s.orLow, 99);
  assert.ok(Math.abs(s.vwap - (bars.reduce((a, b) => a + (b.high + b.low + b.close) / 3, 0) / 12)) < 1e-9);
  assert.ok(Math.abs(s.rvol - 1) < 1e-9);
});

test('budget filter, plans and share math', () => {
  const clock = nyClock(new Date('2026-10-19T14:30:00Z'));
  const recs = [
    { symbol: 'CHEAP', prevClose: 20, yHigh: 20.5, yLow: 19.5, atr: 0.6, atrPct: 0.03, dollarVol: 2e8, pBig: 0.7, pUp: 0.55, yRvol: 1.5, yClosePos: 0.8, intraday: null },
    { symbol: 'PRICY', prevClose: 900, yHigh: 910, yLow: 890, atr: 20, atrPct: 0.022, dollarVol: 5e9, pBig: 0.6, pUp: 0.5, intraday: null },
    { symbol: 'THIN', prevClose: 10, yHigh: 10.2, yLow: 9.8, atr: 0.3, atrPct: 0.03, dollarVol: 1e6, pBig: 0.9, pUp: 0.6, intraday: null },
  ];
  const small = rankDesk(recs, { budget: 500, riskPct: 0.01 });
  assert.deepEqual(small.picks.map((p) => p.symbol), ['CHEAP']);
  assert.equal(small.skipped.price, 1);
  assert.equal(small.skipped.liquidity, 1);
  const p = small.picks[0].plan;
  assert.ok(p.stop < p.entry && p.t1 > p.entry && p.t2 > p.t1);
  assert.ok(p.maxLoss <= 500 * 0.01 + 1e-9, 'never risks more than 1% of the budget');
  assert.ok(p.cost <= 500 + 1e-9, 'never spends more than the budget');
  const big = rankDesk(recs, { budget: 50000, riskPct: 0.01 });
  assert.equal(big.picks.length, 2);
  // live quote turns the record into an intraday one
  const live = applyQuote(recs[0], { c: 21, h: 21.2, l: 20.1, o: 20.2, pc: 20, t: 1760884200 }, clock);
  assert.equal(live.intraday.last, 21);
  const ranked = rankDesk([live], { budget: 1000 });
  assert.equal(ranked.picks[0].bias, 'long');
  const tips = deskTips({ clock, market: null, budget: 1000, riskPct: 0.01, ranked });
  assert.ok(tips.some((x) => /Pattern Day Trader/.test(x.text)));
});

test('buildDeskData forecasts from the last completed day', () => {
  const bench = series(1);
  const model = trainDayModels([{ symbol: 'A', candles: series(5) }, { symbol: 'B', candles: series(6) }], bench);
  const recs = buildDeskData([{ symbol: 'A', name: 'A', sector: 'X', candles: series(5), intraday: null }], bench, model, nyClock(new Date('2026-10-18T15:00:00Z')));
  assert.equal(recs.length, 1);
  assert.ok(recs[0].pBig > 0 && recs[0].pBig < 1);
  assert.equal(recs[0].intraday, null);
});
