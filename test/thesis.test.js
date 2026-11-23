import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thesis } from '../public/js/lib/thesis.js';

const item = {
  symbol: 'ABC', name: 'Abc Corp', sector: 'Technology',
  analysis: {
    price: 100, atr: 2, rsi: 60, sma200: 80, rs3m: 0.12, maxDrawdown: 0.2, daysToEarnings: 5,
    plan: { buyZone: [97, 100], entry: 100, stop: 95, riskPct: 0.05, targets: [107.5, 115, 125], rewardRisk: 1.5 },
    ltPlan: { tranches: [{ price: 100, label: 'Now' }, { price: 92, label: 'Pullback to 50-day avg' }, { price: 82, label: 'Pullback to 200-day avg' }], exitBelow: 76 },
    shortTerm: { score: 70, label: 'Buy', hold: '1–4 weeks', setup: { key: 'pullback', label: 'Pullback', text: 'dipped to its 20-day average', howTo: 'Buy near $98.' },
      reasons: [{ points: 10, text: 'price above rising 50-day average' }, { points: -10, text: 'Earnings report in 5 days. A surprise can gap the price' }] },
    longTerm: { score: 65, label: 'Buy', fundScore: 70, upside: 0.15, grades: { quality: 'A', growth: 'B', value: 'D', analysts: 'C' }, reasons: [] },
  },
};

test('short-term reasoning covers why, risks, plan and invalidation', () => {
  const t = thesis(item, 'shortTerm', {
    sectorRank: { rank: 1, of: 11 },
    smart: { bySymbol: { ABC: { funds: [{ manager: 'Warren Buffett', pct: 0.05, change: 'new' }], insiderValue90: 250000 } } },
    congress: { trades: [{ ticker: 'ABC', type: 'buy', member: '<b>Rep X</b>', filed: new Date().toISOString().slice(0, 10) }] },
  });
  assert.match(t.headline, /short-term buy because a pullback setup/);
  assert.ok(t.why.some((w) => /leader/.test(w)));
  assert.ok(t.why.some((w) => /Warren Buffett/.test(w) && /new this quarter/.test(w)));
  assert.ok(t.why.some((w) => /Insiders are buying/.test(w)));
  assert.ok(t.why.some((w) => /&lt;b&gt;Rep X/.test(w)), 'names from filings are escaped');
  assert.ok(t.risks.some((r) => /Earnings in 5 days/.test(r)));
  assert.match(t.wrongIf, /\$95\.00/);
  assert.ok(t.plan.some((p) => /\$107\.50/.test(p)));
});

test('long-term reasoning uses business grades and the staged plan', () => {
  const t = thesis(item, 'longTerm', {});
  assert.ok(t.why.some((w) => /Solid business/.test(w)));
  assert.ok(t.risks.some((r) => /valuation/.test(r)));
  assert.ok(t.plan.some((p) => /3 stages/.test(p)));
  assert.match(t.wrongIf, /\$76\.00/);
});
