import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, fill, holdings, placeOrder, processOrders, equityCurve, tradeStats, coachBuy, cancelOrder } from '../public/js/lib/paper.js';

const D = (d) => Date.UTC(2026, 0, d, 14, 30);
const c = (d, o, h, l, cl) => ({ t: D(d), open: o, high: h, low: l, close: cl, volume: 1 });

test('market buys and sells move cash and use average cost', () => {
  const a = newAccount(10000, D(1));
  assert.ok(fill(a, { symbol: 'X', side: 'buy', shares: 10, price: 100, t: D(1) }).ok);
  assert.ok(fill(a, { symbol: 'X', side: 'buy', shares: 10, price: 120, t: D(2) }).ok);
  assert.equal(a.cash, 7800);
  const h = holdings(a);
  assert.equal(h.open[0].shares, 20);
  assert.equal(h.open[0].avgCost, 110);
  assert.ok(fill(a, { symbol: 'X', side: 'sell', shares: 5, price: 130, t: D(3) }).ok);
  const h2 = holdings(a);
  assert.equal(h2.closed[0].pl, 100); // 5 × (130 − 110)
  assert.equal(h2.open[0].avgCost, 110);
  assert.equal(a.cash, 8450);
});

test('cannot spend more cash or sell more shares than you have', () => {
  const a = newAccount(1000);
  assert.match(fill(a, { symbol: 'X', side: 'buy', shares: 11, price: 100 }).error, /Not enough cash/);
  assert.match(fill(a, { symbol: 'X', side: 'sell', shares: 1, price: 100 }).error, /only own 0/);
  assert.equal(a.transactions.length, 0);
});

test('limit buy fills when the low reaches it; gaps fill at the open', () => {
  const a = newAccount(10000, D(1));
  placeOrder(a, { symbol: 'X', side: 'buy', type: 'limit', price: 95, shares: 10, t: D(1) });
  placeOrder(a, { symbol: 'Y', side: 'buy', type: 'limit', price: 50, shares: 10, t: D(1) });
  const candles = {
    X: [c(1, 100, 101, 90, 92), c(2, 99, 100, 96, 98), c(3, 97, 98, 94, 95)], // day 1 ignored (placement day)
    Y: [c(2, 45, 47, 44, 46)], // opens below the limit → fills at 45
  };
  const ev = processOrders(a, candles);
  assert.equal(ev.filter((e) => e.type === 'fill').length, 2);
  const x = a.transactions.find((t) => t.symbol === 'X');
  assert.equal(x.price, 95);
  assert.equal(dayIso(x.t), dayIso(D(3)));
  assert.equal(a.transactions.find((t) => t.symbol === 'Y').price, 45);
});

test('stop-loss sells everything and cancels the other sell orders', () => {
  const a = newAccount(10000, D(1));
  fill(a, { symbol: 'X', side: 'buy', shares: 30, price: 100, t: D(1) });
  placeOrder(a, { symbol: 'X', side: 'sell', type: 'stop', price: 94, shares: 30, t: D(1) });
  placeOrder(a, { symbol: 'X', side: 'sell', type: 'limit', price: 110, shares: 10, t: D(1) });
  processOrders(a, { X: [c(2, 99, 100, 95, 96), c(3, 92, 93, 88, 90)] }); // gap down through the stop
  const sell = a.transactions.find((t) => t.side === 'sell');
  assert.equal(sell.price, 92); // filled at the open, below the stop
  assert.equal(sell.shares, 30);
  assert.equal(a.orders.find((o) => o.type === 'limit').status, 'cancelled');
  assert.equal(holdings(a).open.length, 0);
});

test('target limit sells part, stop then sells the rest', () => {
  const a = newAccount(10000, D(1));
  fill(a, { symbol: 'X', side: 'buy', shares: 30, price: 100, t: D(1) });
  placeOrder(a, { symbol: 'X', side: 'sell', type: 'limit', price: 110, shares: 10, t: D(1) });
  placeOrder(a, { symbol: 'X', side: 'sell', type: 'stop', price: 94, shares: 30, t: D(1) });
  processOrders(a, { X: [c(2, 105, 111, 104, 109), c(3, 100, 101, 90, 91)] });
  const sells = a.transactions.filter((t) => t.side === 'sell');
  assert.deepEqual(sells.map((s) => [s.shares, s.price]), [[10, 110], [20, 94]]);
});

test('cancelled orders never fill', () => {
  const a = newAccount(10000, D(1));
  const o = placeOrder(a, { symbol: 'X', side: 'buy', type: 'limit', price: 95, shares: 1, t: D(1) });
  cancelOrder(a, o.id);
  assert.equal(processOrders(a, { X: [c(2, 90, 91, 80, 85)] }).length, 0);
});

test('equity curve tracks cash + holdings and the S&P benchmark', () => {
  const a = newAccount(1000, D(1));
  fill(a, { symbol: 'X', side: 'buy', shares: 10, price: 50, t: D(1) });
  const bench = [c(1, 0, 0, 0, 400), c(2, 0, 0, 0, 440)];
  const curve = equityCurve(a, { X: [c(1, 50, 50, 50, 50), c(2, 60, 60, 60, 60)] }, bench);
  assert.deepEqual(curve.map((p) => p.value), [1000, 1100]);
  assert.deepEqual(curve.map((p) => p.bench), [1000, 1100]);
});

test('trade stats and coach', () => {
  const a = newAccount(10000, D(1));
  fill(a, { symbol: 'X', side: 'buy', shares: 10, price: 100, t: D(1) });
  fill(a, { symbol: 'X', side: 'sell', shares: 10, price: 90, t: D(2) });
  fill(a, { symbol: 'Y', side: 'buy', shares: 10, price: 100, t: D(1) });
  fill(a, { symbol: 'Y', side: 'sell', shares: 10, price: 130, t: D(2) });
  const s = tradeStats(a);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.realized, 200);
  assert.equal(s.best.symbol, 'Y');
  const good = coachBuy({ shares: 10, price: 100, stop: 92, equity: 10000 });
  const bad = coachBuy({ shares: 60, price: 100, stop: null, equity: 10000 });
  assert.equal(good.grade, 'A');
  assert.ok(bad.notes.filter((n) => !n.ok).length >= 2);
});

test('a limit buy with protection places its stop and target only after it fills', () => {
  const a = newAccount(10000, D(1));
  placeOrder(a, { symbol: 'X', side: 'buy', type: 'limit', price: 95, shares: 30, t: D(1), attach: { stop: 88, target: 105, targetShares: 10 } });
  processOrders(a, { X: [c(2, 99, 100, 96, 98)] });
  assert.equal(a.orders.length, 1, 'nothing attached before the fill');
  processOrders(a, { X: [c(2, 99, 100, 96, 98), c(3, 97, 98, 94, 96), c(4, 96, 106, 95, 104)] });
  const sells = a.transactions.filter((t) => t.side === 'sell');
  assert.deepEqual(sells.map((s) => [s.shares, s.price]), [[10, 105]]);
  assert.equal(a.orders.filter((o) => o.status === 'open' && o.type === 'stop').length, 1);
});

const dayIso = (t) => new Date(t).toISOString().slice(0, 10);
