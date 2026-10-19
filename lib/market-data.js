// Daily price history from free sources, shared by server.js and scripts/build-static.js.
// Order: Yahoo Finance chart API → Stooq CSV → simulated "demo" data (marked source: "demo").

import { UNIVERSE } from '../public/js/lib/universe.js';
import { fetchFundamentals, demoFundamentals } from './fundamentals.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export const SYMBOL_RE = /^[A-Z0-9.^=-]{1,15}$/;

export class NotFoundError extends Error {
  constructor(msg) { super(msg); this.status = 404; }
}

const nameOf = (symbol) => UNIVERSE.find((u) => u.symbol === symbol)?.name || symbol;

export async function fetchYahoo(symbol, range = '2y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) throw new NotFoundError(`Unknown symbol ${symbol}`);
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new NotFoundError(json?.chart?.error?.description || `Unknown symbol ${symbol}`);
  const q = r.indicators.quote[0];
  const candles = [];
  r.timestamp.forEach((t, i) => {
    if (q.close[i] == null || q.open[i] == null) return;
    candles.push({ t: t * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 });
  });
  if (candles.length < 2) throw new NotFoundError(`No price data for ${symbol}`);
  const meta = r.meta || {};
  return {
    symbol,
    name: meta.longName || meta.shortName || nameOf(symbol),
    currency: meta.currency || 'USD',
    exchange: meta.exchangeName,
    candles,
    source: 'yahoo',
  };
}

// Stooq: US tickers use the ".us" suffix and "-" instead of "." (BRK.B → brk-b.us).
export async function fetchStooq(symbol) {
  if (/[\^=]/.test(symbol)) throw new Error('Stooq: unsupported symbol');
  const s = `${symbol.toLowerCase().replace(/\./g, '-')}.us`;
  const res = await fetch(`https://stooq.com/q/d/l/?s=${s}&i=d`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Stooq responded ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (!/^Date,Open,High,Low,Close/i.test(lines[0] || '')) throw new Error('Stooq: no data');
  const cutoff = Date.now() - 2 * 366 * 864e5;
  const candles = lines.slice(1).map((l) => {
    const [d, o, h, lo, c, v] = l.split(',');
    return { t: Date.parse(`${d}T00:00:00Z`), open: +o, high: +h, low: +lo, close: +c, volume: +v || 0 };
  }).filter((c) => c.t >= cutoff && c.close > 0);
  if (candles.length < 2) throw new Error('Stooq: no data');
  return { symbol, name: nameOf(symbol), currency: 'USD', candles, source: 'stooq' };
}

// --- Demo data: a deterministic random walk per symbol so the app works offline. ---
function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function demoSeries(symbol, bars = 520) {
  const h = hash(symbol);
  const rnd = mulberry32(h);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const vol = 0.012 + (h % 25) / 1000; // 1.2% – 3.6% daily
  const drift = ((h >> 5) % 21 - 8) / 10000; // slight up or down bias
  let price = 20 + (h % 480);
  const days = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (days.length < bars) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.unshift(d.getTime());
    d.setUTCDate(d.getUTCDate() - 1);
  }
  let regime = drift;
  const candles = days.map((t, i) => {
    if (i % 60 === 0) regime = drift + (rnd() - 0.5) * 0.004; // trend changes every ~quarter
    const open = price;
    const close = Math.max(1, open * Math.exp(regime + vol * gauss()));
    const high = Math.max(open, close) * (1 + Math.abs(gauss()) * vol * 0.5);
    const low = Math.min(open, close) * (1 - Math.abs(gauss()) * vol * 0.5);
    price = close;
    const volume = Math.round(1e6 * (1 + (h % 50)) * (0.6 + rnd()));
    return { t, open, high, low, close, volume };
  });
  return { symbol, name: nameOf(symbol), currency: 'USD', candles, source: 'demo' };
}

// Real data if any source works; demo data if every source is unreachable.
// Throws NotFoundError when the symbol genuinely doesn't exist.
export async function fetchHistory(symbol, { range = '2y', demoOnly = false, log = console.warn } = {}) {
  if (demoOnly) return demoSeries(symbol);
  try {
    return await fetchYahoo(symbol, range);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    log(`[data] ${symbol}: Yahoo failed (${err.message}), trying Stooq`);
  }
  try {
    return await fetchStooq(symbol);
  } catch (err) {
    log(`[data] ${symbol}: Stooq failed (${err.message}), using demo data`);
  }
  return demoSeries(symbol);
}

// Today's 5-minute bars (regular session only). Returns [] outside a session or on failure.
export async function fetchYahooIntraday(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const r = (await res.json())?.chart?.result?.[0];
    if (!r?.timestamp) return [];
    const q = r.indicators.quote[0];
    return r.timestamp.map((t, i) => ({ t: t * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 }))
      .filter((b) => b.close != null && b.open != null);
  } catch {
    return [];
  }
}

export async function searchYahoo(q) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(String(res.status));
  const json = await res.json();
  return (json.quotes || [])
    .filter((x) => x.symbol && ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND'].includes(x.quoteType))
    .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType, exchange: x.exchDisp }));
}

// File name used for a symbol's JSON on the static (GitHub Pages) site. Mirrored in public/js/api.js.
export const dataFileName = (symbol) => `${symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '_')}.json`;

// Company fundamentals for a stock (null for ETFs or when unavailable). Demo price data gets
// demo fundamentals so the offline UI is complete; real price data never gets fake fundamentals.
export async function fundamentalsFor(symbol, data, { demoOnly = false } = {}) {
  if (UNIVERSE.find((u) => u.symbol === symbol)?.sector === 'ETF') return null;
  const f = demoOnly ? null : await fetchFundamentals(symbol);
  if (f) return f;
  return data.source === 'demo' ? demoFundamentals(symbol, data.candles[data.candles.length - 1].close) : null;
}
