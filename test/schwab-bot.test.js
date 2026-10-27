import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunner } from '../bot/runner.js';
import { bracketOrder, exitOco, flattenOrder, fillPrice, Schwab } from '../bot/schwab.js';

// A pretend Schwab that behaves like the real order API: nested orders get ids, children wait
// for the parent, cancelling one leg of an OCO cancels the other.
class FakeSchwab {
  constructor() { this.orders = new Map(); this.sent = []; this.seq = 1000; this.q = {}; this.cash = 100; this.held = {}; this.calls = []; }
  #assign(o, parentStatus) {
    o.orderId = this.seq++;
    o.status = parentStatus;
    if (o.orderLegCollection) o.quantity = o.orderLegCollection[0].quantity;
    this.orders.set(String(o.orderId), o);
    for (const c of o.childOrderStrategies || []) { c.parent = o; this.#assign(c, o.orderStrategyType === 'TRIGGER' ? 'AWAITING_PARENT_ORDER' : parentStatus); }
  }
  async placeOrder(_h, order) {
    const o = structuredClone(order);
    this.sent.push(structuredClone(order));
    this.#assign(o, o.orderType === 'MARKET' ? 'WORKING' : 'WORKING');
    return String(o.orderId);
  }
  async getOrder(_h, id) { const o = this.orders.get(String(id)); return strip(o); }
  async cancelOrder(_h, id) {
    const o = this.orders.get(String(id));
    if (!o || ['FILLED', 'CANCELED'].includes(o.status)) throw new Error('not cancelable');
    const kill = (x) => { if (!['FILLED'].includes(x.status)) x.status = 'CANCELED'; for (const c of x.childOrderStrategies || []) kill(c); };
    kill(o.parent?.orderStrategyType === 'OCO' ? o.parent : o);
    if (o.parent?.orderStrategyType === 'OCO') o.parent.status = 'CANCELED';
  }
  fill(id, price, qty = null) {
    const o = this.orders.get(String(id));
    const n = qty ?? o.quantity;
    o.filledQuantity = n;
    o.status = n === o.quantity ? 'FILLED' : 'WORKING';
    o.orderActivityCollection = [{ executionLegs: [{ price, quantity: n }] }];
    const sym = o.orderLegCollection[0].instrument.symbol;
    const sign = o.orderLegCollection[0].instruction === 'BUY' ? 1 : -1;
    this.held[sym] = (this.held[sym] || 0) + sign * n;
    this.cash -= sign * n * price;
    if (o.status === 'FILLED') for (const c of o.childOrderStrategies || []) activate(c);
    if (o.parent?.orderStrategyType === 'OCO') for (const sib of o.parent.childOrderStrategies) if (sib !== o) sib.status = 'CANCELED';
  }
  find(pred) { return [...this.orders.values()].find(pred); }
  async quotes(syms) { this.calls.push('quotes'); return Object.fromEntries(syms.filter((s) => this.q[s]).map((s) => [s, { ...this.q[s], t: Math.floor(this.time / 1000) }])); }
  async fiveMinuteBars() { return [0, 5, 10, 15, 20, 25].map((k) => ({ t: Date.parse('2026-10-27T13:30:00Z') + k * 60e3, open: 20, high: 20.2, low: 19.8, close: 20 })); }
  async account() { return { type: 'CASH', currentBalances: { cashAvailableForTrading: this.cash }, positions: Object.entries(this.held).filter(([, n]) => n > 0).map(([symbol, longQuantity]) => ({ instrument: { symbol }, longQuantity })) }; }
  async marketOpenToday() { return true; }
}
const activate = (o) => { o.status = 'WORKING'; for (const c of o.childOrderStrategies || []) activate(c); };
const strip = (o) => o && JSON.parse(JSON.stringify(o, (k, v) => (k === 'parent' ? undefined : v)));

const site = { updated: '2026-10-27T12:00:00Z', stocks: [{ symbol: 'ABC', sector: 'Technology', prevClose: 20, atr: 0.8, pBig: 0.6, dollarVol: 1e9 }], etfs: [] };
const et = (hhmm) => Date.parse(`2026-10-27T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, '0')}:${hhmm.slice(3)}:00Z`); // EDT

function setup(mode = 'live', rules = {}) {
  const api = new FakeSchwab();
  let time = et('09:35');
  const clock = { set: (t) => { time = et(t); api.time = time; } };
  clock.set('09:35');
  const state = {};
  const msgs = [];
  const runner = createRunner({
    api, accountHash: 'H', mode, state, save: () => {}, getSiteData: async () => site, notify: (t) => msgs.push(t), log: () => {},
    rules: { startCash: 100, budget: 100, riskPct: 0.02, maxDailyLoss: 5, marketFilter: true, ...rules }, now: () => time,
  });
  api.q = { ABC: { c: 20, o: 19.9, h: 20.2, l: 19.8 }, SPY: { c: 500, o: 499, h: 501, l: 498 } };
  return { api, clock, runner, state, msgs };
}
const at = async (ctx, t, quote) => { ctx.clock.set(t); if (quote) Object.assign(ctx.api.q.ABC, quote); await ctx.runner.tick(); };

