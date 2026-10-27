// The Schwab bot's brain-to-broker loop. The decisions come from AutoPilot's engine
// (public/js/lib/autopilot.js, the same code as the website's paper bot and its Test/Train).
// This file turns those decisions into real Schwab orders and reports what Schwab did back.
//
// Every buy is sent as ONE "1st Triggers OCO" order: a limit buy (never pays more than 0.5% above
// the breakout trigger) plus a stop-loss and a profit target that live at Schwab. So even if this
// computer crashes or loses internet, every position stays protected by a stop at the broker.
//
// mode 'dry-run': real Schwab prices, pretend orders (nothing is sent). Default.
// mode 'live':    real orders in your Schwab account.

import { nyClock } from '../public/js/lib/daytrade.js';
import {
  normalizeRules, newBotAccount, pickWatchlist, newDay, step, endDay, setMarket, setOpeningRange,
  blockEntries, brokerFilled, brokerCancelled, brokerExit, triggerOf, OPEN_MIN,
} from '../public/js/lib/autopilot.js';
import { nyDayMinute } from '../lib/replay-data.js';
import { bracketOrder, exitOco, marketSell, flattenOrder, fillPrice, isDone, LoginNeeded } from './schwab.js';

const r2 = (n) => Math.round(n * 100) / 100;
const ENTRY_TIMEOUT_MS = 90e3; // cancel a buy that hasn't filled in 90 seconds (the price ran away)

const deskRecords = (data) => [...(data.stocks || []), ...(data.etfs || [])]
  .map((r) => ({ symbol: r.symbol, sector: r.sector, prevClose: r.prevClose, atr: r.atr, pBig: r.pBig, dollarVol: r.dollarVol }));

/**
 * api: a Schwab client (or a fake in tests). accountHash: Schwab's id for the account.
 * state: { account, today } (persisted by the caller via save()). getSiteData(): the website's
 * data/daytrade.json (AI forecasts). notify(text): phone notification. log(text): console/file.
 */
