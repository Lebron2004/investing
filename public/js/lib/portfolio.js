// Import brokerage positions and turn them into a concrete action plan.
// Everything here is pure (no DOM, no network) so it can be unit-tested.

import { UNIVERSE } from './universe.js';

// --- CSV import ---------------------------------------------------------------

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const COLS = {
  symbol: ['symbol', 'ticker', 'instrument', 'securitysymbol', 'symbolcusip', 'tickersymbol', 'stocksymbol'],
  shares: ['quantity', 'shares', 'qty', 'sharesquantity', 'quantityshares', 'units', 'shareqty', 'numberofshares'],
  avgCost: ['averagecostbasis', 'averagecost', 'avgcost', 'averageprice', 'avgprice', 'costpershare', 'costbasispershare', 'unitcost', 'averagecostpershare', 'purchaseprice', 'pricepaid', 'avgcostpershare', 'averagecostbasispershare'],
  totalCost: ['costbasistotal', 'costbasis', 'totalcost', 'totalcostbasis', 'costbasisamount'],
  value: ['currentvalue', 'marketvalue', 'value', 'totalvalue', 'mktval', 'marketvaluetotal', 'equity'],
  desc: ['description', 'name', 'securitydescription', 'securityname', 'investmentname'],
};
// Looser matches for headers like Schwab's "Qty (Quantity)" or "Mkt Val (Market Value)".
const PREFIX = { symbol: ['symbol'], shares: ['qty', 'quantity', 'shares'], value: ['mktval', 'marketvalue', 'currentvalue'], totalCost: ['costbasis'], avgCost: ['averagecost', 'avgcost'] };
function findCol(header, key) {
  const exact = header.findIndex((h) => COLS[key].includes(norm(h)));
  if (exact >= 0) return exact;
  return header.findIndex((h) => (PREFIX[key] || []).some((p) => norm(h).startsWith(p)) && !(key === 'totalCost' && /share|average|avg/i.test(h)));
}

export function parseNumber(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || /^-+$|^n\/?a$/i.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[$\s]/g, ''));
  s = s.replace(/[^0-9.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const CASH_RE = /^(SPAXX|FDRXX|FZFXX|SPRXX|FCASH|SWVXX|SNVXX|SNSXX|VMFXX|VMRXX|CORE|CASH|MMDA\d*)\**$/i;

// Accepts CSV exports from most brokers (Fidelity, Schwab, Vanguard, E*TRADE, Merrill, …)
// plus simple hand-made files with Symbol / Shares / Avg Cost columns.
export function parseHoldingsCSV(text) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  const hi = rows.findIndex((r) => findCol(r, 'symbol') >= 0 && findCol(r, 'shares') >= 0);
  if (hi < 0) {
    return { holdings: [], cash: 0, skipped: [], error: 'Couldn\'t find "Symbol" and "Quantity" (or "Shares") columns. Check that this is a positions/holdings export.' };
  }
  const header = rows[hi];
  const col = Object.fromEntries(Object.keys(COLS).map((k) => [k, findCol(header, k)]));
  const merged = new Map();
  const skipped = [];
  let cash = 0;

  for (const r of rows.slice(hi + 1)) {
    if (!r.some((c) => c)) continue;
    // A second header row means a new section (e.g. Vanguard lists transactions after positions).
    if (findCol(r, 'symbol') >= 0 && findCol(r, 'shares') >= 0) break;
    let raw = (r[col.symbol] || '').trim();
    const desc = col.desc >= 0 ? r[col.desc] || '' : '';
    const shares = parseNumber(r[col.shares]);
    const value = col.value >= 0 ? parseNumber(r[col.value]) : null;
    if (!raw) continue;
    if (CASH_RE.test(raw) || /money market|cash & cash|^cash$|cash and sweep/i.test(`${raw} ${desc}`)) {
      cash += value ?? shares ?? 0;
      continue;
    }
    if (/total|pending|^account/i.test(raw)) continue;
    const symbol = raw.toUpperCase().replace(/\*+$/, '').replace(/\s+/g, '').replace('/', '.');
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      skipped.push({ symbol: raw, reason: /\d{6}|\b[CP]\d/.test(raw) || raw.length > 10 ? 'options and bonds are not supported' : 'unrecognized symbol' });
      continue;
    }
    if (!(shares > 0)) {
      if (shares != null && shares < 0) skipped.push({ symbol, reason: 'short positions are not supported' });
      continue;
    }
    let avgCost = col.avgCost >= 0 ? parseNumber(r[col.avgCost]) : null;
    if (avgCost == null && col.totalCost >= 0) {
      const total = parseNumber(r[col.totalCost]);
      if (total != null) avgCost = total / shares;
    }
    const prev = merged.get(symbol);
    if (prev) {
      // Same stock in several accounts: add the shares, blend the cost.
      const costA = prev.avgCost != null ? prev.avgCost * prev.shares : null;
      const costB = avgCost != null ? avgCost * shares : null;
      prev.shares += shares;
      prev.avgCost = costA != null && costB != null ? (costA + costB) / prev.shares : prev.avgCost ?? avgCost;
    } else {
      merged.set(symbol, { symbol, shares, avgCost: avgCost != null && avgCost > 0 ? avgCost : null });
    }
  }
  return { holdings: [...merged.values()], cash: Math.round(cash * 100) / 100, skipped };
}

