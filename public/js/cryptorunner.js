// Runs Crypto AutoPilot live in the browser on a PAPER account, 24/7 while any StockWise page is
// open. Every minute it downloads the latest candles from Coinbase, acts on each bar that just
// closed (the same rules as Test / Train), and checks stop-losses on the bar that's still forming.

import { store } from './api.js';
import { recentBars } from './cryptodata.js';
import { normalizeCryptoRules, DEFAULT_CRYPTO_RULES, newCryptoAccount, prepare, stepBar, checkBreaker, closePosition, TIMEFRAMES } from './lib/cryptobot.js';

const KEY = 'cryptoBot';
const LOCK = 'cryptoBotLock';
const TICK_MS = 60e3;
const tabId = Math.random().toString(36).slice(2);
const listeners = new Set();
let timer = null, running = false;

export function cryptoState() {
  const st = store.get(KEY, null);
  if (st?.account) return st;
  const rules = normalizeCryptoRules(DEFAULT_CRYPTO_RULES);
  return { enabled: false, rules, account: newCryptoAccount(rules), status: null, lastTick: null, prices: {} };
}
function save(st) { store.set(KEY, st); for (const fn of listeners) { try { fn(st); } catch { /* page closed */ } } }
export const onCryptoChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function startCrypto() { const st = cryptoState(); st.enabled = true; st.status = 'Starting…'; save(st); tick(); }
export function stopCrypto() { const st = cryptoState(); st.enabled = false; st.status = 'Off'; save(st); }

// New rules apply from the next bar. Changing the timeframe or strategy only applies to new buys:
// open positions keep their stop and exit with the new rules.
export function saveCryptoRules(input) {
  const st = cryptoState();
  const rules = normalizeCryptoRules({ ...input, startCash: st.account.startCash });
  if (rules.timeframe !== st.rules.timeframe) st.account.lastBar = {};
  st.rules = rules;
  save(st);
  return rules;
}

export function resetCrypto(startCash) {
  const st = cryptoState();
  const rules = normalizeCryptoRules({ ...st.rules, startCash, budget: Math.min(st.rules.budget, startCash) });
  save({ enabled: st.enabled, rules, account: newCryptoAccount(rules), status: st.enabled ? 'Starting…' : null, lastTick: null, prices: {} });
}

// Sell everything now at the latest price (paper).
export function sellAllCrypto() {
  const st = cryptoState();
  for (const pos of [...st.account.positions]) closePosition(st.account, st.rules, pos.coin, st.prices[pos.coin] ?? pos.entry, Date.now(), 'you pressed Sell everything');
  save(st);
}

function claimLock() {
  const lock = store.get(LOCK, null);
  if (lock && lock.id !== tabId && Date.now() - lock.at < TICK_MS * 2.5) return false;
  store.set(LOCK, { id: tabId, at: Date.now() });
  return true;
}

async function tick() {
  if (running || !cryptoState().enabled || !claimLock()) return;
  running = true;
  try {
    const st0 = cryptoState();
    const sec = TIMEFRAMES[st0.rules.timeframe];
    const fetched = {};
    for (const coin of new Set([...st0.rules.coins, ...st0.account.positions.map((p) => p.coin)])) {
      try { fetched[coin] = await recentBars(coin, sec); } catch { /* try next minute */ }
    }
    const st = cryptoState(); // re-read: the user may have changed something meanwhile
    if (!st.enabled) return;
    const a = st.account, rules = st.rules, now = Date.now();
    for (const [coin, bars] of Object.entries(fetched)) {
      if (!bars.length) continue;
      const p = prepare(bars, rules);
      const closedUpTo = bars.findLastIndex((b) => b.t + sec * 1000 <= now);
      if (a.lastBar[coin] == null) a.lastBar[coin] = bars[closedUpTo]?.t ?? 0; // start fresh: don't trade old bars
      for (let i = 0; i <= closedUpTo; i++) {
        if (bars[i].t <= a.lastBar[coin]) continue;
        stepBar(a, rules, coin, p, i);
        a.lastBar[coin] = bars[i].t;
      }
      if (closedUpTo < bars.length - 1) stepBar(a, rules, coin, p, bars.length - 1, { isOpen: true }); // stops on the forming bar
      st.prices[coin] = bars.at(-1).close;
    }
    checkBreaker(a, rules, st.prices, now);
    st.status = Object.keys(fetched).length ? 'running' : 'Can\'t reach Coinbase right now. Retrying every minute.';
    st.lastTick = now;
    save(st);
  } catch (err) {
    const st = cryptoState();
    st.status = `Problem: ${err.message}`;
    save(st);
  } finally {
    running = false;
  }
}

export function initCrypto() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('storage', (e) => { if (e.key === `sw:${KEY}`) for (const fn of listeners) fn(cryptoState()); });
  tick();
}
