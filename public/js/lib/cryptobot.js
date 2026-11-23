// Crypto AutoPilot: a rules-bound trading bot for crypto (spot, long only) on a PAPER account.
// Pure functions over plain JSON objects, shared by the live bot (public/js/cryptorunner.js),
// Test / Train on the Crypto page, and the tests.
//
// Crypto trades 24/7 and has no opening range, so instead of the stock bot's breakout-at-the-open
// setup it uses classic trend-following and swing rules from famous traders (pick one, or let
// Train pick). Bars are candles: { t (ms, start), open, high, low, close, volume }.
//   • Turtle breakout (Richard Dennis & William Eckhardt's "Turtles"): buy a 20- or 55-bar high,
//     stop 2 ATRs below, exit on a 10- or 20-bar low.
//   • Moving-average trend (Ed Seykota): buy when the fast EMA crosses above the slow one, exit
//     when it crosses back below.
//   • RSI(2) pullback (Larry Connors): in an uptrend, buy a sharp 2-bar dip, sell on the bounce.
// Hard limits: budget, risk per trade, max open positions, daily loss limit, a drawdown circuit
// breaker that stops the bot completely, allowed coins, and realistic fees.

import { sma, ema, rsi, atr } from './indicators.js';

const r2 = (n) => Math.round(n * 100) / 100;
const r8 = (n) => Math.round(n * 1e8) / 1e8;

export const COINS = [
  ['BTC', 'Bitcoin'], ['ETH', 'Ethereum'], ['SOL', 'Solana'], ['XRP', 'XRP'], ['DOGE', 'Dogecoin'],
  ['ADA', 'Cardano'], ['AVAX', 'Avalanche'], ['LINK', 'Chainlink'], ['LTC', 'Litecoin'], ['DOT', 'Polkadot'],
];
export const TIMEFRAMES = { '1h': 3600, '6h': 21600, '1d': 86400 };

export const STRATEGIES = {
  turtle: { name: 'Turtle breakout', who: 'Richard Dennis & the Turtle Traders',
    idea: 'In 1983 Dennis taught a group of beginners simple breakout rules and they made millions: buy when price breaks its highest high of the last 20 (or 55) bars, risk 2 ATRs, and get out on a 10 (or 20) bar low. Many small losses, a few huge trends.' },
  ema: { name: 'Moving-average trend', who: 'Ed Seykota',
    idea: 'A pioneer of computer trend-following ("the trend is your friend except at the end"): own it while the fast moving average is above the slow one, be out when it isn\'t.' },
  rsi2: { name: 'RSI(2) pullback', who: 'Larry Connors',
    idea: 'In an uptrend (above the 200-bar average), buy when the 2-bar RSI shows a sharp, short dip, and sell as soon as price closes back above its 5-bar average. Many quick trades.' },
};

