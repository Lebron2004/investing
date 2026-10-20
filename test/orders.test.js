import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder, brokerSteps, BROKERS } from '../public/js/lib/orders.js';

const base = { symbol: 'sofi', shares: 6, entryType: 'stop', entry: 15.28, stop: 14.9, target: 16.1, price: 14.785, account: 100, cash: 100 };
const errors = (o) => o.checks.filter((c) => c.level === 'error').map((c) => c.text);

test('a valid breakout bracket has three legs and no errors', () => {
  const o = buildOrder(base);
  assert.equal(o.symbol, 'SOFI');
  assert.deepEqual(o.legs.map((l) => [l.side, l.type, l.price]), [['Buy', 'Stop market', 15.28], ['Sell', 'Stop market', 14.9], ['Sell', 'Limit', 16.1]]);
  assert.deepEqual(errors(o), []);
  assert.ok(o.checks.some((c) => /Reward : risk is 2\.2/.test(c.text)));
  assert.ok(o.checks.some((c) => c.level === 'warn' && /2\.3% of your/.test(c.text)), 'flags risking more than 2% of a $100 account');
});

test('catches the classic mistakes', () => {
  assert.match(errors(buildOrder({ ...base, entry: 14.7, stop: 14.3 }))[0], /buy STOP must be above the current price/);
  assert.match(errors(buildOrder({ ...base, stop: 15.5 }))[0], /must be below your entry/);
  assert.match(errors(buildOrder({ ...base, target: 15 }))[0], /must be above your entry/);
  assert.match(errors(buildOrder({ ...base, shares: 10 }))[0], /more than your \$100\.00 cash/);
  assert.match(errors(buildOrder({ ...base, symbol: '' }))[0], /symbol/);
  assert.match(errors(buildOrder({ ...base, stop: 0 }))[0], /stop-loss/);
});

test('every broker gets numbered steps that mention the real prices', () => {
  const o = buildOrder(base);
  for (const b of Object.keys(BROKERS)) {
    const steps = brokerSteps(b, o);
    assert.ok(steps.length >= 4, b);
    const text = steps.map((s) => s.detail).join(' ');
    assert.ok(text.includes('14.90') && text.includes('16.10'), `${b} mentions stop and target`);
  }
  assert.match(brokerSteps('schwab', o)[1].detail, /1st Triggers OCO/);
  assert.match(brokerSteps('tos', o)[1].detail, /1st trgs OCO/);
});
