// Hash router + global search box.
import { searchSymbols, staticSite, esc } from './api.js';
import { renderWatchlist } from './views/watchlist.js';
import { renderAnalyze } from './views/analyze.js';
import { renderIdeas } from './views/ideas.js';
import { renderPlanner } from './views/planner.js';
import { renderSizer } from './views/sizer.js';
import { renderPortfolio } from './views/portfolio.js';
import { renderTrade } from './views/trade.js';
import { renderAcademy, renderLesson } from './views/academy.js';

const app = document.getElementById('app');
let cleanup = null;

const routes = [
  [/^\/?$/, 'watchlist', () => renderWatchlist(app)],
  [/^\/stock\/([A-Za-z0-9.^=-]+)$/, 'watchlist', (m) => renderAnalyze(app, m[1].toUpperCase())],
  [/^\/portfolio$/, 'portfolio', () => renderPortfolio(app)],
  [/^\/ideas$/, 'ideas', () => renderIdeas(app)],
  [/^\/planner$/, 'planner', () => renderPlanner(app)],
  [/^\/sizer$/, 'sizer', (m, q) => renderSizer(app, q)],
  [/^\/trade\/([\w.-]+)$/, 'sizer', (m) => renderTrade(app, decodeURIComponent(m[1]))],
  [/^\/academy$/, 'academy', () => renderAcademy(app)],
  [/^\/academy\/([\w-]+)$/, 'academy', (m) => renderLesson(app, m[1])],
];

async function route() {
  const [path, query = ''] = location.hash.slice(1).split('?');
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  for (const [re, nav, fn] of routes) {
    const m = (path || '/').match(re);
    if (!m) continue;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === nav));
    app.innerHTML = '<div class="loading">Loading…</div>';
    try {
      cleanup = await fn(m, new URLSearchParams(query));
    } catch (err) {
      app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p><p><a href="#/">Back to watchlist</a></p></div>`;
    }
    window.scrollTo(0, 0);
    return;
  }
  app.innerHTML = '<div class="card"><h2>Page not found</h2><p><a href="#/">Go home</a></p></div>';
}

window.addEventListener('hashchange', route);
route();

// --- search ---
const form = document.getElementById('search');
const input = document.getElementById('search-input');
const list = document.getElementById('search-results');
let timer;

input.addEventListener('input', () => {
  clearTimeout(timer);
  const q = input.value.trim();
  if (!q) { list.hidden = true; return; }
  timer = setTimeout(async () => {
    const results = await searchSymbols(q).catch(() => []);
    list.innerHTML = results.map((r) => `<li><a href="#/stock/${encodeURIComponent(r.symbol)}"><strong>${esc(r.symbol)}</strong> <span>${esc(r.name)}</span></a></li>`).join('')
      || `<li class="empty">Press Enter to look up “${esc(q.toUpperCase())}”</li>`;
    list.hidden = false;
  }, 200);
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim().toUpperCase();
  if (!q) return;
  const first = list.querySelector('a');
  location.hash = first && !list.hidden ? first.getAttribute('href') : `#/stock/${encodeURIComponent(q)}`;
  input.value = ''; list.hidden = true;
});
list.addEventListener('click', () => { input.value = ''; list.hidden = true; });
document.addEventListener('click', (e) => { if (!form.contains(e.target)) list.hidden = true; });

// On the GitHub Pages build, show when prices were last refreshed.
staticSite.then((m) => {
  if (!m) return;
  const when = new Date(m.updated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  document.getElementById('data-status').textContent = `Prices last updated ${when}. Daily closing prices, refreshed automatically several times each trading day.`;
});
