import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInfoTable, parseForm4, normalizeName, tickerIndex, holdingsByTicker, compareQuarters } from '../lib/sec-parse.js';
import { playbookContext, playbookAt, markLeaders, smartBits, passesTips } from '../public/js/lib/playbook.js';
import { normalizeRules, pickWatchlist, newBotAccount, newDay, step, applyLearned } from '../public/js/lib/autopilot.js';

const INFO = `<?xml version="1.0"?><ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
<ns1:infoTable><ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip><ns1:value>60000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>300000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
<ns1:infoTable><ns1:nameOfIssuer>BANK AMER CORP</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>060505104</ns1:cusip><ns1:value>30000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>700000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
<ns1:infoTable><ns1:nameOfIssuer>ALPHABET INC</ns1:nameOfIssuer><ns1:titleOfClass>CAP STK CL A</ns1:titleOfClass><ns1:cusip>02079K305</ns1:cusip><ns1:value>10000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>50000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt><ns1:putCall>Call</ns1:putCall></ns1:infoTable>
</ns1:informationTable>`;

const FORM4 = `<?xml version="1.0"?><ownershipDocument>
<issuer><issuerCik>0001234</issuerCik><issuerName>Acme Corp</issuerName><issuerTradingSymbol>acme</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerCik>99</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>
<nonDerivativeTransaction><securityTitle><value>Common</value></securityTitle><transactionDate><value>2026-10-01</value></transactionDate>
<transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>25.50</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><securityTitle><value>Common</value></securityTitle><transactionDate><value>2026-10-02</value></transactionDate>
<transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>500</value></transactionShares><transactionPricePerShare><value>26</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument>`;

const TICKERS = { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 70858, ticker: 'BAC', title: 'BANK OF AMERICA CORP /DE/' }, 2: { cik_str: 1652044, ticker: 'GOOGL', title: 'Alphabet Inc.' }, 3: { cik_str: 1652044, ticker: 'GOOG', title: 'Alphabet Inc.' }, 4: { cik_str: 797468, ticker: 'OXY', title: 'OCCIDENTAL PETROLEUM CORP /DE/' } };

test('13F information table: stock rows parsed, options skipped', () => {
  const rows = parseInfoTable(INFO);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'APPLE INC', cls: 'COM', cusip: '037833100', value: 60000000, shares: 300000, putCall: null });
});

test('13F names match tickers, including abbreviated ones', () => {
  const { byName, cik } = tickerIndex(TICKERS);
  assert.equal(byName.get('APPLE INC'), 'AAPL');
  assert.equal(byName.get('BANK AMER CORP'), 'BAC');
  assert.equal(byName.get('ALPHABET INC CAP STK CL C'), 'GOOGL');
  assert.equal(byName.get('OCCIDENTAL PETE CORP'), 'OXY');
  assert.equal(byName.get('UNKNOWN WIDGETS INC'), null);
  assert.equal(cik.AAPL, 320193);
  assert.equal(normalizeName('Apple Inc.'), normalizeName('APPLE INC'));
  const h = holdingsByTicker(parseInfoTable(INFO), byName);
  assert.ok(Math.abs(h.AAPL.pct - 2 / 3) < 1e-9);
  const cmp = compareQuarters(h, { AAPL: { shares: 200000 } });
  assert.equal(cmp.AAPL.change, 'added');
  assert.equal(cmp.BAC.change, 'new');
  assert.equal(compareQuarters(h, null).AAPL.change, null);
});

test('Form 4: only open-market purchases count', () => {
  const f = parseForm4(FORM4);
  assert.equal(f.symbol, 'ACME');
  assert.equal(f.owner, 'Doe Jane');
  assert.equal(f.role, 'Chief Executive Officer');
  assert.deepEqual(f.buys, [{ code: 'P', date: '2026-10-01', shares: 1000, price: 25.5, ad: 'A' }]);
});

function candles(n, f) {
  return Array.from({ length: n }, (_, i) => { const c = f(i); return { t: Date.UTC(2025, 0, 1) + i * 864e5, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 }; });
}

