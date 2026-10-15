// Trading Class: picks a real historical moment with a clean setup, then grades each decision
// the student makes about it. Pure functions; the page is in views/classroom.js.

import { computeIndicators, detectSetup, analyze } from './analysis.js';
import { replayTrade, dayOf } from './tracker.js';

export const CLASS_ACCOUNT = 10000;
export const CLASS_RISK = 0.01;
export const CLASS_MAX_POSITION = 0.25;
export const MAX_HOLD_DAYS = 30;

// Indicators are causal (each value only uses past data), so slicing the full-series arrays
// gives exactly what someone would have seen on that day.
function indicatorsAt(ind, d) {
  const cut = (a) => a.slice(0, d + 1);
  return {
    closes: cut(ind.closes), sma20: cut(ind.sma20), sma50: cut(ind.sma50), sma200: cut(ind.sma200),
    ema9: cut(ind.ema9), rsi14: cut(ind.rsi14), atr14: cut(ind.atr14), vol20: cut(ind.vol20),
    macd: { line: cut(ind.macd.line), signal: cut(ind.macd.signal), hist: cut(ind.macd.hist) },
    bb: { mid: cut(ind.bb.mid), upper: cut(ind.bb.upper), lower: cut(ind.bb.lower) },
  };
}

export function trendAt(ind, d) {
  const c = ind.closes[d], s50 = ind.sma50[d], s200 = ind.sma200[d], s50Prev = ind.sma50[d - 10];
  if (s50 == null || s200 == null) return 'sideways';
  if (c > s50 && s50 > s200 && s50 >= s50Prev) return 'up';
  if (c < s50 && s50 < s200 && s50 <= s50Prev) return 'down';
  return 'sideways';
}

/**
 * Finds a day with a detected setup, a sensible plan, and enough future candles to trade it.
 * rnd: random function (injectable for tests). Returns null if this stock has no usable moment.
 */
export function pickScenario(candles, rnd = Math.random) {
  const n = candles.length;
  if (n < 260) return null;
  const ind = computeIndicators(candles);
  const candidates = [];
  for (let d = n - MAX_HOLD_DAYS - 1; d >= 220; d -= 2) {
    const setup = detectSetup(candles.slice(0, d + 1), indicatorsAt(ind, d));
    if (setup && trendAt(ind, d) !== 'down') candidates.push({ d, setup });
  }
  if (!candidates.length) return null;
  const { d, setup } = candidates[Math.floor(rnd() * candidates.length)];
  const past = candles.slice(0, d + 1);
  const a = analyze(past);
  return {
    d,
    day: dayOf(candles[d].t),
    entry: candles[d].close,
    setup,
    trend: trendAt(ind, d),
    analysis: a,
    atr: a.atr,
    support: a.levels.support[0].price,
    resistance: a.levels.resistance[0]?.price ?? null,
    sma20: a.sma20, sma50: a.sma50, sma200: a.sma200,
    ind,
  };
}

export const TREND_TEXT = {
  up: 'Uptrend: price is above its 50-day average, and the 50-day is above the 200-day and rising. Buyers are in control.',
  down: 'Downtrend: price is below a falling 50-day average, which is below the 200-day. Sellers are in control.',
  sideways: 'Sideways: the averages are tangled together. Neither buyers nor sellers are clearly winning.',
};

export function gradeStop(sc, stop) {
  const { entry, atr, support } = sc;
  const fmt = (n) => `$${n.toFixed(2)}`;
  if (!(stop > 0)) return { ok: false, text: 'Enter a stop price.' };
  if (stop >= entry) return { ok: false, text: `A stop for a buy goes below your entry (${fmt(entry)}). Otherwise it would sell immediately.` };
  const dist = (entry - stop) / atr;
  if (dist < 0.8) return { ok: false, text: `Too tight: only ${dist.toFixed(1)}× the stock's normal daily move (${fmt(atr)}). Ordinary noise would stop you out. Give it at least 1 ATR.` };
  if (dist > 3.5) return { ok: false, text: `Too wide: ${dist.toFixed(1)}× the daily move. You'd have to buy very few shares, and you'd be wrong long before it got there.` };
  if (stop > support) return { ok: 'meh', text: `Reasonable distance, but it's above support at ${fmt(support)}. Stops work best just below support, where buyers stepped in before. Consider ${fmt(Math.min(support - 0.3 * atr, entry - atr))}.` };
  return { ok: true, text: `Good stop: below support (${fmt(support)}) and ${dist.toFixed(1)}× the daily move away. Far enough to survive noise, close enough to keep the loss small.` };
}

export function gradeTarget(sc, stop, target) {
  const { entry } = sc;
  if (!(target > entry)) return { ok: false, text: 'Your target must be above your entry price.' };
  const rr = (target - entry) / (entry - stop);
  const res = sc.resistance && sc.resistance > entry ? ` The nearest resistance is $${sc.resistance.toFixed(2)}.` : '';
  if (rr < 1.5) return { ok: false, rr, text: `Reward : risk is only ${rr.toFixed(1)} : 1. You'd need to win most trades just to break even. Aim for 2 : 1 or better.${res}` };
  if (rr > 5) return { ok: 'meh', rr, text: `Reward : risk ${rr.toFixed(1)} : 1 is ambitious. Big targets get hit less often. Your plan sells only ⅓ there, but consider a closer first target.${res}` };
  return { ok: true, rr, text: `Reward : risk ${rr.toFixed(1)} : 1. ${rr >= 2 ? 'A good trade: winning a third of the time still makes money.' : 'Acceptable.'}${res}` };
}

export function expectedShares(entry, stop) {
  const byRisk = (CLASS_ACCOUNT * CLASS_RISK) / (entry - stop);
  const byCap = (CLASS_ACCOUNT * CLASS_MAX_POSITION) / entry;
  return { shares: Math.max(0, Math.floor(Math.min(byRisk, byCap))), byRisk, byCap, capped: byCap < byRisk };
}

// The trade replayed with the plan's rules over the days revealed so far.
export function classTrade(sc, { stop, target, shares }) {
  const r = target - sc.entry;
  return { symbol: 'CLASS', entryDate: sc.day, entry: sc.entry, shares, stop, targets: [target, sc.entry + r * 1.6, sc.entry + r * 2.5] };
}

export function replayTo(candles, sc, trade, revealed) {
  return replayTrade(trade, candles.slice(0, sc.d + 1 + revealed));
}

// Final result when the student also had the option to sell manually.
export function finalResult(sc, trade, rules, manual) {
  // rules: replayTrade result at the moment the student exited (or at the end).
  const exitPrice = manual?.price ?? null;
  const realized = rules.realized + (manual ? rules.open * (exitPrice - sc.entry) : 0);
  const left = manual ? 0 : rules.open;
  const pl = realized + left * (rules.price - sc.entry);
  const risk = trade.shares * (sc.entry - trade.stop);
  return { pl, r: risk ? pl / risk : 0, pct: pl / CLASS_ACCOUNT };
}
