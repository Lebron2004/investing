// Runs AutoPilot live in the browser on a PAPER account. It keeps running while any StockWise
// page is open (in this tab or the installed app), checking prices every 30 seconds.
// State lives in localStorage so it survives reloads. Only one tab trades at a time.

import { getDeskData, liveQuotes, settings, store } from './api.js';
import { nyClock } from './lib/daytrade.js';
import {
  DEFAULT_RULES, normalizeRules, newBotAccount, pickWatchlist, newDay, step, endDay, setMarket,
  setOpeningRange, haltDay, rebuildWatch, OPEN_MIN,
} from './lib/autopilot.js';

const KEY = 'autopilot';
const LOCK = 'autopilotLock';
const TICK_MS = 30e3;
const tabId = Math.random().toString(36).slice(2);
const listeners = new Set();
let timer = null, running = false;

export function botState() {
  const st = store.get(KEY, null);
  if (st?.account) return st;
  const rules = normalizeRules(DEFAULT_RULES);
  return { enabled: false, rules, account: newBotAccount(rules), today: null, status: null, lastTick: null };
}

function save(st) {
  store.set(KEY, st);
  for (const fn of listeners) { try { fn(st); } catch { /* a closed page */ } }
}
export function onBotChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function startBot() {
  const st = botState();
  st.enabled = true;
  st.status = 'Starting…';
  save(st);
  tick();
}

// Turning the bot off sells anything it holds (at the last price it saw) so nothing is left unmanaged.
export function stopBot() {
  const st = botState();
  st.enabled = false;
  if (st.today && !st.today.done && st.today.positions.length) haltDay(st.today, nyClock().minutes, 'You turned the bot off, so it sold what it held.', {}, st.account);
  st.status = 'Off';
  save(st);
}

export function stopForToday() {
  const st = botState();
  if (st.today && !st.today.done) haltDay(st.today, nyClock().minutes, 'You stopped the bot for today.', {}, st.account);
  save(st);
}

export function saveRules(input) {
  const st = botState();
  const rules = normalizeRules({ ...input, startCash: st.account.startCash });
  const filtersChanged = ['sectors', 'allow', 'block', 'minPrice', 'maxPrice', 'watch', 'fractional', 'budget', 'riskPct']
    .some((k) => JSON.stringify(rules[k]) !== JSON.stringify(st.rules[k]));
  st.rules = rules;
  if (st.today && !st.today.done) {
    st.today.rules = { ...rules, budget: Math.min(rules.budget, st.today.startCash) };
    if (filtersChanged) st.rebuild = true;
  }
  save(st);
  if (st.enabled) tick();
  return rules;
}

// Starts a fresh paper account (new starting cash), keeping the rules.
export function resetBot(startCash) {
  const st = botState();
  const rules = normalizeRules({ ...st.rules, startCash, budget: Math.min(st.rules.budget, startCash) });
  save({ enabled: st.enabled, rules, account: newBotAccount(rules), today: null, status: st.enabled ? 'Starting…' : null, lastTick: null });
  if (st.enabled) tick();
}

const deskRecords = (data) => [...(data.stocks || []), ...(data.etfs || [])]
  .map((r) => ({ symbol: r.symbol, sector: r.sector, prevClose: r.prevClose, atr: r.atr, pBig: r.pBig, dollarVol: r.dollarVol, intraday: r.intraday }));

function claimLock() {
  const lock = store.get(LOCK, null);
  if (lock && lock.id !== tabId && Date.now() - lock.at < TICK_MS * 2.5) return false;
  store.set(LOCK, { id: tabId, at: Date.now() });
  return true;
}

async function tick() {
  if (running) return;
  const first = botState();
  if (!first.enabled) return;
  if (!claimLock()) return; // another StockWise tab is running the bot
  running = true;
  try { await runTick(); } catch (err) {
    const st = botState();
    st.status = `Problem: ${err.message}. Trying again in 30 seconds.`;
    save(st);
  } finally { running = false; }
}

