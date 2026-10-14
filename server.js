// StockWise server: serves the static site and a small market-data API.
// No dependencies — needs Node 18+ (built-in fetch).
//
// Prices come from lib/market-data.js (Yahoo Finance, then Stooq, both free with no API key).
// If neither can be reached, or DATA_SOURCE=demo is set, the API returns simulated prices
// marked `source: "demo"` so the UI shows a clear warning.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIVERSE } from './public/js/lib/universe.js';
import { fetchHistory, searchYahoo, SYMBOL_RE } from './lib/market-data.js';

const PORT = Number(process.env.PORT) || 3000;
const DEMO_ONLY = process.env.DATA_SOURCE === 'demo';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const CACHE_MS = 10 * 60 * 1000;

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

const history = (symbol, range = '2y') =>
  cached(`h:${symbol}:${range}`, () => fetchHistory(symbol, { range, demoOnly: DEMO_ONLY }));

async function search(q) {
  const local = UNIVERSE.filter((u) => u.symbol.startsWith(q.toUpperCase()) || u.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (DEMO_ONLY) return local;
  try {
    const quotes = await cached(`s:${q}`, () => searchYahoo(q));
    return quotes.length ? quotes : local;
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
