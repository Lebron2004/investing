// Data fetching, persistence and formatting helpers used by every view.
import { analyze } from './lib/analysis.js';

const memo = new Map();

// On GitHub Pages there is no server: prices are pre-downloaded into data/ by a GitHub Action.
// If data/manifest.json exists we're in that "static" mode; otherwise we talk to server.js.
export const staticSite = fetch('data/manifest.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
let dataVersion = null; // changes whenever new prices are published
staticSite.then((m) => { dataVersion = m?.updated ?? null; });

// Mirrors dataFileName() in lib/market-data.js.
const dataFileName = (symbol) => `${symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '_')}.json`;

async function loadHistory(symbol, range) {
  const manifest = await staticSite;
  if (manifest) {
    const r = await fetch(`data/history/${dataFileName(symbol)}?v=${encodeURIComponent(dataVersion || manifest.updated)}`);
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
  if (!memo.has(key)) {
    const p = loadHistory(symbol, range);
    memo.set(key, p);
    p.catch(() => memo.delete(key));
  }
  return withLive(await memo.get(key));
}

// --- Freshness -----------------------------------------------------------------
// Asks whether newer prices exist than the ones this page loaded. Returns the new version or null.
export async function checkForNewData() {
  try {
    const static_ = await staticSite;
    const r = await fetch(static_ ? 'data/manifest.json' : 'api/status', { cache: 'no-store' });
    if (!r.ok) return null;
    const v = (await r.json()).updated;
    if (v && v !== dataVersion) return v;
  } catch { /* offline: try again later */ }
  return null;
}

// Forget cached prices so the next render downloads fresh ones.
export function useDataVersion(v) {
  dataVersion = v;
  memo.clear();
  scanPromise = null;
}
export const lastUpdated = () => dataVersion;

// --- Live quotes (optional, needs a free Finnhub API key) -------------------------
// Finnhub's /quote gives the current price, day high/low and open in real time (US stocks & ETFs,
// 60 requests/minute on the free plan). We patch today's candle with it.
const quoteCache = new Map();
export const liveStatus = { enabled: false, ok: null, at: null, error: null };

async function liveQuote(symbol) {
  const key = settings().finnhubKey;
  liveStatus.enabled = !!key;
  if (!key) return null;
  const hit = quoteCache.get(symbol);
  if (hit?.pending) return hit.pending;
  if (hit && Date.now() - hit.at < (hit.q ? 30000 : 60000)) return hit.q;
  const p = (async () => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`);
      if (r.status === 401 || r.status === 403) throw new Error('Finnhub rejected the API key');
      if (r.status === 429) throw new Error('Finnhub rate limit reached, slowing down');
      if (!r.ok) throw new Error(`Finnhub error ${r.status}`);
      const q = await r.json();
      if (!(q.c > 0) || !q.t) return null; // unknown symbol
      Object.assign(liveStatus, { ok: true, at: q.t * 1000, error: null });
      return q;
    } catch (err) {
      Object.assign(liveStatus, { ok: false, error: err.message });
      return null;
    }
  })();
  quoteCache.set(symbol, { at: Date.now(), q: null, pending: p });
  const q = await p;
  quoteCache.set(symbol, { at: Date.now(), q });
  return q;
}

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

// Live quotes for several symbols ({ SYM: quote }), or {} without a Finnhub key.
export async function liveQuotes(symbols) {
  if (!settings().finnhubKey) return {};
  const out = {};
  await Promise.all(symbols.map(async (s) => { const q = await liveQuote(s); if (q) out[s] = q; }));
  return out;
}

// Day Trade Desk data: AI forecasts + intraday snapshot (always fetched fresh).
export async function getDeskData() {
  const m = await staticSite;
  const r = await fetch(m ? `data/daytrade.json?t=${Date.now()}` : 'api/daytrade', { cache: 'no-store' });
  if (!r.ok) throw new Error('Day-trade data isn\'t available yet. It appears after the next site update.');
  return r.json();
}

// Returns a copy of the history with today's candle updated (or added) from the live quote.
async function withLive(data) {
  if (!settings().finnhubKey || !data?.candles?.length) return data;
  const q = await liveQuote(data.symbol);
  if (!q) return data;
  const t = q.t * 1000;
  const candles = data.candles.slice();
  const last = candles[candles.length - 1];
  if (dayOf(last.t) === dayOf(t)) {
    candles[candles.length - 1] = { ...last, close: q.c, high: Math.max(last.high, q.h || q.c), low: Math.min(last.low, q.l || q.c) };
  } else if (t > last.t) {
    candles.push({ t, open: q.o || q.c, high: q.h || q.c, low: q.l || q.c, close: q.c, volume: 0 });
  }
  return { ...data, candles, live: { price: q.c, t } };
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
  const isStatic = !!(await staticSite);
  for (let [symbol, data] of entries) {
    if (data.error) continue;
    if (!isStatic) { // static entries came through getHistory, which already cached and patched them
      memo.set(`${symbol}:2y`, Promise.resolve(data));
      data = await withLive(data);
    }
    try { out.push({ ...data, analysis: analyze(data.candles, ctxFor(data, benchmark)) }); } catch { /* too little history */ }
  }
  return out;
}

// Pre-analyzed summaries for the whole universe (see lib/scan.js). Cached for the session.
let scanPromise = null;
export function getScan() {
  scanPromise ??= staticSite.then(async (m) => {
    const r = await fetch(m ? `data/scan.json?v=${encodeURIComponent(dataVersion || m.updated)}` : 'api/scan');
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
