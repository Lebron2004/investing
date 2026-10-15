import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickScenario, gradeStop, gradeTarget, expectedShares, classTrade, replayTo, finalResult, MAX_HOLD_DAYS } from '../public/js/lib/classroom.js';

// Uptrend with periodic pullbacks so setups appear.
const candles = Array.from({ length: 400 }, (_, i) => {
  const c = 50 * Math.exp(0.0025 * i) * (1 + 0.04 * Math.sin(i / 6));
  return { t: Date.UTC(2025, 0, 1) + i * 864e5, open: c, high: c * 1.012, low: c * 0.988, close: c, volume: 1000 + (i % 20 === 0 ? 3000 : 0) };
});

test('pickScenario finds a setup with room to trade it', () => {
  const sc = pickScenario(candles, () => 0.5);
  assert.ok(sc, 'scenario found');
  assert.ok(sc.d >= 220 && sc.d <= candles.length - MAX_HOLD_DAYS - 1);
  assert.ok(sc.setup.key);
  assert.equal(sc.entry, candles[sc.d].close);
  assert.ok(sc.atr > 0 && sc.support < sc.entry);
  assert.equal(pickScenario(candles.slice(0, 100)), null);
});

test('stop grading', () => {
  const sc = { entry: 100, atr: 2, support: 96 };
  assert.equal(gradeStop(sc, 101).ok, false);
  assert.match(gradeStop(sc, 99).text, /Too tight/);
  assert.match(gradeStop(sc, 90).text, /Too wide/);
  assert.equal(gradeStop(sc, 97).ok, 'meh'); // above support
  assert.equal(gradeStop(sc, 95).ok, true);
});

test('target grading and share math', () => {
  const sc = { entry: 100, resistance: 108 };
  assert.equal(gradeTarget(sc, 95, 105).ok, false); // 1:1
  assert.equal(gradeTarget(sc, 95, 110).ok, true); // 2:1
  assert.equal(gradeTarget(sc, 95, 99).ok, false);
  assert.equal(expectedShares(100, 95).shares, 20); // $100 risk / $5
  assert.equal(expectedShares(100, 99.5).shares, 25); // capped at 25% of $10k
});

test('replay and results', () => {
  const sc = pickScenario(candles, () => 0.5);
  const trade = classTrade(sc, { stop: sc.entry - 2 * sc.atr, target: sc.entry + 4 * sc.atr, shares: 10 });
  const r0 = replayTo(candles, sc, trade, 0);
  assert.equal(r0.open, 10);
  const r = replayTo(candles, sc, trade, MAX_HOLD_DAYS);
  const res = finalResult(sc, trade, r, r.closed ? null : { price: r.price });
  assert.ok(Number.isFinite(res.pl) && Number.isFinite(res.r));
});
