// Paper (practice) trading engine. Pure functions over a plain account object that the
// page keeps in localStorage. Prices are daily candles, so:
//   • market orders fill at the latest price (the last candle's close)
//   • limit / stop orders are checked against every candle AFTER the day they were placed
//     (a limit buy fills when the day's low reaches it, a stop when the low falls through it;
//     if the day opens beyond the price, it fills at the open, just like a real gap).

export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newAccount(startCash, now = Date.now()) {
  return { version: 1, startCash, cash: startCash, created: now, transactions: [], orders: [] };
}

// Shares held and average cost per symbol, plus every closed (sold) lot with its profit.
export function holdings(account) {
  const pos = {};
  const closed = [];
  for (const tx of account.transactions) {
    const p = (pos[tx.symbol] ??= { symbol: tx.symbol, shares: 0, cost: 0, opened: tx.t });
    if (tx.side === 'buy') {
      if (p.shares === 0) p.opened = tx.t;
      p.shares = r3(p.shares + tx.shares);
      p.cost += tx.shares * tx.price;
    } else {
      const avg = p.shares ? p.cost / p.shares : 0;
      closed.push({ symbol: tx.symbol, t: tx.t, shares: tx.shares, price: tx.price, avgCost: avg, pl: (tx.price - avg) * tx.shares, held: tx.t - p.opened, id: tx.id });
      p.cost -= avg * tx.shares;
      p.shares = r3(p.shares - tx.shares);
      if (p.shares <= 0) { p.shares = 0; p.cost = 0; }
    }
  }
  const open = Object.values(pos).filter((p) => p.shares > 0).map((p) => ({ ...p, avgCost: p.cost / p.shares }));
  return { open, closed };
}

export const sharesOf = (account, symbol) => holdings(account).open.find((p) => p.symbol === symbol)?.shares ?? 0;

// Applies a fill. Returns { ok, error }. Mutates the account.
export function fill(account, { symbol, side, shares, price, t = Date.now(), orderType = 'market', note = null, coach = null }) {
  shares = r3(shares);
  if (!(shares > 0) || !(price > 0)) return { ok: false, error: 'Shares and price must be positive.' };
  const total = shares * price;
  if (side === 'buy' && total > account.cash + 0.005) return { ok: false, error: `Not enough cash: this costs $${total.toFixed(2)} and you have $${account.cash.toFixed(2)}.` };
  if (side === 'sell') {
    const held = sharesOf(account, symbol);
    if (shares > held + 1e-9) return { ok: false, error: `You only own ${held} shares of ${symbol}.` };
  }
  account.cash = r2(account.cash + (side === 'buy' ? -total : total));
  const tx = { id: uid('t'), t, symbol, side, shares, price, orderType, note, coach };
  account.transactions.push(tx);
  return { ok: true, tx };
}

// attach (buy orders only): { stop, target, targetShares }, protective orders created when the buy fills.
export function placeOrder(account, { symbol, side, type, price, shares, t = Date.now(), note = null, attach = null }) {
  if (!['limit', 'stop'].includes(type)) throw new Error('Unknown order type');
  if (type === 'stop' && side !== 'sell') throw new Error('Stop orders here are stop-losses (sell only).');
  const order = { id: uid('o'), t, symbol, side, type, price: r2(price), shares: r3(shares), status: 'open', note, attach };
  account.orders.push(order);
  return order;
}

// Stop-loss and/or take-profit orders that go live once a buy has filled.
export function attachProtection(account, symbol, shares, { stop, target, targetShares } = {}, t = Date.now()) {
  const placed = [];
  if (stop > 0) placed.push(placeOrder(account, { symbol, side: 'sell', type: 'stop', price: stop, shares, t, note: 'Stop-loss' }));
  if (target > 0 && targetShares > 0) placed.push(placeOrder(account, { symbol, side: 'sell', type: 'limit', price: target, shares: Math.min(targetShares, shares), t, note: 'Take profit' }));
  return placed;
}

// Once a position is fully sold, its remaining sell orders (stop / target) are no longer needed.
export function closeOutOrders(account, symbol) {
  if (sharesOf(account, symbol) > 0) return [];
  return account.orders
    .filter((o) => o.status === 'open' && o.symbol === symbol && o.side === 'sell')
    .map((o) => cancelOrder(account, o.id, 'Position closed, so this order was no longer needed'));
}

