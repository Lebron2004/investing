// AutoPilot: a rules-bound day-trading bot that trades a PAPER account. Pure functions over plain,
// JSON-serializable objects, so the same code runs live in the browser (public/js/bot.js),
// replays past days (Test / Train on the AutoPilot page) and runs in the tests.
//
// How it trades (one setup, long only):
//   1. Before the open it builds a short watchlist: the stocks your rules allow, ranked by the
//      day-trade AI's "big move today" probability (the model that tested better than a coin flip).
//   2. It waits for the opening range (first 15 / 30 / 60 minutes) to finish.
//   3. It buys when price breaks above the opening-range high, only if the S&P 500 is up on the day
//      (optional) and it isn't chasing (no more than 0.5% past the trigger).
//   4. Every buy gets a stop-loss under the opening range and a profit target (2× the risk by
//      default). The stop moves to break-even once the trade is up 1× its risk.
//   5. Everything is sold before the close. Nothing is held overnight.
// Hard limits it can never break: budget, risk per trade, daily loss limit, trades per day,
// open positions, allowed markets/symbols, trading hours and (optionally) the pattern-day-trader rule.

const r2 = (n) => Math.round(n * 100) / 100;
export const OPEN_MIN = 570;   // 9:30 New York
export const CLOSE_MIN = 960;  // 4:00 New York
export const SLIPPAGE = 0.0005; // 0.05% worse price on market-style fills (entries, stops, closes)

export const DEFAULT_RULES = {
  startCash: 100,      // paper account size
  budget: 100,         // most money it may put into trades today
  cashAccount: true,   // each dollar can only be used once a day (unsettled cash, like a cash account)
  riskPct: 0.02,       // most it may lose on one trade, as a share of today's budget
  maxDailyLoss: 5,     // stop trading for the day after losing this many dollars
  maxTrades: 2,        // buys per day
  maxOpen: 1,          // positions at the same time
  pdt: true,           // at most 3 day trades in any 5 business days
  fractional: false,
  sectors: null,       // null = every sector; otherwise a list of sector names (and/or 'ETF')
  allow: [],           // if not empty: ONLY these symbols
  block: [],           // never these symbols
  minPrice: 1,
  maxPrice: 0,         // 0 = no limit
  minDollarVol: 50e6,  // skip thinly traded stocks
  watch: 6,            // how many stocks it watches each day
  orMinutes: 30,       // opening range length
  lastEntryMin: 900,   // no new buys after 3:00pm
  flatMin: 955,        // sell everything at 3:55pm
  targetR: 2,          // profit target as a multiple of the risk
  breakevenR: 1,       // move the stop to break-even at this multiple (0 = never)
  marketFilter: true,  // only buy while SPY is above its opening price
  maxChase: 0.005,     // don't buy more than 0.5% above the trigger
};

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const symList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s));

// Cleans user input into a safe rule set (every number clamped to a sensible range).
export function normalizeRules(input = {}) {
  const d = DEFAULT_RULES, x = { ...d, ...input };
  const r = {
    startCash: num(x.startCash, d.startCash, 10, 1e7),
    budget: num(x.budget, d.budget, 10, 1e7),
    cashAccount: !!x.cashAccount,
    riskPct: num(x.riskPct, d.riskPct, 0.001, 0.1),
    maxDailyLoss: num(x.maxDailyLoss, d.maxDailyLoss, 0.5, 1e6),
    maxTrades: Math.round(num(x.maxTrades, d.maxTrades, 1, 20)),
    maxOpen: Math.round(num(x.maxOpen, d.maxOpen, 1, 5)),
    pdt: !!x.pdt,
    fractional: !!x.fractional,
    sectors: Array.isArray(x.sectors) && x.sectors.length ? [...x.sectors] : null,
    allow: symList(x.allow),
    block: symList(x.block),
    minPrice: num(x.minPrice, d.minPrice, 0, 1e5),
    maxPrice: num(x.maxPrice, d.maxPrice, 0, 1e5),
    minDollarVol: num(x.minDollarVol, d.minDollarVol, 0, 1e12),
    watch: Math.round(num(x.watch, d.watch, 1, 12)),
    orMinutes: [15, 30, 60].includes(Number(x.orMinutes)) ? Number(x.orMinutes) : d.orMinutes,
    lastEntryMin: Math.round(num(x.lastEntryMin, d.lastEntryMin, OPEN_MIN + 15, 945)),
    flatMin: Math.round(num(x.flatMin, d.flatMin, OPEN_MIN + 30, 958)),
    targetR: num(x.targetR, d.targetR, 0.5, 10),
    breakevenR: num(x.breakevenR, d.breakevenR, 0, 10),
    marketFilter: !!x.marketFilter,
    maxChase: num(x.maxChase, d.maxChase, 0, 0.05),
  };
  r.budget = Math.min(r.budget, r.startCash);
  return r;
}

