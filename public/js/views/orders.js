import { getHistory, settings, saveSettings, store, money, esc } from '../api.js';
import { buildOrder, brokerSteps, BROKERS, ORDER_TYPES } from '../lib/orders.js';

const ENTRY_TYPES = [
  ['stop', 'Breakout', 'Buy STOP: buy only if the price rises to your trigger'],
  ['limit', 'Dip / exact price', 'Buy LIMIT: buy at your price or lower'],
  ['market', 'Right now', 'MARKET: buy immediately at the current price'],
];

export async function renderOrderHelper(app, q) {
  const s = settings();
  const saved = store.get('orderHelper', {});
  const num = (k, d = '') => (q.get(k) != null ? q.get(k) : saved[k] ?? d);
  const state = {
    symbol: (q.get('symbol') || saved.symbol || '').toUpperCase(),
    entryType: q.get('entryType') || saved.entryType || 'stop',
    timing: q.get('timing') || saved.timing || 'DAY',
    broker: s.broker || 'schwab',
    price: null,
  };

  app.innerHTML = `
    <section class="page-head">
      <h1>Order Helper</h1>
      <p class="lede">Turn a trade idea into the right order at your broker: a <strong>bracket</strong> that buys, then automatically protects you with a stop-loss and takes profit at your target. Fill in the numbers (or open this from a Day Trade Desk pick), pick your broker, and follow the steps.</p>
    </section>
    <div class="order-grid">
      <form class="card form" id="order-form" autocomplete="off">
        <h2>1. Your trade</h2>
        <div class="row">
          <label>Stock symbol<input name="symbol" value="${esc(state.symbol)}" placeholder="SOFI" autocapitalize="characters"></label>
          <label>Shares<input name="shares" type="number" min="0" step="any" value="${esc(num('shares'))}" placeholder="6"></label>
        </div>
        <div id="quote" class="small muted"></div>
        <fieldset class="entry-types"><legend>How do you want to get in?</legend>
          ${ENTRY_TYPES.map(([k, l, hint]) => `<label class="radio-card ${state.entryType === k ? 'on' : ''}"><input type="radio" name="entryType" value="${k}" ${state.entryType === k ? 'checked' : ''}><strong>${l}</strong><span>${hint}</span></label>`).join('')}
        </fieldset>
        <div class="row three">
          <label class="entry-field">Entry price<div class="input-prefix"><span>$</span><input name="entry" type="number" step="0.01" min="0" value="${esc(num('entry'))}"></div></label>
          <label>Stop-loss<div class="input-prefix"><span>$</span><input name="stop" type="number" step="0.01" min="0" value="${esc(num('stop'))}"></div></label>
          <label>Profit target<div class="input-prefix"><span>$</span><input name="target" type="number" step="0.01" min="0" value="${esc(num('target'))}"></div></label>
        </div>
        <div class="row three">
          <label>Timing<select name="timing"><option value="DAY" ${state.timing === 'DAY' ? 'selected' : ''}>Day (day trade)</option><option value="GTC" ${state.timing === 'GTC' ? 'selected' : ''}>GTC (swing trade)</option></select></label>
          <label>Cash available<div class="input-prefix"><span>$</span><input name="cash" type="number" step="any" min="0" value="${esc(num('cash', ''))}" placeholder="optional"></div></label>
          <label>Account size<div class="input-prefix"><span>$</span><input name="account" type="number" step="any" min="0" value="${esc(num('account', s.account || ''))}"></div></label>
        </div>
        <label>Your broker<select name="broker">${Object.entries(BROKERS).map(([k, l]) => `<option value="${k}" ${state.broker === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </form>
      <section class="card" id="order-summary"></section>
    </div>
    <section class="card" id="order-steps"></section>
    <section class="card">
      <h2>Order types in plain English</h2>
      <dl class="order-types">${ORDER_TYPES.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    </section>
    <p class="muted small">StockWise can't see or place orders in your brokerage account. You enter and submit the order yourself. Broker menus change from time to time, so if a label looks different, look for the closest match. Not financial advice.</p>`;

  const form = app.querySelector('#order-form');
  let priceFor = null, timer = null;

  const read = () => {
    const f = Object.fromEntries(new FormData(form));
    const n = (k) => (f[k] === '' || f[k] == null ? null : Number(f[k]));
    return { symbol: f.symbol, shares: n('shares'), entryType: f.entryType, entry: n('entry'), stop: n('stop'), target: n('target'), timing: f.timing, cash: n('cash'), account: n('account'), broker: f.broker };
  };

  const draw = () => {
    const f = read();
    form.querySelectorAll('.radio-card').forEach((el) => el.classList.toggle('on', el.querySelector('input').checked));
    form.querySelector('.entry-field').classList.toggle('hidden-field', f.entryType === 'market');
    const order = buildOrder({ ...f, price: priceFor === f.symbol?.toUpperCase() ? state.price : null });
    const hasErrors = order.checks.some((c) => c.level === 'error');
    store.set('orderHelper', { symbol: f.symbol, shares: f.shares, entryType: f.entryType, entry: f.entry, stop: f.stop, target: f.target, timing: f.timing, cash: f.cash, account: f.account });
    if (f.broker !== settings().broker) saveSettings({ broker: f.broker });

    app.querySelector('#order-summary').innerHTML = `
      <h2>2. Your order</h2>
      <div class="ticket-legs">
        <div class="ticket-kind">${f.broker === 'robinhood' ? 'Entry, then a stop-loss (no brackets on Robinhood)' : 'Conditional: <strong>1st Triggers OCO</strong> (bracket)'}</div>
        ${order.legs.map((l) => `<div class="leg leg-${l.n}"><span class="leg-n">${l.n}</span><div><div class="leg-role">${l.role}${l.n > 1 ? ' <span class="muted small">goes live after #1 fills</span>' : ''}</div><div class="leg-text"><strong class="${l.side === 'Buy' ? 'up' : 'down'}">${l.side}</strong> ${l.qty ?? '?'} ${esc(order.symbol || '—')} · ${l.type}${l.price != null ? ` <strong>${l.price ? money(l.price) : '?'}</strong>` : ''} · ${l.timing === 'GTC' ? 'GTC' : 'Day'}</div></div></div>`).join('')}
      </div>
      ${ladder(order)}
      <h3>Safety check</h3>
      <ul class="checks">${order.checks.map((c) => `<li class="chk ${c.level}">${{ ok: '✓', warn: '⚠', error: '✗', info: 'ℹ' }[c.level]} ${esc(c.text)}</li>`).join('')}</ul>`;

    app.querySelector('#order-steps').innerHTML = hasErrors
      ? '<h2>3. Step by step</h2><p class="muted">Fix the ✗ items above and your step-by-step guide will appear here.</p>'
      : `<h2>3. Step by step at ${esc(BROKERS[f.broker])}</h2>
        <ol class="steps-list">${brokerSteps(f.broker, order).map((st, i) => `<li><label><input type="checkbox" data-step="${i}"><span><strong>${esc(st.title)}</strong><br>${st.detail}</span></label></li>`).join('')}</ol>
        <p class="small muted">Tick each step as you go. Before you press the final button, read the broker's order summary and make sure it matches the three lines in "Your order".</p>`;
  };

  const lookup = async () => {
    const sym = form.elements.symbol.value.trim().toUpperCase();
    const box = app.querySelector('#quote');
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(sym)) { box.textContent = ''; return; }
    box.textContent = 'Getting the current price…';
    try {
      const d = await getHistory(sym);
      state.price = d.candles.at(-1).close;
      priceFor = sym;
      const day = d.candles.at(-1);
      box.innerHTML = `${esc(sym)} last price <strong>${money(state.price)}</strong> · today's range ${money(day.low)}–${money(day.high)}${d.live ? ' · <span class="up">live</span>' : ''}`;
    } catch {
      state.price = null; priceFor = null;
      box.textContent = 'Couldn\'t get a price for this symbol, so the check against the current price is skipped.';
    }
    draw();
  };

  form.addEventListener('input', (e) => {
    if (e.target.name === 'symbol') { clearTimeout(timer); timer = setTimeout(lookup, 500); }
    draw();
  });
  draw();
  if (state.symbol) await lookup();
  return () => clearTimeout(timer);
}

// A small vertical price ladder: target, entry, current price and stop, with the reward and risk zones.
function ladder(o) {
  const pts = [o.target, o.entryPx, o.stop, o.price].filter((v) => v > 0);
  if (pts.length < 3 || !(o.stop < o.entryPx && o.target > o.entryPx)) return '';
  let hi = Math.max(...pts), lo = Math.min(...pts);
  const pad = (hi - lo) * 0.12 || 1; hi += pad; lo -= pad;
  const H = 190, W = 300, y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 20);
  const row = (v, label, cls) => `<line class="lad-line ${cls}" x1="70" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}"/><text class="lad-label ${cls}" x="64" y="${y(v) + 4}" text-anchor="end">${label}</text><text class="lad-price" x="${W - 12}" y="${y(v) - 4}" text-anchor="end">${money(v)}</text>`;
  return `<svg class="ladder" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price levels: target ${money(o.target)}, entry ${money(o.entryPx)}, stop ${money(o.stop)}">
    <rect class="lad-reward" x="70" y="${y(o.target)}" width="${W - 80}" height="${y(o.entryPx) - y(o.target)}"/>
    <rect class="lad-risk" x="70" y="${y(o.entryPx)}" width="${W - 80}" height="${y(o.stop) - y(o.entryPx)}"/>
    ${row(o.target, 'Target', 'tgt')}${row(o.entryPx, 'Entry', 'entry')}${row(o.stop, 'Stop', 'stop')}
    ${o.price > 0 ? `<line class="lad-line now" x1="70" x2="${W - 10}" y1="${y(o.price)}" y2="${y(o.price)}"/><text class="lad-label now" x="64" y="${y(o.price) + 4}" text-anchor="end">Now</text><text class="lad-price now" x="${W - 12}" y="${y(o.price) - 4}" text-anchor="end">${money(o.price)}</text>` : ''}
    <text class="lad-zone" x="${(W + 60) / 2}" y="${(y(o.target) + y(o.entryPx)) / 2 + 4}" text-anchor="middle">reward</text>
    <text class="lad-zone" x="${(W + 60) / 2}" y="${(y(o.entryPx) + y(o.stop)) / 2 + 4}" text-anchor="middle">risk</text>
  </svg>`;
}