export function createRunner({ api, accountHash, rules: rulesIn, mode = 'dry-run', state, save, getSiteData, notify = () => {}, log = () => {}, now = () => Date.now() }) {
  const live = mode === 'live';
  const rules = normalizeRules(rulesIn);
  state.account ??= newBotAccount(rules);
  const st = state;
  const say = (text, { push = false } = {}) => { log(text); if (push) notify(text); };

  async function tick() {
    const clock = nyClock(new Date(now()));
    if (st.today && st.today.day !== clock.day) {
      if (st.today.positions.some((p) => p.filled)) say(`⚠ ${st.today.day} ended with open positions in the bot's records. Check thinkorswim.`, { push: true });
      endDay(st.today, st.account, { note: 'closed at the last price the bot saw' });
      st.today = null;
    }
    if (!clock.open) {
      if (st.today && !st.today.done && clock.minutes >= 960) {
        const sum = endDay(st.today, st.account);
        if (sum) say(`Day done: ${sum.trades} trade${sum.trades === 1 ? '' : 's'}, ${sum.pl >= 0 ? '+' : '−'}$${Math.abs(sum.pl).toFixed(2)}.`, { push: true });
      }
      return save(st);
    }
    if (st.closedDay === clock.day) return;
    if (!st.today) {
      await startDay(clock);
      if (!st.today) return save(st);
    }
    const s = st.today;
    if (s.done) return;

    const m = clock.minutes;
    const syms = Object.keys(s.watch);
    const quotes = await api.quotes([...syms, 'SPY']);
    const fresh = (q) => q && q.c > 0 && now() - q.t * 1000 < 10 * 60e3;
    if (fresh(quotes.SPY)) setMarket(s, { open: quotes.SPY.o, last: quotes.SPY.c });
    const orEnd = OPEN_MIN + s.rules.orMinutes;
    for (const sym of syms) {
      const q = quotes[sym];
      if (!fresh(q)) continue;
      const w = s.watch[sym];
      if (w.open == null && q.o > 0) w.open = q.o;
      if (!w.orDone) {
        if (m < orEnd) { w.last = q.c; continue; }
        await exactOpeningRange(s, sym, orEnd, q);
      }
      step(s, sym, { m, o: q.c, h: q.c, l: q.c, c: q.c }, st.account);
    }

    // Turn the engine's decisions into orders, and Schwab's fills back into the engine.
    for (const pos of [...s.positions]) {
      try {
        if (!pos.orderId) await placeEntry(s, pos, quotes[pos.symbol]);
        else if (!pos.filled) await checkEntry(s, pos, m);
        else await checkExits(s, pos, m, quotes[pos.symbol]);
        const still = s.positions.includes(pos);
        if (still && pos.filled && !pos.flattenOrderId) {
          if (m >= s.rules.flatMin) await flatten(s, pos, m, 'end of day (never holds overnight)', quotes[pos.symbol]);
          else if (pos.stop !== pos.sentStop) await replaceExits(s, pos, m, quotes[pos.symbol]);
        }
      } catch (err) {
        if (err instanceof LoginNeeded) throw err;
        say(`⚠ ${pos.symbol}: ${err.message}`, { push: true });
        blockEntries(s, m, `Stopped new trades after a problem talking to Schwab: ${err.message}`);
      }
    }
    save(st);
  }

  async function startDay(clock) {
    if (!(await api.marketOpenToday(clock.day).catch(() => true))) {
      st.closedDay = clock.day;
      say(`Market holiday today (${clock.day}). Sleeping.`);
      return;
    }
    let data;
    try { data = await getSiteData(); } catch (err) {
      say(`Couldn't load the AI's forecasts from the website (${err.message}). Will retry.`);
      return;
    }
    const recs = deskRecords(data);
    let dayRules = { ...rules };
    let pdtUsed = null;
    if (live) {
      const a = await api.account(accountHash);
      const b = a?.currentBalances || {};
      const cash = b.cashAvailableForTrading ?? b.availableFunds ?? b.cashBalance ?? 0;
      st.account.cash = r2(cash);
      if (a?.type === 'CASH') dayRules.cashAccount = true;
      if (a?.type === 'MARGIN' && (b.liquidationValue ?? 0) < 25000) pdtUsed = a.roundTrips ?? null;
      dayRules.budget = Math.min(rules.budget, cash);
      if (cash < 1) say(`Schwab shows $${cash.toFixed(2)} available to trade, so the bot will sit out today.`, { push: true });
    } else {
      dayRules.budget = Math.min(rules.budget, st.account.cash);
    }
    const { watch } = pickWatchlist(recs, dayRules, st.account);
    st.today = newDay(clock.day, watch, dayRules, st.account, { broker: true });
    if (pdtUsed != null) st.today.pdtUsed = Math.max(st.today.pdtUsed, pdtUsed);
    const age = (now() - Date.parse(data.updated)) / 3600e3;
    say(`${live ? '' : '[dry run] '}Good morning. Budget $${dayRules.budget.toFixed(2)}. Watching: ${watch.map((r) => r.symbol).join(', ') || 'nothing fits your rules today'}.${age > 30 ? ' (The AI forecasts are over a day old.)' : ''}`, { push: true });
  }

  // The real opening range from Schwab's 5-minute bars (falls back to the day's high/low).
  async function exactOpeningRange(s, sym, orEnd, q) {
    try {
      const bars = (await api.fiveMinuteBars(sym)).filter((b) => { const { day, m } = nyDayMinute(b.t); return day === s.day && m >= OPEN_MIN && m < orEnd; });
      if (bars.length >= Math.floor(s.rules.orMinutes / 5) - 1) {
        setOpeningRange(s, sym, Math.max(...bars.map((b) => b.high)), Math.min(...bars.map((b) => b.low)), { open: bars[0].open });
        return;
      }
    } catch { /* fall through */ }
    setOpeningRange(s, sym, q.h, q.l, { estimated: true });
  }

  async function placeEntry(s, pos, q) {
    const w = s.watch[pos.symbol];
    const limit = r2(triggerOf(w) * (1 + s.rules.maxChase));
    const target = pos.target > limit ? pos.target : r2(limit + pos.risk);
    pos.target = target;
    // Last line of defense: never spend more than the budget or the cash Schwab says is available.
    if (pos.shares * limit > s.rules.budget + 0.01 || pos.shares * limit > st.account.cash + pos.shares * pos.entry + 0.01) {
      brokerCancelled(s, pos.symbol, null, `the order ($${(pos.shares * limit).toFixed(2)}) would go over your budget`, st.account);
      return;
    }
    const order = bracketOrder({ symbol: pos.symbol, shares: pos.shares, limit, stop: pos.stop, target });
    pos.limit = limit;
    pos.sentAt = now();
    pos.sentStop = pos.stop;
    if (!live) {
      pos.orderId = `DRY-${pos.symbol}-${pos.sentAt}`;
      say(`[dry run] Would send: BUY ${pos.shares} ${pos.symbol} limit $${limit} → stop $${pos.stop}, target $${target}`);
      return;
    }
    pos.orderId = await api.placeOrder(accountHash, order);
    say(`Sent to Schwab: BUY ${pos.shares} ${pos.symbol} limit $${limit}, then stop $${pos.stop} / target $${target} (order ${pos.orderId}).`, { push: true });
  }

  async function checkEntry(s, pos, m) {
    if (!live) { // dry run: assume it filled at the price the bot saw
      brokerFilled(s, pos.symbol, pos.entry, st.account);
      return;
    }
    const o = await api.getOrder(accountHash, pos.orderId);
    const legs = flattenOrder(o);
    const buy = legs.find((l) => l.instruction === 'BUY');
    if (buy?.status === 'FILLED' || (buy?.filledQuantity > 0 && now() - pos.sentAt > ENTRY_TIMEOUT_MS)) {
      if (buy.status !== 'FILLED') await safeCancel(pos.orderId);
      const qty = buy.filledQuantity || pos.shares;
      brokerFilled(s, pos.symbol, buy.fillPrice ?? pos.limit, st.account, qty);
      rememberExits(pos, pos.orderId, legs);
      if (qty !== buy.quantity) await replaceExits(s, pos, m, null); // partial fill: protect exactly what we own
      say(`Bought ${qty} ${pos.symbol} at $${(buy.fillPrice ?? pos.limit).toFixed(2)}. Stop $${pos.sentStop}, target $${pos.target} are live at Schwab.`, { push: true });
      return;
    }
    if (buy && isDone(buy.status)) {
      brokerCancelled(s, pos.symbol, m, `Schwab says the order was ${buy.status.toLowerCase()}${o.statusDescription ? ` (${o.statusDescription})` : ''}`, st.account);
      say(`${pos.symbol} buy was ${buy.status.toLowerCase()} by Schwab.`, { push: true });
      return;
    }
    if (now() - pos.sentAt > ENTRY_TIMEOUT_MS) {
      await safeCancel(pos.orderId);
      const after = flattenOrder(await api.getOrder(accountHash, pos.orderId)).find((l) => l.instruction === 'BUY');
      if (after?.filledQuantity > 0) return checkEntry(s, pos, m); // filled while cancelling
      brokerCancelled(s, pos.symbol, m, 'the price moved past the limit before it filled (not chasing)', st.account);
    }
  }

  function rememberExits(pos, parentId, legs) {
    const sells = legs.filter((l) => l.instruction === 'SELL');
    pos.exitParentId = parentId;
    pos.stopOrderId = sells.find((l) => l.type === 'STOP')?.orderId || null;
    pos.targetOrderId = sells.find((l) => l.type === 'LIMIT')?.orderId || null;
  }

  // Did the stop or the target fill at Schwab?
  async function checkExits(s, pos, m, q) {
    if (!live) {
      const c = q?.c;
      if (c == null) return;
      if (pos.flattenOrderId) return brokerExit(s, pos.symbol, m, c, pos.flattenWhy, st.account);
      if (c <= pos.sentStop) return brokerExit(s, pos.symbol, m, c, pos.sentStop >= pos.entry ? 'break-even stop' : 'stop-loss', st.account);
      if (c >= pos.target) return brokerExit(s, pos.symbol, m, pos.target, 'profit target', st.account);
      return;
    }
    if (pos.flattenOrderId) {
      const o = await api.getOrder(accountHash, pos.flattenOrderId);
      if (o.status === 'FILLED') {
        brokerExit(s, pos.symbol, m, fillPrice(o) ?? q?.c ?? pos.entry, pos.flattenWhy, st.account);
        say(`Sold ${pos.shares} ${pos.symbol} at $${(fillPrice(o) ?? 0).toFixed(2)} (${pos.flattenWhy}).`, { push: true });
      } else if (isDone(o.status)) {
        throw new Error(`the sell order for ${pos.symbol} was ${o.status.toLowerCase()}. Sell it in thinkorswim now.`);
      }
      return;
    }
    const legs = flattenOrder(await api.getOrder(accountHash, pos.exitParentId)).filter((l) => l.instruction === 'SELL');
    const filled = legs.find((l) => l.status === 'FILLED');
    if (filled) {
      const why = filled.type === 'STOP' ? (pos.sentStop >= pos.entry ? 'break-even stop' : 'stop-loss') : 'profit target';
      brokerExit(s, pos.symbol, m, filled.fillPrice ?? (filled.type === 'STOP' ? pos.sentStop : pos.target), why, st.account);
      say(`Sold ${pos.symbol} (${why}) at $${(filled.fillPrice ?? 0).toFixed(2)}. Today: ${s.realized >= 0 ? '+' : '−'}$${Math.abs(s.realized).toFixed(2)}.`, { push: true });
      return;
    }
    if (legs.length && legs.every((l) => isDone(l.status))) {
      // Someone cancelled the stop and target (or Schwab did): never leave shares unprotected.
      say(`⚠ ${pos.symbol}'s stop and target were cancelled outside the bot. Re-protecting it.`, { push: true });
      await protect(s, pos, m, q);
    }
  }

  // Swap the stop (e.g. to break-even): cancel the old stop/target pair, then send a new pair.
  async function replaceExits(s, pos, m, q) {
    if (!live) { pos.sentStop = pos.stop; return; }
    await cancelExits(pos);
    const legs = flattenOrder(await api.getOrder(accountHash, pos.exitParentId)).filter((l) => l.instruction === 'SELL');
    const filled = legs.find((l) => l.status === 'FILLED');
    if (filled) return checkExits(s, pos, m, q); // it sold while we were changing it
    await protect(s, pos, m, q);
    say(`${pos.symbol}: stop moved to $${pos.stop} at Schwab.`);
  }

  async function protect(s, pos, m, q) {
    try {
      const id = await api.placeOrder(accountHash, exitOco({ symbol: pos.symbol, shares: pos.shares, stop: pos.stop, target: pos.target }));
      rememberExits(pos, id, flattenOrder(await api.getOrder(accountHash, id)));
      pos.sentStop = pos.stop;
    } catch (err) {
      // Can't protect it: get out instead.
      say(`⚠ Couldn't place a stop for ${pos.symbol} (${err.message}). Selling it to be safe.`, { push: true });
      await flatten(s, pos, m, 'sold for safety (stop could not be placed)', q, { skipCancel: true });
    }
  }

  async function cancelExits(pos) {
    for (const id of [pos.stopOrderId, pos.targetOrderId]) if (id) await safeCancel(id);
  }

  async function safeCancel(id) {
    try { await api.cancelOrder(accountHash, id); } catch { /* already filled or cancelled */ }
  }

  async function flatten(s, pos, m, why, q, { skipCancel = false } = {}) {
    pos.flattenWhy = why;
    if (!live) { pos.flattenOrderId = 'DRY'; return checkExits(s, pos, m, q); }
    if (!skipCancel) {
      await cancelExits(pos);
      const legs = flattenOrder(await api.getOrder(accountHash, pos.exitParentId)).filter((l) => l.instruction === 'SELL');
      if (legs.some((l) => l.status === 'FILLED')) { pos.flattenWhy = null; return checkExits(s, pos, m, q); }
    }
    // Only ever sell shares the bot itself bought.
    const a = await api.account(accountHash);
    const held = (a?.positions || []).find((p) => p.instrument?.symbol === pos.symbol)?.longQuantity ?? 0;
    const qty = Math.min(pos.shares, held);
    if (!(qty > 0)) { brokerExit(s, pos.symbol, m, q?.c ?? pos.entry, `${why} (already sold)`, st.account); return; }
    pos.flattenOrderId = await api.placeOrder(accountHash, marketSell({ symbol: pos.symbol, shares: qty }));
    say(`Selling ${qty} ${pos.symbol} at market (${why}).`);
  }

  // Kill switch: cancel everything and sell what the bot holds.
  async function stopAll(why = 'You stopped the bot.') {
    const s = st.today;
    if (!s || s.done) return;
    s.stopped = true;
    const m = nyClock(new Date(now())).minutes;
    const quotes = s.positions.length ? await api.quotes(s.positions.map((p) => p.symbol)).catch(() => ({})) : {};
    for (const pos of [...s.positions]) {
      try {
        if (!pos.filled) {
          if (live && pos.orderId) await safeCancel(pos.orderId);
          if (live && pos.orderId) {
            const buy = flattenOrder(await api.getOrder(accountHash, pos.orderId)).find((l) => l.instruction === 'BUY');
            if (buy?.filledQuantity > 0) { brokerFilled(s, pos.symbol, buy.fillPrice ?? pos.limit, st.account, buy.filledQuantity); rememberExits(pos, pos.orderId, flattenOrder(await api.getOrder(accountHash, pos.orderId))); }
          }
          if (!pos.filled) { brokerCancelled(s, pos.symbol, m, why, st.account); continue; }
        }
        if (!pos.flattenOrderId) await flatten(s, pos, m, why, quotes[pos.symbol]);
      } catch (err) {
        say(`⚠ Couldn't close ${pos.symbol}: ${err.message}. Close it in thinkorswim.`, { push: true });
      }
    }
    blockEntries(s, m, why);
    save(st);
  }

  return { tick, stopAll, state: st, live };
}
