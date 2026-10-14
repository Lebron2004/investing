import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHoldingsCSV, parseNumber, planPortfolio } from '../public/js/lib/portfolio.js';
import { RISK_PROFILES } from '../public/js/lib/sizing.js';

const FIDELITY = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today's Gain/Loss Dollar,Today's Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Average Cost Basis,Type
Z123,Individual,SPAXX**,HELD IN MONEY MARKET,,,,$1520.33,,,,,5%,,,Cash
Z123,Individual,AAPL,APPLE INC,10,$230.00,+$1.00,$2300.00,+$10,+0.4%,+$800,+53%,10%,$1500.00,$150.00,Margin
Z123,Individual,MSFT,MICROSOFT CORP,"1,000",$400.00,,"$400,000.00",,,,,,"$300,000.00",$300.00,Cash
Z456,Roth IRA,AAPL,APPLE INC,10,$230.00,,$2300.00,,,,,,$2500.00,$250.00,Cash
Z123,Individual,Pending Activity,,,,,$-50.00,,,,,,,,

"The data and information in this spreadsheet is provided to you solely for your use..."`;

const SCHWAB = `"Positions for account Individual ...123 as of 04:00 PM ET, 2026/10/14"
"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Security Type"
"NVDA","NVIDIA CORP","25","$120.00","$3,000.00","$2,000.00","Equity"
"VOO","VANGUARD S&P 500 ETF","4.5","$500.00","$2,250.00","$1,800.00","ETFs & Closed End Funds"
"AAPL 01/16/2027 250.00 C","CALL APPLE","1","$5.00","$500.00","$300.00","Option"
"Cash & Cash Investments","--","--","--","$812.50","--","Cash and Money Market"
"Account Total","--","--","--","$6,562.50","$4,100.00","--"`;

const VANGUARD = `Account Number,Investment Name,Symbol,Shares,Share Price,Total Value,
12345678,VANGUARD FEDERAL MONEY MARKET,VMFXX,300.25,1,300.25,
12345678,VANGUARD TOTAL STOCK MARKET ETF,VTI,12,280.5,3366,

