// Money management: how much to buy, how much to sell, and how to split an account.

export const RISK_PROFILES = {
  conservative: { label: 'Conservative', riskPerTrade: 0.005, maxPosition: 0.10, alloc: { cash: 0.15, core: 0.65, picks: 0.15, trading: 0.05 } },
  moderate: { label: 'Moderate', riskPerTrade: 0.01, maxPosition: 0.15, alloc: { cash: 0.10, core: 0.50, picks: 0.30, trading: 0.10 } },
  aggressive: { label: 'Aggressive', riskPerTrade: 0.02, maxPosition: 0.25, alloc: { cash: 0.05, core: 0.35, picks: 0.40, trading: 0.20 } },
};

// Fixed-fractional sizing: lose at most `riskPct` of the account if the stop is hit,
// and never put more than `maxPositionPct` of the account into a single stock.
export function positionSize({ account, riskPct, entry, stop, maxPositionPct = 0.25, fractional = false }) {
  if (!(account > 0) || !(entry > 0)) return null;
  if (!(stop > 0) || stop >= entry) return { error: 'Stop-loss must be below the entry price for a buy.' };
  const riskPerShare = entry - stop;
  const riskBudget = account * riskPct;
  const byRisk = riskBudget / riskPerShare;
  const byCap = (account * maxPositionPct) / entry;
  const round = fractional ? (x) => Math.floor(x * 1000) / 1000 : Math.floor;
  const shares = Math.max(0, round(Math.min(byRisk, byCap)));
  const cost = shares * entry;
  return {
    shares,
    cost,
    riskPerShare,
    riskBudget,
    dollarsAtRisk: shares * riskPerShare,
    pctOfAccount: cost / account,
    limitedBy: byCap < byRisk ? 'position cap' : 'risk',
    tooExpensive: shares === 0,
  };
}

// Scale out of a position: sell a third at each target and trail the rest.
export function sellPlan(shares, entry, stop, targets, fractional = false) {
  const round = fractional ? (x) => Math.floor(x * 1000) / 1000 : Math.floor;
  const first = round(shares / 3);
  const second = round(shares / 3);
  const rest = +(shares - first - second).toFixed(3);
  const steps = [
    { when: `Price reaches ${targets[0].toFixed(2)} (Target 1)`, sell: first, price: targets[0], then: `Move stop up to break-even (${entry.toFixed(2)})` },
    { when: `Price reaches ${targets[1].toFixed(2)} (Target 2)`, sell: second, price: targets[1], then: `Move stop up to Target 1 (${targets[0].toFixed(2)})` },
    { when: `Price reaches ${targets[2].toFixed(2)} or the trailing stop is hit`, sell: rest, price: targets[2], then: 'Trade complete' },
  ].filter((s) => s.sell > 0);
  const profit = steps.reduce((p, s) => p + s.sell * (s.price - entry), 0);
  return { steps, stopLoss: stop, maxLoss: shares * (entry - stop), profitIfAllTargets: profit };
}

const HORIZON_SHIFT = { short: { core: -0.15, trading: 0.15 }, mixed: {}, long: { core: 0.1, trading: -0.1 } };

// Split an amount of money into buckets based on risk tolerance and time horizon.
export function allocate(amount, profileKey, horizon) {
  const p = RISK_PROFILES[profileKey];
  const a = { ...p.alloc };
  for (const [k, d] of Object.entries(HORIZON_SHIFT[horizon] || {})) a[k] = Math.max(0, a[k] + d);
  const total = Object.values(a).reduce((x, y) => x + y, 0);
  for (const k of Object.keys(a)) a[k] /= total;
  return Object.fromEntries(Object.entries(a).map(([k, w]) => [k, { weight: w, dollars: amount * w }]));
}

export const CORE_ETFS = {
  conservative: [{ symbol: 'VOO', name: 'S&P 500 index', weight: 0.5 }, { symbol: 'BND', name: 'Total US bond market', weight: 0.35 }, { symbol: 'VXUS', name: 'International stocks', weight: 0.15 }],
  moderate: [{ symbol: 'VOO', name: 'S&P 500 index', weight: 0.6 }, { symbol: 'QQQ', name: 'Nasdaq-100 index', weight: 0.2 }, { symbol: 'VXUS', name: 'International stocks', weight: 0.1 }, { symbol: 'BND', name: 'Total US bond market', weight: 0.1 }],
  aggressive: [{ symbol: 'VOO', name: 'S&P 500 index', weight: 0.5 }, { symbol: 'QQQ', name: 'Nasdaq-100 index', weight: 0.4 }, { symbol: 'VXUS', name: 'International stocks', weight: 0.1 }],
};

// Split a dollar amount across priced holdings, buying whole (or fractional) shares.
export function buyList(dollars, holdings, fractional = false) {
  let leftover = dollars;
  const rows = holdings.map((h) => {
    const budget = dollars * h.weight;
    const shares = h.price > 0 ? (fractional ? Math.floor((budget / h.price) * 1000) / 1000 : Math.floor(budget / h.price)) : 0;
    const cost = shares * h.price;
    leftover -= cost;
    return { ...h, budget, shares, cost };
  });
  return { rows, leftover };
}