export const DEFAULT_CRYPTO_RULES = {
  startCash: 100,
  budget: 100,           // most money in trades at once
  riskPct: 0.02,         // loss at the stop, as a share of the budget
  maxPositions: 2,
  maxDailyLoss: 5,       // dollars per UTC day; then no new buys until tomorrow
  maxDrawdownPct: 0.25,  // circuit breaker: stop the bot if the account falls this far below its peak
  coins: ['BTC', 'ETH', 'SOL'],
  timeframe: '6h',
  strategy: 'turtle',
  trendFilter: true,     // only buy above the 200-bar average (Paul Tudor Jones' rule)
  fee: 0.006,            // per side. Coinbase Advanced charges about 0.6% "taker" for small accounts
  slippage: 0.001,
  turtleEntry: 20, turtleExit: 10, stopN: 2,
  emaFast: 20, emaSlow: 100,
  rsiBuyBelow: 10,
};

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function normalizeCryptoRules(x0 = {}) {
  const d = DEFAULT_CRYPTO_RULES, x = { ...d, ...x0 };
  const r = {
    startCash: num(x.startCash, d.startCash, 10, 1e7),
    budget: num(x.budget, d.budget, 5, 1e7),
    riskPct: num(x.riskPct, d.riskPct, 0.002, 0.1),
    maxPositions: Math.round(num(x.maxPositions, d.maxPositions, 1, 10)),
    maxDailyLoss: num(x.maxDailyLoss, d.maxDailyLoss, 0.5, 1e6),
    maxDrawdownPct: num(x.maxDrawdownPct, d.maxDrawdownPct, 0.05, 0.9),
    coins: (Array.isArray(x.coins) ? x.coins : d.coins).filter((c) => COINS.some(([s]) => s === c)),
    timeframe: TIMEFRAMES[x.timeframe] ? x.timeframe : d.timeframe,
    strategy: STRATEGIES[x.strategy] ? x.strategy : d.strategy,
    trendFilter: !!x.trendFilter,
    fee: num(x.fee, d.fee, 0, 0.02),
    slippage: num(x.slippage, d.slippage, 0, 0.02),
    turtleEntry: Math.round(num(x.turtleEntry, d.turtleEntry, 5, 100)),
    turtleExit: Math.round(num(x.turtleExit, d.turtleExit, 3, 60)),
    stopN: num(x.stopN, d.stopN, 0.5, 6),
    emaFast: Math.round(num(x.emaFast, d.emaFast, 3, 100)),
    emaSlow: Math.round(num(x.emaSlow, d.emaSlow, 10, 300)),
    rsiBuyBelow: num(x.rsiBuyBelow, d.rsiBuyBelow, 1, 40),
  };
  r.budget = Math.min(r.budget, r.startCash);
  if (r.emaFast >= r.emaSlow) r.emaFast = Math.max(3, Math.floor(r.emaSlow / 3));
  return r;
}

// --- Indicators per coin ----------------------------------------------------------------
export function prepare(bars, rules) {
  const closes = bars.map((b) => b.close);
  const hh = rolling(bars.map((b) => b.high), rules.turtleEntry, Math.max);
  const ll = rolling(bars.map((b) => b.low), rules.turtleExit, Math.min);
  return {
    bars, closes,
    atr: atr(bars, 20), ma200: sma(closes, 200), ma5: sma(closes, 5),
    emaF: ema(closes, rules.emaFast), emaS: ema(closes, rules.emaSlow), rsi2: rsi(closes, 2),
    hh, ll,
  };
}
// Highest/lowest of the PREVIOUS n bars (not including the current one).
function rolling(vals, n, fn) {
  const out = new Array(vals.length).fill(null);
  for (let i = n; i < vals.length; i++) out[i] = fn(...vals.slice(i - n, i));
  return out;
}

// Should we buy at the close of bar i? Returns the stop distance, or null.
function entrySignal(p, i, rules) {
  const b = p.bars[i], n = p.atr[i];
  if (n == null || i < 1) return null;
  if (rules.trendFilter && (p.ma200[i] == null || b.close < p.ma200[i])) return null;
  if (rules.strategy === 'turtle') return p.hh[i] != null && b.close > p.hh[i] ? rules.stopN * n : null;
  if (rules.strategy === 'ema') return p.emaF[i] != null && p.emaS[i] != null && p.emaF[i] > p.emaS[i] && p.emaF[i - 1] <= p.emaS[i - 1] ? rules.stopN * n : null;
  if (rules.strategy === 'rsi2') return p.rsi2[i] != null && p.rsi2[i] < rules.rsiBuyBelow && (p.ma200[i] != null && b.close > p.ma200[i]) ? rules.stopN * n : null;
  return null;
}
function exitSignal(p, i, rules) {
  const b = p.bars[i];
  if (rules.strategy === 'turtle') return p.ll[i] != null && b.close < p.ll[i] ? `closed below its ${rules.turtleExit}-bar low` : null;
  if (rules.strategy === 'ema') return p.emaF[i] != null && p.emaF[i] < p.emaS[i] ? 'fast average crossed below the slow one' : null;
  if (rules.strategy === 'rsi2') return p.ma5[i] != null && b.close > p.ma5[i] ? 'bounced above its 5-bar average' : null;
  return null;
}

