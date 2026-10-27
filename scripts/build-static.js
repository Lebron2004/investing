// Builds the GitHub Pages version of the site into ./dist.
// GitHub Pages can't run server.js, so this script downloads price history for every
// symbol ahead of time and saves it as JSON files the browser reads directly.
//
//   node scripts/build-static.js          real data (Yahoo → Stooq → demo fallback)
//   DATA_SOURCE=demo node scripts/...     simulated data, for testing offline
//
// Symbols = the built-in universe + anything listed in symbols.txt.

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UNIVERSE } from '../public/js/lib/universe.js';
import { fetchHistory, fetchYahooIntraday, fundamentalsFor, dataFileName, SYMBOL_RE } from '../lib/market-data.js';
import { trainDayModels } from '../public/js/lib/daymodel.js';
import { nyClock, intradaySnapshot, buildDeskData } from '../public/js/lib/daytrade.js';
import { summarize } from '../public/js/lib/scan.js';
import { fetchIntradayDays, demoIntradayDays, mergeDays, morningRecords } from '../lib/replay-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = `${root}dist/`;
const demoOnly = process.env.DATA_SOURCE === 'demo';

async function extraSymbols() {
  try {
    const text = await readFile(`${root}symbols.txt`, 'utf8');
    return text.split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim().toUpperCase())
      .filter(Boolean)
      .filter((s) => {
        if (SYMBOL_RE.test(s)) return true;
        console.warn(`::warning::symbols.txt: skipping invalid symbol "${s}"`);
        return false;
      });
  } catch {
    return [];
  }
}

const symbols = [...new Set([...UNIVERSE.map((u) => u.symbol), ...(await extraSymbols())])];

await rm(out, { recursive: true, force: true });
await cp(`${root}public/`, out, { recursive: true });
await mkdir(`${out}data/history`, { recursive: true });
await writeFile(`${out}.nojekyll`, '');
await stampVersion(process.env.GITHUB_SHA?.slice(0, 10) || Date.now().toString(36));

// Browsers (and GitHub Pages' 10-minute cache) can keep old copies of the scripts after a deploy,
// which shows up as "Page not found" for brand-new pages. Adding ?v=<build> to every script and
// stylesheet URL makes each deploy load fresh files.
async function stampVersion(v) {
  const files = (await readdir(`${out}js`, { recursive: true })).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const path = `${out}js/${f}`;
    const src = await readFile(path, 'utf8');
    await writeFile(path, src.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g, `$1$2$3?v=${v}$2`));
  }
  const html = await readFile(`${out}index.html`, 'utf8');
  await writeFile(`${out}index.html`, html.replace('href="styles.css"', `href="styles.css?v=${v}"`).replace('src="js/app.js"', `src="js/app.js?v=${v}"`));
}

const manifest = { updated: new Date().toISOString(), symbols: [] };
const scan = [];
const inUniverse = new Set(UNIVERSE.map((u) => u.symbol));
const counts = { live: 0, demo: 0, missing: 0, fundamentals: 0 };

// Fundamentals barely change during a day, so they're cached between runs (GitHub Actions cache)
// and re-downloaded about once a day. If Yahoo fails, a cached copy up to a week old is used.
const FUND_CACHE = `${root}.cache/fundamentals.json`;
let fundCache = {};
try { fundCache = JSON.parse(await readFile(FUND_CACHE, 'utf8')); } catch { /* first run */ }
const age = (f) => (f?.fetched ? Date.now() - Date.parse(f.fetched) : Infinity);
async function fundamentals(symbol, data) {
  const cached = fundCache[symbol];
  if (!demoOnly && cached && age(cached) < 20 * 3600e3) return cached;
  const f = await fundamentalsFor(symbol, data, { demoOnly });
  if (f?.source === 'yahoo') { fundCache[symbol] = f; return f; }
  return cached && age(cached) < 7 * 864e5 ? cached : f;
}
const loaded = new Map();
const queue = [...symbols];

