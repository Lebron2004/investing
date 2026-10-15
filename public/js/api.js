// Data fetching, persistence and formatting helpers used by every view.
import { analyze } from './lib/analysis.js';

const memo = new Map();

// On GitHub Pages there is no server: prices are pre-downloaded into data/ by a GitHub Action.
// If data/manifest.json exists we're in that "static" mode; otherwise we talk to server.js.
export const staticSite = fetch('data/manifest.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);

// Mirrors dataFileName() in lib/market-data.js.
const dataFileName = (symbol) => `${symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '_')}.json`;

async function loadHistory(symbol, range) {
  const manifest = await staticSite;
  if (manifest) {
    const r = await fetch(`data/history/${dataFileName(symbol)}?v=${encodeURIComponent(manifest.updated)}`);
    if (!r.ok) {
      throw new Error(`${symbol} isn't tracked on this site yet. To add it, put ${symbol} on its own line in symbols.txt in your GitHub repo and commit. Prices appear after the next update (a few minutes).`);
    }
    return r.json();
  }
  const r = await fetch(`api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `Could not load ${symbol}`);
  return json;
}

export async function getHistory(symbol, range = '2y') {
  const key = `${symbol}:${range}`;
  if (memo.has(key)) return memo.get(key);
  const p = loadHistory(symbol, range);
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}

// The S&P 500 (SPY) is the yardstick for relative strength. Optional: analysis works without it.
const getBenchmark = () => getHistory('SPY').then((d) => d.candles, () => null);
const ctxFor = (data, benchmark) => ({ benchmark, fundamentals: data.fundamentals });

export async function getAnalysis(symbol) {
  const [data, benchmark] = await Promise.all([getHistory(symbol), getBenchmark()]);
  return { ...data, analysis: analyze(data.candles, ctxFor(data, benchmark)) };
}

// Returns analyzed data for every symbol that loaded; silently skips the rest.
export async function getBatch(symbols) {
  let entries;
  if (await staticSite) {
    entries = await Promise.all(symbols.map((s) => getHistory(s).then((d) => [s, d], (e) => [s, { error: e.message }])));
  } else {
    const r = await fetch(`api/batch?symbols=${symbols.map(encodeURIComponent).join(',')}`);
    entries = Object.entries((await r.json()).results);
  }
  const benchmark = await getBenchmark();
  const out = [];
  for (const [symbol, data] of entries) {
    if (data.error) continue;
    memo.set(`${symbol}:2y`, Promise.resolve(data));
    try { out.push({ ...data, analysis: analyze(data.candles, ctxFor(data, benchmark)) }); } catch { /* too little history */ }
  }
  return out;
}

// Pre-analyzed summaries for the whole universe (see lib/scan.js). Cached for the session.
let scanPromise = null;
export function getScan() {
  scanPromise ??= staticSite.then(async (m) => {
    const r = await fetch(m ? `data/scan.json?v=${encodeURIComponent(m.updated)}` : 'api/scan');
    if (!r.ok) throw new Error('Could not load the market scan');
    return (await r.json()).results;
  });
  scanPromise.catch(() => { scanPromise = null; });
  return scanPromise;
}

export async function searchSymbols(q) {
  const manifest = await staticSite;
  if (manifest) {
    const Q = q.toUpperCase();
    return manifest.symbols
      .filter((s) => s.symbol.startsWith(Q) || s.name.toUpperCase().includes(Q))
      .sort((a, b) => (b.symbol.startsWith(Q) - a.symbol.startsWith(Q)))
      .slice(0, 8);
  }
  const r = await fetch(`api/search?q=${encodeURIComponent(q)}`);
  return (await r.json()).results || [];
}

// --- localStorage, wrapped so private mode / blocked storage never breaks the app ---
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`sw:${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`sw:${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

export const settings = () => store.get('settings', { account: 10000, profile: 'moderate', fractional: false });
export const saveSettings = (s) => store.set('settings', { ...settings(), ...s });

// --- formatting ---
export const money = (n, digits = 2) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
export const num = (n, d = 2) => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (n, d = 1, sign = false) => (n == null || Number.isNaN(n) ? '—' : `${sign && n > 0 ? '+' : ''}${(n * 100).toFixed(d)}%`);
export const shares = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(3));
export const toneOf = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

export function badge(rating) {
  return `<span class="badge ${rating.tone}">${esc(rating.label)}</span>`;
}

export function gradeChips(grades) {
  if (!grades) return '';
  const names = { quality: 'Quality', growth: 'Growth', value: 'Value', analysts: 'Analysts' };
  return `<div class="grades">${Object.entries(names).filter(([k]) => grades[k]).map(([k, n]) => `<span class="grade g-${grades[k]}" title="${n}: grade ${grades[k]}"><b>${grades[k]}</b>${n}</span>`).join('')}</div>`;
}

export const bigMoney = (n) => (n == null ? '—' : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);

export function scoreBar(score) {
  const tone = score >= 58 ? 'up' : score >= 43 ? 'flat' : 'down';
  return `<span class="scorebar ${tone}" title="Score ${score}/100"><span style="width:${score}%"></span></span><span class="score-num">${score}</span>`;
}

export function demoNotice(items) {
  const anyDemo = [].concat(items).some((d) => d && d.source === 'demo');
  return anyDemo
    ? '<div class="notice warn"><strong>Demo data.</strong> Live prices could not be reached, so these numbers are simulated. Don\'t trade on them. On your own computer, run the server with internet access. On GitHub Pages, check the latest run under the repo\'s Actions tab.</div>'
    : '';
}
