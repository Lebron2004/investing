import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalLine } from '../public/js/lib/signal.js';

const mk = (fn, n = 300) => Array.from({ length: n }, (_, i) => {
  const c = fn(i);
  return { t: Date.UTC(2025, 0, 1) + i * 864e5, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1 };
});

test('steady uptrend: line under price, status HOLD', () => {
  const s = signalLine(mk((i) => 50 + i * 0.5));
  const i = 299;
  assert.equal(s.dir[i], 1);
  assert.ok(s.line[i] < 50 + i * 0.5);
  assert.match(s.status.label, /HOLD|BUY/);
  assert.ok(s.status.stop > 0 && s.status.distance > 0);
});

test('rally then crash: BUY then SELL, line above price after the crash', () => {
  const s = signalLine(mk((i) => (i < 220 ? 50 + i * 0.5 : 160 - (i - 220) * 1.5)));
  const types = s.signals.filter((x) => x.type !== 'hot').map((x) => x.type);
  assert.ok(types.includes('sell'));
  assert.equal(s.dir[299], -1);
  assert.ok(s.line[299] > 160 - 79 * 1.5);
  assert.match(s.status.label, /SELL/);
});

test('trend filter turns a flip-up below the 200-day into WAIT', () => {
  // long decline, then a short bounce that stays below the 200-day average
  const s = signalLine(mk((i) => (i < 260 ? 200 - i * 0.5 : 70 + (i - 260) * 1.2)));
  const ups = s.signals.filter((x) => x.type === 'buy' || x.type === 'wait');
  assert.equal(ups.at(-1).type, 'wait');
  const s2 = signalLine(mk((i) => (i < 260 ? 200 - i * 0.5 : 70 + (i - 260) * 1.2)), { trendFilter: false });
  assert.equal(s2.signals.filter((x) => x.type === 'buy' || x.type === 'wait').at(-1).type, 'buy');
});

test('the uptrend line never moves down', () => {
  const s = signalLine(mk((i) => 50 + i * 0.4 + 3 * Math.sin(i / 4)));
  for (let i = 1; i < 300; i++) {
    if (s.dir[i] === 1 && s.dir[i - 1] === 1) assert.ok(s.line[i] >= s.line[i - 1] - 1e-9, `bar ${i}`);
  }
});

// TradingView's reference implementation of ta.supertrend (from the Pine Script docs), ported 1:1.
function pineSupertrend(candles, factor, atrPeriod) {
  const tr = candles.map((c, i) => (i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close))));
  const atrArr = []; let prev = null;
  for (let i = 0; i < candles.length; i++) {
    if (i < atrPeriod - 1) { atrArr.push(null); continue; }
    prev = prev == null ? tr.slice(0, atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod : (prev * (atrPeriod - 1) + tr[i]) / atrPeriod; // ta.rma
    atrArr.push(prev);
  }
  const out = []; let up = null, lo = null, st = null, dir = null;
  candles.forEach((c, i) => {
    const a = atrArr[i];
    if (a == null) { out.push(null); return; }
    const src = (c.high + c.low) / 2;
    let upper = src + factor * a, lower = src - factor * a;
    const prevLower = lo ?? 0, prevUpper = up ?? 0;
    lower = lower > prevLower || candles[i - 1].close < prevLower ? lower : prevLower;
    upper = upper < prevUpper || candles[i - 1].close > prevUpper ? upper : prevUpper;
    if (atrArr[i - 1] == null) dir = 1;
    else if (st === prevUpper) dir = c.close > upper ? -1 : 1;
    else dir = c.close < lower ? 1 : -1;
    st = dir === -1 ? lower : upper;
    up = upper; lo = lower;
    out.push({ st, up: dir === -1 });
  });
  return out;
}

test('matches TradingView\'s ta.supertrend bar for bar', () => {
  const candles = mk((i) => 80 + 25 * Math.sin(i / 17) + i * 0.08 + 3 * Math.sin(i * 1.7), 400);
  const ours = signalLine(candles);
  const tv = pineSupertrend(candles, 3, 14);
  let compared = 0;
  for (let i = 20; i < candles.length; i++) {
    if (!tv[i]) continue;
    assert.equal(ours.dir[i] === 1, tv[i].up, `direction at bar ${i}`);
    assert.ok(Math.abs(ours.line[i] - tv[i].st) < 1e-9, `line at bar ${i}`);
    compared++;
  }
  assert.ok(compared > 350);
});
