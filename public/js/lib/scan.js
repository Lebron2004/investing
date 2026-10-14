// Compact per-symbol summary used by Top Ideas and the Money Planner, so those pages can
// load one small file for the whole universe instead of ~150 full price histories.

import { analyze } from './analysis.js';
import { pctChange } from './indicators.js';
import { UNIVERSE } from './universe.js';

// ctx.benchmark: SPY candles, for relative strength.
export function summarize(data, ctx = {}) {
  const { indicators, ...analysis } = analyze(data.candles, { benchmark: ctx.benchmark, fundamentals: data.fundamentals });
  if (analysis.fundamentals) {
    const { summary, industry, ...rest } = analysis.fundamentals; // keep the scan file small
    analysis.fundamentals = rest;
  }
  analysis.oneMonth = pctChange(indicators.closes, 21);
  analysis.threeMonth = pctChange(indicators.closes, 63);
  const meta = UNIVERSE.find((u) => u.symbol === data.symbol);
  return {
    symbol: data.symbol,
    name: meta?.name || data.name,
    sector: meta?.sector || 'Other',
    source: data.source,
    analysis,
  };
}
