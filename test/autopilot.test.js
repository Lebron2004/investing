import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, pickWatchlist, newDay, step, endDay, newBotAccount, replay, tune, dayTradesInWindow, businessDaysBack, haltDay, ruleWarnings } from '../public/js/lib/autopilot.js';
import { demoIntradayDay } from '../lib/demo-intraday.js';

const rec = (symbol, extra = {}) => ({ symbol, sector: 'Technology', prevClose: 20, atr: 0.8, pBig: 0.5, dollarVol: 1e9, ...extra });
const bar = (m, o, h, l, c) => ({ m, o, h, l, c });
const rules = (x = {}) => normalizeRules({ startCash: 100, budget: 100, riskPct: 0.02, maxDailyLoss: 5, marketFilter: false, ...x });

// Opening range 19.80–20.20 (9:30–10:00), then whatever bars the test adds.
function day(r, extraBars, { sym = 'ABC', account = newBotAccount(r) } = {}) {
  const s = newDay('2026-10-20', [rec(sym)], r, account);
  for (let m = 570; m < 600; m += 5) step(s, sym, bar(m, 20, 20.2, 19.8, 20), account);
  for (const b of extraBars) step(s, sym, b, account);
  return { s, account };
}

test('rules are clamped to safe values', () => {
  const r = normalizeRules({ startCash: 100, budget: 5000, riskPct: 0.9, maxTrades: 99, allow: 'sofi, f  $$$ ', orMinutes: 7 });
  assert.equal(r.budget, 100, 'budget can never exceed the account');
  assert.equal(r.riskPct, 0.1);
  assert.equal(r.maxTrades, 20);
  assert.deepEqual(r.allow, ['SOFI', 'F']);
  assert.equal(r.orMinutes, 30);
  assert.ok(ruleWarnings(normalizeRules({ riskPct: 0.05 })).length > 0);
});

test('watchlist obeys sectors, allow/block lists, price and budget', () => {
  const recs = [rec('AAA', { pBig: 0.9 }), rec('BBB', { sector: 'Energy', pBig: 0.8 }), rec('CCC', { prevClose: 150, atr: 3, pBig: 0.95 }), rec('DDD', { pBig: 0.1 }), rec('EEE', { dollarVol: 1e6 })];
  const acct = newBotAccount(rules());
  assert.deepEqual(pickWatchlist(recs, rules(), acct).watch.map((r) => r.symbol), ['AAA', 'BBB', 'DDD'], 'CCC costs more than $100, EEE is illiquid; ranked by the AI');
  assert.deepEqual(pickWatchlist(recs, rules({ sectors: ['Energy'] }), acct).watch.map((r) => r.symbol), ['BBB']);
  assert.deepEqual(pickWatchlist(recs, rules({ allow: ['DDD', 'CCC'] }), acct).watch.map((r) => r.symbol), ['DDD']);
  assert.deepEqual(pickWatchlist(recs, rules({ block: ['AAA'] }), acct).watch.map((r) => r.symbol), ['BBB', 'DDD']);
  assert.deepEqual(pickWatchlist(recs, rules({ maxPrice: 10 }), acct).watch, []);
});

test('buys the opening-range breakout with a stop and target, sized to the risk', () => {
  const { s, account } = day(rules(), [bar(600, 20.1, 20.3, 20.05, 20.25)]);
  assert.equal(s.positions.length, 1);
  const p = s.positions[0];
  assert.ok(p.entry >= 20.22 && p.entry < 20.25, `entry ${p.entry}`);
  assert.ok(p.stop < p.entry && p.target > p.entry);
  assert.ok(p.shares * (p.entry - p.stop) <= 2.0001, 'never risks more than 2% of $100');
  assert.ok(p.shares * p.entry <= 100);
  assert.ok(account.cash < 100);
});

