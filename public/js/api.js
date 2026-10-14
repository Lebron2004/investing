// Data fetching, persistence and formatting helpers used by every view.
import { analyze } from './lib/analysis.js';

const memo = new Map();

export async function getHistory(symbol, range = '2y') {
  const key = `${symbol}:${range}`;
  if (memo.has(key)) return memo.get(key);
  const p = fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`).then(async (r) => {
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || `Could not load ${symbol}`);
    return json;
  });
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}

export async function getAnalysis(symbol) {
  const data = await getHistory(symbol);
  return { ...data, analysis: analyze(data.candles) };
}

export async function getBatch(symbols) {
  const r = await fetch(`/api/batch?symbols=${symbols.map(encodeURIComponent).join(',')}`);
  const { results } = await r.json();
  const out = [];
  for (const [symbol, data] of Object.entries(results)) {
    if (data.error) continue;
    memo.set(`${symbol}:2y`, Promise.resolve(data));
    try { out.push({ ...data, analysis: analyze(data.candles) }); } catch { /* too little history */ }
  }
  return out;
}

export async function searchSymbols(q) {
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
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
export const toneOf = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

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

export function scoreBar(score) {
  const tone = score >= 58 ? 'up' : score >= 43 ? 'flat' : 'down';
  return `<span class="scorebar ${tone}" title="Score ${score}/100"><span style="width:${score}%"></span></span><span class="score-num">${score}</span>`;
}

export function demoNotice(items) {
  const anyDemo = [].concat(items).some((d) => d && d.source === 'demo');
  return anyDemo
    ? '<div class="notice warn"><strong>Demo data.</strong> Live prices could not be reached, so these numbers are simulated. Don\'t trade on them. Run the server with internet access to get real prices.</div>'
    : '';
}