Account Number,Trade Date,Settlement Date,Transaction Type,Transaction Description,Investment Name,Symbol,Shares,Share Price,Principal Amount,
12345678,2026-01-02,2026-01-03,Buy,Buy,VANGUARD TOTAL STOCK MARKET ETF,VTI,2,250,500,`;

test('parseNumber handles money formats', () => {
  assert.equal(parseNumber('$1,234.50'), 1234.5);
  assert.equal(parseNumber('($12.00)'), -12);
  assert.equal(parseNumber('-$5'), -5);
  assert.equal(parseNumber('--'), null);
  assert.equal(parseNumber(''), null);
});

test('imports a Fidelity export: merges accounts, finds cash, skips junk', () => {
  const r = parseHoldingsCSV(FIDELITY);
  assert.equal(r.error, undefined);
  assert.equal(r.cash, 1520.33);
  const aapl = r.holdings.find((h) => h.symbol === 'AAPL');
  assert.equal(aapl.shares, 20);
  assert.equal(aapl.avgCost, 200); // (10×150 + 10×250) / 20
  assert.equal(r.holdings.find((h) => h.symbol === 'MSFT').shares, 1000);
  assert.equal(r.holdings.length, 2);
});

test('imports a Schwab export with a title row and odd headers', () => {
  const r = parseHoldingsCSV(SCHWAB);
  assert.deepEqual(r.holdings.map((h) => h.symbol), ['NVDA', 'VOO']);
  assert.equal(r.holdings[0].avgCost, 80); // $2,000 total / 25
  assert.equal(r.holdings[1].shares, 4.5);
  assert.equal(r.cash, 812.5);
  assert.equal(r.skipped.length, 1);
});

test('imports a Vanguard export and stops at the transactions section', () => {
  const r = parseHoldingsCSV(VANGUARD);
  assert.deepEqual(r.holdings, [{ symbol: 'VTI', shares: 12, avgCost: null }]);
  assert.equal(r.cash, 300.25);
});

test('reports an error for a file without positions columns', () => {
  assert.ok(parseHoldingsCSV('Date,Amount\n2026-01-01,5').error);
});

// Minimal stand-ins for analyze() output.
const fake = (price, lt, st, extra = {}) => ({
  price, rsi: 55,
  longTerm: { score: lt }, shortTerm: { score: st },
  plan: { stop: price * 0.93 }, ltPlan: { exitBelow: price * 0.85 },
  ...extra,
});

test('planPortfolio: sells broken stocks, trims weak ones, rebalances giants, adds to leaders', () => {
  const analyses = {
    BAD: fake(10, 20, 30),
    WEAK: fake(50, 38, 50),
    BIG: fake(100, 60, 50),
    GOOD: fake(20, 75, 70),
    OK: fake(30, 50, 50),
  };
  const holdings = [
    { symbol: 'BAD', shares: 100, avgCost: 15 },   // $1,000
    { symbol: 'WEAK', shares: 21, avgCost: 40 },   // $1,050
    { symbol: 'BIG', shares: 60, avgCost: 50 },    // $6,000 → 60% of $10k
    { symbol: 'GOOD', shares: 25, avgCost: 10 },   // $500
    { symbol: 'OK', shares: 10, avgCost: 30 },     // $300
    { symbol: 'NODATA', shares: 5, avgCost: 10 },  // $50 (priced at cost)
  ];
  const plan = planPortfolio({ holdings, cash: 1100, analyses, profile: RISK_PROFILES.moderate });
  const by = Object.fromEntries(plan.rows.map((r) => [r.symbol, r.action]));
  assert.equal(plan.total, 10000);
  assert.equal(by.BAD.type, 'sell');
  assert.equal(by.BAD.shares, 100);
  assert.equal(by.WEAK.type, 'trim');
  assert.equal(by.WEAK.shares, 10);
  assert.equal(by.BIG.type, 'rebalance');
  assert.equal(by.BIG.shares, 45); // back to 15% = $1,500
  assert.equal(by.GOOD.type, 'add');
  assert.ok(by.GOOD.shares > 0);
  assert.ok(by.GOOD.shares * 20 + 500 <= 1500 + 1e-9, 'adds never exceed the max position size');
  assert.equal(by.OK.type, 'hold');
  assert.equal(by.NODATA.type, 'unknown');
  assert.equal(plan.rows[0].action.type, 'sell', 'sells are listed first');
  assert.ok(plan.cashAfter >= 0);
});

test('planPortfolio: no cash means no adds', () => {
  const plan = planPortfolio({
    holdings: [{ symbol: 'GOOD', shares: 10, avgCost: 10 }, { symbol: 'VOO', shares: 10, avgCost: 400 }],
    cash: 0,
    analyses: { GOOD: fake(20, 75, 70), VOO: fake(500, 70, 65) },
    profile: RISK_PROFILES.moderate,
  });
  assert.ok(plan.rows.every((r) => r.action.type === 'hold'));
});

test('planPortfolio: broad index funds are never sold on weak signals', () => {
  const plan = planPortfolio({
    holdings: [{ symbol: 'VOO', shares: 10, avgCost: 400 }],
    cash: 0,
    analyses: { VOO: fake(500, 10, 20) },
    profile: RISK_PROFILES.moderate,
  });
  assert.equal(plan.rows[0].action.type, 'hold');
});

test('planPortfolio: symbols without data are left out of gain/loss', () => {
  const plan = planPortfolio({
    holdings: [{ symbol: 'NODATA', shares: 10, avgCost: 5 }],
    cash: 0, analyses: {}, profile: RISK_PROFILES.moderate,
  });
  assert.equal(plan.rows[0].pl, null);
  assert.equal(plan.costBasis, 0);
});
