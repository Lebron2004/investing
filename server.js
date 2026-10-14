// StockWise server: serves the static site and a small market-data API.
// No dependencies — needs Node 18+ (built-in fetch).
//
// Data source: Yahoo Finance's public chart endpoint (free, no API key).
// If it can't be reached, or DATA_SOURCE=demo is set, the API returns simulated prices
// and marks them `source: "demo"` so the UI can show a clear warning.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIVERSE } from './public/js/lib/universe.js';

const PORT = Number(process.env.PORT) || 3000;
const DEMO_ONLY = process.env.DATA_SOURCE === 'demo';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const CACHE_MS = 10 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const SYMBOL_RE = /^[A-Z0-9.^=-]{1,15}$/;

async function fetchYahoo(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(json?.chart?.error?.description || 'Unknown symbol');
  const q = r.indicators.quote[0];
  const candles = [];
  r.timestamp.forEach((t, i) => {
    if (q.close[i] == null || q.open[i] == null) return;
    candles.push({ t: t * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 });
  });
  if (candles.length < 2) throw new Error('No price data for this symbol');
  const meta = r.meta || {};
  return {
    symbol,
    name: meta.longName || meta.shortName || UNIVERSE.find((u) => u.symbol === symbol)?.name || symbol,
    currency: meta.currency || 'USD',
    exchange: meta.exchangeName,
    candles,
    source: 'yahoo',
  };
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
function demoSeries(symbol, bars = 520) {
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
  return {
    symbol,
    name: UNIVERSE.find((u) => u.symbol === symbol)?.name || symbol,
    currency: 'USD',
    candles,
    source: 'demo',
  };
}

async function history(symbol, range = '2y') {
  return cached(`h:${symbol}:${range}`, async () => {
    if (DEMO_ONLY) return demoSeries(symbol);
    try {
      return await fetchYahoo(symbol, range);
    } catch (err) {
      if (/Unknown symbol|No data|No price data|Not Found|404/i.test(err.message)) throw Object.assign(err, { status: 404 });
      console.warn(`[data] ${symbol}: ${err.message} — using demo data`);
      return demoSeries(symbol);
    }
  });
}

async function search(q) {
  const local = UNIVERSE.filter((u) => u.symbol.startsWith(q.toUpperCase()) || u.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (DEMO_ONLY) return local;
  try {
    return await cached(`s:${q}`, async () => {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const quotes = (json.quotes || [])
        .filter((x) => x.symbol && ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND'].includes(x.quoteType))
        .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType, exchange: x.exchDisp }));
      return quotes.length ? quotes : local;
    });
  } catch {
    return local;
  }
}

function send(res, status, body, type = MIME['.json']) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function handleApi(url, res) {
  const p = url.pathname;
  if (p === '/api/history') {
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
    const range = ['6mo', '1y', '2y', '5y'].includes(url.searchParams.get('range')) ? url.searchParams.get('range') : '2y';
    if (!SYMBOL_RE.test(symbol)) return send(res, 400, { error: 'Invalid symbol' });
    try {
      return send(res, 200, await history(symbol, range));
    } catch (err) {
      return send(res, err.status || 502, { error: err.message });
    }
  }
  if (p === '/api/batch') {
    const symbols = (url.searchParams.get('symbols') || '').toUpperCase().split(',').filter((s) => SYMBOL_RE.test(s)).slice(0, 60);
    const results = {};
    // Fetch a few at a time to stay polite to the data provider.
    for (let i = 0; i < symbols.length; i += 6) {
      await Promise.all(symbols.slice(i, i + 6).map(async (s) => {
        try { results[s] = await history(s, '2y'); } catch (err) { results[s] = { error: err.message }; }
      }));
    }
    return send(res, 200, { results });
  }
  if (p === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
    return send(res, 200, { results: q ? await search(q) : [] });
  }
  if (p === '/api/universe') return send(res, 200, { results: UNIVERSE });
  return send(res, 404, { error: 'Not found' });
}

async function serveStatic(url, res) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !extname(rel)) rel = '/index.html';
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await readFile(file);
    send(res, 200, body, MIME[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(url, res);
    else await serveStatic(url, res);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`StockWise running at http://localhost:${PORT}${DEMO_ONLY ? ' (demo data)' : ''}`);
});
