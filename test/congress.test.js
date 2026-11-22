import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { parseReport, parseIndex, unzip, tradedTickers } from '../lib/congress.js';
import { copyPortfolio, memberSummary } from '../public/js/lib/copytrade.js';
import { smartBits } from '../public/js/lib/playbook.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('House report text → transactions (real Pelosi report)', () => {
  const t = parseReport(fixture('ptr-pelosi-20035143.txt'));
  assert.equal(t.length, 7);
  assert.deepEqual(t.map((x) => [x.ticker, x.assetType, x.type, x.owner]), [
    ['BE', 'ST', 'buy', 'SP'], ['BE', 'OP', 'buy', 'SP'], ['BE', 'ST', 'buy', 'SP'], ['BE', 'OP', 'buy', 'SP'],
    ['INTC', 'OP', 'buy', 'SP'], ['INTC', 'ST', 'buy', 'SP'], [null, 'AB', 'buy', 'SP'],
  ]);
  assert.equal(t[0].txDate, '2026-07-24');
  assert.equal(t[0].lo, 1000001);
  assert.equal(t[0].hi, 5000000);
  assert.match(t[5].asset, /^Intel Corporation/);
});

test('sales, other members and non-stock assets', () => {
  const [w] = parseReport(fixture('ptr-webster-20034562.txt'));
  assert.deepEqual([w.ticker, w.type, w.txDate, w.notified, w.lo, w.hi, w.owner], ['REXR', 'sell', '2025-02-26', '2025-03-01', 15001, 50000, 'self']);
  assert.match(w.asset, /^Rexford Industrial Realty/);
  const [c] = parseReport(fixture('ptr-wittman-20034916.txt'));
  assert.deepEqual([c.ticker, c.type, c.lo, c.hi], ['CCI', 'sell', 1001, 15000]);
  const [tb] = parseReport(fixture('ptr-yakym-20035691.txt'));
  assert.equal(tb.ticker, null);
  assert.equal(tb.assetType, 'GS');
  const partial = parseReport('$200? Microsoft Corporation - Common Stock (MSFT) [ST] S (partial) 10/27/2026 11/01/2026 $15,001 - $50,000 F S : New');
  assert.equal(partial[0].type, 'partial');
  const big = parseReport('$200? SP NVIDIA Corporation - Common Stock (NVDA) [ST] P 01/02/2026 01/03/2026 Over $50,000,000');
  assert.deepEqual([big[0].lo, big[0].hi], [50000000, null]);
});

test('yearly index: ZIP + XML → transaction reports only', () => {
  const xml = '﻿<FinancialDisclosure><Member><Prefix>Hon.</Prefix><Last>Pelosi</Last><First>Nancy</First><Suffix /><FilingType>P</FilingType><StateDst>CA11</StateDst><Year>2026</Year><FilingDate>8/21/2026</FilingDate><DocID>20035143</DocID></Member>'
    + '<Member><Last>Aaron</Last><First>Richard</First><FilingType>W</FilingType><StateDst>MI04</StateDst><Year>2026</Year><FilingDate>4/15/2026</FilingDate><DocID>8068</DocID></Member></FinancialDisclosure>';
  const zip = makeZip('2026FD.xml', Buffer.from(xml));
  const files = unzip(zip);
  const idx = parseIndex(files['2026FD.xml'].toString('utf8').replace(/^﻿/, ''));
  assert.deepEqual(idx, [{ name: 'Nancy Pelosi', last: 'Pelosi', state: 'CA11', year: '2026', filed: '2026-08-21', docId: '20035143' }]);
});

// A one-file ZIP (deflate), enough to test the reader.
function makeZip(name, data) {
  const comp = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, n, comp]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, n, end]);
}

const candles = (prices, start = '2026-01-05') => prices.map((p, i) => ({ t: Date.parse(`${start}T14:30:00Z`) + i * 864e5, open: p, high: p, low: p, close: p }));

test('copy portfolio buys after the filing, follows sells, and beats nothing it cannot see', () => {
  // ABC: 10 for 10 days, then 20. The member bought on day 1 but only reported on day 5.
  const abc = candles([10, 10, 10, 10, 10, 10, 20, 20, 20, 20]);
  const spy = candles([100, 100, 100, 100, 100, 100, 100, 100, 100, 110]);
  const trades = [
    { member: 'A', ticker: 'ABC', type: 'buy', txDate: '2026-01-05', filed: '2026-01-09', lo: 1001, hi: 15000 },
    { member: 'A', ticker: 'ABC', type: 'partial', txDate: '2026-01-12', filed: '2026-01-12', lo: 1001, hi: 15000 },
    { member: 'B', ticker: 'XYZ', type: 'buy', txDate: '2026-01-05', filed: '2026-01-06', lo: 1001, hi: 15000 },
  ];
  const r = copyPortfolio(trades, (s) => ({ ABC: abc, SPY: spy }[s] ?? null), { members: ['A'], start: '2026-01-01', budget: 1000, slicePct: 0.1, bench: spy });
  const buy = r.fills[0];
  assert.equal(buy.day, '2026-01-10', 'next trading day after the filing');
  assert.equal(buy.lag, 4);
  assert.equal(r.fills[1].side, 'sell');
  assert.ok(Math.abs(r.fills[1].shares - 5) < 0.01, 'partial sale sells half');
  assert.ok(Math.abs(r.value - 1100) < 1, `value ${r.value}`); // $900 cash + 5 sold at 20 + 5 held at 20
  assert.ok(Math.abs(r.stats.benchRet - 0.1) < 1e-9);
  assert.equal(r.skipped.length, 0, 'member B is not copied');
  const everyone = copyPortfolio(trades, (s) => ({ ABC: abc, SPY: spy }[s] ?? null), { start: '2026-01-01', budget: 1000, bench: spy });
  assert.equal(everyone.skipped[0].reason, 'no price data on this site');
  assert.deepEqual(memberSummary(trades).map((m) => [m.name, m.trades, m.buys, m.sells]), [['A', 2, 1, 1], ['B', 1, 1, 0]]);
  assert.deepEqual(tradedTickers({ trades }), ['ABC', 'XYZ']);
});

test('the Congress tip only counts purchases already reported', () => {
  const smart = { congressBuys: { NVDA: ['2026-10-01'] } };
  assert.equal(smartBits(smart, 'NVDA', '2026-10-01'), 0);
  assert.equal(smartBits(smart, 'NVDA', '2026-10-15'), 256);
  assert.equal(smartBits(smart, 'NVDA', '2026-12-15'), 0, 'older than 60 days');
});