// Plain-English problems with a rule set (shown on the page; the bot still runs with the safe version).
export function ruleWarnings(r) {
  const w = [];
  if (r.maxDailyLoss < r.budget * r.riskPct) w.push(`Your daily loss limit ($${r.maxDailyLoss}) is smaller than one trade's risk ($${r2(r.budget * r.riskPct)}), so trades will be sized down to fit it.`);
  if (r.maxDailyLoss > r.budget * 0.1) w.push(`A daily loss limit above 10% of the budget ($${r2(r.budget * 0.1)}) is aggressive for day trading.`);
  if (r.riskPct > 0.03) w.push('Risking more than 3% per trade can wipe out an account quickly in a losing streak.');
  if (r.lastEntryMin >= r.flatMin) w.push('The last-buy time is after the sell-everything time, so it can\'t buy at all.');
  if (OPEN_MIN + r.orMinutes >= r.lastEntryMin) w.push('The opening range ends after the last-buy time, so it can\'t buy at all.');
  if (r.allow.length && r.allow.every((s) => r.block.includes(s))) w.push('Every allowed symbol is also blocked.');
  return w;
}

// --- Pattern-day-trader rule ---------------------------------------------------------------
export function businessDaysBack(day, n) {
  const out = [];
  const d = new Date(`${day}T12:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
// Day trades (buy and sell the same stock the same day) in the 5 business days ending on `day`.
export function dayTradesInWindow(account, day) {
  const win = new Set(businessDaysBack(day, 5));
  return (account.dayTrades || []).filter((d) => win.has(d)).length;
}

// --- Account -------------------------------------------------------------------------------
export function newBotAccount(rules) {
  return { startCash: rules.startCash, cash: rules.startCash, created: Date.now(), days: [], trades: [], dayTrades: [] };
}

// --- Watchlist ------------------------------------------------------------------------------
/**
 * records: [{ symbol, sector, prevClose, atr, pBig, dollarVol }] for the coming session.
 * Returns { watch: [records], counts: { reason: n } } with the reasons stocks were left out.
 */
export function pickWatchlist(records, rules, account) {
  const counts = {};
  const out = (why) => { counts[why] = (counts[why] || 0) + 1; return false; };
  const cash = Math.min(rules.budget, account?.cash ?? rules.budget);
  const riskBudget = rules.budget * rules.riskPct;
  const allow = new Set(rules.allow), block = new Set(rules.block);
  const ok = records.filter((r) => {
    if (!(r.prevClose > 0) || !(r.atr > 0)) return out('no data');
    if (block.has(r.symbol)) return out('blocked by you');
    if (allow.size && !allow.has(r.symbol)) return out('not on your allowed list');
    if (!allow.size && rules.sectors && !rules.sectors.includes(r.sector)) return out('sector not allowed');
    if (r.prevClose < rules.minPrice || (rules.maxPrice > 0 && r.prevClose > rules.maxPrice)) return out('outside your price range');
    if ((r.dollarVol ?? Infinity) < rules.minDollarVol) return out('not traded enough');
    const atrPct = r.atr / r.prevClose;
    if (atrPct < 0.008 || atrPct > 0.12) return out('too quiet or too wild');
    if (!rules.fractional && r.prevClose > cash) return out('one share costs more than the budget');
    if (!rules.fractional && riskBudget < 0.4 * r.atr) return out('too volatile for your risk per trade');
    return true;
  });
  ok.sort((a, b) => (b.pBig ?? 0) - (a.pBig ?? 0));
  return { watch: ok.slice(0, rules.watch), counts, eligible: ok.length };
}

// --- One trading day --------------------------------------------------------------------------
export function newDay(day, watchRecs, rules, account) {
  const s = {
    day, rules, startCash: account.cash,
    watch: {}, spy: { open: null, last: null },
    positions: [], spent: 0, trades: 0, realized: 0, halted: null, done: false,
    log: [], fills: [],
    pdtUsed: dayTradesInWindow(account, day),
  };
  for (const r of watchRecs) s.watch[r.symbol] = watchEntry(r);
  log(s, OPEN_MIN - 30, null, 'info', watchRecs.length
    ? `Watching ${watchRecs.map((r) => r.symbol).join(', ')} (the AI's most likely big movers that fit your rules).`
    : 'No stock fits your rules today, so the bot will sit out.');
  return s;
}

const watchEntry = (r) => ({ symbol: r.symbol, sector: r.sector, prevClose: r.prevClose, atr: r.atr, pBig: r.pBig ?? null, open: null, orHigh: null, orLow: null, orDone: false, orEstimated: false, last: null, status: 'waiting', note: null });

// Replace the watchlist mid-day (e.g. the rules changed) without losing today's trades.
export function rebuildWatch(s, watchRecs) {
  const keep = new Set(s.positions.map((p) => p.symbol));
  const next = {};
  for (const r of watchRecs) next[r.symbol] = s.watch[r.symbol] || watchEntry(r);
  for (const sym of keep) next[sym] = s.watch[sym];
  s.watch = next;
  log(s, null, null, 'info', `Rules changed. Now watching ${Object.keys(next).join(', ') || 'nothing'}.`);
}

function log(s, m, symbol, kind, text) {
  s.log.push({ m, symbol, kind, text });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
}

export const fmtMin = (m) => {
  if (m == null) return '';
  const h = Math.floor(m / 60), mm = String(Math.floor(m % 60)).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm}${h < 12 ? 'am' : 'pm'}`;
};

export function setMarket(s, { open, last }) {
  if (open > 0 && s.spy.open == null) s.spy.open = open;
  if (last > 0) s.spy.last = last;
}

// Sets the opening range directly (live mode: from the quote's day high/low, or the site's snapshot).
export function setOpeningRange(s, symbol, high, low, { estimated = false, open = null } = {}) {
  const w = s.watch[symbol];
  if (!w || w.orDone || !(high > 0) || !(low > 0)) return;
  w.orHigh = high; w.orLow = low; w.orDone = true; w.orEstimated = estimated;
  if (open > 0 && w.open == null) w.open = open;
  log(s, orEnd(s), symbol, 'info', `Opening range${estimated ? ' (estimated: the bot started late, so it uses the day\'s high and low so far)' : ''}: ${money(low)}–${money(high)}. It buys only if price breaks above ${money(triggerOf(w))}.`);
}

const orEnd = (s) => OPEN_MIN + s.rules.orMinutes;
export const triggerOf = (w) => r2(w.orHigh * 1.001 + 0.005);
const openCost = (s) => s.positions.reduce((a, p) => a + p.shares * p.entry, 0);

/**
 * Feeds one price bar for one symbol. bar = { m, o, h, l, c } where m = minutes since midnight
 * New York (start of the bar). Live mode passes a "bar" per quote with o = h = l = c = price.
 * account is updated when positions close. Returns the state.
 */
export function step(s, symbol, bar, account) {
  if (s.done) return s;
  if (symbol === 'SPY') {
    setMarket(s, { open: bar.o, last: bar.c });
    if (!(symbol in s.watch)) return s;
  }
  const w = s.watch[symbol];
  if (!w) return s;
  const { rules } = s;
  if (w.open == null) w.open = bar.o;
  w.last = bar.c;
  const barEnd = bar.m + 5;

  // Opening range
  if (!w.orDone) {
    if (bar.m < orEnd(s)) {
      w.orHigh = Math.max(w.orHigh ?? -Infinity, bar.h);
      w.orLow = Math.min(w.orLow ?? Infinity, bar.l);
      if (barEnd < orEnd(s)) return s;
      w.orDone = true;
      log(s, orEnd(s), symbol, 'info', `Opening range set: ${money(w.orLow)}–${money(w.orHigh)}. It buys only if price breaks above ${money(triggerOf(w))}.`);
      return s;
    }
    if (w.orHigh == null) { // first price arrived after the range ended (bot started late)
      setOpeningRange(s, symbol, bar.h, bar.l, { estimated: true });
      return s;
    }
    w.orDone = true;
  }

  // Manage an open position
  const pos = s.positions.find((p) => p.symbol === symbol);
  if (pos) {
    if (bar.m >= pos.entryM + (bar.h === bar.l ? 0 : 5)) manage(s, pos, bar, account);
    return s;
  }
  if (bar.m >= rules.flatMin) return s;

  // Look for an entry
  if (w.status !== 'waiting') return s;
  const trigger = triggerOf(w);
  if (bar.h < trigger) return s;
  const block = entryBlock(s, bar.m);
  if (block) { skip(s, w, bar.m, block); return s; }
  const fillRaw = Math.max(trigger, bar.o);
  if (fillRaw > trigger * (1 + rules.maxChase)) { skip(s, w, bar.m, `Price jumped past the ${money(trigger)} trigger to ${money(fillRaw)}. Not chasing.`, 'missed'); return s; }
  enter(s, w, bar.m, r2(fillRaw * (1 + SLIPPAGE)), account);
  return s;
}

function entryBlock(s, m) {
  const { rules } = s;
  if (s.halted) return s.halted;
  if (m < orEnd(s)) return 'The opening range isn\'t finished yet.';
  if (m >= rules.lastEntryMin) return `It's past your last-buy time (${fmtMin(rules.lastEntryMin)}).`;
  if (s.trades >= rules.maxTrades) return `Already made ${s.trades} of your ${rules.maxTrades} trades for today.`;
  if (s.positions.length >= rules.maxOpen) return `Already holding ${s.positions.length} position${s.positions.length > 1 ? 's' : ''} (your limit).`;
  if (rules.pdt && s.pdtUsed >= 3) return 'Pattern-day-trader rule: 3 day trades in the last 5 business days already.';
  if (rules.marketFilter && s.spy.open && s.spy.last && s.spy.last < s.spy.open) return 'The S&P 500 is down on the day (your market filter).';
  return null;
}

