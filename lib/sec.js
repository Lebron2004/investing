// "Smart money" data from SEC EDGAR (free, public): famous funds' quarterly 13F holdings and
// company insiders' open-market purchases (Form 4). Downloaded by the build and cached in .cache/sec
// so each filing is only fetched once.
//
// The SEC asks automated tools to identify themselves with a User-Agent. Set the SEC_USER_AGENT
// environment variable (for GitHub: a repository variable) to something like "Your Name you@example.com"
// if the SEC starts refusing the default.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseInfoTable, parseForm4, tickerIndex, holdingsByTicker, compareQuarters } from './sec-parse.js';

const UA = process.env.SEC_USER_AGENT || 'StockWise educational app (github.com/Lebron2004/investing)';

// Famous investors whose 13F filings are tracked. `match` guards against a wrong CIK: the SEC's
// name for the filer must contain it, or the fund is skipped.
export const FUNDS = [
  { key: 'berkshire', label: 'Berkshire Hathaway', manager: 'Warren Buffett', cik: 1067983, match: /BERKSHIRE/i },
  { key: 'pershing', label: 'Pershing Square', manager: 'Bill Ackman', cik: 1336528, match: /PERSHING/i },
  { key: 'duquesne', label: 'Duquesne Family Office', manager: 'Stanley Druckenmiller', cik: 1536411, match: /DUQUESNE/i },
  { key: 'appaloosa', label: 'Appaloosa', manager: 'David Tepper', cik: 1656456, match: /APPALOOSA/i },
  { key: 'thirdpoint', label: 'Third Point', manager: 'Dan Loeb', cik: 1040273, match: /THIRD POINT/i },
  { key: 'baupost', label: 'Baupost Group', manager: 'Seth Klarman', cik: 1061768, match: /BAUPOST/i },
  { key: 'greenlight', label: 'Greenlight Capital', manager: 'David Einhorn', cik: 1079114, match: /GREENLIGHT/i },
  { key: 'scion', label: 'Scion Asset Management', manager: 'Michael Burry', cik: 1649339, match: /SCION/i },
  { key: 'tiger', label: 'Tiger Global', manager: 'Chase Coleman', cik: 1167483, match: /TIGER GLOBAL/i },
  { key: 'ark', label: 'ARK Invest', manager: 'Cathie Wood', cik: 1697748, match: /ARK INVEST/i },
  { key: 'bridgewater', label: 'Bridgewater Associates', manager: 'Ray Dalio (founder)', cik: 1350694, match: /BRIDGEWATER/i },
  { key: 'renaissance', label: 'Renaissance Technologies', manager: 'Jim Simons (founder)', cik: 1037389, match: /RENAISSANCE/i },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function secGet(url, { json = true } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 130 - Date.now(); // stay under the SEC's 10 requests/second
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`SEC ${res.status} for ${url.replace('https://', '')}`);
    return json ? res.json() : res.text();
  }
  throw new Error(`SEC kept refusing ${url.replace('https://', '')}`);
}
const pad = (cik) => String(cik).padStart(10, '0');
const archive = (cik, acc, file = '') => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${file}`;

function recent(sub, forms) {
  const r = sub?.filings?.recent;
  if (!r) return [];
  return r.form.map((form, i) => ({ form, acc: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate?.[i], doc: r.primaryDocument[i] }))
    .filter((f) => forms.includes(f.form));
}

async function loadJson(f, d) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } }

/**
 * symbols: the tickers we care about (insider buys are checked for these).
 * Returns the data/smartmoney.json object. Never throws: problems are listed in `errors`.
 */
export async function smartMoney({ symbols, cacheDir, log = () => {}, maxForm4 = 500, today = new Date().toISOString().slice(0, 10) }) {
  await mkdir(cacheDir, { recursive: true });
  const cacheFile = `${cacheDir}/sec.json`;
  const cache = await loadJson(cacheFile, { tickers: null, tickersAt: 0, filings: {}, form4: {}, subs: {} });
  const errors = [];
  const out = { updated: new Date().toISOString(), funds: [], insiders: {}, holdings: {}, insiderBuys: {}, bySymbol: {}, errors };

  try {
    if (!cache.tickers || Date.now() - cache.tickersAt > 7 * 864e5) {
      cache.tickers = await secGet('https://www.sec.gov/files/company_tickers.json');
      cache.tickersAt = Date.now();
    }
  } catch (err) {
    errors.push(`ticker list: ${err.message}`);
    if (!cache.tickers) return out;
  }
  const { byName, cik } = tickerIndex(cache.tickers);
  const subs = async (c) => {
    const hit = cache.subs[c];
    if (hit && Date.now() - hit.at < 20 * 3600e3) return hit.data;
    const full = await secGet(`https://data.sec.gov/submissions/CIK${pad(c)}.json`);
    const r = full.filings.recent;
    const keep = r.form.map((f, i) => i).filter((i) => ['13F-HR', '4'].includes(r.form[i])).slice(0, 400);
    const data = { name: full.name, filings: { recent: Object.fromEntries(['form', 'accessionNumber', 'filingDate', 'reportDate', 'primaryDocument'].map((k) => [k, keep.map((i) => r[k]?.[i])])) } };
    cache.subs[c] = { at: Date.now(), data };
    return data;
  };

  // --- Famous funds (13F) ---
  const used = new Set();
  for (const f of FUNDS) {
    try {
      const sub = await subs(f.cik);
      if (!f.match.test(sub.name || '')) { errors.push(`${f.label}: SEC name "${sub.name}" doesn't match, skipped`); continue; }
      const filings = recent(sub, ['13F-HR']).slice(0, 4);
      const quarters = [];
      for (const fl of filings) {
        used.add(fl.acc);
        let hit = cache.filings[fl.acc];
        if (!hit) {
          const idx = await secGet(archive(f.cik, fl.acc, 'index.json'));
          const xmls = (idx.directory?.item || []).filter((x) => /\.xml$/i.test(x.name) && !/primary_doc/i.test(x.name));
          const table = xmls.find((x) => /info|table/i.test(x.name)) || xmls.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0];
          if (!table) continue;
          const rows = parseInfoTable(await secGet(archive(f.cik, fl.acc, table.name), { json: false }));
          hit = { filed: fl.filed, period: fl.period, rows: rows.map((r) => [r.name, r.value, r.shares]) };
          cache.filings[fl.acc] = hit;
        }
        quarters.push({ filed: hit.filed, period: hit.period, holdings: holdingsByTicker(hit.rows.map(([name, value, shares]) => ({ name, value, shares })), byName), names: hit.rows });
      }
      if (!quarters.length) continue;
      quarters.sort((a, b) => b.filed.localeCompare(a.filed));
      // Timeline for the AutoPilot "funds" tip: held from the filing date until the next filing.
      quarters.forEach((q, i) => {
        const until = i === 0 ? null : quarters[i - 1].filed;
        for (const t of Object.keys(q.holdings)) (out.holdings[t] ??= []).push([q.filed, until]);
      });
      const latest = compareQuarters(quarters[0].holdings, quarters[1]?.holdings ?? null);
      const stale = (Date.parse(today) - Date.parse(quarters[0].filed)) / 864e5 > 200;
      const top = Object.entries(latest).sort((a, b) => b[1].pct - a[1].pct);
      out.funds.push({
        key: f.key, label: f.label, manager: f.manager, secName: sub.name, filed: quarters[0].filed, period: quarters[0].period, stale,
        positions: quarters[0].names.length,
        top: top.slice(0, 15).map(([t, h]) => ({ symbol: t, name: h.name, pct: round(h.pct, 4), change: h.change })),
        newBuys: top.filter(([, h]) => h.change === 'new').slice(0, 10).map(([t, h]) => ({ symbol: t, name: h.name, pct: round(h.pct, 4) })),
        added: top.filter(([, h]) => h.change === 'added').slice(0, 10).map(([t, h]) => ({ symbol: t, name: h.name, pct: round(h.pct, 4) })),
      });
      for (const [t, h] of top) (out.bySymbol[t] ??= { funds: [] }).funds.push({ key: f.key, label: f.label, manager: f.manager, pct: round(h.pct, 4), change: h.change });
      log(`13F ${f.label}: ${quarters.length} quarter(s), latest filed ${quarters[0].filed}, ${top.length} matched holdings`);
    } catch (err) {
      errors.push(`${f.label}: ${err.message}`);
    }
  }

  // --- Insider buying (Form 4) ---
  const since = new Date(Date.parse(today) - 120 * 864e5).toISOString().slice(0, 10);
  let fetched = 0;
  for (const sym of symbols) {
    const c = cik[sym] ?? cik[sym.replace('.', '-')];
    if (!c) continue;
    try {
      const forms = recent(await subs(c), ['4']).filter((x) => x.filed >= since);
      for (const fl of forms) {
        let hit = cache.form4[fl.acc];
        if (!hit) {
          if (fetched >= maxForm4) break; // the rest next run
          fetched++;
          const raw = fl.doc.replace(/^xsl[^/]+\//i, '');
          const p = parseForm4(await secGet(archive(c, fl.acc, raw), { json: false }));
          hit = { filed: fl.filed, symbol: p.symbol, owner: p.owner, role: p.role, buys: p.buys.map((b) => [b.date, b.shares, b.price]) };
          cache.form4[fl.acc] = hit;
        }
        if (!hit.buys.length || (hit.symbol && hit.symbol !== sym && hit.symbol.replace('.', '-') !== sym.replace('.', '-'))) continue;
        const shares = hit.buys.reduce((a, b) => a + b[1], 0);
        const value = hit.buys.reduce((a, b) => a + b[1] * b[2], 0);
        (out.insiders[sym] ??= []).push({ filed: hit.filed, date: hit.buys[0][0], owner: hit.owner, role: hit.role, shares, price: shares ? round(value / shares, 2) : null, value: Math.round(value) });
        (out.insiderBuys[sym] ??= []).push(hit.filed);
      }
    } catch (err) {
      errors.push(`${sym} insiders: ${err.message}`);
    }
  }
  for (const [sym, list] of Object.entries(out.insiders)) {
    list.sort((a, b) => b.filed.localeCompare(a.filed));
    const v90 = list.filter((x) => (Date.parse(today) - Date.parse(x.filed)) / 864e5 <= 90).reduce((a, x) => a + x.value, 0);
    (out.bySymbol[sym] ??= { funds: [] }).insiderValue90 = v90;
  }
  log(`Form 4: ${fetched} new filings read, insider buying found in ${Object.keys(out.insiders).length} stocks`);

  // Keep the cache from growing forever.
  for (const acc of Object.keys(cache.filings)) if (!used.has(acc)) delete cache.filings[acc];
  for (const [acc, f] of Object.entries(cache.form4)) if (f.filed < since) delete cache.form4[acc];
  await writeFile(cacheFile, JSON.stringify(cache));
  return out;
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