// --- Action plan -------------------------------------------------------------

// Broad funds are allowed to be a big part of a portfolio; single stocks are not.
export const BROAD_FUNDS = new Set(['VOO', 'VTI', 'SPY', 'IVV', 'QQQ', 'QQQM', 'VXUS', 'VT', 'BND', 'AGG', 'SCHB', 'SCHX', 'SCHD', 'ITOT', 'SPLG', 'VUG', 'VTV', 'VIG', 'VYM', 'IXUS', 'VEA', 'VWO', 'IEFA', 'RSP', 'FXAIX', 'FSKAX', 'SWPPX', 'VTSAX', 'VFIAX', 'VTIAX', 'VBTLX']);

const sectorOf = (s) => (BROAD_FUNDS.has(s) ? 'Index funds' : UNIVERSE.find((u) => u.symbol === s)?.sector || 'Other');

export const ACTIONS = {
  sell: { label: 'Sell all', tone: 'down', order: 0 },
  trim: { label: 'Trim', tone: 'down', order: 1 },
  rebalance: { label: 'Rebalance', tone: 'flat', order: 2 },
  profit: { label: 'Take profit', tone: 'flat', order: 3 },
  add: { label: 'Buy more', tone: 'up', order: 4 },
  hold: { label: 'Hold', tone: 'flat', order: 5 },
  unknown: { label: 'No data', tone: 'flat', order: 6 },
};

/**
 * holdings: [{symbol, shares, avgCost}]
 * analyses: {SYMBOL: analysis from analyze()}
 * profile:  RISK_PROFILES entry
 */
export function planPortfolio({ holdings, cash = 0, analyses, profile, fractional = false }) {
  const floorSh = fractional ? (x) => Math.floor(x * 1000) / 1000 : Math.floor;
  const priced = holdings.map((h) => {
    const a = analyses[h.symbol];
    const price = a?.price ?? h.avgCost ?? 0;
    return { ...h, a, price, value: h.shares * price };
  });
  const invested = priced.reduce((s, h) => s + h.value, 0);
  const total = invested + cash;
  const costKnown = priced.filter((h) => h.avgCost != null && h.a);
  const costBasis = costKnown.reduce((s, h) => s + h.avgCost * h.shares, 0);
  const plTotal = costKnown.reduce((s, h) => s + (h.price - h.avgCost) * h.shares, 0);
  const maxPos = profile.maxPosition;

  const rows = priced.map((h) => {
    const row = {
      ...h,
      weight: total ? h.value / total : 0,
      pl: h.a && h.avgCost != null ? (h.price - h.avgCost) * h.shares : null,
      plPct: h.a && h.avgCost ? (h.price - h.avgCost) / h.avgCost : null,
      broad: BROAD_FUNDS.has(h.symbol),
      sector: sectorOf(h.symbol),
    };
    row.action = decide(row, total, maxPos, floorSh);
    return row;
  });

  // Money freed by sells/trims, plus spare cash above the reserve, funds the "buy more" list.
  const reserve = total * profile.alloc.cash;
  const proceeds = rows.reduce((s, r) => s + (['sell', 'trim', 'rebalance', 'profit'].includes(r.action.type) ? r.action.shares * r.price : 0), 0);
  let spendable = Math.max(0, cash + proceeds - reserve);
  const adds = rows.filter((r) => r.action.type === 'add')
    .sort((x, y) => (y.a.longTerm.score + y.a.shortTerm.score) - (x.a.longTerm.score + x.a.shortTerm.score));
  for (const r of adds) {
    const room = r.broad ? spendable : Math.max(0, total * maxPos - r.value);
    const sh = floorSh(Math.min(room, spendable) / r.price);
    if (sh > 0) {
      r.action.shares = sh;
      r.action.text = `Buy ${fmtSh(sh)} more shares (about $${Math.round(sh * r.price).toLocaleString('en-US')}). ${r.action.text}`;
      spendable -= sh * r.price;
    } else {
      r.action = { ...r.action, type: 'hold', text: `Strong on both timeframes, but there's no spare cash to add right now. ${r.action.text}` };
    }
  }
  const spent = rows.reduce((s, r) => s + (r.action.type === 'add' ? r.action.shares * r.price : 0), 0);
  const cashAfter = cash + proceeds - spent;

  rows.sort((x, y) => ACTIONS[x.action.type].order - ACTIONS[y.action.type].order || y.value - x.value);
  return {
    total, invested, cash, costBasis, plTotal,
    plPct: costBasis ? plTotal / costBasis : null,
    rows,
    proceeds, spent, cashAfter, reserve,
    warnings: warnings(rows, total, cash, reserve, maxPos),
  };
}

