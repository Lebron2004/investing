import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, fundamentalScore, detectSetup, relativeStrength, computeIndicators, grade } from '../public/js/lib/analysis.js';
import { parseQuoteSummary } from '../lib/fundamentals.js';

const mk = (n, fn, vol = () => 1000) => Array.from({ length: n }, (_, i) => {
  const c = fn(i);
  return { t: Date.UTC(2025, 0, 1) + i * 864e5, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: vol(i) };
});

const GREAT = { profitMargin: 0.3, roe: 0.35, debtToEquity: 30, freeCashflow: 1e10, revenueGrowth: 0.25, earningsGrowth: 0.3, forwardPE: 14, peg: 0.8, targetMean: 130, analystCount: 30, recommendationMean: 1.6 };
const AWFUL = { profitMargin: -0.2, roe: -0.3, debtToEquity: 400, freeCashflow: -1e9, revenueGrowth: -0.15, earningsGrowth: -0.5, forwardPE: null, trailingPE: null, targetMean: 80, analystCount: 10, recommendationMean: 3.6 };

test('fundamentalScore grades a great business A and a broken one F', () => {
  const g = fundamentalScore(GREAT, 100);
  const b = fundamentalScore(AWFUL, 100);
  assert.ok(g.score >= 80, `great ${g.score}`);
  assert.ok(b.score < 35, `awful ${b.score}`);
  assert.deepEqual(Object.keys(g.grades).sort(), ['analysts', 'growth', 'quality', 'value']);
  assert.equal(g.grades.quality, 'A');
  assert.equal(b.grades.growth, 'F');
  assert.ok(Math.abs(g.upside - 0.3) < 1e-9);
  assert.ok(g.reasons.every((r) => r.group && r.text));
  assert.equal(fundamentalScore(null, 100), null);
  assert.equal(fundamentalScore({}, 100), null);
});

test('grade boundaries', () => {
  assert.deepEqual([90, 70, 55, 40, 10].map(grade), ['A', 'B', 'C', 'D', 'F']);
});

test('long-term score blends trend and fundamentals 50/50', () => {
  const candles = mk(300, (i) => 50 * Math.exp(0.002 * i));
  const plain = analyze(candles);
  const good = analyze(candles, { fundamentals: GREAT });
  const bad = analyze(candles, { fundamentals: AWFUL });
  assert.equal(plain.longTerm.fundScore, null);
  assert.equal(good.longTerm.trendScore, plain.longTerm.score);
  assert.equal(good.longTerm.score, Math.round((good.longTerm.trendScore + good.longTerm.fundScore) / 2));
  assert.ok(good.longTerm.score > bad.longTerm.score + 20);
  assert.ok(good.longTerm.reasons.some((r) => r.group === 'Growth'));
});

test('relative strength vs the benchmark', () => {
  const a = mk(100, (i) => 100 * (1 + i * 0.004));
  const b = mk(100, (i) => 100);
  assert.ok(relativeStrength(a.map((c) => c.close), b.map((c) => c.close), 63) > 0.2);
  assert.equal(relativeStrength([1, 2], null), null);
});

test('detectSetup finds a breakout on heavy volume', () => {
  // Gentle uptrend, then a jump above the 20-day high on 3× volume.
  const candles = mk(260, (i) => (i < 259 ? 100 + i * 0.05 + Math.sin(i) : 125), (i) => (i === 259 ? 3000 : 1000));
  const s = detectSetup(candles, computeIndicators(candles));
  assert.equal(s?.key, 'breakout');
  assert.match(s.howTo, /failed/);
});

test('detectSetup returns null in a plain downtrend', () => {
  const candles = mk(260, (i) => 200 - i * 0.3);
  assert.equal(detectSetup(candles, computeIndicators(candles)), null);
});

test('earnings within a week costs short-term points', () => {
  const candles = mk(300, (i) => 50 * Math.exp(0.002 * i) * (1 + 0.02 * Math.sin(i / 5)));
  const lastT = candles.at(-1).t;
  const far = analyze(candles, { fundamentals: { ...GREAT, nextEarnings: lastT + 40 * 864e5 } });
  const near = analyze(candles, { fundamentals: { ...GREAT, nextEarnings: lastT + 3 * 864e5 } });
  assert.equal(near.daysToEarnings, 3);
  assert.equal(far.shortTerm.score - near.shortTerm.score, 10);
});

test('parseQuoteSummary normalizes Yahoo\'s {raw, fmt} payload', () => {
  const json = { quoteSummary: { result: [{
    summaryDetail: { trailingPE: { raw: 30.5 }, forwardPE: { raw: 27.1 }, dividendYield: { raw: 0.0045 }, marketCap: { raw: 3.5e12 }, beta: { raw: 1.2 } },
    defaultKeyStatistics: { pegRatio: { raw: 2.1 } },
    financialData: { revenueGrowth: { raw: 0.06 }, profitMargins: { raw: 0.25 }, returnOnEquity: { raw: 1.5 }, debtToEquity: { raw: 150 }, targetMeanPrice: { raw: 250 }, numberOfAnalystOpinions: { raw: 40 }, recommendationMean: { raw: 2.0 }, recommendationKey: 'buy' },
    calendarEvents: { earnings: { earningsDate: [{ raw: Math.floor(Date.now() / 1000) + 10 * 86400 }] } },
    assetProfile: { industry: 'Consumer Electronics', longBusinessSummary: 'Makes phones. '.repeat(60) },
  }] } };
  const f = parseQuoteSummary(json);
  assert.equal(f.forwardPE, 27.1);
  assert.equal(f.dividendYield, 0.0045);
  assert.equal(f.analystCount, 40);
  assert.equal(f.industry, 'Consumer Electronics');
  assert.ok(f.summary.length <= 425);
  assert.ok(f.nextEarnings > Date.now());
  assert.equal(f.source, 'yahoo');
  assert.equal(parseQuoteSummary({ quoteSummary: { result: [{ price: { quoteType: 'ETF' } }] } }), null);
  assert.equal(parseQuoteSummary({}), null);
});
