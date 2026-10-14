import { getBatch, staticSite, store, settings, saveSettings, money, pct, shares, toneOf, esc, badge, demoNotice } from '../api.js';
import { parseHoldingsCSV, planPortfolio, ACTIONS } from '../lib/portfolio.js';
import { RISK_PROFILES } from '../lib/sizing.js';

const load = () => store.get('portfolio', { holdings: [], cash: 0, updated: null });
const save = (p) => store.set('portfolio', { ...p, updated: new Date().toISOString() });

const BROKERS = [
  ['Fidelity', 'Accounts & Trade → Portfolio → Positions → the download icon (CSV).'],
  ['Charles Schwab', 'Accounts → Positions → Export (top right) → CSV.'],
  ['Vanguard', 'My Accounts → Balances & holdings → Download → CSV.'],
  ['E*TRADE / Morgan Stanley', 'Portfolios → choose the account → Download → Excel/CSV.'],
  ['Merrill / J.P. Morgan / Interactive Brokers', 'Open your Positions or Holdings page and look for Export or Download as CSV.'],
  ['Robinhood, Webull, Cash App', 'These don\'t export positions. Type your holdings in below (symbol, shares, average cost from the app).'],
];

export async function renderPortfolio(app) {
  const p = load();
  app.innerHTML = `
    <section class="page-head">
      <h1>My Portfolio</h1>
      <p class="lede">Bring in your real holdings and StockWise tells you what to do with each one: hold, buy more, trim or sell, with exact share counts and the price to sell at if things turn.</p>
      <p class="privacy">🔒 Your holdings stay in this browser only. They're never uploaded anywhere, and StockWise never asks for your broker login and can't place trades.</p>
    </section>

    <div class="grid-2 import-grid">
      <section class="card">
        <h2>1. Import from your broker</h2>
        <label class="dropzone" id="drop">
          <input type="file" id="file" accept=".csv,.txt,text/csv" hidden>
          <strong>Drop your positions CSV here</strong>
          <span class="muted">or click to choose a file</span>
        </label>
        <p id="import-msg" class="small" role="status"></p>
        <details class="explain"><summary>How do I download my positions?</summary>
          <ul class="bullets small">${BROKERS.map(([b, how]) => `<li><strong>${esc(b)}:</strong> ${esc(how)}</li>`).join('')}</ul>
          <p class="muted small">Menu names change from time to time. Look for "Positions" or "Holdings" and a Download or Export button. If your file doesn't import, you can type the holdings in instead.</p>
        </details>
      </section>

      <section class="card">
        <div class="card-head"><h2>2. Check your holdings</h2><button class="btn ghost small-btn" id="clear" type="button">Clear all</button></div>
        <form id="holdings-form">
          <div class="table-wrap"><table class="table compact edit-table">
            <thead><tr><th>Symbol</th><th class="num">Shares</th><th class="num">Avg cost</th><th></th></tr></thead>
            <tbody id="rows"></tbody>
          </table></div>
          <button class="btn ghost small-btn" id="add-row" type="button">+ Add holding</button>
          <label class="cash-row">Cash in the account<div class="input-prefix"><span>$</span><input type="number" name="cash" min="0" step="any" value="${p.cash || 0}"></div></label>
          <button class="btn" type="submit">Analyze my portfolio</button>
        </form>
      </section>
    </div>
    <div id="result"></div>`;

  const tbody = app.querySelector('#rows');
  const form = app.querySelector('#holdings-form');
  const msg = app.querySelector('#import-msg');
  const rowHtml = (h = {}) => `<tr>
    <td><input name="symbol" value="${esc(h.symbol || '')}" placeholder="AAPL" aria-label="Symbol" autocapitalize="characters" size="7"></td>
    <td class="num"><input name="shares" type="number" step="any" min="0" value="${h.shares ?? ''}" placeholder="10" aria-label="Shares"></td>
    <td class="num"><input name="avgCost" type="number" step="any" min="0" value="${h.avgCost != null ? +h.avgCost.toFixed(4) : ''}" placeholder="optional" aria-label="Average cost per share"></td>
    <td><button type="button" class="icon-btn" data-del aria-label="Remove">✕</button></td></tr>`;
  const fill = (holdings) => {
    tbody.innerHTML = (holdings.length ? holdings : [{}, {}, {}]).map(rowHtml).join('');
  };
  const read = () => {
    const holdings = [...tbody.querySelectorAll('tr')].map((tr) => ({
      symbol: tr.querySelector('[name=symbol]').value.trim().toUpperCase(),
      shares: Number(tr.querySelector('[name=shares]').value),
      avgCost: tr.querySelector('[name=avgCost]').value === '' ? null : Number(tr.querySelector('[name=avgCost]').value),
    })).filter((h) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(h.symbol) && h.shares > 0);
    return { holdings, cash: Math.max(0, Number(form.elements.cash.value) || 0) };
  };

  fill(p.holdings);
  tbody.addEventListener('click', (e) => { if (e.target.closest('[data-del]')) e.target.closest('tr').remove(); });
  app.querySelector('#add-row').addEventListener('click', () => {
    tbody.insertAdjacentHTML('beforeend', rowHtml());
    tbody.lastElementChild.querySelector('input').focus();
  });
  app.querySelector('#clear').addEventListener('click', () => {
    if (!confirm('Remove all holdings from this browser?')) return;
    save({ holdings: [], cash: 0 });
    fill([]); form.elements.cash.value = 0;
    app.querySelector('#result').innerHTML = '';
  });

  const importText = (text, name) => {
    const res = parseHoldingsCSV(text);
    if (res.error) { msg.className = 'small down'; msg.textContent = res.error; return; }
    fill(res.holdings);
    form.elements.cash.value = res.cash;
    msg.className = 'small up';
    msg.textContent = `Imported ${res.holdings.length} holdings${res.cash ? ` and ${money(res.cash)} cash` : ''} from ${name}.`
      + (res.skipped.length ? ` Skipped: ${res.skipped.map((s) => `${s.symbol} (${s.reason})`).join(', ')}.` : '')
      + (res.holdings.some((h) => h.avgCost == null) ? ' Some average costs were missing. Add them for profit/loss tracking.' : '');
    form.requestSubmit();
  };
  const fileInput = app.querySelector('#file');
  const drop = app.querySelector('#drop');
  const readFile = (f) => f && f.text().then((t) => importText(t, f.name));
  fileInput.addEventListener('change', () => readFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = read();
    save(data);
    await analyzeInto(app.querySelector('#result'), data);
  });

  if (p.holdings.length) await analyzeInto(app.querySelector('#result'), p);
}