// --- Account & state ----------------------------------------------------------------------
export function newCryptoAccount(rules) {
  return { startCash: rules.startCash, cash: rules.startCash, peak: rules.startCash, positions: [], trades: [], log: [], halted: null, dayLoss: {}, lastBar: {}, created: Date.now() };
}
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const log = (a, t, coin, kind, text) => { a.log.push({ t, coin, kind, text }); if (a.log.length > 400) a.log.splice(0, a.log.length - 400); };
const fmt = (n) => (n >= 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(3) : n.toPrecision(4));
const usd = (n) => `$${Math.abs(n).toFixed(2)}`;

export function equity(a, prices) {
  return a.cash + a.positions.reduce((s, p) => s + p.qty * (prices[p.coin] ?? p.entry), 0);
}

/**
 * Feeds one bar for one coin. `isOpen` = the bar is still forming (live mode): then only the stop
 * is checked (using its low so far), not the close-based entry/exit rules.
 */
export function stepBar(a, rules, coin, p, i, { isOpen = false } = {}) {
  const b = p.bars[i];
  const pos = a.positions.find((x) => x.coin === coin);
  const tEnd = b.t + TIMEFRAMES[rules.timeframe] * 1000;
  if (pos && b.t >= pos.entryT) {
    if (b.low <= pos.stop) return sell(a, rules, pos, Math.min(pos.stop, b.open) * (1 - rules.slippage), isOpen ? Date.now() : tEnd, 'stop-loss');
    if (isOpen) return;
    const why = exitSignal(p, i, rules);
    if (why) return sell(a, rules, pos, b.close * (1 - rules.slippage), tEnd, why);
    return;
  }
  if (pos || isOpen) return;
  const stopDist = entrySignal(p, i, rules);
  if (!stopDist) return;
  if (a.halted) return; // the circuit breaker already said why
  const block = entryBlock(a, rules, tEnd);
  if (block) { log(a, tEnd, coin, 'skip', `${coin} gave a buy signal, but: ${block}`); return; }
  buy(a, rules, coin, b.close * (1 + rules.slippage), stopDist, tEnd);
}

function entryBlock(a, rules, t) {
  if (a.halted) return a.halted;
  if (a.positions.length >= rules.maxPositions) return `already holding ${a.positions.length} (your limit).`;
  if ((a.dayLoss[utcDay(t)] || 0) >= rules.maxDailyLoss) return 'daily loss limit reached. No new buys until tomorrow (UTC).';
  return null;
}

function buy(a, rules, coin, price, stopDist, t) {
  const inTrades = a.positions.reduce((s, p) => s + p.cost, 0);
  const room = Math.min(rules.budget - inTrades, a.cash) / (1 + rules.fee);
  const riskDollars = rules.budget * rules.riskPct;
  const lossPerUnit = stopDist + price * rules.fee * 2; // the fees count as risk too
  const qty = r8(Math.min(riskDollars / lossPerUnit, room / price));
  if (!(qty * price >= 1)) { log(a, t, coin, 'skip', `${coin} gave a buy signal, but there wasn't enough budget left for a $1 order.`); return; }
  const cost = qty * price, fee = cost * rules.fee;
  a.cash = r2(a.cash - cost - fee);
  const pos = { coin, qty, entry: price, entryT: t, stop: price - stopDist, cost, fees: fee };
  a.positions.push(pos);
  log(a, t, coin, 'buy', `BUY ${fmt(qty)} ${coin} at $${fmt(price)} (${STRATEGIES[rules.strategy].name}). Stop $${fmt(pos.stop)}. Risking about ${usd(qty * (stopDist + price * rules.fee * 2))} incl. fees.`);
}