test('stop-loss, break-even and target exits', () => {
  // Stop
  let { s, account } = day(rules(), [bar(600, 20.1, 20.3, 20.05, 20.25), bar(605, 20.2, 20.2, 19.5, 19.6)]);
  assert.equal(s.positions.length, 0);
  assert.ok(account.trades[0].pl < 0 && account.trades[0].why === 'stop-loss');
  assert.ok(account.trades[0].pl >= -2.1);
  // Target (2R)
  ({ s, account } = day(rules(), [bar(600, 20.1, 20.3, 20.05, 20.25), bar(605, 20.3, 22, 20.3, 21.9)]));
  assert.equal(account.trades[0].why, 'profit target');
  assert.ok(Math.abs(account.trades[0].R - 2) < 0.1, `R ${account.trades[0].R}`);
  // Break-even: up 1R, then back down
  ({ s, account } = day(rules(), [bar(600, 20.1, 20.3, 20.05, 20.25), bar(605, 20.3, 20.65, 20.3, 20.6), bar(610, 20.5, 20.5, 20.0, 20.1)]));
  assert.equal(account.trades[0].why, 'break-even stop');
  assert.ok(Math.abs(account.trades[0].pl) < 0.2);
});

test('never holds overnight and never buys after the last-buy time', () => {
  let { s, account } = day(rules(), [bar(600, 20.1, 20.3, 20.05, 20.25), bar(950, 20.4, 20.45, 20.35, 20.4)]);
  assert.equal(s.positions.length, 0);
  assert.match(account.trades[0].why, /end of day/);
  ({ s } = day(rules(), [bar(905, 20.1, 20.3, 20.05, 20.25)]));
  assert.equal(s.positions.length, 0);
  assert.match(s.log.at(-1).text, /last-buy time/);
});

test('respects max trades, the daily loss limit and the budget', () => {
  const r = rules({ maxTrades: 5, maxOpen: 1, maxDailyLoss: 3, cashAccount: false });
  const account = newBotAccount(r);
  const s = newDay('2026-10-20', [rec('AAA'), rec('BBB'), rec('CCC')], r, account);
  for (const sym of ['AAA', 'BBB', 'CCC']) for (let m = 570; m < 600; m += 5) step(s, sym, bar(m, 20, 20.2, 19.8, 20), account);
  step(s, 'AAA', bar(600, 20.1, 20.3, 20.05, 20.25), account);
  step(s, 'BBB', bar(600, 20.1, 20.3, 20.05, 20.25), account);
  assert.equal(s.positions.length, 1, 'max 1 open position');
  step(s, 'AAA', bar(605, 20.2, 20.2, 19.5, 19.6), account); // stopped out (−~2)
  step(s, 'BBB', bar(610, 20.1, 20.3, 20.05, 20.25), account);
  const lossRoom = 3 + s.realized;
  const p = s.positions[0];
  assert.ok(p.shares * (p.entry - p.stop) <= lossRoom + 0.01, 'second trade is shrunk to fit the loss limit');
  step(s, 'BBB', bar(615, 19.2, 19.3, 19.0, 19.1), account); // gaps through the stop
  assert.ok(s.halted, 'halts after the daily loss limit');
  step(s, 'CCC', bar(620, 20.1, 20.3, 20.05, 20.25), account);
  assert.equal(s.positions.length, 0, 'no buys once halted');
  assert.ok(s.realized >= -6, 'only a gap through the stop can push past the limit');
  endDay(s, account);
  assert.equal(account.days.length, 1);
});

test('cash account: money spent today is not reused', () => {
  const r = rules({ maxTrades: 5, riskPct: 0.1, maxDailyLoss: 50 });
  const account = newBotAccount(r);
  const s = newDay('2026-10-20', [rec('AAA'), rec('BBB')], r, account);
  for (const sym of ['AAA', 'BBB']) for (let m = 570; m < 600; m += 5) step(s, sym, bar(m, 20, 20.2, 19.8, 20), account);
  step(s, 'AAA', bar(600, 20.1, 20.3, 20.05, 20.25), account);
  step(s, 'AAA', bar(605, 20.3, 22, 20.3, 21.9), account); // target hit
  const spent = s.spent;
  step(s, 'BBB', bar(610, 20.1, 20.3, 20.05, 20.25), account);
  const used = s.positions[0] ? s.positions[0].shares * s.positions[0].entry : 0;
  assert.ok(spent + used <= 100.01, `spent ${spent} + ${used}`);
});

