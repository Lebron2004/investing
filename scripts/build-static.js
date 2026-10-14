// Builds the GitHub Pages version of the site into ./dist.
// GitHub Pages can't run server.js, so this script downloads price history for every
// symbol ahead of time and saves it as JSON files the browser reads directly.
//
//   node scripts/build-static.js          real data (Yahoo → Stooq → demo fallback)
//   DATA_SOURCE=demo node scripts/...     simulated data, for testing offline
//
// Symbols = the built-in universe + anything listed in symbols.txt.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UNIVERSE } from '../public/js/lib/universe.js';
import { fetchHistory, fundamentalsFor, dataFileName, SYMBOL_RE } from '../lib/market-data.js';
import { summarize } from '../public/js/lib/scan.js';

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

const manifest = { updated: new Date().toISOString(), symbols: [] };
const scan = [];
const inUniverse = new Set(UNIVERSE.map((u) => u.symbol));
const counts = { live: 0, demo: 0, missing: 0, fundamentals: 0 };
const loaded = new Map();
const queue = [...symbols];

async function worker() {
  while (queue.length) {
    const symbol = queue.shift();
    try {
      const data = await fetchHistory(symbol, { demoOnly, log: () => {} });
      data.fundamentals = await fundamentalsFor(symbol, data, { demoOnly });
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

manifest.symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));
await writeFile(`${out}data/manifest.json`, JSON.stringify(manifest));
await writeFile(`${out}data/scan.json`, JSON.stringify({ updated: manifest.updated, results: scan }));

console.log(`\nBuilt ./dist: ${counts.live} live, ${counts.demo} demo, ${counts.missing} not found, ${counts.fundamentals} with live fundamentals.`);
if (!demoOnly && counts.live > 0 && counts.fundamentals === 0) {
  console.warn('::warning::No company fundamentals could be downloaded. Long-term scores fall back to price trend only.');
}
if (!demoOnly && counts.demo > 0) {
  console.warn(`::warning::${counts.demo} symbols used simulated demo data because no price source could be reached. The site shows a warning on those pages.`);
}