function sell(a, rules, pos, price, t, why) {
  const value = pos.qty * price, fee = value * rules.fee;
  a.cash = r2(a.cash + value - fee);
  const pl = r2(value - fee - pos.cost - pos.fees);
  a.positions = a.positions.filter((p) => p !== pos);
  a.trades.push({ coin: pos.coin, qty: pos.qty, entry: pos.entry, exit: price, entryT: pos.entryT, exitT: t, pl, fees: r2(pos.fees + fee), why });
  if (a.trades.length > 3000) a.trades.splice(0, a.trades.length - 3000);
  if (pl < 0) a.dayLoss[utcDay(t)] = r2((a.dayLoss[utcDay(t)] || 0) - pl);
  log(a, t, pos.coin, pl >= 0 ? 'win' : 'loss', `SELL ${fmt(pos.qty)} ${pos.coin} at $${fmt(price)} (${why}): ${pl >= 0 ? '+' : '−'}${usd(pl)} after ${usd(pos.fees + fee)} fees.`);
}

// Sell a position now at `price` (the "Sell everything" button).
export function closePosition(a, rules, coin, price, t, why) {
  const pos = a.positions.find((p) => p.coin === coin);
  if (pos) sell(a, rules, pos, price * (1 - rules.slippage), t, why);
}

// After each round of bars: track the peak and trip the circuit breaker on a big drawdown.
export function checkBreaker(a, rules, prices, t) {
  const eq = equity(a, prices);
  a.peak = Math.max(a.peak, eq);
  if (!a.halted && eq < a.peak * (1 - rules.maxDrawdownPct)) {
    a.halted = `Circuit breaker: the account fell ${(rules.maxDrawdownPct * 100).toFixed(0)}% below its peak. The bot stopped buying. Review it, then press Start over to reset.`;
    log(a, t, null, 'halt', a.halted);
  }
}

// --- Replay over history -------------------------------------------------------------------
/** history: { COIN: bars[] } (oldest first). Returns { account, stats, curve, hold }. */
export function replayCrypto(rulesIn, history, { from = null, to = null } = {}) {
  const rules = normalizeCryptoRules(rulesIn);
  const a = newCryptoAccount(rules);
  const prep = {};
  for (const c of rules.coins) if (history[c]?.length) prep[c] = prepare(history[c], rules);
  const times = [...new Set(Object.values(prep).flatMap((p) => p.bars.map((b) => b.t)))].sort((x, y) => x - y)
    .filter((t) => (from == null || t >= from) && (to == null || t < to));
  const idx = Object.fromEntries(Object.entries(prep).map(([c, p]) => [c, new Map(p.bars.map((b, i) => [b.t, i]))]));
  const last = {};
  const curve = [];
  for (const t of times) {
    for (const [c, p] of Object.entries(prep)) {
      const i = idx[c].get(t);
      if (i == null) continue;
      stepBar(a, rules, c, p, i);
      last[c] = p.bars[i].close;
    }
    checkBreaker(a, rules, last, t);
    curve.push({ t, value: r2(equity(a, last)) });
  }
  // Close what's still open at the last price, so results are comparable.
  for (const pos of [...a.positions]) sell(a, rules, pos, last[pos.coin] ?? pos.entry, times.at(-1), 'end of test');
  // Buy-and-hold the same coins (equal split) as the yardstick.
  const hold = buyAndHold(prep, times, rules.startCash, rules.fee);
  return { account: a, stats: cryptoStats(a, curve, rules), curve, hold, rules };
}

function buyAndHold(prep, times, cash, fee) {
  const coins = Object.keys(prep);
  if (!coins.length || !times.length) return [];
  const qty = {}, ptr = {};
  const out = [];
  for (const t of times) {
    let v = 0;
    for (const c of coins) {
      const bars = prep[c].bars;
      let k = ptr[c] ?? 0;
      while (k < bars.length - 1 && bars[k + 1].t <= t) k++;
      ptr[c] = k;
      const px = bars[k].close;
      if (qty[c] == null) qty[c] = ((cash / coins.length) * (1 - fee)) / px;
      v += qty[c] * px;
    }
    out.push({ t, value: r2(v) });
  }
  return out;
}

