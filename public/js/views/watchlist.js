import { getBatch, store, settings, saveSettings, money, pct, toneOf, esc, badge, demoNotice } from '../api.js';
import { RISK_PROFILES } from '../lib/sizing.js';

const DEFAULT_LIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'SPY', 'QQQ'];

export const getWatchlist = () => store.get('watchlist', DEFAULT_LIST);
export function toggleWatch(symbol) {
  const list = getWatchlist();
  const next = list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol];
  store.set('watchlist', next);
  return next.includes(symbol);
}

export async function renderWatchlist(app) {
  const s = settings();
  const list = getWatchlist();
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Your market, simplified</h1>
        <p class="lede">Track the stocks you care about. For each one you get a short-term and long-term rating, where to buy, where to sell, and how many shares fit your account.</p>
      </div>
      <form class="card account-card" id="account-form">
        <h3>Your account</h3>
        <label>Money you're investing
          <div class="input-prefix"><span>$</span><input type="number" min="1" step="any" name="account" value="${s.account}" required></div>
        </label>
        <label>Risk style
          <select name="profile">
            ${Object.entries(RISK_PROFILES).map(([k, p]) => `<option value="${k}" ${k === s.profile ? 'selected' : ''}>${p.label} — risk ${(p.riskPerTrade * 100).toFixed(1)}% per trade</option>`).join('')}
          </select>
        </label>
        <label class="check"><input type="checkbox" name="fractional" ${s.fractional ? 'checked' : ''}> My broker allows fractional shares</label>
        <p class="hint" id="saved-hint">Used to size every buy and sell plan on the site.</p>
      </form>
    </section>
    <div id="wl-notice"></div>
    <section class="card">
      <div class="card-head">
        <h2>Watchlist</h2>
        <span class="muted">${list.length} symbols · click a row for the full analysis</span>
      </div>
      <div class="table-wrap"><table class="table" id="wl-table">
        <thead><tr><th>Symbol</th><th class="num">Price</th><th class="num">Day</th><th>Short-term</th><th>Long-term</th><th class="num hide-sm">Buy zone</th><th class="num hide-sm">Stop</th><th></th></tr></thead>
        <tbody><tr><td colspan="8" class="loading">Loading prices…</td></tr></tbody>
      </table></div>
      ${list.length ? '' : '<p class="muted">Your watchlist is empty. Use the search bar to find a stock and add it.</p>'}
    </section>`;

  const form = app.querySelector('#account-form');
  form.addEventListener('change', () => {
    const fd = new FormData(form);
    saveSettings({ account: Number(fd.get('account')) || 10000, profile: fd.get('profile'), fractional: fd.get('fractional') === 'on' });
    const hint = app.querySelector('#saved-hint');
    hint.textContent = 'Saved ✓';
    setTimeout(() => (hint.textContent = 'Used to size every buy and sell plan on the site.'), 1500);
  });

  if (!list.length) { app.querySelector('#wl-table tbody').innerHTML = ''; return; }
  const items = await getBatch(list);
  const bySym = Object.fromEntries(items.map((i) => [i.symbol, i]));
  app.querySelector('#wl-notice').innerHTML = demoNotice(items);
  const tbody = app.querySelector('#wl-table tbody');
  tbody.innerHTML = list.map((sym) => {
    const d = bySym[sym];
    if (!d) return `<tr><td><strong>${esc(sym)}</strong></td><td colspan="6" class="muted">Couldn't load this symbol</td><td><button class="icon-btn" data-remove="${esc(sym)}" aria-label="Remove ${esc(sym)}">✕</button></td></tr>`;
    const a = d.analysis;
    return `<tr class="clickable" data-href="#/stock/${encodeURIComponent(sym)}">
      <td><strong>${esc(sym)}</strong><div class="sub">${esc(d.name)}</div></td>
      <td class="num">${money(a.price)}</td>
      <td class="num ${toneOf(a.changePct)}">${pct(a.changePct, 2, true)}</td>
      <td>${badge(a.shortTerm)} <span class="score-num">${a.shortTerm.score}</span></td>
      <td>${badge(a.longTerm)} <span class="score-num">${a.longTerm.score}</span></td>
      <td class="num hide-sm">${money(a.plan.buyZone[0])} – ${money(a.plan.buyZone[1])}</td>
      <td class="num hide-sm">${money(a.plan.stop)}</td>
      <td><button class="icon-btn" data-remove="${esc(sym)}" aria-label="Remove ${esc(sym)}">✕</button></td>
    </tr>`;
  }).join('');
  tbody.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { toggleWatch(rm.dataset.remove); renderWatchlist(app); return; }
    const row = e.target.closest('tr[data-href]');
    if (row) location.hash = row.dataset.href;
  });
}