async function runTick() {
  let st = botState();
  const clock = nyClock();
  const acct = st.account;

  // A day the bot didn't see the end of (computer asleep, browser closed): close it out.
  if (st.today && st.today.day !== clock.day) {
    endDay(st.today, acct, { note: 'closed at the last price the bot saw (it was offline at the close)' });
    st.today = null;
  }
  if (!clock.open) {
    if (st.today && !st.today.done && clock.minutes >= 960) endDay(st.today, acct);
    st.status = clock.weekend ? 'Market closed for the weekend. The bot starts again Monday at 9:30am New York time.'
      : clock.minutes < OPEN_MIN ? 'Waiting for the market to open (9:30am New York time).'
        : 'Market closed. Today\'s results are in the report card below.';
    st.lastTick = Date.now();
    return save(st);
  }
  if (!settings().finnhubKey) {
    st.status = 'needs-key';
    st.lastTick = Date.now();
    return save(st);
  }

  if (!st.today || st.rebuild) {
    save(st);
    const data = await getDeskData();
    st = botState(); // the user may have changed something while we waited
    const recs = deskRecords(data);
    if (!st.today) {
      const dayRules = { ...st.rules, budget: Math.min(st.rules.budget, st.account.cash) };
      const { watch } = pickWatchlist(recs, dayRules, st.account);
      st.today = newDay(clock.day, watch, dayRules, st.account);
      const ageH = (Date.now() - Date.parse(data.updated)) / 3600e3;
      if (ageH > 30) st.today.log.push({ m: clock.minutes, symbol: null, kind: 'info', text: `Heads-up: the AI's forecasts are from ${new Date(data.updated).toLocaleDateString('en-US')} (the site hasn't updated since).` });
      // The site's 30-minute opening range is exact, so use it when the bot starts after 10:00.
      for (const r of watch) {
        const id = r.intraday;
        if (id?.date === clock.day && id.orComplete && st.today.rules.orMinutes === 30 && clock.minutes >= OPEN_MIN + 30) {
          setOpeningRange(st.today, r.symbol, id.orHigh, id.orLow, { open: id.open });
        }
      }
    } else {
      rebuildWatch(st.today, pickWatchlist(recs, st.today.rules, st.account).watch);
    }
    st.rebuild = false;
  }

  if (!st.today.done) {
    save(st);
    const quotes = await liveQuotes([...Object.keys(st.today.watch), 'SPY'], { maxAge: 10e3 });
    st = botState(); // re-read: the user may have stopped or reset the bot while we waited
    if (!st.enabled || st.today?.day !== clock.day || st.today.done) return;
    const today = st.today;
    const before = today.log.length;
    const m = clock.minutes;
    const fresh = (q) => q && q.c > 0 && Date.now() - q.t * 1000 < 10 * 60e3;
    if (fresh(quotes.SPY)) setMarket(today, { open: quotes.SPY.o, last: quotes.SPY.c });
    const orEnd = OPEN_MIN + today.rules.orMinutes;
    for (const sym of Object.keys(today.watch)) {
      const q = quotes[sym];
      if (!fresh(q)) continue;
      const w = today.watch[sym];
      if (w.open == null && q.o > 0) w.open = q.o;
      if (!w.orDone) {
        // During the opening range, the day's high and low so far ARE the opening range.
        if (m < orEnd) { w.orHigh = q.h; w.orLow = q.l; w.last = q.c; w.orSeenAt = m; continue; }
        const exact = w.orSeenAt != null && w.orSeenAt >= orEnd - 2;
        setOpeningRange(today, sym, exact ? w.orHigh : q.h, exact ? w.orLow : q.l, { estimated: !exact });
      }
      step(today, sym, { m, o: q.c, h: q.c, l: q.c, c: q.c }, st.account);
    }
    st.status = Object.keys(today.watch).length && !Object.keys(quotes).length ? 'Waiting for live prices from Finnhub…' : 'running';
    notify(today.log.slice(before));
  }
  st.lastTick = Date.now();
  save(st);
}

// Desktop notifications for buys, sells and halts (only if you allowed them on the AutoPilot page).
function notify(entries) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  for (const e of entries) {
    if (!['buy', 'win', 'loss', 'halt'].includes(e.kind)) continue;
    try { new Notification(`AutoPilot (paper): ${e.kind === 'buy' ? 'Bought' : e.kind === 'halt' ? 'Stopped' : 'Sold'}${e.symbol ? ` ${e.symbol}` : ''}`, { body: e.text, tag: `ap-${e.symbol}-${e.m}` }); } catch { /* not allowed here */ }
  }
}

// Called once from app.js: keeps the bot ticking while the site is open.
export function initBot() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('storage', (e) => { if (e.key === `sw:${KEY}`) for (const fn of listeners) fn(botState()); });
  tick();
}