function skip(s, w, m, why, status = 'skipped') {
  // Temporary blocks (market down, position limit) keep the stock on watch; log each reason once.
  const temporary = /market filter|position|opening range/.test(why);
  if (w.note !== why) log(s, m, w.symbol, 'skip', `${w.symbol} broke out, but no buy: ${why}`);
  w.note = why;
  if (!temporary) w.status = status;
}

// Stop, target and share count for a buy at `fill`, within every money limit.
function sizeEntry(s, w, fill, account) {
  const { rules } = s;
  const risk = Math.min(0.4 * w.atr, Math.max(0.15 * w.atr, fill - w.orLow));
  const lossRoom = rules.maxDailyLoss + Math.min(0, s.realized);
  const riskDollars = Math.min(rules.budget * rules.riskPct, lossRoom);
  const room = Math.min(rules.cashAccount ? rules.budget - s.spent : rules.budget - openCost(s), account.cash);
  const round = rules.fractional ? (x) => Math.floor(x * 1000) / 1000 : Math.floor;
  const shares = Math.max(0, round(Math.min(riskDollars / risk, room / fill)));
  return { risk, stop: r2(fill - risk), target: r2(fill + rules.targetR * risk), shares, riskDollars, room };
}

// What the bot plans to do if this stock breaks out (for "copy this setup to my broker").
export function previewEntry(s, symbol, account) {
  const w = s.watch[symbol];
  if (!w?.orDone || w.status !== 'waiting') return null;
  const trigger = triggerOf(w);
  const z = sizeEntry(s, w, trigger, account);
  return z.shares > 0 ? { trigger, stop: z.stop, target: z.target, shares: z.shares } : null;
}