const fmtSh = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(3));
const usd = (n) => `$${n.toFixed(2)}`;

function decide(r, total, maxPos, floorSh) {
  const a = r.a;
  if (!a) return { type: 'unknown', shares: 0, text: 'No price data for this symbol, so no recommendation.' };
  const st = a.shortTerm.score, lt = a.longTerm.score;
  const stop = lt >= 43 ? a.ltPlan.exitBelow : a.plan.stop;

  // Broad index funds are the long-term core: never dumped on chart signals.
  if (r.broad) {
    if (lt >= 58 && st >= 58) return { type: 'add', shares: 0, stop: null, text: 'Core index fund in a healthy uptrend.' };
    return { type: 'hold', shares: 0, stop: null, text: lt < 43
      ? 'Broad index funds are long-term holdings. The market is in a downtrend, but selling now usually locks in losses. Keep it and keep adding a fixed amount each month.'
      : 'Core long-term holding. Keep it and keep adding a fixed amount each month.' };
  }

  if (lt < 30 && st < 43) {
    return { type: 'sell', shares: r.shares, stop: null, text: `Long-term trend is broken (score ${lt}) and short-term momentum is also negative (${st}). Free up this money for stronger holdings.` };
  }
  if (lt < 43) {
    let sh = floorSh(r.shares / 2);
    if (sh === 0) sh = r.shares;
    return { type: 'trim', shares: sh, stop: a.plan.stop, text: `Long-term trend is weak (score ${lt}). Sell about half to cut risk, and sell the rest if it closes below ${usd(a.plan.stop)}.` };
  }
  if (!r.broad && r.weight > maxPos * 1.5) {
    const sh = floorSh((r.value - total * maxPos) / r.price);
    if (sh > 0) return { type: 'rebalance', shares: sh, stop, text: `This one stock is ${(r.weight * 100).toFixed(0)}% of your portfolio. Selling ${fmtSh(sh)} shares brings it back to ${(maxPos * 100).toFixed(0)}%, so one bad day can't sink you.` };
  }
  if (r.plPct != null && r.plPct > 0.3 && a.rsi > 75) {
    const sh = floorSh(r.shares / 4);
    if (sh > 0) return { type: 'profit', shares: sh, stop, text: `You're up ${(r.plPct * 100).toFixed(0)}% and it looks overheated (RSI ${a.rsi.toFixed(0)}). Lock in some gains by selling about a quarter. Keep the rest while the trend holds.` };
  }
  if (lt >= 58 && st >= 58 && (r.broad || r.weight < maxPos)) {
    return { type: 'add', shares: 0, stop, text: `Strong on both timeframes (long ${lt}, short ${st}).` };
  }
  const why = lt >= 58 ? `Long-term trend is healthy (score ${lt})` : `Signals are mixed (long ${lt}, short ${st})`;
  return { type: 'hold', shares: 0, stop, text: `${why}. Keep it, and sell if it closes below ${usd(stop)}.` };
}

function warnings(rows, total, cash, reserve, maxPos) {
  const w = [];
  if (!total) return w;
  const bySector = {};
  for (const r of rows) if (!r.broad) bySector[r.sector] = (bySector[r.sector] || 0) + r.value;
  for (const [sector, v] of Object.entries(bySector)) {
    if (sector !== 'Other' && v / total > 0.4) w.push(`${(v / total * 100).toFixed(0)}% of your money is in ${sector} stocks. If that sector has a bad year, your whole portfolio does too.`);
  }
  const singles = rows.filter((r) => !r.broad);
  if (!rows.some((r) => r.broad) && singles.length < 8) w.push(`You hold ${singles.length} individual stock${singles.length === 1 ? '' : 's'} and no broad index fund. Consider a core fund like VOO or VTI for diversification.`);
  if (cash / total > 0.3) w.push(`${(cash / total * 100).toFixed(0)}% of your account is sitting in cash. That's fine if you need it soon. Otherwise the Money Planner can show where to put it.`);
  if (cash < reserve * 0.5) w.push('Your cash cushion is thin. Keeping some cash lets you buy dips without selling something else.');
  for (const r of rows) {
    if (r.plPct != null && r.plPct < -0.25 && !['sell', 'trim'].includes(r.action.type)) w.push(`${r.symbol} is down ${(-r.plPct * 100).toFixed(0)}% from what you paid. Make sure you'd still buy it today. If not, a loss can offset taxes on gains.`);
  }
  if (rows.some((r) => !r.broad && r.weight > maxPos * 1.5) && !rows.some((r) => r.action.type === 'rebalance')) {
    w.push(`At least one stock is over ${(maxPos * 150).toFixed(0)}% of your portfolio.`);
  }
  return w;
}