async function analyzeInto(el, { holdings, cash }) {
  if (!holdings.length) {
    el.innerHTML = '<div class="card"><p class="muted">Add at least one holding to get your action plan.</p></div>';
    return;
  }
  el.innerHTML = '<div class="loading">Analyzing your holdings…</div>';
  const s = settings();
  const profile = RISK_PROFILES[s.profile];
  const items = await getBatch(holdings.map((h) => h.symbol));
  const analyses = Object.fromEntries(items.map((i) => [i.symbol, i.analysis]));
  const plan = planPortfolio({ holdings, cash, analyses, profile, fractional: s.fractional });
  const todo = plan.rows.filter((r) => !['hold', 'unknown'].includes(r.action.type));
  const missing = plan.rows.filter((r) => r.action.type === 'unknown').map((r) => r.symbol);
  const accountDiffers = Math.abs(s.account - plan.total) / plan.total > 0.02;

  const actionBadge = (t) => `<span class="badge ${ACTIONS[t].tone} action-${t}">${ACTIONS[t].label}</span>`;
  const step = (r) => {
    const t = r.action.type;
    const verb = t === 'add' ? `Buy ${shares(r.action.shares)} shares of` : t === 'sell' ? `Sell all ${shares(r.action.shares)} shares of` : `Sell ${shares(r.action.shares)} shares of`;
    const amount = r.action.shares * r.price;
    return `<li class="todo">
      ${actionBadge(t)}
      <div><strong>${verb} <a href="#/stock/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></strong> at about ${money(r.price)} <span class="muted">(${t === 'add' ? '' : '+'}${money(amount, 0)}${t === 'add' ? ' cost' : ' cash back'})</span>
      <div class="muted small">${esc(r.action.text.replace(/^Buy [\d.,]+ more shares \(about \$[\d,]+\)\. /, ''))}</div></div>
    </li>`;
  };

  el.innerHTML = `
    ${demoNotice(items)}
    ${missing.length ? `<div class="notice warn">No price data for ${missing.map(esc).join(', ')}. ${await staticHint()}</div>` : ''}
    <section class="card">
      <div class="big-stats four">
        <div><span class="label">Total value</span><span class="value">${money(plan.total, 0)}</span></div>
        <div><span class="label">Gain / loss</span><span class="value ${toneOf(plan.plTotal)}">${plan.costBasis ? `${plan.plTotal >= 0 ? '+' : ''}${money(plan.plTotal, 0)}` : '—'}</span><span class="sub">${plan.plPct != null ? pct(plan.plPct, 1, true) : 'add avg costs to see this'}</span></div>
        <div><span class="label">Cash</span><span class="value">${money(plan.cash, 0)}</span><span class="sub">${pct(plan.cash / plan.total, 0)} of account</span></div>
        <div><span class="label">Positions</span><span class="value">${plan.rows.length}</span></div>
      </div>
      ${accountDiffers ? `<p class="small">Your account size in settings is ${money(s.account, 0)}. <button class="link-btn" id="sync-account">Use ${money(plan.total, 0)} instead</button> so every buy and sell size on the site matches your real account.</p>` : ''}
    </section>

    <section class="card">
      <h2>Your action plan <span class="muted small">${esc(profile.label.toLowerCase())} risk style · <a href="#/">change</a></span></h2>
      ${todo.length ? `<p class="muted">Do the sells first. They free up cash for the buys.</p><ol class="todo-list">${todo.map(step).join('')}</ol>
        <p class="small">Cash after these trades: <strong>${money(plan.cashAfter, 0)}</strong>${plan.cashAfter > plan.reserve * 1.5 ? `. That's more than your ${money(plan.reserve, 0)} reserve, so see <a href="#/ideas">Top Ideas</a> or the <a href="#/planner">Money Planner</a> for where to put the rest.` : '.'}</p>`
        : '<p><strong>Nothing to change right now.</strong> Every holding is a hold. Keep an eye on the sell-below prices in the table.</p>'}
      ${plan.rows.some((r) => ['sell', 'trim', 'profit', 'rebalance'].includes(r.action.type) && r.pl > 0) ? '<p class="muted small">Heads-up: selling at a gain in a regular (taxable) account can trigger capital-gains tax. Gains on shares held over a year are usually taxed less.</p>' : ''}
    </section>

    ${plan.warnings.length ? `<section class="card"><h2>Things to watch</h2><ul class="bullets">${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>` : ''}

    <section class="card">
      <h2>Every holding</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Holding</th><th class="num">Value</th><th class="num">Weight</th><th class="num">Gain/loss</th><th>Long / short term</th><th>What to do</th><th class="num">Sell if below</th></tr></thead>
        <tbody>${plan.rows.map((r) => `<tr class="clickable" data-href="#/stock/${encodeURIComponent(r.symbol)}">
          <td><strong>${esc(r.symbol)}</strong><div class="sub">${shares(r.shares)} sh @ ${money(r.price)}</div></td>
          <td class="num">${money(r.value, 0)}</td>
          <td class="num">${pct(r.weight, 1)}</td>
          <td class="num ${toneOf(r.pl)}">${r.pl != null ? `${r.pl >= 0 ? '+' : ''}${money(r.pl, 0)}<div class="sub">${pct(r.plPct, 1, true)}</div>` : '—'}</td>
          <td>${r.a ? `${badge(r.a.longTerm)} ${badge(r.a.shortTerm)}` : '—'}</td>
          <td>${actionBadge(r.action.type)}${r.action.shares && r.action.type !== 'hold' ? ` <span class="small">${shares(r.action.shares)} sh</span>` : ''}<div class="sub why">${esc(r.action.text)}</div></td>
          <td class="num down">${r.action.stop ? money(r.action.stop) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>`;

  el.querySelector('#sync-account')?.addEventListener('click', (e) => {
    saveSettings({ account: Math.round(plan.total) });
    e.target.closest('p').innerHTML = `Account size updated to ${money(plan.total, 0)} ✓`;
  });
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('tr[data-href]');
    if (row) location.hash = row.dataset.href;
  });
}

async function staticHint() {
  return (await staticSite)
    ? 'On the GitHub version of the site, add these tickers to <code>symbols.txt</code> in your repo and commit. They\'ll appear after the next update.'
    : 'Check the ticker spelling.';
}
