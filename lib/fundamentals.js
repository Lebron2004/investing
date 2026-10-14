// Company fundamentals (valuation, growth, profitability, analyst targets, earnings date)
// from Yahoo Finance's quoteSummary endpoint. Free, no API key, but it needs a cookie +
// "crumb" token first. Every failure returns null: fundamentals are a bonus, never required.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const MODULES = 'summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile,price';

let session = null; // Promise<{ cookie, crumb }>, shared by concurrent callers

function getSession(force = false) {
  if (!session || force) {
    session = newSession();
    session.catch(() => { session = null; });
  }
  return session;
}

async function newSession() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  const cookie = (r1.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('no Yahoo cookie');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, cookie }, signal: AbortSignal.timeout(8000) });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes('<') || crumb.length > 40) throw new Error(`no Yahoo crumb (${r2.status})`);
  return { cookie, crumb };
}

export async function fetchFundamentals(symbol) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { cookie, crumb } = await getSession(attempt > 0);
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, cookie }, signal: AbortSignal.timeout(10000) });
      if (res.status === 401 || res.status === 403) continue; // stale crumb → refresh once
      if (!res.ok) return null;
      return parseQuoteSummary(await res.json());
    } catch {
      if (attempt > 0) return null;
    }
  }
  return null;
}

const raw = (x) => (x == null ? null : typeof x === 'number' ? x : typeof x.raw === 'number' ? x.raw : null);

// Normalizes Yahoo's nested {raw, fmt} payload into plain numbers (fractions for percentages).
export function parseQuoteSummary(json) {
  const r = json?.quoteSummary?.result?.[0];
  if (!r) return null;
  const sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {};
  const ap = r.assetProfile || {}, pr = r.price || {}, ce = r.calendarEvents || {};
  let dividendYield = raw(sd.dividendYield) ?? raw(sd.trailingAnnualDividendYield);
  if (dividendYield != null && dividendYield > 0.25) dividendYield /= 100; // some fields come back as percent
  const earnings = (ce.earnings?.earningsDate || []).map(raw).filter(Boolean).map((s) => s * 1000);
  const f = {
    marketCap: raw(sd.marketCap) ?? raw(pr.marketCap),
    trailingPE: raw(sd.trailingPE),
    forwardPE: raw(sd.forwardPE) ?? raw(ks.forwardPE),
    peg: raw(ks.pegRatio),
    priceToBook: raw(ks.priceToBook),
    dividendYield,
    beta: raw(sd.beta) ?? raw(ks.beta),
    revenueGrowth: raw(fd.revenueGrowth),
    earningsGrowth: raw(fd.earningsGrowth) ?? raw(ks.earningsQuarterlyGrowth),
    grossMargin: raw(fd.grossMargins),
    operatingMargin: raw(fd.operatingMargins),
    profitMargin: raw(fd.profitMargins) ?? raw(ks.profitMargins),
    roe: raw(fd.returnOnEquity),
    debtToEquity: raw(fd.debtToEquity), // percent, e.g. 150 = 1.5×
    currentRatio: raw(fd.currentRatio),
    freeCashflow: raw(fd.freeCashflow),
    targetMean: raw(fd.targetMeanPrice),
    targetHigh: raw(fd.targetHighPrice),
    targetLow: raw(fd.targetLowPrice),
    analystCount: raw(fd.numberOfAnalystOpinions),
    recommendationMean: raw(fd.recommendationMean), // 1 = strong buy … 5 = sell
    recommendationKey: fd.recommendationKey || null,
    nextEarnings: earnings.find((t) => t > Date.now() - 864e5) ?? null,
    industry: ap.industry || null,
    summary: ap.longBusinessSummary ? trimSummary(ap.longBusinessSummary) : null,
    quoteType: pr.quoteType || null,
  };
  // Nothing useful (e.g. most ETFs) → treat as unavailable.
  const useful = ['trailingPE', 'forwardPE', 'revenueGrowth', 'profitMargin', 'targetMean'].some((k) => f[k] != null);
  return useful ? { ...f, source: 'yahoo', fetched: new Date().toISOString() } : null;
}

function trimSummary(s) {
  if (s.length <= 420) return s;
  const cut = s.slice(0, 420);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, 300))}…`.replace(/\.…$/, '.');
}

// --- Demo fundamentals: deterministic, plausible numbers so the UI can be tested offline. ---
function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function demoFundamentals(symbol, price) {
  let h = hash(`${symbol}:f`);
  const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
  const between = (a, b) => a + (b - a) * rnd();
  const eps = between(-0.02, 0.08) * price;
  return {
    marketCap: Math.round(between(10, 3000)) * 1e9,
    trailingPE: eps > 0 ? price / eps : null,
    forwardPE: eps > 0 ? price / (eps * between(0.9, 1.4)) : null,
    peg: eps > 0 ? between(0.6, 4) : null,
    priceToBook: between(1, 20),
    dividendYield: rnd() < 0.4 ? 0 : between(0.003, 0.05),
    beta: between(0.5, 2),
    revenueGrowth: between(-0.1, 0.4),
    earningsGrowth: between(-0.3, 0.6),
    grossMargin: between(0.2, 0.8),
    operatingMargin: between(-0.05, 0.4),
    profitMargin: between(-0.08, 0.35),
    roe: between(-0.1, 0.45),
    debtToEquity: between(10, 250),
    currentRatio: between(0.7, 3),
    freeCashflow: between(-2, 30) * 1e9,
    targetMean: price * between(0.85, 1.35),
    targetHigh: price * between(1.3, 1.7),
    targetLow: price * between(0.6, 0.95),
    analystCount: Math.round(between(3, 45)),
    recommendationMean: between(1.4, 3.4),
    recommendationKey: null,
    nextEarnings: Date.now() + Math.round(between(2, 85)) * 864e5,
    industry: null,
    summary: 'Simulated company data for offline testing. Run with internet access to see the real business description and numbers.',
    quoteType: 'EQUITY',
    source: 'demo',
    fetched: new Date().toISOString(),
  };
}
