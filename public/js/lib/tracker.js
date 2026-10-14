// Trade tracker: replays daily candles since you bought and applies the selling plan
// candle by candle, so you can see when the rules said "sell" and when they said "hold".
//
// Rules (same as the sizer's plan):
//   • Targets are limit sells: hit when the day's HIGH reaches them.
//     Target 1 → sell ⅓, stop moves to break-even.  Target 2 → sell ⅓, stop moves to Target 1.
//     Target 3 → sell the rest.
//   • After Target 1 the stop also trails 3 ATRs under the highest close, so winners are protected.
//   • The stop is a CLOSING stop: sell everything if a day closes below it.
//   • Closing below the 20-day average or RSI over 75 are warnings, not sells.

import { atr, sma, rsi } from './indicators.js';

export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

function splitShares(shares) {
  const frac = !Number.isInteger(shares);
  const round = frac ? (x) => Math.floor(x * 1000) / 1000 : Math.floor;
  const a = round(shares / 3), b = round(shares / 3);
  return [a, b, +(shares - a - b).toFixed(3)];
}

/**
 * trade:   { symbol, entryDate: 'YYYY-MM-DD', entry, shares, stop, targets: [t1, t2, t3] }
 * candles: daily candles (oldest first)
 */
export function replayTrade(trade, candles) {
  const closes = candles.map((c) => c.close);
  const atr14 = atr(candles, 14);
  const sma20 = sma(closes, 20);
  const rsi14 = rsi(closes, 14);
  const parts = splitShares(trade.shares);
  const startIdx = candles.findIndex((c) => dayOf(c.t) > trade.entryDate);

  let open = trade.shares;
  let stop = trade.stop;
  let hits = 0;
  let realized = 0;
  let highestClose = trade.entry;
  let belowAvg = null, hot = false;
  let closedAt = null;
  const events = [];
  const stopPath = new Array(candles.length).fill(null);
  const money = (n) => `$${n.toFixed(2)}`;
  const sell = (i, shares, price, type, text) => {
    const pl = shares * (price - trade.entry);
    realized += pl;
    open = +(open - shares).toFixed(3);
    events.push({ i, t: candles[i].t, type, shares, price, pl, text });
  };

  if (startIdx >= 0) {
    for (let i = startIdx; i < candles.length && open > 0; i++) {
      const c = candles[i];

      // 1. Profit targets (limit orders fill intraday).
      while (hits < 3 && open > 0 && c.high >= trade.targets[hits]) {
        const price = trade.targets[hits];
        const qty = hits === 2 ? open : Math.min(open, parts[hits]);
        if (hits === 0) {
          stop = Math.max(stop, trade.entry);
          sell(i, qty, price, 'target', `Target 1 (${money(price)}) hit. Sell ${fmt(qty)} shares. Move your stop up to break-even (${money(trade.entry)}), so this trade can no longer lose money.`);
        } else if (hits === 1) {
          stop = Math.max(stop, trade.targets[0]);
          sell(i, qty, price, 'target', `Target 2 (${money(price)}) hit. Sell ${fmt(qty)} more shares. Move your stop up to Target 1 (${money(trade.targets[0])}).`);
        } else {
          sell(i, qty, price, 'target', `Target 3 (${money(price)}) hit. Sell your last ${fmt(qty)} shares. Trade complete.`);
        }
        hits++;
      }
      if (open <= 0) { closedAt = i; stopPath[i] = stop; break; }

      // 2. Closing stop.
      if (c.close < stop) {
        const why = hits === 0 ? 'your stop-loss' : 'your raised stop';
        sell(i, open, c.close, 'stop', `Closed at ${money(c.close)}, below ${why} (${money(stop)}). Sell your remaining ${fmt(open)} shares.`);
        stopPath[i] = stop;
        closedAt = i;
        break;
      }

      // 3. Trail the stop once the trade is working.
      highestClose = Math.max(highestClose, c.close);
      if (hits >= 1 && atr14[i] != null) {
        const trail = highestClose - 3 * atr14[i];
        if (trail > stop * 1.0001) stop = trail;
      }
      stopPath[i] = stop;

      // 4. Warnings (state changes only, so they don't repeat every day).
      if (sma20[i] != null) {
        const below = c.close < sma20[i];
        if (belowAvg === false && below) events.push({ i, t: c.t, type: 'warn', text: `Closed below the 20-day average (${money(sma20[i])}). Momentum is fading. That alone isn't a reason to sell, so keep your stop where it is.` });
        if (belowAvg === true && !below) events.push({ i, t: c.t, type: 'info', text: 'Back above the 20-day average. The uptrend resumed.' });
        belowAvg = below;
      }
      const isHot = rsi14[i] != null && rsi14[i] > 75;
      if (isHot && !hot) events.push({ i, t: c.t, type: 'warn', text: `RSI ${rsi14[i].toFixed(0)}: overheated. Pullbacks are likely. If you're near a target, let the limit order work.` });
      hot = isHot;
    }
  }

  const last = candles[candles.length - 1];
  const price = last.close;
  const unrealized = open * (price - trade.entry);
  return {
    open,
    closed: open <= 0,
    stop,
    hits,
    realized,
    unrealized,
    totalPL: realized + unrealized,
    plPct: (realized + unrealized) / (trade.shares * trade.entry),
    price,
    events,
    stopPath,
    startIdx,
    closedAt,
    nextTarget: hits < 3 ? trade.targets[hits] : null,
    today: decideToday(trade, candles, { open, stop, hits, events, startIdx, closedAt, price, atr: atr14[candles.length - 1], sma20: sma20[candles.length - 1] }),
  };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(3));

