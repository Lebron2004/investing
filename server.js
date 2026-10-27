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
import { fetchHistory, fetchYahooIntraday, fundamentalsFor, searchYahoo, SYMBOL_RE } from './lib/market-data.js';
import { trainDayModels } from './public/js/lib/daymodel.js';
import { nyClock, intradaySnapshot, buildDeskData } from './public/js/lib/daytrade.js';
import { summarize } from './public/js/lib/scan.js';
import { fetchIntradayDays, demoIntradayDays, mergeDays, morningRecords } from './lib/replay-data.js';

const PORT = Number(process.env.PORT) || 3000;
const DEMO_ONLY = process.env.DATA_SOURCE === 'demo';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const CACHE_MS = 2 * 60 * 1000; // prices refresh every 2 minutes

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pine': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ts': 'text/plain; charset=utf-8',
};

const cache = new Map();
async function cached(key, fn, ttl = CACHE_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Price history plus company fundamentals (fundamentals change slowly: cached 12 hours).
async function history(symbol, range = '2y') {
  const data = await cached(`h:${symbol}:${range}`, () => fetchHistory(symbol, { range, demoOnly: DEMO_ONLY }));
  const fundamentals = await cached(`f:${symbol}`, () => fundamentalsFor(symbol, data, { demoOnly: DEMO_ONLY }), 12 * 3600e3);
  return { ...data, fundamentals };
}

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

// Analyze the whole universe (a few at a time to stay polite to the data provider).
async function scanAll() {
  const benchmark = (await history('SPY').catch(() => null))?.candles;
  const queue = UNIVERSE.map((u) => u.symbol);
  const results = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      try { results.push(summarize(await history(s), { benchmark })); } catch { /* unknown symbol or too little history */ }
    }
  }));
  return { updated: new Date().toISOString(), results };
}

// Day Trade Desk: the AI is retrained twice a day; intraday 5-minute data refreshes every minute.
async function dayTradeDesk() {
  const stocks = UNIVERSE.filter((u) => u.sector !== 'ETF');
  const etfs = UNIVERSE.filter((u) => u.sector === 'ETF');
  const loaded = new Map();
  const queue = [...UNIVERSE.map((u) => u.symbol), 'SPY', 'QQQ'];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      try { loaded.set(s, await history(s)); } catch { /* skip */ }
    }
  }));
  const bench = loaded.get('SPY')?.candles;
  const model = await dayModel(loaded, bench);
  const clock = nyClock();
  const intraday = new Map();
  if (clock.open && !DEMO_ONLY) {
    const q = [...loaded.keys()];
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (q.length) {
        const sym = q.shift();
        const c = loaded.get(sym).candles;
        const avgVol = c.slice(-21, -1).reduce((a, x) => a + (x.volume || 0), 0) / 20;
        const snap = await cached(`i:${sym}`, async () => intradaySnapshot(await fetchYahooIntraday(sym), avgVol), 60e3);
        if (snap) intraday.set(sym, snap);
      }
    }));
  }
  const marketRec = (sym) => {
    const c = loaded.get(sym)?.candles;
    if (!c) return null;
    const prev = clock.open && new Date(c.at(-1).t).toISOString().slice(0, 10) === clock.day ? c.at(-2) : c.at(-1);
    return { symbol: sym, prevClose: prev.close, intraday: intraday.get(sym) || null };
  };
  const strip = (m) => { if (!m) return m; const { w, b, ...rest } = m; return rest; };
  return {
    updated: new Date().toISOString(),
    clock,
    model: model ? { trainedAt: model.trainedAt, samples: model.samples, testSamples: model.testSamples, testFrom: model.testFrom, features: model.features, big: strip(model.big), up: strip(model.up) } : null,
    market: { spy: marketRec('SPY'), qqq: marketRec('QQQ') },
    stocks: buildDeskData(stocks.filter((u) => loaded.has(u.symbol)).map((u) => ({ ...u, candles: loaded.get(u.symbol).candles, intraday: intraday.get(u.symbol) || null })), bench, model, clock),
    etfs: buildDeskData(etfs.filter((u) => loaded.has(u.symbol)).map((u) => ({ ...u, candles: loaded.get(u.symbol).candles, intraday: intraday.get(u.symbol) || null })), bench, model, clock),
    source: DEMO_ONLY ? 'demo' : 'live',
  };
}

const dayModel = (loaded, bench) => cached('daymodel', async () => trainDayModels(UNIVERSE.filter((u) => u.sector !== 'ETF' && loaded.has(u.symbol)).map((u) => ({ symbol: u.symbol, candles: loaded.get(u.symbol).candles })), bench), 12 * 3600e3);

// AutoPilot replay data (see scripts/build-static.js): recent 5-minute bars + what the bot knew each morning.
const intradayBars = new Map();
async function replayData() {
  const loaded = new Map();
  const queue = [...UNIVERSE.map((u) => u.symbol), 'SPY'];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      try { loaded.set(s, await history(s)); } catch { /* skip */ }
    }
  }));
  const bench = loaded.get('SPY')?.candles;
  const model = await dayModel(loaded, bench);
  const clock = nyClock();
  const unfinished = !clock.weekend && clock.minutes < 960 ? clock.day : null;
  let anyReal = false;
  const q = [...loaded.keys()];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const sym = q.shift();
      let days = DEMO_ONLY ? {} : await fetchIntradayDays(sym);
      if (Object.keys(days).length) anyReal = true;
      else days = demoIntradayDays(sym, loaded.get(sym).candles);
      intradayBars.set(sym, mergeDays({}, days, { today: unfinished }));
    }
  }));
  const members = UNIVERSE.filter((u) => loaded.has(u.symbol));
  const days = Object.keys(intradayBars.get('SPY') || {}).sort().slice(-60);
  return {
    updated: new Date().toISOString(),
    testFrom: model?.testFrom ?? null,
    days,
    sectors: Object.fromEntries(members.map((u) => [u.symbol, u.sector])),
    records: morningRecords(members.map((u) => ({ ...u, candles: loaded.get(u.symbol).candles })), bench, model, days),
    spy: Object.fromEntries(days.map((d) => [d, intradayBars.get('SPY')?.[d] || []])),
    source: anyReal ? 'live' : 'demo',
  };
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
  // Pages poll this to learn when fresher prices are available (they change every CACHE_MS).
  if (p === '/api/status') return send(res, 200, { updated: new Date(Math.floor(Date.now() / CACHE_MS) * CACHE_MS).toISOString() });
  if (p === '/api/universe') return send(res, 200, { results: UNIVERSE });
  if (p === '/api/daytrade') return send(res, 200, await cached('desk', dayTradeDesk, 60e3));
  if (p === '/api/replay') return send(res, 200, await cached('replay', replayData, 30 * 60e3));
  if (p === '/api/intraday') {
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
    if (!intradayBars.has(symbol)) await cached('replay', replayData, 30 * 60e3);
    const days = intradayBars.get(symbol);
    return days ? send(res, 200, { symbol, days }) : send(res, 404, { error: `No 5-minute data for ${symbol}` });
  }
  if (p === '/api/scan') return send(res, 200, await cached('scan', scanAll));
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
