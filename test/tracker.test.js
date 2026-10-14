import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayTrade } from '../public/js/lib/tracker.js';

// Build candles from [high, low, close] triples, one per weekday starting 2026-01-05.
function candles(rows) {
  const start = Date.UTC(2026, 0, 5);
  return rows.map(([high, low, close], i) => ({ t: start + i * 864e5, open: close, high, low, close, volume: 1000 }));
}
// 30 flat days at $100 so ATR/SMA exist, then the test rows. Entry is on the last flat day.
const flat = Array.from({ length: 30 }, () => [101, 99, 100]);
const entryDate = new Date(Date.UTC(2026, 0, 5) + 29 * 864e5).toISOString().slice(0, 10);
const trade = { symbol: 'X', entryDate, entry: 100, shares: 30, stop: 95, targets: [105, 110, 120] };

test('targets sell a third each and move the stop up', () => {
  const r = replayTrade(trade, candles([...flat, [103, 99, 102], [106, 101, 104], [111, 104, 109], [121, 110, 118]]));
  const sells = r.events.filter((e) => e.type === 'target');
  assert.deepEqual(sells.map((e) => e.shares), [10, 10, 10]);
  assert.equal(r.closed, true);
  assert.equal(r.realized, 10 * 5 + 10 * 10 + 10 * 20);
  assert.equal(r.today.action, 'sell-all');
});

test('a close below the stop sells everything', () => {
  const r = replayTrade(trade, candles([...flat, [101, 97, 98], [98, 93, 94]]));
  assert.equal(r.closed, true);
  const stop = r.events.find((e) => e.type === 'stop');
  assert.equal(stop.shares, 30);
  assert.equal(stop.price, 94);
  assert.equal(r.today.action, 'sell-all');
});

test('an intraday dip below the stop that closes above it is NOT a sell', () => {
  const r = replayTrade(trade, candles([...flat, [101, 93, 97]]));
  assert.equal(r.closed, false);
  assert.equal(r.open, 30);
  assert.ok(['hold', 'watch'].includes(r.today.action));
});

test('after Target 1 a fall to entry exits at break-even, not at the original stop', () => {
  const r = replayTrade(trade, candles([...flat, [106, 101, 104], [104, 98, 99]]));
  assert.equal(r.events[0].type, 'target');
  const stop = r.events.find((e) => e.type === 'stop');
  assert.ok(stop, 'stopped out');
  assert.equal(stop.shares, 20);
  assert.ok(r.stop >= 100, 'stop was at least break-even');
});

test('no candles after entry → just opened', () => {
  const r = replayTrade({ ...trade, entryDate: '2099-01-01' }, candles(flat));
  assert.equal(r.startIdx, -1);
  assert.equal(r.today.action, 'hold');
  assert.equal(r.open, 30);
});

test('holding comfortably above the stop says hold', () => {
  const r = replayTrade(trade, candles([...flat, [103, 100, 102], [104, 101, 103]]));
  assert.equal(r.today.action, 'hold');
  assert.match(r.today.title, /Hold/);
});