test('bracket order JSON matches Schwab\'s 1st-Triggers-OCO format', () => {
  const o = bracketOrder({ symbol: 'SOFI', shares: 6, limit: 15.36, stop: 14.9, target: 16.2 });
  assert.equal(o.orderStrategyType, 'TRIGGER');
  assert.equal(o.orderType, 'LIMIT');
  assert.equal(o.price, 15.36);
  assert.equal(o.orderLegCollection[0].instruction, 'BUY');
  const oco = o.childOrderStrategies[0];
  assert.equal(oco.orderStrategyType, 'OCO');
  assert.deepEqual(oco.childOrderStrategies.map((c) => [c.orderType, c.stopPrice ?? c.price, c.orderLegCollection[0].instruction]), [['LIMIT', 16.2, 'SELL'], ['STOP', 14.9, 'SELL']]);
  assert.throws(() => bracketOrder({ symbol: 'X', shares: 1, limit: 10, stop: 11, target: 12 }));
  assert.equal(exitOco({ symbol: 'X', shares: 1, stop: 9, target: 11 }).childOrderStrategies.length, 2);
  const legs = flattenOrder({ ...o, orderId: 1, childOrderStrategies: [{ ...oco, childOrderStrategies: oco.childOrderStrategies.map((c, i) => ({ ...c, orderId: 2 + i, status: 'WORKING' })) }] });
  assert.equal(legs.length, 3);
  assert.equal(fillPrice({ orderActivityCollection: [{ executionLegs: [{ price: 10, quantity: 1 }, { price: 11, quantity: 3 }] }] }), 10.75);
});

test('login link and weekly expiry', () => {
  const s = new Schwab({ appKey: 'KEY', appSecret: 'S', callbackUrl: 'https://127.0.0.1', tokenFile: '/dev/null' });
  assert.match(s.loginUrl(), /client_id=KEY&redirect_uri=https%3A%2F%2F127\.0\.0\.1/);
  s.tokens = { loggedInAt: Date.now() - 6 * 864e5 };
  assert.ok(s.daysLeft() > 0.9 && s.daysLeft() < 1.1);
});

test('live: breakout → bracket sent → filled → stop to break-even → target', async () => {
  const ctx = setup();
  await at(ctx, '09:35');
  assert.deepEqual(Object.keys(ctx.state.today.watch), ['ABC']);
  await at(ctx, '10:01', { c: 20.1 });
  assert.equal(ctx.state.today.watch.ABC.orHigh, 20.2, 'opening range from Schwab 5-minute bars');
  assert.equal(ctx.api.sent.length, 0);
  await at(ctx, '10:02', { c: 20.25 });
  assert.equal(ctx.api.sent.length, 1);
  const sent = ctx.api.sent[0];
  assert.equal(sent.orderStrategyType, 'TRIGGER');
  assert.ok(sent.price <= 20.34 && sent.orderLegCollection[0].quantity * sent.price <= 100);
  const pos = ctx.state.today.positions[0];
  ctx.api.fill(pos.orderId, 20.26);
  await at(ctx, '10:03', { c: 20.3 });
  assert.ok(pos.filled && pos.entry === 20.26 && pos.stopOrderId && pos.targetOrderId);
  // Up 1R → stop moves to break-even: old stop/target cancelled, new pair sent
  const oldStop = pos.stopOrderId;
  await at(ctx, '10:20', { c: 20.26 + pos.risk + 0.02 });
  assert.equal(ctx.api.sent.length, 2);
  assert.equal(ctx.api.sent[1].orderStrategyType, 'OCO');
  assert.equal(ctx.api.sent[1].childOrderStrategies[1].stopPrice, 20.26);
  assert.equal(ctx.api.orders.get(oldStop).status, 'CANCELED');
  assert.notEqual(pos.stopOrderId, oldStop);
  ctx.api.fill(pos.targetOrderId, pos.target);
  await at(ctx, '10:40', { c: pos.target });
  assert.equal(ctx.state.today.positions.length, 0);
  const t = ctx.state.account.trades[0];
  assert.equal(t.why, 'profit target');
  assert.ok(t.pl > 0);
  assert.ok(ctx.msgs.some((m) => /Bought/.test(m)) && ctx.msgs.some((m) => /profit target/.test(m)));
});

