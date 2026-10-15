import { getBatch, getHistory, getAnalysis, store, settings, money, pct, shares as fmtShares, toneOf, esc, badge, demoNotice } from '../api.js';
import { newAccount, fill, holdings, placeOrder, cancelOrder, closeOutOrders, processOrders, equityCurve, tradeStats, coachBuy, attachProtection } from '../lib/paper.js';
import { positionSize, RISK_PROFILES } from '../lib/sizing.js';
import { UNIVERSE } from '../lib/universe.js';
import { mountLineChart } from '../chart.js';

const KEY = 'paper';
const load = () => store.get(KEY, null);
const save = (a) => store.set(KEY, a);
const fmtDate = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
let flash = null; // message shown once after an action
let teardown = null; // the page re-renders itself after each order

export async function renderPractice(app, q) {
  teardown?.();
  teardown = null;
  const acct = load();
  if (!acct) return renderSetup(app);

  const symbols = [...new Set([...acct.transactions.map((t) => t.symbol), ...acct.orders.filter((o) => o.status === 'open').map((o) => o.symbol)])];
  const [items, spy] = await Promise.all([getBatch(symbols), getHistory('SPY').catch(() => null)]);
  const bySym = Object.fromEntries(items.map((i) => [i.symbol, i]));
  const candles = Object.fromEntries(items.map((i) => [i.symbol, i.candles]));

  // Fill any limit/stop orders that new candles have triggered since your last visit.
  const events = processOrders(acct, candles);
  if (events.length) save(acct);

  const s = settings();
  const profile = RISK_PROFILES[s.profile];
  const { open, closed } = holdings(acct);
  const price = (sym) => bySym[sym]?.analysis.price ?? null;
  const positions = open.map((p) => {
    const px = price(p.symbol) ?? p.avgCost;
    return { ...p, price: px, value: p.shares * px, pl: (px - p.avgCost) * p.shares, plPct: px / p.avgCost - 1, a: bySym[p.symbol]?.analysis };
  });
  const invested = positions.reduce((t, p) => t + p.value, 0);
  const equity = acct.cash + invested;
  const ret = equity / acct.startCash - 1;
  const curve = spy ? equityCurve(acct, candles, spy.candles) : [];
  const benchRet = curve.length && curve.at(-1).bench ? curve.at(-1).bench / acct.startCash - 1 : null;
  const stats = tradeStats(acct);
  const openOrders = acct.orders.filter((o) => o.status === 'open');
  const closedById = Object.fromEntries(closed.map((c) => [c.id, c]));
  const hasStop = (sym) => openOrders.some((o) => o.symbol === sym && o.type === 'stop');

  const eventText = (e) => e.type === 'fill'
    ? `${e.order.type === 'stop' ? 'Stop-loss' : 'Limit'} ${e.order.side} filled: ${fmtShares(e.tx.shares)} ${e.order.symbol} at ${money(e.tx.price)} on ${fmtDate(e.tx.t)}.`
    : `Order cancelled: ${e.order.side} ${e.order.symbol} (${e.order.reason}).`;

  app.innerHTML = `<div class="practice-page">
    <section class="page-head practice-head">
      <div>
        <h1>Practice Trading</h1>
        <p class="lede">Trade with fake money at real market prices. Build the habits (sizing, stop-losses, patience) before real money is on the line.</p>
      </div>
      <button class="btn ghost small-btn" id="reset">Reset account</button>
    </section>
    ${demoNotice(items)}
    ${flash ? `<div class="notice ${flash.tone || 'ok'}">${flash.html}</div>` : ''}
    ${events.length ? `<div class="notice ok"><strong>While you were away:</strong><ul class="bullets small">${events.map((e) => `<li>${esc(eventText(e))}</li>`).join('')}</ul></div>` : ''}

    <section class="card">
      <div class="big-stats five">
        <div><span class="label">Account value</span><span class="value">${money(equity)}</span><span class="sub">started with ${money(acct.startCash, 0)}</span></div>
        <div><span class="label">Total return</span><span class="value ${toneOf(ret)}">${pct(ret, 2, true)}</span><span class="sub ${toneOf(equity - acct.startCash)}">${equity >= acct.startCash ? '+' : '−'}${money(Math.abs(equity - acct.startCash))}</span></div>
        <div><span class="label">vs. S&amp;P 500</span><span class="value ${benchRet == null ? '' : toneOf(ret - benchRet)}">${benchRet == null ? '—' : `${ret - benchRet >= 0 ? '+' : ''}${((ret - benchRet) * 100).toFixed(2)} pts`}</span><span class="sub">S&amp;P ${benchRet == null ? '—' : pct(benchRet, 2, true)} since you started</span></div>
        <div><span class="label">Cash</span><span class="value">${money(acct.cash)}</span><span class="sub">${pct(acct.cash / equity, 0)} of account</span></div>
        <div><span class="label">Realized P/L</span><span class="value ${toneOf(stats.realized)}">${stats.realized >= 0 ? '+' : '−'}${money(Math.abs(stats.realized))}</span><span class="sub">from ${stats.sells} sale${stats.sells === 1 ? '' : 's'}</span></div>
      </div>
    </section>

    <div class="grid-2 practice-grid">
      <section class="card" id="ticket"></section>
      <section class="card">
        <div class="card-head"><h2>Your account vs. the S&amp;P 500</h2></div>
        <div class="legend"><span class="k acct">Your account</span><span class="k benchk">S&amp;P 500 (same starting money)</span></div>
        <div id="equity" class="chart-box"></div>
        ${curve.length < 2 ? '<p class="muted small">Your chart grows one point per trading day. Check back tomorrow!</p>' : ''}
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>Positions</h2><span class="muted small">${positions.length} open</span></div>
      ${positions.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Gain/loss</th><th>Signal now</th><th></th></tr></thead>
        <tbody>${positions.sort((x, y) => y.value - x.value).map((p) => `<tr>
          <td><a href="#/stock/${encodeURIComponent(p.symbol)}"><strong>${esc(p.symbol)}</strong></a><div class="sub">${pct(p.value / equity, 0)} of account${hasStop(p.symbol) ? '' : ' · <span class="down">no stop!</span>'}</div></td>
          <td class="num">${fmtShares(p.shares)}</td>
          <td class="num">${money(p.avgCost)}</td>
          <td class="num">${money(p.price)}</td>
          <td class="num">${money(p.value, 0)}</td>
          <td class="num ${toneOf(p.pl)}">${p.pl >= 0 ? '+' : '−'}${money(Math.abs(p.pl))}<div class="sub">${pct(p.plPct, 1, true)}</div></td>
          <td>${p.a ? `${badge(p.a.shortTerm)} <span class="sub">short</span><br>${badge(p.a.longTerm)} <span class="sub">long</span>` : '—'}</td>
          <td class="row-actions"><button class="btn ghost small-btn" data-sell="${esc(p.symbol)}">Sell</button>${hasStop(p.symbol) ? '' : `<button class="btn ghost small-btn" data-protect="${esc(p.symbol)}">Add stop</button>`}</td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No positions yet. Use the order ticket to make your first trade. Not sure what to buy? Check <a href="#/ideas">Top Ideas</a>.</p>'}
    </section>

    ${openOrders.length ? `<section class="card">
      <div class="card-head"><h2>Open orders</h2><span class="muted small">Checked against every new daily candle</span></div>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Placed</th><th>Order</th><th class="num">Shares</th><th class="num">Trigger price</th><th class="num">Now</th><th></th></tr></thead>
        <tbody>${openOrders.map((o) => `<tr>
          <td>${fmtDate(o.t)}</td>
          <td><strong>${o.type === 'stop' ? 'Stop-loss sell' : `Limit ${o.side}`}</strong> ${esc(o.symbol)}${o.note ? ` <span class="muted small">· ${esc(o.note)}</span>` : ''}${o.attach ? '<div class="sub">adds stop/target when filled</div>' : ''}</td>
          <td class="num">${o.side === 'sell' ? fmtShares(Math.min(o.shares, positions.find((x) => x.symbol === o.symbol)?.shares ?? 0)) : fmtShares(o.shares)}</td>
          <td class="num">${money(o.price)}</td>
          <td class="num">${price(o.symbol) ? money(price(o.symbol)) : '—'}</td>
          <td><button class="icon-btn" data-cancel="${esc(o.id)}" aria-label="Cancel order">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
    </section>` : ''}

    <section class="card">
      <h2>Report card</h2>
      ${reportCard(stats)}
    </section>

    <section class="card">
      <div class="card-head"><h2>History</h2><span class="muted small">${acct.transactions.length} trades</span></div>
      ${acct.transactions.length ? `<div class="table-wrap"><table class="table compact">
        <thead><tr><th>Date</th><th>Trade</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Total</th><th class="num">Profit</th><th>Coach</th></tr></thead>
        <tbody>${[...acct.transactions].reverse().map((t) => {
          const c = closedById[t.id];
          return `<tr><td>${fmtDate(t.t)}</td>
            <td><span class="badge ${t.side === 'buy' ? 'up' : 'flat'}">${t.side === 'buy' ? 'Buy' : 'Sell'}</span> <strong>${esc(t.symbol)}</strong> <span class="muted small">${t.orderType === 'market' ? 'market' : t.orderType === 'stop' ? 'stop-loss' : 'limit'}</span></td>
            <td class="num">${fmtShares(t.shares)}</td><td class="num">${money(t.price)}</td><td class="num">${money(t.shares * t.price, 0)}</td>
            <td class="num ${c ? toneOf(c.pl) : ''}">${c ? `${c.pl >= 0 ? '+' : '−'}${money(Math.abs(c.pl))}` : ''}</td>
            <td>${t.coach?.grade ? `<span class="grade-pill g-${t.coach.grade}">${t.coach.grade}</span>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="muted">Nothing yet.</p>'}
    </section></div>`;
  flash = null;
  const page = app.querySelector('.practice-page');

  const chart = curve.length ? mountLineChart(app.querySelector('#equity'), curve) : null;
  const ticket = mountTicket(app.querySelector('#ticket'), { acct, equity, profile, s, initial: q.get('symbol'), positions, rerender: () => renderPractice(app, new URLSearchParams()) });

  app.querySelector('#reset').addEventListener('click', () => {
    if (!confirm('Start over? This erases all practice trades and orders.')) return;
    store.set(KEY, null);
    renderPractice(app, new URLSearchParams());
  });
  page.addEventListener('click', (e) => {
    const sell = e.target.closest('[data-sell]');
    if (sell) { ticket.load(sell.dataset.sell, 'sell'); app.querySelector('#ticket').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const prot = e.target.closest('[data-protect]');
    if (prot) {
      const p = positions.find((x) => x.symbol === prot.dataset.protect);
      const stop = p.a?.plan.stop ?? p.price * 0.92;
      const input = prompt(`Stop-loss price for ${p.symbol} (sell all ${fmtShares(p.shares)} shares if it falls here):`, stop.toFixed(2));
      const px = Number(input);
      if (input == null) return;
      if (!(px > 0) || px >= p.price) { alert('The stop must be a positive price below the current price.'); return; }
      placeOrder(acct, { symbol: p.symbol, side: 'sell', type: 'stop', price: px, shares: p.shares, note: 'Stop-loss' });
      save(acct);
      flash = { html: `Stop-loss placed: sell ${fmtShares(p.shares)} ${esc(p.symbol)} if it trades at ${money(px)} or lower.` };
      renderPractice(app, new URLSearchParams());
      return;
    }
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      cancelOrder(acct, cancel.dataset.cancel);
      save(acct);
      flash = { html: 'Order cancelled.' };
      renderPractice(app, new URLSearchParams());
    }
  });
  teardown = () => chart?.destroy();
  return teardown;
}

function renderSetup(app) {
  app.innerHTML = `
    <section class="page-head">
      <h1>Practice Trading</h1>
      <p class="lede">Get a practice account with fake money and trade real stocks at real prices. Nothing you do here touches real money.</p>
    </section>
    <section class="card setup-card">
      <h2>How much do you want to start with?</h2>
      <p class="muted">Pick something close to what you'd really invest, so the habits carry over.</p>
      <div class="chips" id="presets">${[1000, 5000, 10000, 25000, 100000].map((v) => `<button class="chip" data-amt="${v}">${money(v, 0)}</button>`).join('')}</div>
      <form id="start" class="form inline-form">
        <label>Starting cash<div class="input-prefix"><span>$</span><input type="number" name="amt" min="100" max="100000000" step="any" value="${settings().account || 10000}" required></div></label>
        <button class="btn" type="submit">Start practicing</button>
      </form>
      <ul class="bullets small muted">
        <li><strong>Market orders</strong> fill right away at the latest price.</li>
        <li><strong>Limit</strong> and <strong>stop-loss</strong> orders wait and fill when a later day's prices reach them, just like a real broker.</li>
        <li>A coach checks every buy: size, stop-loss, the StockWise signal, and earnings.</li>
        <li>Your account is compared with simply buying the S&amp;P 500. Beating it is the real test.</li>
      </ul>
    </section>`;
  const form = app.querySelector('#start');
  app.querySelector('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-amt]');
    if (b) form.elements.amt.value = b.dataset.amt;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amt = Number(form.elements.amt.value);
    if (!(amt >= 100)) return;
    save(newAccount(Math.round(amt * 100) / 100));
    flash = { html: `Practice account opened with <strong>${money(amt, 0)}</strong>. Search for a stock below to place your first trade.` };
    renderPractice(app, new URLSearchParams());
  });
}

function reportCard(st) {
  const tips = [];
  if (st.buys === 0) return '<p class="muted">Make a few trades and your stats and coaching tips will appear here.</p>';
  if (st.stopRate != null && st.stopRate < 0.8) tips.push(`Only ${pct(st.stopRate, 0)} of your buys had a stop-loss. Pros protect every trade.`);
  if (st.avgWin != null && st.avgLoss != null && Math.abs(st.avgLoss) > st.avgWin) tips.push(`Your average loss (${money(Math.abs(st.avgLoss))}) is bigger than your average win (${money(st.avgWin)}). Cut losers sooner or let winners run longer.`);
  if (st.againstSignal > 0) tips.push(`${st.againstSignal} buy${st.againstSignal === 1 ? ' was' : 's were'} rated Sell by StockWise when you bought. Did they work? Review them in the history below.`);
  if (st.winRate != null && st.winRate < 0.4 && st.sells >= 5) tips.push('Win rate under 40%. That\'s OK only if your wins are much bigger than your losses (2:1 or better).');
  if (!tips.length) tips.push('Solid habits so far. Keep sizing small and using stops.');
  return `<div class="big-stats four">
      <div><span class="label">Win rate</span><span class="value">${st.winRate == null ? '—' : pct(st.winRate, 0)}</span><span class="sub">${st.sells} sale${st.sells === 1 ? '' : 's'}</span></div>
      <div><span class="label">Avg win / loss</span><span class="value"><span class="up">${st.avgWin == null ? '—' : money(st.avgWin, 0)}</span> / <span class="down">${st.avgLoss == null ? '—' : money(Math.abs(st.avgLoss), 0)}</span></span></div>
      <div><span class="label">Best / worst</span><span class="value small-value">${st.best ? `<span class="up">${esc(st.best.symbol)} +${money(st.best.pl, 0)}</span>` : '—'}<br>${st.worst && st.worst.pl < 0 ? `<span class="down">${esc(st.worst.symbol)} −${money(Math.abs(st.worst.pl), 0)}</span>` : ''}</span></div>
      <div><span class="label">Buys with a stop</span><span class="value">${st.stopRate == null ? '—' : pct(st.stopRate, 0)}</span><span class="sub">${st.buys} buy${st.buys === 1 ? '' : 's'}</span></div>
    </div>
    <h3>Coach's notes</h3><ul class="bullets">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

// --- order ticket ---------------------------------------------------------------

function mountTicket(el, ctx) {
  const st = { symbol: null, data: null, side: 'buy', type: 'market', error: null };
  const knownSymbols = UNIVERSE.map((u) => `<option value="${u.symbol}">${esc(u.name)}</option>`).join('');

  const shell = () => {
    el.innerHTML = `
      <h2>Order ticket</h2>
      <form id="sym-form" class="sym-row">
        <input name="sym" list="sym-list" placeholder="Stock symbol, e.g. AAPL" autocapitalize="characters" value="${esc(st.symbol || '')}" aria-label="Stock symbol">
        <datalist id="sym-list">${knownSymbols}</datalist>
        <button class="btn ghost" type="submit">Get quote</button>
      </form>
      <div id="ticket-body">${st.error ? `<p class="down small">${esc(st.error)}</p>` : '<p class="muted small">Look up a stock to trade. Tip: open any stock page and click <strong>Practice trade</strong>.</p>'}</div>`;
    el.querySelector('#sym-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.elements.sym.value.trim().toUpperCase();
      if (v) api.load(v, st.side);
    });
  };

  const body = () => el.querySelector('#ticket-body');

  const drawOrder = () => {
    const a = st.data.analysis;
    const owned = ctx.positions.find((p) => p.symbol === st.symbol)?.shares ?? 0;
    const sell = st.side === 'sell';
    body().innerHTML = `
      <div class="quote">
        <div><strong class="sym">${esc(st.symbol)}</strong> <span class="muted">${esc(st.data.name || '')}</span>
          <div class="price-line"><span class="price small-price">${money(a.price)}</span> <span class="${toneOf(a.changePct)}">${pct(a.changePct, 2, true)}</span></div></div>
        <div class="quote-badges">${badge(a.shortTerm)} <span class="sub">short</span> ${badge(a.longTerm)} <span class="sub">long</span><br><a class="small" href="#/stock/${encodeURIComponent(st.symbol)}">Full analysis →</a></div>
      </div>
      <form id="order" class="form">
        <div class="seg" id="side"><button type="button" data-side="buy" class="${sell ? '' : 'on'}">Buy</button><button type="button" data-side="sell" class="${sell ? 'on' : ''}">Sell${owned ? ` (own ${fmtShares(owned)})` : ''}</button></div>
        <div class="row">
          <label>Order type<select name="type">
            <option value="market" ${st.type === 'market' ? 'selected' : ''}>Market: fill now at ${money(a.price)}</option>
            <option value="limit" ${st.type === 'limit' ? 'selected' : ''}>Limit: ${sell ? 'sell at this price or higher' : 'buy at this price or lower'}</option>
            ${sell ? `<option value="stop" ${st.type === 'stop' ? 'selected' : ''}>Stop-loss: sell if it falls to this price</option>` : ''}
          </select></label>
          <label class="${st.type === 'market' ? 'hidden-field' : ''}">${st.type === 'stop' ? 'Stop price' : 'Limit price'}<div class="input-prefix"><span>$</span><input type="number" name="px" step="any" min="0" value="${(sell ? (st.type === 'stop' ? a.plan.stop : a.plan.targets[0]) : a.plan.buyZone[0]).toFixed(2)}"></div></label>
        </div>
        <label>Shares
          <div class="shares-row">
            <input type="number" name="shares" min="0" step="${ctx.s.fractional ? 'any' : '1'}" value="${sell ? owned : ''}" placeholder="0" required>
            ${sell ? '<button class="btn ghost small-btn" type="button" id="all">All</button>' : '<button class="btn ghost small-btn" type="button" id="size">Size it for me</button>'}
          </div>
        </label>
        ${sell ? '' : `
        <fieldset class="protect">
          <legend>Protect this trade</legend>
          <label class="check"><input type="checkbox" name="useStop" checked> Stop-loss at <span class="input-prefix inline"><span>$</span><input type="number" name="stop" step="any" min="0" value="${a.plan.stop.toFixed(2)}"></span></label>
          <label class="check"><input type="checkbox" name="useTarget" checked> Take profit on ⅓ at <span class="input-prefix inline"><span>$</span><input type="number" name="target" step="any" min="0" value="${a.plan.targets[0].toFixed(2)}"></span></label>
        </fieldset>`}
        <div id="estimate" class="estimate"></div>
        <div id="coach"></div>
        <p id="order-error" class="down small" role="alert"></p>
        <button class="btn ${sell ? 'sell-btn' : ''}" type="submit">${sell ? 'Place practice sell' : 'Place practice buy'}</button>
        <p class="muted small">Market orders fill at the latest price StockWise has (refreshed a few times each trading day). Limit and stop orders are checked against each new day's high and low.</p>
      </form>`;

    const form = body().querySelector('#order');
    const n = (k) => Number(form.elements[k]?.value);
    const entryPx = () => (st.type === 'market' ? a.price : n('px'));
    const update = () => {
      const sh = n('shares') || 0;
      const px = entryPx() || 0;
      const total = sh * px;
      body().querySelector('#estimate').innerHTML = sh > 0 && px > 0
        ? `<div class="kv small"><span>${sell ? 'You receive' : 'Cost'}</span><strong>${money(total)}</strong><span>Cash after</span><strong class="${!sell && total > ctx.acct.cash ? 'down' : ''}">${st.type === 'market' ? money(ctx.acct.cash + (sell ? total : -total)) : `${money(ctx.acct.cash)} (until it fills)`}</strong></div>` : '';
      if (!sell) {
        const c = coachBuy({ shares: sh, price: px, stop: form.elements.useStop.checked ? n('stop') : null, equity: ctx.equity, a, maxPosition: ctx.profile.maxPosition, riskPerTrade: ctx.profile.riskPerTrade });
        body().querySelector('#coach').innerHTML = sh > 0 ? `<div class="coach"><div class="coach-head">Coach check <span class="grade-pill g-${c.grade}">${c.grade}</span></div><ul>${c.notes.map((x) => `<li class="${x.ok ? 'ok' : 'warn'}">${x.ok ? '✓' : '⚠'} ${esc(x.text)}</li>`).join('')}</ul></div>` : '';
      }
    };
    form.addEventListener('input', update);
    form.elements.type.addEventListener('change', () => { st.type = form.elements.type.value; drawOrder(); });
    body().querySelector('#side').addEventListener('click', (e) => {
      const b = e.target.closest('[data-side]');
      if (b && b.dataset.side !== st.side) { st.side = b.dataset.side; st.type = 'market'; drawOrder(); }
    });
    body().querySelector('#all')?.addEventListener('click', () => { form.elements.shares.value = owned; update(); });
    body().querySelector('#size')?.addEventListener('click', () => {
      const stop = form.elements.useStop.checked ? n('stop') : a.plan.stop;
      const pos = positionSize({ account: ctx.equity, riskPct: ctx.profile.riskPerTrade, entry: entryPx(), stop, maxPositionPct: ctx.profile.maxPosition, fractional: ctx.s.fractional });
      let sh = pos && !pos.error ? pos.shares : 0;
      const affordable = ctx.s.fractional ? Math.floor((ctx.acct.cash / entryPx()) * 1000) / 1000 : Math.floor(ctx.acct.cash / entryPx());
      sh = Math.min(sh, affordable);
      form.elements.shares.value = sh;
      update();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = body().querySelector('#order-error');
      const sh = n('shares');
      const px = entryPx();
      if (!(sh > 0)) { err.textContent = 'Enter how many shares.'; return; }
      if (!ctx.s.fractional && !Number.isInteger(sh)) { err.textContent = 'Whole shares only. Turn on fractional shares in your account settings on the Watchlist page.'; return; }
      if (!(px > 0)) { err.textContent = 'Enter a price.'; return; }
      const acct = ctx.acct;
      let msg;
      if (sell) {
        if (sh > owned + 1e-9) { err.textContent = `You only own ${fmtShares(owned)} shares.`; return; }
        if (st.type === 'market') {
          const res = fill(acct, { symbol: st.symbol, side: 'sell', shares: sh, price: a.price });
          if (!res.ok) { err.textContent = res.error; return; }
          closeOutOrders(acct, st.symbol);
          msg = `Sold ${fmtShares(sh)} ${st.symbol} at ${money(a.price)}.`;
        } else {
          if (st.type === 'stop' && px >= a.price) { err.textContent = 'A stop-loss must be below the current price.'; return; }
          if (st.type === 'limit' && px <= a.price) { err.textContent = 'A limit sell should be above the current price. To sell now, use a market order.'; return; }
          placeOrder(acct, { symbol: st.symbol, side: 'sell', type: st.type, price: px, shares: sh, note: st.type === 'stop' ? 'Stop-loss' : 'Take profit' });
          msg = `${st.type === 'stop' ? 'Stop-loss' : 'Limit sell'} placed: ${fmtShares(sh)} ${st.symbol} at ${money(px)}.`;
        }
      } else {
        const stop = form.elements.useStop.checked ? n('stop') : null;
        const target = form.elements.useTarget.checked ? n('target') : null;
        if (stop && stop >= px) { err.textContent = 'Your stop-loss must be below the buy price.'; return; }
        if (target && target <= px) { err.textContent = 'Your take-profit price must be above the buy price.'; return; }
        const coach = coachBuy({ shares: sh, price: px, stop, equity: ctx.equity, a, maxPosition: ctx.profile.maxPosition, riskPerTrade: ctx.profile.riskPerTrade });
        const tShares = ctx.s.fractional ? Math.floor((sh / 3) * 1000) / 1000 : Math.floor(sh / 3);
        const attach = { stop, target, targetShares: tShares };
        const coachRec = { grade: coach.grade, rating: a.shortTerm.label, stopPlaced: !!stop };
        if (st.type === 'market') {
          const res = fill(acct, { symbol: st.symbol, side: 'buy', shares: sh, price: a.price, coach: coachRec });
          if (!res.ok) { err.textContent = res.error; return; }
          attachProtection(acct, st.symbol, sh, attach);
          msg = `Bought ${fmtShares(sh)} ${st.symbol} at ${money(a.price)}${stop ? `, with a stop-loss at ${money(stop)}` : ''}${target && tShares ? ` and a take-profit on ${fmtShares(tShares)} shares at ${money(target)}` : ''}.`;
        } else {
          if (px >= a.price) { err.textContent = 'A limit buy should be below the current price. To buy now, use a market order.'; return; }
          if (sh * px > acct.cash) { err.textContent = `Not enough cash: this needs ${money(sh * px)}.`; return; }
          placeOrder(acct, { symbol: st.symbol, side: 'buy', type: 'limit', price: px, shares: sh, attach: stop || target ? attach : null });
          msg = `Limit buy placed: ${fmtShares(sh)} ${st.symbol} at ${money(px)} or lower.${stop ? ' Your stop-loss goes live once it fills.' : ''}`;
        }
      }
      save(acct);
      flash = { html: esc(msg) };
      ctx.rerender();
    });
    update();
  };

  const api = {
    async load(symbol, side = 'buy') {
      st.symbol = symbol; st.side = side; st.type = 'market'; st.error = null;
      shell();
      body().innerHTML = '<div class="loading">Getting a quote…</div>';
      try {
        st.data = await getAnalysis(symbol);
        drawOrder();
      } catch (err) {
        st.error = err.message;
        shell();
      }
    },
  };
  shell();
  if (ctx.initial) api.load(ctx.initial.toUpperCase());
  return api;
}

