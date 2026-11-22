// The "big-investor playbook": well-known rules from famous traders and investors, turned into
// yes/no checks the AutoPilot bot can use as filters. Each one can be tested on past days
// (Test / Train on the AutoPilot page) so you can see whether it actually helps right now.
//
// Price-based checks use only what was known at the previous close. "Smart money" checks use
// SEC filings: famous funds' quarterly 13F holdings and company insiders' open-market purchases
// (Form 4), each counted only from the day it was filed.

import { sma } from './indicators.js';

export const TIPS = [
  { key: 'above200', bit: 1, who: 'Paul Tudor Jones', title: 'Only stocks above their 200-day average',
    idea: 'One of the most successful macro traders says the 200-day moving average is the line he judges everything by: above it, the long-term trend is up. Below it, he plays defense.' },
  { key: 'trend', bit: 2, who: 'Mark Minervini', title: 'Trend Template: stocks in a strong uptrend',
    idea: 'From the U.S. Investing Champion\'s rules: price above the 50-, 150- and 200-day averages (stacked in that order), the 200-day rising, at least 25% above the 52-week low and within 25% of the 52-week high.' },
  { key: 'leader', bit: 4, who: 'William O\'Neil', title: 'Market leaders only (top 30% strength)',
    idea: 'CAN SLIM\'s "L": buy the leaders, not the laggards. Only stocks whose last 3 months beat at least 70% of the other stocks.' },
  { key: 'market', bit: 32, who: 'William O\'Neil', title: 'Only when the market is in an uptrend',
    idea: 'CAN SLIM\'s "M": three out of four stocks follow the market. Only trade when the S&P 500 is above its 50-day average.' },
  { key: 'nearHigh', bit: 16, who: 'Jesse Livermore', title: 'Stocks near new highs',
    idea: 'The legendary speculator bought strength at new highs, not bargains. Only stocks within 5% of their 52-week high.' },
  { key: 'nr7', bit: 8, who: 'Toby Crabel', title: 'Quiet day before the breakout (NR7)',
    idea: 'Crabel, who wrote the book on opening-range breakouts, found that a day with the narrowest range of the last 7 is often followed by a big move. Only stocks coming off an NR7 day.' },
  { key: 'funds', bit: 64, who: 'Mohnish Pabrai', title: 'Held by famous investors (13F)',
    idea: 'Pabrai openly "clones" the best investors\' picks. Only stocks owned by at least one of the famous funds StockWise tracks (Berkshire Hathaway, Pershing Square, Duquesne and others), per their latest SEC 13F filing.' },
  { key: 'insider', bit: 128, who: 'Peter Lynch', title: 'Insiders have been buying',
    idea: '"Insiders might sell their shares for any number of reasons, but they buy them for only one: they think the price will rise." Only stocks where an executive or director bought shares on the open market in the last 90 days (SEC Form 4).' },
  { key: 'congress', bit: 256, who: 'Members of Congress', title: 'Congress has been buying',
    idea: 'Only stocks a member of the U.S. House disclosed buying in the last 60 days (STOCK Act reports). Members have up to 45 days to report, so this is always late. Train shows whether it has helped anyway.' },
  { key: 'noGap', bit: 0, who: 'Common day-trading rule', title: 'Skip big opening gaps',
    idea: 'A stock that opens more than 4% away from yesterday\'s close has already made much of its move. Gaps are often faded. Skip it for the day.' },
];
export const TIP = Object.fromEntries(TIPS.map((t) => [t.key, t]));

// Daily context for the playbook checks on one stock's candles.
export function playbookContext(c, bench) {
  const closes = c.map((x) => x.close);
  const benchClose = new Map();
  let benchUp = new Map();
  if (bench) {
    const bc = bench.map((x) => x.close);
    const s50 = sma(bc, 50);
    bench.forEach((x, i) => {
      const day = new Date(x.t).toISOString().slice(0, 10);
      benchClose.set(day, { i, close: x.close, ret63: i >= 63 ? x.close / bc[i - 63] - 1 : 0 });
      if (s50[i] != null) benchUp.set(day, x.close > s50[i]);
    });
  }
  return { s50: sma(closes, 50), s150: sma(closes, 150), s200: sma(closes, 200), benchClose, benchUp };
}

/**
 * Price-based playbook bits for candle i (known at its close). ret63 is returned separately
 * because "leader" needs every stock's return that day (see markLeaders).
 */
export function playbookAt(c, i, pctx) {
  const d = c[i];
  const { s50, s150, s200 } = pctx;
  let bits = 0;
  if (s200[i] != null && d.close > s200[i]) bits |= 1;
  if (i >= 252 && s200[i] != null && s200[i - 20] != null) {
    const yr = c.slice(i - 251, i + 1);
    const hi = Math.max(...yr.map((x) => x.high)), lo = Math.min(...yr.map((x) => x.low));
    if (d.close > s50[i] && s50[i] > s150[i] && s150[i] > s200[i] && s200[i] > s200[i - 20] && d.close >= 1.25 * lo && d.close >= 0.75 * hi) bits |= 2;
    if (d.close >= 0.95 * hi) bits |= 16;
  } else if (i >= 60) {
    const hi = Math.max(...c.slice(Math.max(0, i - 251), i + 1).map((x) => x.high));
    if (d.close >= 0.95 * hi) bits |= 16;
  }
  if (i >= 7) {
    const ranges = c.slice(i - 6, i + 1).map((x) => x.high - x.low);
    if (ranges[6] <= Math.min(...ranges)) bits |= 8;
  }
  const day = new Date(d.t).toISOString().slice(0, 10);
  if (pctx.benchUp.get(day)) bits |= 32;
  const ret63 = i >= 63 ? d.close / c[i - 63].close - 1 : null;
  return { bits, ret63 };
}

// Sets the "leader" bit on the top 30% of records by 3-month return. records: [{ ret63, flags }].
export function markLeaders(records) {
  const rets = records.map((r) => r.ret63).filter((v) => v != null).sort((a, b) => a - b);
  if (rets.length < 5) return records;
  const cut = rets[Math.floor(rets.length * 0.7)];
  for (const r of records) if (r.ret63 != null && r.ret63 >= cut) r.flags |= 4;
  return records;
}

// Smart-money bits for a symbol on a day, from data/smartmoney.json's timelines (no peeking ahead).
export function smartBits(smart, symbol, day) {
  if (!smart) return 0;
  let bits = 0;
  const holders = smart.holdings?.[symbol];
  if (holders?.some(([filed, until]) => filed < day && (!until || day <= until))) bits |= 64;
  const buys = smart.insiderBuys?.[symbol];
  if (buys?.some((filed) => filed < day && daysBetween(filed, day) <= 90)) bits |= 128;
  const congress = smart.congressBuys?.[symbol];
  if (congress?.some((filed) => filed < day && daysBetween(filed, day) <= 60)) bits |= 256;
  return bits;
}
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

// Does a stock pass every enabled tip? (noGap is checked at the open, by the engine.)
export function passesTips(flags, tips) {
  for (const k of tips || []) {
    const t = TIP[k];
    if (t?.bit && !((flags ?? 0) & t.bit)) return false;
  }
  return true;
}

export const tipNames = (tips) => (tips || []).map((k) => TIP[k]?.who).filter(Boolean);