function enter(s, w, m, fill, account) {
  const { rules } = s;
  const { risk, stop, target, shares, riskDollars, room } = sizeEntry(s, w, fill, account);
  if (!(shares > 0) || (rules.fractional && shares * fill < 1)) {
    skip(s, w, m, room < fill && !rules.fractional ? `not enough budget left for one share (${money(Math.max(0, room))} left)` : `one share would risk more than your limit (${money(riskDollars)})`);
    return;
  }
  const cost = r2(shares * fill);
  account.cash = r2(account.cash - cost);
  s.spent = r2(s.spent + cost);
  s.trades++;
  const pos = { symbol: w.symbol, shares, entry: fill, entryM: m, stop, initialStop: stop, risk: r2(risk), target, orHigh: w.orHigh, orLow: w.orLow };
  s.positions.push(pos);
  w.status = 'in';
  w.note = null;
  s.fills.push({ m, symbol: w.symbol, side: 'buy', shares, price: fill });
  log(s, m, w.symbol, 'buy', `BUY ${shares} ${w.symbol} at ${money(fill)} (broke above ${money(w.orHigh)}). Stop ${money(stop)}, target ${money(target)}. Risking ${money(shares * (fill - stop))}.`);
}

function manage(s, pos, bar, account) {
  const { rules } = s;
  if (bar.l <= pos.stop) {
    const px = Math.min(pos.stop, bar.o) * (1 - SLIPPAGE);
    return exit(s, pos, bar.m, px, pos.stop >= pos.entry ? 'break-even stop' : 'stop-loss', account);
  }
  if (bar.h >= pos.target) return exit(s, pos, bar.m, Math.max(pos.target, bar.o), 'profit target', account);
  if (bar.m + (bar.h === bar.l ? 0 : 5) >= rules.flatMin) return exit(s, pos, bar.m, bar.c * (1 - SLIPPAGE), 'end of day (never holds overnight)', account);
  if (rules.breakevenR > 0 && pos.stop < pos.entry && bar.h >= pos.entry + rules.breakevenR * pos.risk) {
    pos.stop = pos.entry;
    log(s, bar.m, pos.symbol, 'info', `${pos.symbol} is up ${rules.breakevenR}× its risk: stop moved to break-even (${money(pos.entry)}). This trade can't lose much now.`);
  }
}