export function cancelOrder(account, id, reason = 'Cancelled by you') {
  const o = account.orders.find((x) => x.id === id && x.status === 'open');
  if (o) { o.status = 'cancelled'; o.reason = reason; o.closedAt = Date.now(); }
  return o;
}

/**
 * Checks open orders against candles that happened after each order was placed.
 * candlesBySymbol: { SYM: [candles...] }. Returns the list of events (fills/cancels) that happened.
 */
export function processOrders(account, candlesBySymbol) {
  const events = [];
  // Walk forward day by day across all symbols so fills happen in time order.
  const days = new Set();
  for (const o of account.orders) {
    if (o.status !== 'open') continue;
    for (const c of candlesBySymbol[o.symbol] || []) if (dayOf(c.t) > dayOf(o.t)) days.add(dayOf(c.t));
  }
  for (const day of [...days].sort()) {
    for (const o of account.orders) {
      if (o.status !== 'open' || dayOf(o.t) >= day) continue;
      const c = (candlesBySymbol[o.symbol] || []).find((x) => dayOf(x.t) === day);
      if (!c) continue;
      let px = null;
      if (o.type === 'limit' && o.side === 'buy' && c.low <= o.price) px = Math.min(o.price, c.open);
      if (o.type === 'limit' && o.side === 'sell' && c.high >= o.price) px = Math.max(o.price, c.open);
      if (o.type === 'stop' && c.low <= o.price) px = Math.min(o.price, c.open);
      if (px == null) continue;
      let shares = o.shares;
      if (o.side === 'sell') shares = Math.min(shares, sharesOf(account, o.symbol));
      if (shares <= 0) { cancelOrder(account, o.id, `You no longer own ${o.symbol}`); events.push({ type: 'cancel', order: o }); continue; }
      const res = fill(account, { symbol: o.symbol, side: o.side, shares, price: r2(px), t: c.t, orderType: o.type, note: o.note });
      if (res.ok) {
        o.status = 'filled'; o.filledPrice = r2(px); o.closedAt = c.t; o.filledShares = shares;
        events.push({ type: 'fill', order: o, tx: res.tx });
        if (o.side === 'buy' && o.attach) attachProtection(account, o.symbol, shares, o.attach, c.t);
        if (o.side === 'sell') for (const other of closeOutOrders(account, o.symbol)) events.push({ type: 'cancel', order: other });
      } else {
        cancelOrder(account, o.id, res.error);
        events.push({ type: 'cancel', order: o });
      }
    }
  }
  return events;
}

// Daily account value since the account was opened, with the S&P 500 (SPY) scaled to the same start.
export function equityCurve(account, candlesBySymbol, benchCandles) {
  const start = dayOf(account.created);
  const days = (benchCandles || []).map((c) => dayOf(c.t)).filter((d) => d >= start);
  if (!days.length) return [];
  const closeOn = {};
  for (const [sym, cs] of Object.entries(candlesBySymbol)) closeOn[sym] = new Map(cs.map((c) => [dayOf(c.t), c.close]));
  const benchMap = new Map(benchCandles.map((c) => [dayOf(c.t), c.close]));
  const bench0 = benchMap.get(days[0]);
  const txs = [...account.transactions].sort((a, b) => a.t - b.t);
  const lastPx = {};
  let cash = account.startCash, i = 0;
  const shares = {};
  return days.map((d) => {
    while (i < txs.length && dayOf(txs[i].t) <= d) {
      const tx = txs[i++];
      const sign = tx.side === 'buy' ? 1 : -1;
      cash -= sign * tx.shares * tx.price;
      shares[tx.symbol] = (shares[tx.symbol] || 0) + sign * tx.shares;
      lastPx[tx.symbol] ??= tx.price;
    }
    let value = cash;
    for (const [sym, n] of Object.entries(shares)) {
      if (n <= 1e-9) continue;
      const px = closeOn[sym]?.get(d) ?? lastPx[sym];
      if (px != null) lastPx[sym] = px;
      value += n * (px ?? 0);
    }
    return { day: d, value: r2(value), bench: bench0 ? r2(account.startCash * (benchMap.get(d) / bench0)) : null };
  });
}

