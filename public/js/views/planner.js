import { getScan, settings, saveSettings, money, pct, shares, esc, badge, demoNotice } from '../api.js';
import { STOCKS } from '../lib/universe.js';
import { allocate, buyList, positionSize, CORE_ETFS, RISK_PROFILES } from '../lib/sizing.js';

const BUCKETS = {
  cash: { label: 'Cash reserve', desc: 'Dry powder for dips and emergencies. Not invested.' },
  core: { label: 'Core index funds', desc: 'Low-cost ETFs that own hundreds of companies. The foundation.' },
  picks: { label: 'Long-term stock picks', desc: 'Individual stocks in strong long-term uptrends, bought in stages.' },
  trading: { label: 'Short-term trading', desc: 'Swing trades with strict stop-losses. Highest risk.' },
};

export function renderPlanner(app) {
  const s = settings();
  app.innerHTML = `
    <section class="page-head">
      <h1>Money Planner</h1>
      <p class="lede">Tell us how much you have and how you like to invest. We'll split it into buckets and give you an exact shopping list: what to buy, how many shares, and what to keep in cash.</p>
    </section>
    <form class="card form planner-form" id="plan-form">
      <label>How much money?<div class="input-prefix"><span>$</span><input type="number" name="amount" min="50" step="any" value="${s.account}" required></div></label>
      <label>Risk style<select name="profile">${Object.entries(RISK_PROFILES).map(([k, p]) => `<option value="${k}" ${k === s.profile ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
      <label>Main goal<select name="horizon">
        <option value="long">Long-term growth (years)</option>
        <option value="mixed" selected>Mix of both</option>
        <option value="short">Short-term gains (weeks–months)</option>
      </select></label>
      <label class="check"><input type="checkbox" name="fractional" ${s.fractional ? 'checked' : ''}> Fractional shares</label>
      <button class="btn" type="submit">Build my plan</button>
    </form>
    <div id="plan-out"></div>`;

  const form = app.querySelector('#plan-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const amount = Number(f.amount);
    const fractional = f.fractional === 'on';
    saveSettings({ account: amount, profile: f.profile, fractional });
    const out = app.querySelector('#plan-out');
    out.innerHTML = '<div class="loading">Pricing your plan…</div>';
    const etfs = CORE_ETFS[f.profile];
    const items = await getScan();
    out.innerHTML = buildPlan({ amount, profile: f.profile, horizon: f.horizon, fractional, items, etfs });
  });
  form.requestSubmit();
}

function buildPlan({ amount, profile, horizon, fractional, items, etfs }) {
  const prof = RISK_PROFILES[profile];
  const alloc = allocate(amount, profile, horizon);
  const bySym = Object.fromEntries(items.map((i) => [i.symbol, i]));
  const stocks = items.filter((i) => STOCKS.some((s) => s.symbol === i.symbol));
  let leftover = alloc.cash.dollars;

  // Core ETFs
  const core = buyList(alloc.core.dollars, etfs.filter((e) => bySym[e.symbol]).map((e) => ({ ...e, price: bySym[e.symbol].analysis.price })), fractional);
  leftover += core.leftover;

  // Long-term picks: best long-term scores, equally weighted. Fewer picks for small accounts.
  const nPicks = alloc.picks.dollars < 1500 ? 2 : alloc.picks.dollars < 10000 ? 3 : 5;
  // Best long-term scores, at most one per sector so the picks are diversified.
  const ltTop = [];
  for (const i of [...stocks].filter((x) => x.analysis.longTerm.score >= 58).sort((a, b) => b.analysis.longTerm.score - a.analysis.longTerm.score)) {
    if (ltTop.length < nPicks && !ltTop.some((p) => p.sector === i.sector)) ltTop.push(i);
  }
  const picks = ltTop.length
    ? buyList(alloc.picks.dollars, ltTop.map((i) => ({ symbol: i.symbol, name: i.name, weight: 1 / ltTop.length, price: i.analysis.price, rating: i.analysis.longTerm, add: i.analysis.ltPlan.tranches[1].price })), fractional)
    : { rows: [], leftover: alloc.picks.dollars };
  leftover += picks.leftover;

  // Swing trades: sized by risk, each limited to half the trading bucket.
  const stTop = [...stocks].filter((i) => i.analysis.shortTerm.score >= 58).sort((a, b) => b.analysis.shortTerm.score - a.analysis.shortTerm.score).slice(0, 2);
  let tradingLeft = alloc.trading.dollars;
  const trades = stTop.map((i) => {
    const a = i.analysis;
    const pos = positionSize({ account: amount, riskPct: prof.riskPerTrade, entry: a.plan.entry, stop: a.plan.stop, maxPositionPct: Math.min(prof.maxPosition, alloc.trading.dollars / 2 / amount), fractional });
    const ok = pos && !pos.error && pos.shares > 0 && pos.cost <= tradingLeft + 0.01;
    if (ok) tradingLeft -= pos.cost;
    return { i, a, pos: ok ? pos : null };
  }).filter((t) => t.pos);
  leftover += tradingLeft;

  const totalInvested = amount - leftover;
  const bar = Object.entries(alloc).map(([k, v]) => `<span class="seg-${k}" style="width:${v.weight * 100}%" title="${BUCKETS[k].label} ${pct(v.weight, 0)}"></span>`).join('');

  return `
    ${demoNotice(items)}
    <section class="card">
      <h2>Your split</h2>
      <div class="alloc-bar">${bar}</div>
      <div class="alloc-legend">${Object.entries(alloc).map(([k, v]) => `
        <div class="alloc-item"><span class="dot seg-${k}"></span><div><strong>${BUCKETS[k].label}</strong> · ${pct(v.weight, 0)} · ${money(v.dollars, 0)}<div class="muted small">${BUCKETS[k].desc}</div></div></div>`).join('')}</div>
    </section>

    <section class="card">
      <h2>1. Core index funds <span class="muted small">${money(alloc.core.dollars, 0)}</span></h2>
      <p class="muted">Buy these first. They give you the whole market for almost no fees. Add to them every month.</p>
      ${table(core.rows.map((r) => [`<strong>${esc(r.symbol)}</strong><div class="sub">${esc(r.name)}</div>`, pct(r.weight, 0), money(r.price), shares(r.shares), money(r.cost)]), ['Fund', 'Weight', 'Price', 'Shares', 'Cost'])}
    </section>

    <section class="card">
      <h2>2. Long-term picks <span class="muted small">${money(alloc.picks.dollars, 0)}</span></h2>
      ${picks.rows.length ? `<p class="muted">The strongest long-term trends today, one per sector so you're not all-in on one industry. The share counts are your <strong>full target position</strong>: buy about 40% now and the rest on pullbacks near the "add more" price. Hold while they stay above their 200-day average.</p>
      ${table(picks.rows.map((r) => [`<a href="#/stock/${encodeURIComponent(r.symbol)}"><strong>${esc(r.symbol)}</strong></a><div class="sub">${esc(r.name)}</div>`, badge(r.rating), money(r.price), shares(r.shares), money(r.cost), money(r.add)]), ['Stock', 'Rating', 'Price', 'Shares', 'Cost', 'Add more near'])}`
        : '<p>No stocks pass the long-term filter right now, so this money goes to cash or extra index funds until something qualifies.</p>'}
    </section>

    <section class="card">
      <h2>3. Short-term trades <span class="muted small">${money(alloc.trading.dollars, 0)}</span></h2>
      ${trades.length ? `<p class="muted">Each trade risks only ${pct(prof.riskPerTrade, 1)} of your money (${money(amount * prof.riskPerTrade)}). Set the stop-loss order <strong>at the same time</strong> you buy.</p>
      ${table(trades.map(({ i, a, pos }) => [`<a href="#/stock/${encodeURIComponent(i.symbol)}"><strong>${esc(i.symbol)}</strong></a>`, badge(a.shortTerm), shares(pos.shares), money(pos.cost), `<span class="down">${money(a.plan.stop)}</span>`, `<span class="up">${money(a.plan.targets[0])}</span>`, `<span class="down">${money(pos.dollarsAtRisk)}</span>`]), ['Stock', 'Signal', 'Shares', 'Cost', 'Stop', 'Target 1', 'Max loss'])}`
        : '<p>No short-term setups fit your budget and risk rules right now. Keep this money in cash. Not trading is a position too.</p>'}
    </section>

    <section class="card summary">
      <div class="big-stats">
        <div><span class="label">Invested</span><span class="value">${money(totalInvested, 0)}</span></div>
        <div><span class="label">Kept in cash</span><span class="value">${money(leftover, 0)}</span><span class="sub">reserve + leftovers</span></div>
        <div><span class="label">Positions</span><span class="value">${core.rows.filter((r) => r.shares > 0).length + picks.rows.filter((r) => r.shares > 0).length + trades.length}</span></div>
      </div>
      <h3>Habits that matter more than picks</h3>
      <ul class="bullets">
        <li>Keep 3–6 months of expenses in savings <em>before</em> investing, and pay off high-interest debt first.</li>
        <li>Invest a fixed amount every month (dollar-cost averaging). It removes the pressure of timing.</li>
        <li>Revisit this plan once a month. Re-run it with your new total and rebalance if a bucket drifts more than 5%.</li>
        <li>Use tax-advantaged accounts (401k, IRA / Roth IRA) for the long-term buckets when you can.</li>
      </ul>
    </section>`;
}

function table(rows, head) {
  return `<div class="table-wrap"><table class="table compact"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
