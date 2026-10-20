// Hash router + global search box.
import { searchSymbols, staticSite, esc, checkForNewData, useDataVersion, lastUpdated, liveStatus, settings } from './api.js';
import { renderWatchlist } from './views/watchlist.js';
import { renderAnalyze } from './views/analyze.js';
import { renderIdeas } from './views/ideas.js';
import { renderPlanner } from './views/planner.js';
import { renderSizer } from './views/sizer.js';
import { renderPortfolio } from './views/portfolio.js';
import { renderTrade } from './views/trade.js';
import { renderPractice } from './views/practice.js';
import { renderClass } from './views/classroom.js';
import { renderTools } from './views/tools.js';
import { renderDesk } from './views/desk.js';
import { renderOrderHelper } from './views/orders.js';
import { registerServiceWorker } from './install.js';
import { renderAcademy, renderLesson } from './views/academy.js';

const app = document.getElementById('app');
let cleanup = null;
let dirty = false;      // the user has typed into the current page
let lastRender = Date.now();
let pendingVersion = null;
let navId = 0;          // only the most recent navigation may write to the page
const pill = document.getElementById('live-pill');

const routes = [
  [/^\/?$/, 'watchlist', () => renderWatchlist(app)],
  [/^\/stock\/([A-Za-z0-9.^=-]+)$/, 'watchlist', (m) => renderAnalyze(app, m[1].toUpperCase())],
  [/^\/portfolio$/, 'portfolio', () => renderPortfolio(app)],
  [/^\/ideas$/, 'ideas', () => renderIdeas(app)],
  [/^\/planner$/, 'planner', () => renderPlanner(app)],
  [/^\/sizer$/, 'sizer', (m, q) => renderSizer(app, q)],
  [/^\/trade\/([\w.-]+)$/, 'sizer', (m) => renderTrade(app, decodeURIComponent(m[1]))],
  [/^\/practice$/, 'practice', (m, q) => renderPractice(app, q)],
  [/^\/desk$/, 'desk', (m, q) => renderDesk(app, q)],
  [/^\/order$/, 'tools', (m, q) => renderOrderHelper(app, q)],
  [/^\/tools$/, 'tools', (m, q) => renderTools(app, q)],
  [/^\/class$/, 'academy', (m, q) => renderClass(app, q)],
  [/^\/academy$/, 'academy', () => renderAcademy(app)],
  [/^\/academy\/([\w-]+)$/, 'academy', (m) => renderLesson(app, m[1])],
];

// refresh = true re-renders the same page with fresh prices, keeping the scroll position.
async function route(refresh = false) {
  const [path, query = ''] = location.hash.slice(1).split('?');
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const scrollY = window.scrollY;
  const myNav = ++navId;
  if (!refresh) dirty = false;
  lastRender = Date.now();
  hidePill();
  for (const [re, nav, fn] of routes) {
    const m = (path || '/').match(re);
    if (!m) continue;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === nav));
    if (!refresh) app.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const done = await fn(m, new URLSearchParams(query));
      if (myNav === navId) cleanup = done;
      else if (typeof done === 'function') done(); // the user already moved on: tidy up the old page
    } catch (err) {
      // A page that finished loading after you navigated away must not overwrite the new page.
      if (myNav === navId) app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p><p><a href="#/">Back to watchlist</a></p></div>`;
    }
    if (myNav !== navId) return;
    window.scrollTo(0, refresh ? scrollY : 0);
    showStatus();
    return;
  }
  app.innerHTML = '<div class="card"><h2>Page not found</h2><p><a href="#/">Go home</a></p></div>';
}

window.addEventListener('hashchange', () => route());
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

// --- Keeping prices fresh ---------------------------------------------------------
// Every minute or two we ask whether newer prices were published (GitHub: every ~15 min during
// market hours; local server: every 2 min; Finnhub live quotes: every 30 s). If you're in the middle
// of typing (an order, a form), we don't yank the page: a "New prices" button appears instead.
app.addEventListener('input', () => { dirty = true; });
const fmtTime = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function showStatus() {
  if (pendingVersion) return;
  const live = settings().finnhubKey && liveStatus.ok;
  const v = lastUpdated();
  pill.className = `live-pill ${live ? 'live' : ''}`;
  pill.innerHTML = live ? `<span class="dot"></span>Live · ${fmtTime(Date.now())}`
    : v ? `<span class="dot"></span>Prices ${fmtTime(v)}` : '';
  pill.title = live ? 'Real-time prices from Finnhub, refreshed every 30–60 seconds'
    : liveStatus.error ? `Live prices off: ${liveStatus.error}` : 'When prices were last updated. New prices load automatically.';
  pill.hidden = !pill.innerHTML;
  pill.disabled = true;
  const fs = document.getElementById('data-status');
  if (v) fs.textContent = `Prices last updated ${new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. They refresh every ~15 minutes during market hours${settings().finnhubKey ? ', plus live quotes from Finnhub on the pages you open' : ''}.`;
}

function hidePill() { pendingVersion = null; }

function offerRefresh(v) {
  pendingVersion = v || 'live';
  pill.className = 'live-pill pending';
  pill.innerHTML = '<span class="dot"></span>New prices · Refresh';
  pill.title = 'Newer prices are available. Click to update this page.';
  pill.hidden = false;
  pill.disabled = false;
}

pill.addEventListener('click', () => {
  if (!pendingVersion) return;
  if (pendingVersion !== 'live') useDataVersion(pendingVersion);
  route(true);
});

async function tick() {
  const v = await checkForNewData();
  const liveDue = settings().finnhubKey && Date.now() - lastRender > 55000;
  if (v || liveDue) {
    const busy = dirty || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (busy || document.hidden) offerRefresh(v);
    else {
      if (v) useDataVersion(v);
      route(true);
    }
  }
}
setInterval(tick, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
staticSite.then(showStatus);
registerServiceWorker();
