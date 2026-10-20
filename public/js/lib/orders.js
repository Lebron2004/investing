// Order Helper: turns a trade idea into a correct bracket order ("1st Triggers OCO") and
// broker-specific, step-by-step instructions, plus safety checks. Pure functions (tested).

const usd = (n) => `$${Number(n).toFixed(2)}`;

/**
 * input: { symbol, shares, entryType: 'stop' | 'limit' | 'market', entry, stop, target,
 *          price (current, optional), account (optional), cash (optional), timing: 'DAY' | 'GTC' }
 */
export function buildOrder(input) {
  const o = { timing: 'DAY', entryType: 'stop', ...input };
  o.symbol = String(o.symbol || '').trim().toUpperCase();
  const entryPx = o.entryType === 'market' ? (o.price ?? o.entry) : o.entry;
  const legs = [
    { n: 1, role: 'Entry', side: 'Buy', qty: o.shares, type: o.entryType === 'stop' ? 'Stop market' : o.entryType === 'limit' ? 'Limit' : 'Market', price: o.entryType === 'market' ? null : o.entry, timing: o.timing },
    { n: 2, role: 'Stop-loss', side: 'Sell', qty: o.shares, type: 'Stop market', price: o.stop, timing: o.timing },
    { n: 3, role: 'Profit target', side: 'Sell', qty: o.shares, type: 'Limit', price: o.target, timing: o.timing },
  ];
  return { ...o, entryPx, legs, checks: checkOrder(o, entryPx) };
}

export function checkOrder(o, entryPx) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(o.symbol)) add('error', 'Enter a stock symbol (for example SOFI).');
  if (!(o.shares > 0)) add('error', 'Enter how many shares to buy.');
  if (o.entryType !== 'market' && !(o.entry > 0)) add('error', 'Enter your entry price.');
  if (!(o.stop > 0)) add('error', 'Enter a stop-loss price. Every trade needs one.');
  if (!(o.target > 0)) add('error', 'Enter a profit-target price.');
  if (out.some((x) => x.level === 'error')) return out;

  if (o.stop >= entryPx) add('error', `Your stop-loss (${usd(o.stop)}) must be below your entry (${usd(entryPx)}). Otherwise it sells right away.`);
  if (o.target <= entryPx) add('error', `Your profit target (${usd(o.target)}) must be above your entry (${usd(entryPx)}).`);
  if (o.price > 0) {
    if (o.entryType === 'stop' && o.entry <= o.price) add('error', `A buy STOP must be above the current price (${usd(o.price)}). At ${usd(o.entry)} it would fill immediately. Use a Limit order to buy below the current price.`);
    if (o.entryType === 'limit' && o.entry > o.price * 1.002) add('warn', `A buy LIMIT above the current price (${usd(o.price)}) fills right away at about the current price. If you meant "buy only if it rises to ${usd(o.entry)}", use a Stop order.`);
    if (o.stop >= o.price && o.entryType !== 'stop') add('error', `Your stop-loss (${usd(o.stop)}) is above the current price (${usd(o.price)}). It would trigger as soon as you buy.`);
  }
  if (out.some((x) => x.level === 'error')) return out;

  const risk = (entryPx - o.stop) * o.shares;
  const reward = (o.target - entryPx) * o.shares;
  const cost = entryPx * o.shares;
  const rr = reward / risk;
  add(rr >= 1.5 ? 'ok' : 'warn', `Reward : risk is ${rr.toFixed(1)} : 1 (risking ${usd(risk)} to make ${usd(reward)}).${rr < 1.5 ? ' Aim for at least 1.5–2 : 1.' : ''}`);
  if (o.cash > 0) {
    add(cost <= o.cash ? 'ok' : 'error', cost <= o.cash ? `Cost ${usd(cost)} fits your ${usd(o.cash)} cash.` : `Cost ${usd(cost)} is more than your ${usd(o.cash)} cash. Buy ${Math.floor(o.cash / entryPx)} shares or fewer.`);
  }
  if (o.account > 0) {
    const rp = risk / o.account;
    const max = Math.floor((o.account * 0.01) / (entryPx - o.stop));
    add(rp <= 0.02 ? 'ok' : 'warn', rp <= 0.02
      ? `If the stop hits you lose ${usd(risk)} (${rp < 0.001 ? 'less than 0.1' : (rp * 100).toFixed(1)}% of your account). Within the 1–2% guideline.`
      : `If the stop hits you lose ${usd(risk)}, which is ${(rp * 100).toFixed(1)}% of your ${usd(o.account)} account. The 1% rule would be ${max} share${max === 1 ? '' : 's'}.`);
    if (cost / o.account > 0.5) add('warn', `This puts ${Math.round((cost / o.account) * 100)}% of your account into one stock.`);
  }
  if (o.entryType === 'stop') add('info', 'Stop market orders fill at the next available price once triggered. In a fast move that can be a little worse than your trigger price.');
  if (o.timing === 'DAY') add('info', 'DAY orders expire at 4:00 PM ET. If you still hold the shares near the close, your stop and target expire too, so sell manually or re-enter them.');
  return out;
}