function exit(s, pos, m, rawPx, why, account) {
  const px = r2(rawPx);
  const pl = r2((px - pos.entry) * pos.shares);
  account.cash = r2(account.cash + px * pos.shares);
  s.realized = r2(s.realized + pl);
  s.positions = s.positions.filter((p) => p !== pos);
  const w = s.watch[pos.symbol];
  if (w) w.status = 'done';
  const R = r2(pl / (pos.shares * (pos.entry - pos.initialStop)));
  const trade = { day: s.day, symbol: pos.symbol, shares: pos.shares, entry: pos.entry, exit: px, entryM: pos.entryM, exitM: m, stop: pos.initialStop, target: pos.target, pl, R, why };
  s.fills.push({ m, symbol: pos.symbol, side: 'sell', shares: pos.shares, price: px });
  account.trades.push(trade);
  if (account.trades.length > 2000) account.trades.splice(0, account.trades.length - 2000);
  account.dayTrades = [...(account.dayTrades || []), s.day].slice(-50);
  s.pdtUsed++;
  log(s, m, pos.symbol, pl >= 0 ? 'win' : 'loss', `SELL ${pos.shares} ${pos.symbol} at ${money(px)} (${why}): ${pl >= 0 ? '+' : '−'}${money(Math.abs(pl))} (${R >= 0 ? '+' : ''}${R}R).`);
  if (!s.halted && s.realized <= -s.rules.maxDailyLoss + 0.005) {
    s.halted = `Daily loss limit reached (${money(-s.realized)} lost today). Done for the day.`;
    log(s, m, null, 'halt', s.halted);
  }
}

// Stop trading for today (user pressed the button). Open positions are sold at `prices[sym]`.
export function haltDay(s, m, why, prices = {}, account) {
  for (const pos of [...s.positions]) {
    const px = prices[pos.symbol] ?? s.watch[pos.symbol]?.last ?? pos.entry;
    exit(s, pos, m, px * (1 - SLIPPAGE), why, account);
  }
  if (!s.halted) { s.halted = why; log(s, m, null, 'halt', why); }
}

// Closes the day: sells anything still open at its last price and records the day's result.
export function endDay(s, account, { m = CLOSE_MIN, note = 'market close' } = {}) {
  if (s.done) return null;
  for (const pos of [...s.positions]) exit(s, pos, m, (s.watch[pos.symbol]?.last ?? pos.entry) * (1 - SLIPPAGE), note, account);
  s.done = true;
  const trades = account.trades.filter((t) => t.day === s.day);
  const summary = { day: s.day, pl: s.realized, trades: trades.length, wins: trades.filter((t) => t.pl > 0).length, endCash: account.cash, halted: s.halted && !/^You /.test(s.halted) ? s.halted : null };
  account.days = [...(account.days || []).filter((d) => d.day !== s.day), summary].slice(-400);
  return summary;
}

// --- Replay: run the bot over past days ----------------------------------------------------------
/**
 * days: [{ day, records: [...pickWatchlist records], bars: { SYM: [[m,o,h,l,c], ...] }, spy: [[m,o,h,l,c], ...] }]
 * Bars must include every symbol the watchlist could pick (callers load them on demand).
 */
