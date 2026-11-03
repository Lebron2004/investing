// Parsers for SEC EDGAR filings (pure functions, tested in test/smartmoney.test.js).
//   • 13F-HR "information table": what a fund owned at the end of a quarter
//   • Form 4: a company insider's trades in their own company's stock

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'));
  return m ? m[1].trim() : null;
};
const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'gi'))].map((m) => m[1]);
const valueOf = (xml, name) => { const b = tag(xml, name); return b == null ? null : (tag(b, 'value') ?? b); };
const decode = (s) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"');

// [{ name, cusip, value, shares, putCall }] (stock rows only; options are skipped)
export function parseInfoTable(xml) {
  return blocks(xml, 'infoTable').map((b) => {
    const amt = tag(b, 'shrsOrPrnAmt') || '';
    return {
      name: decode(tag(b, 'nameOfIssuer')),
      cls: decode(tag(b, 'titleOfClass')),
      cusip: tag(b, 'cusip'),
      value: Number(tag(b, 'value')) || 0,
      shares: Number(tag(amt, 'sshPrnamt')) || 0,
      putCall: tag(b, 'putCall'),
    };
  }).filter((r) => r.name && !r.putCall);
}

// Open-market purchases (transaction code P) in a Form 4.
export function parseForm4(xml) {
  const owner = decode(tag(tag(xml, 'reportingOwnerId') || '', 'rptOwnerName')) || 'An insider';
  const rel = tag(xml, 'reportingOwnerRelationship') || '';
  const role = decode(tag(rel, 'officerTitle')) || (/<(?:\w+:)?isDirector>\s*(1|true)/i.test(rel) ? 'Director' : /<(?:\w+:)?isTenPercentOwner>\s*(1|true)/i.test(rel) ? '10% owner' : 'Insider');
  const symbol = tag(tag(xml, 'issuer') || '', 'issuerTradingSymbol')?.toUpperCase() || null;
  const buys = blocks(xml, 'nonDerivativeTransaction').map((t) => ({
    code: tag(tag(t, 'transactionCoding') || '', 'transactionCode'),
    date: valueOf(t, 'transactionDate'),
    shares: Number(valueOf(t, 'transactionShares')) || 0,
    price: Number(valueOf(t, 'transactionPricePerShare')) || 0,
    ad: valueOf(t, 'transactionAcquiredDisposedCode'),
  })).filter((t) => t.code === 'P' && t.ad === 'A' && t.shares > 0);
  return { symbol, owner, role, buys };
}

// Company names in 13F filings ("APPLE INC", "ALPHABET INC CAP STK CL A") → comparable keys.
const SUFFIX = /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|PLC|HOLDINGS?|GROUP|N\s?V|S\s?A|AG|SE|LP|LLC|THE|NEW|DEL|COM|CL(ASS)?\s?[A-C]?|CAP\s?STK|SHS|ORD|SPONSORED|ADR|REIT)\b/g;
export function normalizeName(name) {
  return String(name || '').toUpperCase().replace(/\/[A-Z]{2,4}\/?/g, ' ').replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}

// SEC's company_tickers.json → { byName: lookup(13F name) → ticker, cik: { TICKER: cik } }
export function tickerIndex(companyTickers) {
  const exact = new Map(), cik = {}, byFirst = new Map();
  for (const r of Object.values(companyTickers || {})) {
    const t = String(r.ticker).toUpperCase().replace('-', '.');
    cik[t] ??= r.cik_str;
    const k = normalizeName(r.title);
    if (!k || exact.has(k)) continue; // first listed = the main share class
    exact.set(k, t);
    const words = k.replace(/\b(OF|AND)\b/g, ' ').split(/\s+/).filter(Boolean);
    if (!byFirst.has(words[0])) byFirst.set(words[0], []);
    byFirst.get(words[0]).push({ words, t });
  }
  // 13F names are often abbreviated ("BANK AMER CORP", "OCCIDENTAL PETE CORP"): match word by word
  // on the first 3 letters, and only when exactly one company fits.
  const fuzzy = (k) => {
    const words = k.replace(/\b(OF|AND)\b/g, ' ').split(/\s+/).filter(Boolean);
    const hits = (byFirst.get(words[0]) || []).filter((c) => c.words.length === words.length
      && c.words.every((w, i) => w.slice(0, 3) === words[i].slice(0, 3)));
    return hits.length === 1 ? hits[0].t : null;
  };
  const memo = new Map();
  const byName = { get: (name) => {
    const k = normalizeName(name);
    if (!memo.has(k)) memo.set(k, exact.get(k) ?? fuzzy(k));
    return memo.get(k);
  } };
  return { byName, cik };
}

// Rolls a 13F into { TICKER: { pct, value, shares } } (share classes combined).
export function holdingsByTicker(rows, byName) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const out = {};
  for (const r of rows) {
    const t = byName.get(normalizeName(r.name));
    if (!t) continue;
    const h = (out[t] ??= { pct: 0, value: 0, shares: 0, name: r.name });
    h.value += r.value; h.shares += r.shares; h.pct += r.value / total;
  }
  return out;
}

// Compares two quarters: new positions, bigger, smaller, sold out.
export function compareQuarters(now = {}, before = null) {
  return Object.fromEntries(Object.entries(now).map(([t, h]) => {
    const prev = before?.[t];
    const change = !before ? null : !prev ? 'new' : h.shares > prev.shares * 1.05 ? 'added' : h.shares < prev.shares * 0.95 ? 'trimmed' : 'held';
    return [t, { ...h, change }];
  }));
}
