// Stock trades by members of the U.S. House of Representatives, from their public STOCK Act
// "Periodic Transaction Reports" (disclosures-clerk.house.gov). Members must report a trade within
// 45 days, so every trade here is late by design: that delay is shown everywhere on the site.
//
// Pipeline: yearly index (ZIP with XML) → each report's PDF (encrypted with an empty password) →
// text via scripts/pdf_text.py (pypdf) → transactions. Each report is read once and cached in
// .cache/congress. Scanned paper filings have no text and are skipped.
//
// The disclosure law (5 U.S.C. 13107) forbids using these reports for commercial purposes, credit
// ratings or fundraising. Personal research and education like this site are fine.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const BASE = 'https://disclosures-clerk.house.gov/public_disc';
const UA = 'Mozilla/5.0 (StockWise educational app; github.com/Lebron2004/investing)';
const PDF_TEXT = fileURLToPath(new URL('../scripts/pdf_text.py', import.meta.url));

// --- ZIP (just enough to read the House's index file) ------------------------------------
export function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files[name] = method === 8 ? inflateRawSync(raw) : raw;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// --- Index of filings ---------------------------------------------------------------------
const tag = (s, t) => (s.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1]?.trim() || '';
const isoDate = (us) => { const [m, d, y] = us.split('/'); return y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null; };

// Periodic Transaction Reports (FilingType P) from the yearly XML index.
export function parseIndex(xml) {
  return [...xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)].map((m) => m[1])
    .filter((s) => tag(s, 'FilingType') === 'P')
    .map((s) => ({
      name: [tag(s, 'First'), tag(s, 'Last'), tag(s, 'Suffix')].filter(Boolean).join(' '),
      last: tag(s, 'Last'),
      state: tag(s, 'StateDst'),
      year: tag(s, 'Year'),
      filed: isoDate(tag(s, 'FilingDate')),
      docId: tag(s, 'DocID'),
    }))
    .filter((f) => f.docId && f.filed);
}

// --- One report's text → transactions ----------------------------------------------------
const TYPES = { P: 'buy', S: 'sell', 'S (partial)': 'partial', E: 'exchange' };
const money = (s) => Number(s.replace(/[$,]/g, ''));

/**
 * Transactions in a report's text: [{ ticker, asset, assetType, type, txDate, notified, lo, hi, owner }].
 * Each transaction reads: [owner] asset name (TICKER) [TYPE] then P|S|S (partial)|E date date $lo - $hi.
 */
export function parseReport(text) {
  const t = text.replace(/\u0000/g, '').replace(/\s+/g, ' ');
  const core = /(?:^|\s)(P|S \(partial\)|S|E)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(?:(\$[\d,]+)\s*-\s*(\$[\d,]+)|(?:Over|Spouse\/DC Over)\s+(\$[\d,]+))/g;
  const out = [];
  let prevEnd = 0, m;
  while ((m = core.exec(t))) {
    // The asset is described in the text since the previous transaction. That text also holds the
    // previous transaction's notes ("Filing status: New", "Description: Purchased 100 shares."),
    // so the ticker and owner are read from its END.
    let seg = t.slice(prevEnd, m.index);
    const header = seg.lastIndexOf('$200?');
    if (header >= 0) seg = seg.slice(header + 5);
    prevEnd = core.lastIndex;
    const tks = [...seg.matchAll(/\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\[([A-Z]{2})\]/g)];
    const tk = tks.at(-1);
    const kind = tk?.[2] ?? [...seg.matchAll(/\[([A-Z]{2})\]/g)].at(-1)?.[1] ?? null;
    let name = tk ? seg.slice(0, tk.index + tk[0].length) : seg;
    // Skip the previous transaction's notes: everything up to the end of the last "Label: text" note.
    const colon = name.lastIndexOf(':');
    if (colon >= 0) {
      const rest = name.slice(colon + 1);
      const end = rest.match(/^\s*(?:New|Amended)\b/) || rest.match(/^[^.]*?Portfolio\b/) || rest.match(/^.*?\.(?=\s)/);
      name = end ? rest.slice(end[0].length) : rest;
    }
    const own = [...name.matchAll(/(?:^|\s)(SP|JT|DC)\s/g)].at(-1);
    const owner = own?.[1] ?? 'self';
    if (own) name = name.slice(own.index + own[0].length);
    const asset = name.replace(/\s*\[[A-Z]{2}\]\s*$/, '').trim();
    out.push({
      ticker: tk ? tk[1].replace('-', '.') : null,
      asset: asset.slice(0, 120),
      assetType: kind,
      type: TYPES[m[1]],
      txDate: isoDate(m[2]),
      notified: isoDate(m[3]),
      lo: money(m[4] ?? m[6]),
      hi: m[5] ? money(m[5]) : null,
      owner,
    });
  }
  return out;
}