test('live: a buy that does not fill in 90 seconds is cancelled, not chased', async () => {
  const ctx = setup();
  await at(ctx, '09:35');
  await at(ctx, '10:01', { c: 20.1 });
  await at(ctx, '10:02', { c: 20.25 });
  const id = ctx.state.today.positions[0].orderId;
  await at(ctx, '10:04', { c: 20.6 });
  assert.equal(ctx.api.orders.get(id).status, 'CANCELED');
  assert.equal(ctx.state.today.positions.length, 0);
  assert.equal(ctx.state.today.watch.ABC.status, 'missed');
  assert.equal(ctx.state.today.trades, 0);
});

test('live: sells at market before the close and never sells more than it bought', async () => {
  const ctx = setup();
  await at(ctx, '09:35');
  await at(ctx, '10:01', { c: 20.1 });
  await at(ctx, '10:02', { c: 20.25 });
  const pos = ctx.state.today.positions[0];
  ctx.api.fill(pos.orderId, 20.25);
  ctx.api.held.ABC += 50; // shares you owned before: the bot must not touch them
  await at(ctx, '10:03', { c: 20.3 });
  await at(ctx, '15:55', { c: 20.3 });
  const sell = ctx.api.sent.at(-1);
  assert.equal(sell.orderType, 'MARKET');
  assert.equal(sell.orderLegCollection[0].quantity, pos.shares);
  assert.equal(ctx.api.orders.get(pos.stopOrderId).status, 'CANCELED');
  ctx.api.fill(pos.flattenOrderId, 20.3);
  await at(ctx, '15:56', { c: 20.3 });
  assert.match(ctx.state.account.trades[0].why, /end of day/);
  assert.equal(ctx.api.held.ABC, 50);
});

test('live: the kill switch cancels and sells', async () => {
  const ctx = setup();
  await at(ctx, '09:35');
  await at(ctx, '10:01', { c: 20.1 });
  await at(ctx, '10:02', { c: 20.25 });
  const pos = ctx.state.today.positions[0];
  ctx.api.fill(pos.orderId, 20.25);
  await at(ctx, '10:03', { c: 20.3 });
  await ctx.runner.stopAll('You stopped the bot.');
  assert.equal(ctx.api.sent.at(-1).orderType, 'MARKET');
  assert.ok(ctx.state.today.halted);
  await at(ctx, '10:30', { c: 21 });
  assert.equal(ctx.api.sent.filter((o) => o.orderStrategyType === 'TRIGGER').length, 1, 'no new buys after stopping');
});

test('dry run never sends orders but still trades on paper', async () => {
  const ctx = setup('dry-run');
  await at(ctx, '09:35');
  await at(ctx, '10:01', { c: 20.1 });
  await at(ctx, '10:02', { c: 20.25 });
  await at(ctx, '10:03', { c: 20.3 });
  await at(ctx, '10:30', { c: 19.0 });
  assert.equal(ctx.api.sent.length, 0);
  assert.equal(ctx.state.account.trades.length, 1);
  assert.equal(ctx.state.account.trades[0].why, 'stop-loss');
});

test('client refreshes the 30-minute token and reads the order number Schwab returns', async () => {
  const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const tokenFile = `${await mkdtemp(`${tmpdir()}/sw-`)}/t.json`;
  await writeFile(tokenFile, JSON.stringify({ access_token: 'old', refresh_token: 'R', expiresAt: 0, loggedInAt: Date.now() - 864e5 }));
  const seen = [];
  const fakeFetch = async (url, opts) => {
    seen.push([opts.method, url.replace('https://api.schwabapi.com', ''), opts.headers.Authorization]);
    if (url.endsWith('/v1/oauth/token')) {
      assert.match(opts.body, /grant_type=refresh_token&refresh_token=R/);
      return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'R', expires_in: 1800 }), { status: 200 });
    }
    if (opts.method === 'POST') return new Response('', { status: 201, headers: { location: 'https://api.schwabapi.com/trader/v1/accounts/H/orders/987654' } });
    return new Response(JSON.stringify({ SPY: { quote: { lastPrice: 500, openPrice: 499, highPrice: 501, lowPrice: 498, closePrice: 497, tradeTime: Date.now() } } }), { status: 200 });
  };
  const api = new Schwab({ appKey: 'K', appSecret: 'S', tokenFile, fetchImpl: fakeFetch });
  const id = await api.placeOrder('H', bracketOrder({ symbol: 'F', shares: 1, limit: 10, stop: 9.5, target: 11 }));
  assert.equal(id, '987654');
  assert.equal(seen[1][2], 'Bearer new');
  assert.equal(JSON.parse(await readFile(tokenFile, 'utf8')).access_token, 'new');
  assert.equal((await api.quotes(['SPY'])).SPY.c, 500);
});