async function worker() {
  while (queue.length) {
    const symbol = queue.shift();
    try {
      const data = await fetchHistory(symbol, { demoOnly, log: () => {} });
      data.fundamentals = await fundamentals(symbol, data);
      await writeFile(`${out}data/history/${dataFileName(symbol)}`, JSON.stringify(data));
      manifest.symbols.push({ symbol, name: data.name, source: data.source });
      loaded.set(symbol, data);
      data.source === 'demo' ? counts.demo++ : counts.live++;
      if (data.fundamentals?.source === 'yahoo') counts.fundamentals++;
      console.log(`${symbol.padEnd(8)} ${data.source.padEnd(6)} ${data.candles.length} days${data.fundamentals ? `  fundamentals: ${data.fundamentals.source}` : ''}`);
    } catch (err) {
      counts.missing++;
      console.warn(`::warning::${symbol}: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

// Summaries need the S&P 500 (SPY) for relative strength, so they're built after every download.
const benchmark = loaded.get('SPY')?.candles;
for (const [symbol, data] of loaded) {
  if (!inUniverse.has(symbol)) continue;
  try { scan.push(summarize(data, { benchmark })); } catch (err) { console.warn(`::warning::${symbol}: ${err.message}`); }
}

// Day Trade Desk: train the AI on every stock's history, then score the next session.
let model = null;
const clock = nyClock();
{
  const started = Date.now();
  const stocks = UNIVERSE.filter((u) => u.sector !== 'ETF' && loaded.has(u.symbol));
  const etfs = UNIVERSE.filter((u) => u.sector === 'ETF' && loaded.has(u.symbol));
  model = benchmark ? trainDayModels(stocks.map((u) => ({ symbol: u.symbol, candles: loaded.get(u.symbol).candles })), benchmark) : null;
  const intraday = new Map();
  if (clock.open && !demoOnly) {
    const q = [...stocks.map((u) => u.symbol), ...etfs.map((u) => u.symbol), 'SPY', 'QQQ'];
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (q.length) {
        const sym = q.shift();
        const bars = await fetchYahooIntraday(sym);
        const c = loaded.get(sym)?.candles;
        const avgVol = c ? c.slice(-21, -1).reduce((a, x) => a + (x.volume || 0), 0) / 20 : null;
        if (bars.length) intraday.set(sym, intradaySnapshot(bars, avgVol));
      }
    }));
  }
  const desk = buildDeskData(stocks.map((u) => ({ ...u, candles: loaded.get(u.symbol).candles, intraday: intraday.get(u.symbol) || null })), benchmark, model, clock);
  const marketRec = (sym) => {
    const c = loaded.get(sym)?.candles;
    if (!c) return null;
    const lastDay = new Date(c.at(-1).t).toISOString().slice(0, 10);
    const prev = clock.open && lastDay === clock.day ? c.at(-2) : c.at(-1);
    return { symbol: sym, prevClose: prev.close, intraday: clock.open ? intraday.get(sym) || null : null };
  };
  const { w: _w, b: _b, ...bigInfo } = model?.big || {};
  const { w: _w2, b: _b2, ...upInfo } = model?.up || {};
  await writeFile(`${out}data/daytrade.json`, JSON.stringify({
    updated: manifest.updated,
    clock,
    model: model ? { trainedAt: model.trainedAt, samples: model.samples, testSamples: model.testSamples, testFrom: model.testFrom, features: model.features, big: bigInfo, up: upInfo } : null,
    market: { spy: marketRec('SPY'), qqq: marketRec('QQQ') },
    stocks: desk,
    // Sector ETFs aren't Desk picks, but AutoPilot may trade them if you allow ETFs.
    etfs: buildDeskData(etfs.map((u) => ({ ...u, candles: loaded.get(u.symbol).candles, intraday: intraday.get(u.symbol) || null })), benchmark, model, clock),
    source: demoOnly ? 'demo' : 'live',
  }));
  console.log(`Day Trade Desk: ${desk.length} stocks scored, ${intraday.size} with intraday data, model ${model ? `AUC ${model.big.metrics.auc.toFixed(3)} (big) / ${model.up.metrics.auc.toFixed(3)} (up)` : 'not trained'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// AutoPilot replay data: 5-minute bars for recent sessions (kept in .cache between runs so the
// history grows past Yahoo's 60-day limit) plus what the bot knew each morning.
{
  const started = Date.now();
  const members = UNIVERSE.filter((u) => loaded.has(u.symbol));
  const syms = [...new Set([...members.map((u) => u.symbol), 'SPY'])].filter((s) => loaded.has(s));
  await mkdir(`${out}data/intraday`, { recursive: true });
  await mkdir(`${root}.cache/intraday`, { recursive: true });
  const unfinished = !clock.weekend && clock.minutes < 960 ? clock.day : null;
  const bars = new Map();
  const q = [...syms];
  let fetched = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const sym = q.shift();
      const cacheFile = `${root}.cache/intraday/${dataFileName(sym)}`;
      let cached = {};
      if (!demoOnly) { try { cached = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* first run */ } }
      const fresh = demoOnly ? demoIntradayDays(sym, loaded.get(sym).candles) : await fetchIntradayDays(sym);
      if (Object.keys(fresh).length) fetched++;
      const merged = mergeDays(cached, fresh, { today: unfinished });
      if (!demoOnly) await writeFile(cacheFile, JSON.stringify(merged));
      bars.set(sym, merged);
    }
  }));
  const days = Object.keys(bars.get('SPY') || {}).sort().slice(-60);
  const records = morningRecords(members.map((u) => ({ ...u, candles: loaded.get(u.symbol).candles })), benchmark, model, days);
  for (const sym of syms) {
    const all = bars.get(sym) || {};
    const keep = Object.fromEntries(days.filter((d) => all[d]).map((d) => [d, all[d]]));
    await writeFile(`${out}data/intraday/${dataFileName(sym)}`, JSON.stringify({ symbol: sym, days: keep }));
  }
  await writeFile(`${out}data/replay.json`, JSON.stringify({
    updated: manifest.updated,
    testFrom: model?.testFrom ?? null,
    days,
    sectors: Object.fromEntries(members.map((u) => [u.symbol, u.sector])),
    records,
    spy: Object.fromEntries(days.map((d) => [d, bars.get('SPY')?.[d] || []])),
    source: demoOnly ? 'demo' : 'live',
  }));
  console.log(`AutoPilot replay: ${days.length} past sessions, ${fetched}/${syms.length} symbols with fresh 5-minute data in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!demoOnly && !fetched) console.warn('::warning::No 5-minute data could be downloaded, so AutoPilot\'s Test/Train uses whatever was cached.');
}

manifest.symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));
if (!demoOnly) {
  await mkdir(`${root}.cache`, { recursive: true });
  await writeFile(FUND_CACHE, JSON.stringify(fundCache));
}
await writeFile(`${out}data/manifest.json`, JSON.stringify(manifest));
await writeFile(`${out}data/scan.json`, JSON.stringify({ updated: manifest.updated, results: scan }));

console.log(`\nBuilt ./dist: ${counts.live} live, ${counts.demo} demo, ${counts.missing} not found, ${counts.fundamentals} with live fundamentals.`);
if (!demoOnly && counts.live > 0 && counts.fundamentals === 0) {
  console.warn('::warning::No company fundamentals could be downloaded. Long-term scores fall back to price trend only.');
}
if (!demoOnly && counts.demo > 0) {
  console.warn(`::warning::${counts.demo} symbols used simulated demo data because no price source could be reached. The site shows a warning on those pages.`);
}