// --- Orchestration (used by the build) ----------------------------------------------------
async function get(url, binary = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`House site ${res.status} for ${url.replace(BASE, '')}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns the data/congress.json object: { updated, members, trades, errors }.
 * maxPdfs caps how many new reports are downloaded per run (the rest come next run).
 */
export async function congressTrades({ cacheDir, today = new Date().toISOString().slice(0, 10), maxPdfs = 150, log = () => {} }) {
  await mkdir(cacheDir, { recursive: true });
  const cacheFile = `${cacheDir}/reports.json`;
  let cache = {};
  try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* first run */ }
  const errors = [];
  const year = Number(today.slice(0, 4));
  const since = new Date(Date.parse(today) - 400 * 864e5).toISOString().slice(0, 10);

  let filings = [];
  for (const y of [year, year - 1]) {
    try {
      const files = unzip(await get(`${BASE}/financial-pdfs/${y}FD.zip`, true));
      const xml = Object.entries(files).find(([n]) => n.endsWith('.xml'))?.[1];
      if (xml) filings.push(...parseIndex(xml.toString('utf8').replace(/^﻿/, '')));
    } catch (err) {
      errors.push(`index ${y}: ${err.message}`);
    }
  }
  filings = filings.filter((f) => f.filed >= since).sort((a, b) => b.filed.localeCompare(a.filed));

  // Download new reports (newest first), then read them all with one Python call.
  const todo = filings.filter((f) => !cache[f.docId]).slice(0, maxPdfs);
  if (todo.length) {
    const tmp = `${cacheDir}/pdf`;
    await mkdir(tmp, { recursive: true });
    const paths = [];
    for (const f of todo) {
      try {
        const pdf = await get(`${BASE}/ptr-pdfs/${f.year}/${f.docId}.pdf`, true);
        const path = `${tmp}/${f.docId}.pdf`;
        await writeFile(path, pdf);
        paths.push([f, path]);
      } catch (err) {
        errors.push(`${f.name} ${f.docId}: ${err.message}`);
      }
      await sleep(250); // be polite to the House's server
    }
    let texts = {};
    try {
      const { stdout } = await run('python3', [PDF_TEXT, ...paths.map(([, p]) => p)], { maxBuffer: 64 * 1024 * 1024 });
      texts = JSON.parse(stdout);
    } catch (err) {
      errors.push(`Reading PDFs needs Python with pypdf (pip install pypdf): ${err.message.split('\n')[0]}`);
    }
    for (const [f, path] of paths) {
      if (!(path in texts)) continue; // couldn't read: try again next run
      cache[f.docId] = { filed: f.filed, trades: parseReport(texts[path]), scanned: !texts[path].trim() };
    }
    await rm(tmp, { recursive: true, force: true });
    log(`Congress: read ${paths.length} new House reports (${Object.keys(cache).length} cached)`);
  }

  // Assemble: one row per stock transaction.
  const trades = [];
  const members = {};
  for (const f of filings) {
    const c = cache[f.docId];
    if (!c) continue;
    const mem = (members[f.name] ??= { name: f.name, last: f.last, state: f.state, chamber: 'House', reports: 0, scanned: 0, trades: 0, buys: 0, sells: 0, lastFiled: f.filed });
    mem.reports++;
    if (c.scanned) mem.scanned++;
    for (const t of c.trades) {
      if (!t.ticker || t.assetType !== 'ST') continue;
      trades.push({ member: f.name, state: f.state, filed: f.filed, docId: f.docId, ...t });
      mem.trades++;
      if (t.type === 'buy') mem.buys++;
      if (t.type === 'sell' || t.type === 'partial') mem.sells++;
    }
  }
  // Forget reports that dropped out of the window.
  const keep = new Set(filings.map((f) => f.docId));
  for (const id of Object.keys(cache)) if (!keep.has(id)) delete cache[id];
  await writeFile(cacheFile, JSON.stringify(cache));
  trades.sort((a, b) => b.filed.localeCompare(a.filed) || b.txDate.localeCompare(a.txDate));
  return {
    updated: new Date().toISOString(),
    source: `${BASE.replace('/public_disc', '')} (House Periodic Transaction Reports)`,
    members: Object.values(members).sort((a, b) => b.trades - a.trades),
    trades,
    pending: filings.filter((f) => !cache[f.docId]).length,
    errors,
  };
}

// Tickers members traded recently (so the build can download their prices too).
export function tradedTickers(data, limit = 80) {
  const count = {};
  for (const t of data?.trades || []) count[t.ticker] = (count[t.ticker] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

// Simulated trades for offline demo builds (DATA_SOURCE=demo), marked as demo everywhere.
export function demoCongress(symbols, candlesOf) {
  const people = [['Demo Member A', 'CA11'], ['Demo Member B', 'TX02'], ['Demo Member C', 'NY14']];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const trades = [];
  for (const [name, state] of people) {
    for (let k = 0; k < 18; k++) {
      const sym = symbols[Math.floor(rnd() * symbols.length)];
      const c = candlesOf(sym);
      if (!c || c.length < 300) continue;
      const i = c.length - 250 + Math.floor(rnd() * 230);
      const tx = new Date(c[i].t).toISOString().slice(0, 10);
      const filed = new Date(c[i].t + (5 + Math.floor(rnd() * 40)) * 864e5).toISOString().slice(0, 10);
      trades.push({ member: name, state, filed, docId: 'demo', ticker: sym, asset: sym, assetType: 'ST', type: rnd() < 0.65 ? 'buy' : 'sell', txDate: tx, notified: tx, lo: 1001, hi: 15000, owner: 'self' });
    }
  }
  trades.sort((a, b) => b.filed.localeCompare(a.filed));
  return { updated: new Date().toISOString(), source: 'demo', members: people.map(([name, state]) => ({ name, state, chamber: 'House' })), trades, pending: 0, errors: ['Demo mode: simulated Congress trades.'] };
}