export const BROKERS = {
  schwab: 'Charles Schwab (website)',
  tos: 'thinkorswim (desktop)',
  fidelity: 'Fidelity',
  webull: 'Webull',
  robinhood: 'Robinhood',
  other: 'Other broker',
};

const legText = (l, sym) => `${l.side} ${l.qty} ${sym} · ${l.type}${l.price != null ? ` ${usd(l.price)}` : ''} · ${l.timing === 'GTC' ? 'GTC' : 'Day'}`;

// Step-by-step instructions. Menu names are what each broker used at the time of writing;
// they can differ slightly between app versions.
export function brokerSteps(broker, order) {
  const [e, s, t] = order.legs;
  const sym = order.symbol;
  const entryFields = (l) => l.type === 'Market' ? 'Order type <b>Market</b>' : `Order type <b>${l.type}</b>, ${l.type === 'Limit' ? 'Limit' : 'Stop'} price <b>${usd(l.price)}</b>`;
  const timing = order.timing === 'GTC' ? 'GTC' : 'Day';
  switch (broker) {
    case 'schwab': return [
      { title: 'Open the All-In-One Trade Ticket', detail: 'Trade → <b>All-In-One Trade Ticket</b>.' },
      { title: 'Set Conditional to "1st Triggers OCO"', detail: 'In the <b>Conditional</b> dropdown pick <b>1st Triggers OCO</b>. You should see three orders. <em>Not</em> "One Cancels Other (OCO)": that\'s only for shares you already own.' },
      { title: 'Order 1: the entry', detail: `Symbol <b>${sym}</b>, Action <b>Buy</b>, Quantity <b>${e.qty}</b>, ${entryFields(e)}, Timing <b>${timing}</b>.` },
      { title: 'Order 2: the stop-loss', detail: `Symbol <b>${sym}</b>, Action <b>Sell</b>, Quantity <b>${s.qty}</b>, Order type <b>Stop market</b>, Stop price <b>${usd(s.price)}</b>, Timing <b>${timing}</b>.` },
      { title: 'Order 3: the profit target', detail: `Symbol <b>${sym}</b>, Action <b>Sell</b>, Quantity <b>${t.qty}</b>, Order type <b>Limit</b>, Limit price <b>${usd(t.price)}</b>, Timing <b>${timing}</b>.` },
      { title: 'Review, then place', detail: 'Click <b>Review</b>. Check the summary reads like the three lines in the box above, then <b>Place order</b>. Track it under <b>Order Status</b>.' },
    ];
    case 'tos': return [
      { title: 'Start a buy order', detail: `In the <b>Trade</b> tab, type <b>${sym}</b>. Click the <b>Ask</b> price to create a Buy order at the bottom (Order Entry).` },
      { title: 'Turn it into a bracket', detail: 'In the Order Entry row, open the <b>Advanced Order</b> dropdown (it says "Single") and choose <b>1st trgs OCO</b>. Two sell rows appear under your buy.' },
      { title: 'Row 1: the entry', detail: `BUY, quantity <b>${e.qty}</b>, type <b>${e.type === 'Stop market' ? 'STP' : e.type === 'Limit' ? 'LMT' : 'MKT'}</b>${e.price != null ? `, price <b>${usd(e.price)}</b>` : ''}, TIF <b>${timing.toUpperCase()}</b>.` },
      { title: 'Row 2: the stop-loss', detail: `SELL, quantity <b>${s.qty}</b>, type <b>STP</b>, price <b>${usd(s.price)}</b>, TIF <b>${timing.toUpperCase()}</b>.` },
      { title: 'Row 3: the profit target', detail: `SELL, quantity <b>${t.qty}</b>, type <b>LMT</b>, price <b>${usd(t.price)}</b>, TIF <b>${timing.toUpperCase()}</b>.` },
      { title: 'Confirm and send', detail: 'Click <b>Confirm and Send</b>, read the order description, then <b>Send</b>. Working orders show in <b>Monitor → Activity and Positions</b>.' },
    ];
    case 'fidelity': return [
      { title: 'Open the trade ticket', detail: 'Accounts & Trade → <b>Trade</b> → Stocks/ETFs.' },
      { title: 'Choose a conditional order', detail: 'Look for <b>Conditional</b> (or "Order type → Conditional") and pick <b>One-Triggers-OCO (OTOCO)</b>.' },
      { title: 'Trigger order: the entry', detail: `Buy <b>${e.qty}</b> ${sym}, ${entryFields(e)}, Time in force <b>${timing}</b>.` },
      { title: 'OCO order A: the stop-loss', detail: `Sell <b>${s.qty}</b> ${sym}, <b>Stop loss</b> at <b>${usd(s.price)}</b>, ${timing}.` },
      { title: 'OCO order B: the profit target', detail: `Sell <b>${t.qty}</b> ${sym}, <b>Limit</b> at <b>${usd(t.price)}</b>, ${timing}.` },
      { title: 'Preview, then place', detail: 'Click <b>Preview order</b>, check all three legs, then <b>Place order</b>.' },
    ];
    case 'webull': return [
      { title: 'Open a buy order', detail: `Search <b>${sym}</b> → <b>Trade</b> → <b>Buy</b>.` },
      { title: 'Pick the bracket type', detail: 'Change the order type to <b>OTOCO</b> (sometimes under "Advanced"/"Bracket"). It shows a primary order plus take-profit and stop-loss.' },
      { title: 'Primary (entry)', detail: `Quantity <b>${e.qty}</b>, ${entryFields(e)}, ${timing}.` },
      { title: 'Take profit', detail: `Limit sell at <b>${usd(t.price)}</b>.` },
      { title: 'Stop loss', detail: `Stop sell at <b>${usd(s.price)}</b>.` },
      { title: 'Review and submit', detail: 'Check the summary, then submit. Watch it under <b>Orders</b>.' },
    ];
    case 'robinhood': return [
      { title: 'Heads-up: no brackets', detail: 'Robinhood doesn\'t offer "1st Triggers OCO" for stocks, so you place the entry first and protect it after it fills. You can\'t have the stop and the target working at the same time on the same shares.' },
      { title: 'Place the entry', detail: `${sym} → <b>Trade</b> → <b>Buy</b> → order type ${e.type === 'Stop market' ? `<b>Stop order</b>, stop price <b>${usd(e.price)}</b>` : e.type === 'Limit' ? `<b>Limit order</b>, limit <b>${usd(e.price)}</b>` : '<b>Market</b>'}, ${e.qty} shares, good for <b>${timing === 'GTC' ? 'Good till canceled' : 'Good for day'}</b>.` },
      { title: 'As soon as it fills: add the stop-loss', detail: `${sym} → <b>Trade</b> → <b>Sell</b> → <b>Stop loss order</b>, stop price <b>${usd(s.price)}</b>, ${s.qty} shares.` },
      { title: 'Watch your target', detail: `When the price reaches <b>${usd(t.price)}</b>, cancel the stop order and sell (or replace the stop with a Limit sell at ${usd(t.price)}).` },
    ];
    default: return [
      { title: 'Find the bracket / conditional order', detail: 'Look for <b>1st Triggers OCO</b>, <b>OTOCO</b>, <b>Bracket</b> or <b>One-Triggers-OCO</b> in the order-type or "Conditional/Advanced" menu.' },
      { title: 'Order 1: entry', detail: legText(e, sym) },
      { title: 'Order 2: stop-loss', detail: legText(s, sym) },
      { title: 'Order 3: profit target', detail: legText(t, sym) },
      { title: 'If there\'s no bracket option', detail: 'Place the entry, and right after it fills place a Stop sell at the stop-loss price. Watch for the target yourself.' },
    ];
  }
}

export const ORDER_TYPES = [
  ['Market', 'Buy or sell right now at the best available price. Fast, but you don\'t control the exact price.'],
  ['Limit', 'Buy at this price or LOWER (or sell at this price or HIGHER). Use it to buy a dip or to take profit at a target.'],
  ['Stop market', 'Does nothing until the price reaches your trigger, then becomes a market order. A sell stop below the price is a stop-loss; a buy stop above the price buys a breakout.'],
  ['Stop limit', 'Like a stop, but becomes a limit order. You control the price, but in a fast drop it may never fill, which is risky for stop-losses.'],
  ['OCO (One Cancels Other)', 'Two SELL orders on shares you already own: a stop-loss and a profit target. When one fills, the other is cancelled.'],
  ['1st Triggers OCO (OTOCO / bracket)', 'All three in one: the BUY goes in first, and only after it fills do the stop-loss and target go live, as an OCO pair. This is the one to use for a new trade.'],
  ['Day vs GTC', 'DAY orders expire at 4:00 PM ET. GTC (good-till-canceled) orders stay until filled or cancelled, usually up to 60–180 days depending on the broker.'],
];