test('market filter and pattern-day-trader rule block entries', () => {
  const r = rules({ marketFilter: true });
  const account = newBotAccount(r);
  let s = newDay('2026-10-20', [rec('ABC')], r, account);
  step(s, 'SPY', bar(570, 500, 500, 500, 500), account);
  for (let m = 570; m < 600; m += 5) step(s, 'ABC', bar(m, 20, 20.2, 19.8, 20), account);
  step(s, 'SPY', bar(600, 495, 495, 495, 495), account);
  step(s, 'ABC', bar(600, 20.1, 20.3, 20.05, 20.25), account);
  assert.equal(s.positions.length, 0);
  assert.match(s.log.at(-1).text, /S&P 500 is down/);

  assert.deepEqual(businessDaysBack('2026-10-20', 5), ['2026-10-20', '2026-10-19', '2026-10-16', '2026-10-15', '2026-10-14']);
  const busy = { ...newBotAccount(r), dayTrades: ['2026-10-14', '2026-10-15', '2026-10-19', '2026-10-09'] };
  assert.equal(dayTradesInWindow(busy, '2026-10-20'), 3);
  ({ s } = day(rules({ pdt: true }), [bar(600, 20.1, 20.3, 20.05, 20.25)], { account: busy }));
  assert.equal(s.positions.length, 0);
  assert.match(s.log.at(-1).text, /Pattern-day-trader/);
});

test('does not chase a gap far above the trigger', () => {
  const { s } = day(rules(), [bar(600, 21, 21.2, 20.9, 21.1)]);
  assert.equal(s.positions.length, 0);
  assert.match(s.log.at(-1).text, /Not chasing/);
});

test('stop for today sells everything', () => {
  const { s, account } = day(rules(), [bar(600, 20.1, 20.3, 20.05, 20.25)]);
  haltDay(s, 620, 'You stopped the bot for today.', { ABC: 20.3 }, account);
  assert.equal(s.positions.length, 0);
  assert.ok(s.halted);
  assert.ok(Math.abs(account.cash - 100 - account.trades[0].pl) < 0.01);
});

test('replay and tune run end to end on simulated days', () => {
  const days = [];
  for (let k = 0; k < 16; k++) {
    const d = `2026-09-${String(k + 1).padStart(2, '0')}`;
    const records = ['AAA', 'BBB', 'CCC', 'DDD'].map((sym, j) => rec(sym, { prevClose: 15 + j, pBig: 0.3 + j * 0.1 }));
    const bars = {};
    for (const r of records) {
      const o = r.prevClose * (1 + ((k * 7 + r.symbol.charCodeAt(0)) % 5 - 2) / 200);
      const c = o * (1 + ((k * 3 + r.symbol.charCodeAt(1)) % 9 - 4) / 100);
      bars[r.symbol] = demoIntradayDay(`${r.symbol}${d}`, { open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c });
    }
    days.push({ day: d, records, bars, spy: demoIntradayDay(`SPY${d}`, { open: 500, high: 505, low: 497, close: 502 }) });
  }
  const { stats, account } = replay(rules(), days);
  assert.equal(stats.days, 16);
  assert.ok(stats.trades > 0);
  assert.ok(account.trades.every((t) => t.shares * t.entry <= 100.01));
  assert.ok(account.days.every((d) => d.pl >= -5.5), 'no day loses much more than the limit');
  const t = tune(rules(), days, { minTrades: 1 });
  assert.equal(t.tried, 36);
  assert.equal(t.trainDays.length + t.testDays.length, 16);
  assert.ok(t.best.settings && typeof t.best.test.totalR === 'number');
});

test('demo intraday bars match the daily candle', () => {
  const b = demoIntradayDay('X', { open: 10, high: 10.6, low: 9.7, close: 10.3 });
  assert.equal(b.length, 78);
  assert.equal(b[0][0], 570);
  assert.equal(b[0][1], 10);
  assert.ok(Math.abs(b.at(-1)[4] - 10.3) < 1e-9);
  assert.ok(Math.abs(Math.max(...b.map((x) => x[2])) - 10.6) < 1e-6);
  assert.ok(Math.abs(Math.min(...b.map((x) => x[3])) - 9.7) < 1e-6);
});
