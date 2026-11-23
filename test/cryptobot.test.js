import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCryptoRules, replayCrypto, trainCrypto, newCryptoAccount, prepare, stepBar, checkBreaker, equity } from '../public/js/lib/cryptobot.js';

const H = 6 * 3600e3;
const bars = (closes) => closes.map((c, i) => ({ t: Date.UTC(2026, 0, 1) + i * H, open: c, high: c * 1.005, low: c * 0.995, close: c, volume: 1 }));
// Flat, then a strong uptrend, then a crash.
const series = [...Array(250).fill(100), ...Array.from({ length: 150 }, (_, i) => 100 + i), ...Array.from({ length: 100 }, (_, i) => 250 - i * 2)];

test('turtle breakout catches the trend and the stop / exit gets it out', () => {
  const r = replayCrypto({ strategy: 'turtle', trendFilter: false, coins: ['BTC'], startCash: 1000, budget: 1000, timeframe: '6h' }, { BTC: bars(series) });
  assert.ok(r.account.trades.length >= 1);
  const first = r.account.trades[0];
  assert.ok(first.exit > first.entry, 'rode the uptrend');
  assert.ok(r.stats.pl > 0);
  assert.ok(r.stats.fees > 0, 'fees are charged');
  assert.equal(r.account.positions.length, 0, 'closed at the end of the test');
});

test('risk per trade sizes the position and fees count toward it', () => {
  const rules = normalizeCryptoRules({ strategy: 'turtle', trendFilter: false, coins: ['BTC'], startCash: 1000, budget: 1000, riskPct: 0.02, fee: 0.006 });
  const a = newCryptoAccount(rules);
  const p = prepare(bars(series), rules);
  for (let i = 0; i < 300 && !a.positions.length; i++) stepBar(a, rules, 'BTC', p, i);
  const pos = a.positions[0];
  const loss = pos.qty * (pos.entry - pos.stop) + pos.qty * pos.entry * rules.fee * 2;
  assert.ok(loss <= 20.01, `risk ${loss}`);
});

test('limits: max positions, daily loss and the drawdown circuit breaker', () => {
  const rules = normalizeCryptoRules({ coins: ['BTC', 'ETH'], maxPositions: 1, maxDrawdownPct: 0.1, startCash: 100, budget: 100 });
  const a = newCryptoAccount(rules);
  a.positions.push({ coin: 'BTC', qty: 1, entry: 100, entryT: 0, stop: 50, cost: 100, fees: 0 });
  a.cash = 0;
  checkBreaker(a, rules, { BTC: 85 }, 1);
  assert.match(a.halted, /Circuit breaker/);
  assert.equal(equity(a, { BTC: 85 }), 85);
  assert.equal(normalizeCryptoRules({ coins: ['BTC', 'FAKE'] }).coins.join(), 'BTC');
  assert.equal(normalizeCryptoRules({ startCash: 50, budget: 500 }).budget, 50);
});

test('train picks on the older part and reports the newer part', () => {
  const t = trainCrypto({ coins: ['BTC'] }, { BTC: bars([...series, ...series.map((x) => x * 1.1)]) });
  assert.ok(t.best.settings.strategy);
  assert.equal(typeof t.best.test.ret, 'number');
  assert.equal(typeof t.best.test.holdRet, 'number');
});