export function cryptoStats(a, curve, rules) {
  const tr = a.trades;
  const wins = tr.filter((x) => x.pl > 0);
  let peak = rules.startCash, maxDD = 0;
  for (const p of curve) { peak = Math.max(peak, p.value); maxDD = Math.max(maxDD, (peak - p.value) / peak); }
  const end = a.cash;
  return {
    trades: tr.length, winRate: tr.length ? wins.length / tr.length : null,
    pl: r2(end - rules.startCash), ret: end / rules.startCash - 1,
    fees: r2(tr.reduce((s, x) => s + x.fees, 0)), maxDrawdown: maxDD,
    best: tr.length ? Math.max(...tr.map((x) => x.pl)) : null, worst: tr.length ? Math.min(...tr.map((x) => x.pl)) : null,
    halted: a.halted,
  };
}

// --- Train: pick the strategy settings on older data, check them on newer data -------------
export const CRYPTO_GRID = [
  { strategy: 'turtle', turtleEntry: 20, turtleExit: 10 }, { strategy: 'turtle', turtleEntry: 55, turtleExit: 20 },
  { strategy: 'turtle', turtleEntry: 20, turtleExit: 20 },
  { strategy: 'ema', emaFast: 10, emaSlow: 50 }, { strategy: 'ema', emaFast: 20, emaSlow: 100 }, { strategy: 'ema', emaFast: 50, emaSlow: 200 },
  { strategy: 'rsi2', rsiBuyBelow: 5 }, { strategy: 'rsi2', rsiBuyBelow: 10 },
];

export function trainCrypto(rulesIn, history) {
  const base = normalizeCryptoRules(rulesIn);
  const times = [...new Set(Object.values(history).flatMap((b) => b.map((x) => x.t)))].sort((x, y) => x - y);
  // Indicators need warm-up, so the split is on time: the older 60% trains, the newer 40% tests.
  const cut = times[Math.floor(times.length * 0.6)];
  const score = (r, part) => {
    const res = replayCrypto({ ...r, startCash: 1000, budget: 1000, maxDailyLoss: 1e6, maxDrawdownPct: 0.9 }, history, part === 'train' ? { to: cut } : { from: cut });
    const holdRet = res.hold.length ? res.hold.at(-1).value / 1000 - 1 : null;
    return { ret: res.stats.ret, trades: res.stats.trades, winRate: res.stats.winRate, maxDrawdown: res.stats.maxDrawdown, holdRet };
  };
  const results = [];
  for (const g of CRYPTO_GRID) for (const trendFilter of [true, false]) {
    const settings = { ...g, trendFilter };
    results.push({ settings, train: score({ ...base, ...settings }, 'train') });
  }
  const pool = results.filter((x) => x.train.trades >= 4);
  (pool.length ? pool : results).sort((x, y) => y.train.ret - x.train.ret);
  const best = (pool.length ? pool : results)[0];
  best.test = score({ ...base, ...best.settings }, 'test');
  const current = { train: score(base, 'train'), test: score(base, 'test') };
  return {
    cut, from: times[0], to: times.at(-1), best, current, leaderboard: (pool.length ? pool : results).slice(0, 5),
    heldUp: best.test.ret > current.test.ret && best.test.ret > 0,
    beatHold: best.test.holdRet != null && best.test.ret > best.test.holdRet,
  };
}

export const describeCrypto = (x) => {
  const s = STRATEGIES[x.strategy];
  const p = x.strategy === 'turtle' ? `${x.turtleEntry}-bar high in, ${x.turtleExit}-bar low out` : x.strategy === 'ema' ? `${x.emaFast}/${x.emaSlow} EMA` : `RSI(2) below ${x.rsiBuyBelow}`;
  return `${s.name} (${p})${x.trendFilter ? ' · only above the 200-bar average' : ''}`;
};