// Report card over closed trades.
export function tradeStats(account) {
  const { closed } = holdings(account);
  // Group partial sells of one position into "trades" by symbol + open date.
  const wins = closed.filter((c) => c.pl > 0), losses = closed.filter((c) => c.pl < 0);
  const sum = (a) => a.reduce((s, x) => s + x.pl, 0);
  const buys = account.transactions.filter((t) => t.side === 'buy');
  const withStop = buys.filter((b) => account.orders.some((o) => o.type === 'stop' && o.symbol === b.symbol && Math.abs(o.t - b.t) < 120000) || b.coach?.stopPlaced);
  const againstSignal = buys.filter((b) => b.coach?.rating && /Sell/.test(b.coach.rating));
  return {
    sells: closed.length,
    realized: sum(closed),
    winRate: closed.length ? wins.length / closed.length : null,
    avgWin: wins.length ? sum(wins) / wins.length : null,
    avgLoss: losses.length ? sum(losses) / losses.length : null,
    best: closed.reduce((b, c) => (!b || c.pl > b.pl ? c : b), null),
    worst: closed.reduce((b, c) => (!b || c.pl < b.pl ? c : b), null),
    buys: buys.length,
    stopRate: buys.length ? withStop.length / buys.length : null,
    againstSignal: againstSignal.length,
  };
}

/**
 * Pre-trade coach: checks a proposed buy against the site's rules.
 * a: analysis for the symbol (or null). equity: total account value.
 */
export function coachBuy({ shares, price, stop, equity, a, maxPosition = 0.15, riskPerTrade = 0.01 }) {
  const notes = [];
  const cost = shares * price;
  const add = (ok, text) => notes.push({ ok, text });
  if (equity > 0) {
    const w = cost / equity;
    add(w <= maxPosition * 1.2, w <= maxPosition * 1.2
      ? `Position size ${(w * 100).toFixed(0)}% of your account. Within your ${(maxPosition * 100).toFixed(0)}% limit.`
      : `This puts ${(w * 100).toFixed(0)}% of your account in one stock. Your limit is ${(maxPosition * 100).toFixed(0)}%. One bad day could hurt a lot.`);
  }
  if (stop && stop < price) {
    const risk = (price - stop) * shares;
    const rp = equity ? risk / equity : 0;
    add(rp <= riskPerTrade * 1.5, rp <= riskPerTrade * 1.5
      ? `If the stop at $${stop.toFixed(2)} hits you lose about $${risk.toFixed(0)} (${(rp * 100).toFixed(1)}% of your account). Good.`
      : `If the stop hits you lose $${risk.toFixed(0)} (${(rp * 100).toFixed(1)}% of your account). Your rule is ${(riskPerTrade * 100).toFixed(1)}%, so buy fewer shares.`);
  } else {
    add(false, 'No stop-loss. Decide where you\'re wrong before you buy, and let a stop order enforce it.');
  }
  if (a) {
    const st = a.shortTerm, lt = a.longTerm;
    add(st.score >= 43 || lt.score >= 58, st.score >= 58
      ? `StockWise rates it a ${st.label} short-term${st.setup ? ` (${st.setup.label} setup)` : ''}.`
      : lt.score >= 58 ? `Short-term timing is ${st.label}, but it's a ${lt.label} long-term. Fine for an investment, weaker for a quick trade.`
        : `StockWise rates it ${st.label} short-term and ${lt.label} long-term. You're trading against the signals.`);
    if (a.daysToEarnings != null && a.daysToEarnings <= 7) add(false, `Earnings in ${a.daysToEarnings} days. The price can gap past your stop.`);
    if (a.rsi != null && a.rsi > 75) add(false, `RSI ${a.rsi.toFixed(0)}: overheated. Buying here is chasing, so a pullback is likely.`);
  }
  const score = notes.filter((n) => n.ok).length / notes.length;
  return { notes, grade: score >= 0.99 ? 'A' : score >= 0.75 ? 'B' : score >= 0.5 ? 'C' : 'D' };
}
