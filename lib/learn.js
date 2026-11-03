// Auto-learn: re-runs AutoPilot's Train on the newest days the AI never trained on and returns the
// published data/learned.json. Used by scripts/build-static.js (every site update) and server.js.

import { tune } from '../public/js/lib/autopilot.js';

// Learning uses a large paper account so the results don't depend on which stocks $100 can afford.
const LEARN_RULES = { startCash: 10000, budget: 10000, riskPct: 0.01, maxDailyLoss: 300, maxTrades: 3, maxOpen: 2, pdt: false, cashAccount: false };

/**
 * days: sorted sessions; records: { day: [[symbol, prevClose, atr, pBig, dollarVol, flags]] };
 * sectorOf: { SYM: sector }; barsOf(symbol, day) → 5-minute bars; testFrom: the AI's holdout start.
 */
export function learnSettings({ days, records, sectorOf, barsOf, testFrom, source = 'live', updated = new Date().toISOString() }) {
  const learnDays = days.filter((d) => !testFrom || d >= testFrom).map((day) => {
    const recs = (records[day] || []).map(([symbol, prevClose, atr, pBig, dollarVol, flags]) => ({ symbol, sector: sectorOf[symbol], prevClose, atr, pBig, dollarVol, flags }));
    return {
      day,
      records: recs,
      spy: barsOf('SPY', day) || [],
      bars: Object.fromEntries(recs.map((r) => [r.symbol, barsOf(r.symbol, day)]).filter(([, b]) => b)),
    };
  });
  if (learnDays.length < 10) return null;
  const t = tune(LEARN_RULES, learnDays);
  const pick = (x) => ({ totalR: x.totalR, trades: x.trades, winRate: x.winRate == null ? null : Math.round(x.winRate * 1000) / 1000 });
  return {
    updated, source,
    trainDays: [t.trainDays[0], t.trainDays.at(-1), t.trainDays.length],
    testDays: [t.testDays[0], t.testDays.at(-1), t.testDays.length],
    settings: t.best.settings, heldUp: t.heldUp,
    best: { train: pick(t.best.train), test: pick(t.best.test) },
    defaults: { settings: t.current.settings, train: pick(t.current.train), test: pick(t.current.test) },
    baseline: { train: pick(t.baseline.train), test: pick(t.baseline.test) },
    tips: t.tips.map((x) => ({ key: x.key, keep: x.keep, train: pick(x.train), test: pick(x.test) })),
  };
}