export function replay(rulesIn, days, { account = null } = {}) {
  const rules = normalizeRules(rulesIn);
  const acct = account || newBotAccount(rules);
  const dayStates = [];
  for (const d of days) {
    // Like a real account: today's budget can't be more than the cash you have.
    const dayRules = { ...rules, budget: Math.min(rules.budget, acct.cash) };
    const { watch } = pickWatchlist(d.records, dayRules, acct);
    const s = newDay(d.day, watch, dayRules, acct);
    const streams = [['SPY', d.spy || []], ...watch.map((r) => [r.symbol, d.bars[r.symbol] || []])];
    const minutes = [...new Set(streams.flatMap(([, b]) => b.map((x) => x[0])))].sort((a, b) => a - b);
    const idx = Object.fromEntries(streams.map(([sym, b]) => [sym, new Map(b.map((x) => [x[0], x]))]));
    for (const m of minutes) {
      for (const [sym] of streams) {
        const x = idx[sym].get(m);
        if (x) step(s, sym, { m: x[0], o: x[1], h: x[2], l: x[3], c: x[4] }, acct);
      }
    }
    endDay(s, acct);
    dayStates.push(s);
  }
  return { account: acct, dayStates, stats: botStats(acct, rules) };
}

export function botStats(account, rules) {
  const trades = account.trades, days = account.days || [];
  const wins = trades.filter((t) => t.pl > 0), losses = trades.filter((t) => t.pl <= 0);
  const gross = (xs) => xs.reduce((a, t) => a + t.pl, 0);
  let peak = account.startCash, eq = account.startCash, maxDD = 0;
  for (const d of days) { eq = d.endCash; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq); }
  const pl = r2(account.cash - account.startCash);
  return {
    days: days.length,
    daysTraded: days.filter((d) => d.trades > 0).length,
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : null,
    pl,
    ret: pl / account.startCash,
    avgR: trades.length ? r2(trades.reduce((a, t) => a + t.R, 0) / trades.length) : null,
    totalR: r2(trades.reduce((a, t) => a + t.R, 0)),
    profitFactor: losses.length && gross(losses) < 0 ? r2(gross(wins) / -gross(losses)) : wins.length ? Infinity : null,
    maxDrawdown: r2(maxDD),
    bestDay: days.length ? Math.max(...days.map((d) => d.pl)) : null,
    worstDay: days.length ? Math.min(...days.map((d) => d.pl)) : null,
    haltedDays: days.filter((d) => d.halted).length,
    rules,
  };
}

// --- Train: find better settings on older days, then check them on newer, unseen days ----------
export const TUNE_GRID = {
  orMinutes: [15, 30, 60],
  targetR: [1.5, 2, 3],
  breakevenR: [0, 1],
  marketFilter: [true, false],
};

export function tune(rulesIn, days, { minTrades = 6 } = {}) {
  const base = normalizeRules(rulesIn);
  const half = Math.floor(days.length / 2);
  const trainDays = days.slice(0, half), testDays = days.slice(half);
  // Score in R (risk units) so the result doesn't depend on the account size.
  const score = (rules, ds) => {
    const { stats } = replay(rules, ds);
    return { totalR: stats.totalR, trades: stats.trades, winRate: stats.winRate };
  };
  const combos = [];
  for (const orMinutes of TUNE_GRID.orMinutes) for (const targetR of TUNE_GRID.targetR)
    for (const breakevenR of TUNE_GRID.breakevenR) for (const marketFilter of TUNE_GRID.marketFilter)
      combos.push({ orMinutes, targetR, breakevenR, marketFilter });
  const results = combos.map((c) => ({ settings: c, train: score({ ...base, ...c }, trainDays) }));
  const usable = results.filter((x) => x.train.trades >= minTrades);
  const pool = usable.length ? usable : results;
  pool.sort((a, b) => b.train.totalR - a.train.totalR);
  const best = pool[0];
  const current = { orMinutes: base.orMinutes, targetR: base.targetR, breakevenR: base.breakevenR, marketFilter: base.marketFilter };
  best.test = score({ ...base, ...best.settings }, testDays);
  const currentScores = { train: score(base, trainDays), test: score(base, testDays) };
  return {
    trainDays: trainDays.map((d) => d.day), testDays: testDays.map((d) => d.day),
    tried: combos.length,
    best, current: { settings: current, ...currentScores },
    leaderboard: pool.slice(0, 5),
    heldUp: best.test.totalR > currentScores.test.totalR && best.test.totalR > 0,
  };
}

function money(n) {
  return n == null || Number.isNaN(n) ? '—' : `$${Number(n).toFixed(2)}`;
}