test('playbook checks: uptrend stock passes Tudor Jones, Minervini and Livermore; downtrend fails', () => {
  const up = candles(300, (i) => 50 + i * 0.3);
  const down = candles(300, (i) => 150 - i * 0.3);
  const bench = candles(300, (i) => 400 + i);
  const a = playbookAt(up, 299, playbookContext(up, bench));
  const b = playbookAt(down, 299, playbookContext(down, bench));
  assert.ok(a.bits & 1 && a.bits & 2 && a.bits & 16, `up bits ${a.bits}`);
  assert.ok(a.bits & 32, 'market uptrend');
  assert.equal(b.bits & (1 | 2 | 16), 0);
  const recs = markLeaders([{ ret63: 0.3, flags: 0 }, { ret63: 0.1, flags: 0 }, { ret63: -0.1, flags: 0 }, { ret63: 0.0, flags: 0 }, { ret63: 0.2, flags: 0 }, { ret63: -0.2, flags: 0 }]);
  assert.deepEqual(recs.map((r) => !!(r.flags & 4)), [true, false, false, false, true, false]);
  // NR7: the narrowest range of the last 7 days
  const nr = candles(20, () => 100).map((c, i) => (i === 19 ? { ...c, high: 100.1, low: 99.9 } : c));
  assert.ok(playbookAt(nr, 19, playbookContext(nr, null)).bits & 8);
});

test('smart-money bits only count filings made before the day', () => {
  const smart = { holdings: { AAPL: [['2026-08-14', '2026-11-14']] }, insiderBuys: { ACME: ['2026-10-03'] } };
  assert.equal(smartBits(smart, 'AAPL', '2026-08-14'), 0, 'filed that day: not known at the open');
  assert.equal(smartBits(smart, 'AAPL', '2026-09-01'), 64);
  assert.equal(smartBits(smart, 'AAPL', '2026-12-01'), 0, 'next filing dropped it');
  assert.equal(smartBits(smart, 'ACME', '2026-10-10'), 128);
  assert.equal(smartBits(smart, 'ACME', '2027-02-01'), 0, 'older than 90 days');
  assert.ok(passesTips(64 | 1, ['funds', 'above200']));
  assert.ok(!passesTips(64, ['funds', 'insider']));
  assert.ok(passesTips(0, ['noGap']), 'the gap rule is checked at the open, not here');
});

test('AutoPilot obeys the playbook: watchlist filter and the gap rule', () => {
  const rec = (symbol, flags) => ({ symbol, sector: 'Technology', prevClose: 20, atr: 0.8, pBig: 0.5, dollarVol: 1e9, flags });
  const r = normalizeRules({ startCash: 100, budget: 100, marketFilter: false, tips: ['above200', 'insider', 'bogus'] });
  assert.deepEqual(r.tips, ['above200', 'insider']);
  const acct = newBotAccount(r);
  assert.deepEqual(pickWatchlist([rec('A', 1), rec('B', 129), rec('C', 128)], r, acct).watch.map((x) => x.symbol), ['B']);

  const g = normalizeRules({ startCash: 100, budget: 100, marketFilter: false, tips: ['noGap'] });
  const s = newDay('2026-10-20', [rec('GAP', 0)], g, newBotAccount(g));
  for (let m = 570; m < 600; m += 5) step(s, 'GAP', { m, o: 21, h: 21.2, l: 20.8, c: 21 }, newBotAccount(g)); // opened 5% up
  step(s, 'GAP', { m: 600, o: 21.1, h: 21.3, l: 21.05, c: 21.25 }, newBotAccount(g));
  assert.equal(s.positions.length, 0);
  assert.match(s.log.at(-1).text, /skip-big-gaps/);
});

test('auto-learn applies only settings that held up, never money limits', () => {
  const r = normalizeRules({ startCash: 100, budget: 80, maxDailyLoss: 4, autoLearn: true, tips: ['above200'] });
  const learned = { heldUp: true, settings: { orMinutes: 15, targetR: 3, breakevenR: 0, marketFilter: false, tips: ['nr7'] } };
  const { rules, note } = applyLearned(r, learned);
  assert.equal(rules.orMinutes, 15);
  assert.equal(rules.targetR, 3);
  assert.deepEqual(rules.tips, ['above200', 'nr7']);
  assert.equal(rules.budget, 80);
  assert.equal(rules.maxDailyLoss, 4);
  assert.match(note, /learned settings/);
  assert.equal(applyLearned(r, { ...learned, heldUp: false }).rules, r);
  assert.equal(applyLearned({ ...r, autoLearn: false }, learned).rules.orMinutes, 30);
});
