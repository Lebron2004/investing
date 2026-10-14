import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, clusterLevels, maxDrawdown } from '../public/js/lib/indicators.js';
import { analyze, rate } from '../public/js/lib/analysis.js';
import { positionSize, sellPlan, allocate, buyList } from '../public/js/lib/sizing.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function makeCandles(n, fn) {
  return Array.from({ length: n }, (_, i) => {
    const c = fn(i);
    return { t: i * 864e5, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 };
  });
}

test('sma and ema', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = ema([1, 2, 3, 4, 5], 3);
  near(e[2], 2); near(e[3], 3); near(e[4], 4);
});

test('rsi is 100 for a straight rise and 0 for a straight fall', () => {
  const up = Array.from({ length: 30 }, (_, i) => 10 + i);
  const down = Array.from({ length: 30 }, (_, i) => 50 - i);
  assert.equal(rsi(up).at(-1), 100);
  near(rsi(down).at(-1), 0);
});

test('atr of constant-range candles equals the range', () => {
  const c = makeCandles(30, () => 100);
  near(atr(c).at(-1), 2, 1e-9);
});

test('clusterLevels merges nearby prices', () => {
  const out = clusterLevels([100, 100.5, 101, 120]);
  assert.equal(out.length, 2);
  assert.equal(out[0].touches, 3);
});

test('maxDrawdown', () => {
  near(maxDrawdown([100, 120, 90, 130]), -0.25);
});

test('analyze: steady uptrend rates bullish long-term, downtrend bearish', () => {
  const up = analyze(makeCandles(300, (i) => 50 * Math.exp(0.002 * i) * (1 + 0.02 * Math.sin(i / 5))));
  const down = analyze(makeCandles(300, (i) => 200 * Math.exp(-0.002 * i) * (1 + 0.02 * Math.sin(i / 5))));
  assert.ok(up.longTerm.score >= 58, `uptrend score ${up.longTerm.score}`);
  assert.ok(down.longTerm.score < 43, `downtrend score ${down.longTerm.score}`);
  for (const a of [up, down]) {
    assert.ok(a.plan.stop < a.plan.entry, 'stop below entry');
    assert.ok(a.plan.targets[0] > a.plan.entry, 'target above entry');
    assert.ok(a.plan.targets[0] < a.plan.targets[1] && a.plan.targets[1] < a.plan.targets[2], 'targets ascend');
    assert.ok(a.plan.buyZone[0] <= a.plan.buyZone[1]);
    assert.ok(a.shortTerm.reasons.length > 0 && a.longTerm.reasons.length > 0);
  }
});

test('rate thresholds', () => {
  assert.equal(rate(80).label, 'Strong Buy');
  assert.equal(rate(60).label, 'Buy');
  assert.equal(rate(50).label, 'Hold');
  assert.equal(rate(35).label, 'Sell');
  assert.equal(rate(10).label, 'Strong Sell');
});

test('positionSize follows the 1% rule and the position cap', () => {
  const p = positionSize({ account: 10000, riskPct: 0.01, entry: 50, stop: 45, maxPositionPct: 0.5 });
  assert.equal(p.shares, 20);
  assert.equal(p.dollarsAtRisk, 100);
  assert.equal(p.limitedBy, 'risk');
  const capped = positionSize({ account: 10000, riskPct: 0.02, entry: 100, stop: 99, maxPositionPct: 0.1 });
  assert.equal(capped.shares, 10);
  assert.equal(capped.limitedBy, 'position cap');
  assert.ok(positionSize({ account: 1000, riskPct: 0.01, entry: 10, stop: 11 }).error);
  const frac = positionSize({ account: 500, riskPct: 0.01, entry: 400, stop: 380, maxPositionPct: 0.25, fractional: true });
  assert.equal(frac.shares, 0.25);
});

test('sellPlan splits shares and never sells more than owned', () => {
  for (const n of [1, 2, 3, 10, 31]) {
    const sp = sellPlan(n, 100, 95, [107, 115, 125]);
    assert.equal(sp.steps.reduce((a, s) => a + s.sell, 0), n);
  }
  near(sellPlan(30, 100, 95, [107, 115, 125]).profitIfAllTargets, 10 * 7 + 10 * 15 + 10 * 25);
});

test('allocate sums to the full amount', () => {
  for (const p of ['conservative', 'moderate', 'aggressive']) for (const h of ['short', 'mixed', 'long']) {
    const a = allocate(5000, p, h);
    near(Object.values(a).reduce((s, x) => s + x.dollars, 0), 5000, 1e-6);
  }
});

test('buyList never overspends', () => {
  const { rows, leftover } = buyList(1000, [{ symbol: 'A', weight: 0.5, price: 333 }, { symbol: 'B', weight: 0.5, price: 70 }]);
  assert.equal(rows[0].shares, 1);
  assert.equal(rows[1].shares, 7);
  assert.ok(leftover >= 0);
});