function decideToday(trade, candles, s) {
  const lastIdx = candles.length - 1;
  const todays = s.events.filter((e) => e.i === lastIdx && (e.type === 'target' || e.type === 'stop'));
  const money = (n) => `$${n.toFixed(2)}`;
  if (todays.length) {
    const qty = todays.reduce((a, e) => a + e.shares, 0);
    return { action: s.open <= 0 ? 'sell-all' : 'sell', shares: qty, title: s.open <= 0 ? `Sell your last ${fmt(qty)} shares` : `Sell ${fmt(qty)} shares`, text: todays.map((e) => e.text).join(' ') };
  }
  if (s.open <= 0) {
    return { action: 'closed', shares: 0, title: 'Trade closed', text: `This trade finished on ${dayOf(candles[s.closedAt].t)}. Nothing left to do.` };
  }
  if (s.startIdx < 0) {
    return { action: 'hold', shares: 0, title: 'Just opened. Set your orders.', text: `No trading days since you bought yet. Place a stop-loss at ${money(s.stop)} and a limit sell for part of the position at Target 1 (${money(trade.targets[0])}).` };
  }
  const cushion = s.atr ? (s.price - s.stop) / s.atr : Infinity;
  if (cushion < 0.75) {
    return { action: 'watch', shares: 0, title: 'Watch closely. Don\'t sell yet.', text: `Price (${money(s.price)}) is close to your stop (${money(s.stop)}). Stick to the plan: don't sell early and don't move the stop lower. Sell only if a day closes below ${money(s.stop)}.` };
  }
  const trend = s.sma20 != null && s.price >= s.sma20 ? 'the short-term uptrend is intact' : 'momentum has cooled, but the stop hasn\'t been touched';
  return {
    action: 'hold', shares: 0, title: 'Hold. Don\'t sell.',
    text: `Price is ${money(s.price)}, ${money(s.price - s.stop)} above your stop, and ${trend}. ${s.atr ? `Normal daily swings are about ${money(s.atr)}, so a red day is not a reason to sell.` : ''} Next target: ${s.hits < 3 ? money(trade.targets[s.hits]) : '—'}.`,
  };
}
