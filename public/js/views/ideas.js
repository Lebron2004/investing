import { getScan, settings, money, pct, shares, toneOf, esc, badge, scoreBar, demoNotice, gradeChips } from '../api.js';
import { SECTORS, STOCKS } from '../lib/universe.js';
import { positionSize, RISK_PROFILES } from '../lib/sizing.js';
import { rate } from '../lib/analysis.js';

// Remembered while you move around the site.
const state = { tab: 'short', sector: 'all', setup: 'all', sort: 'score', dir: -1, showAll: false };
const ROWS = 25;

const SETUPS = [
  ['breakout', 'Breakout', 'Pushing above recent highs on heavy volume'],
  ['pullback', 'Pullback', 'Dipped to support inside an uptrend'],
  ['bounce', 'Oversold bounce', 'Sold off hard and turning back up'],
  ['momentum', 'Momentum', 'Steady strength above key averages'],
];

const f = (d) => d.analysis.fundamentals || {};
const scoreKey = () => (state.tab === 'short' ? 'shortTerm' : 'longTerm');
const pctCell = (v, d = 1) => `<span class="${toneOf(v)}">${pct(v, d, true)}</span>`;
const COMMON = {
  symbol: { key: 'symbol', label: 'Stock', get: (d) => d.symbol, render: (d) => `<strong>${esc(d.symbol)}</strong><div class="sub">${esc(d.name)}</div>` },
  sector: { key: 'sector', label: 'Sector', get: (d) => d.sector, render: (d) => `<span class="small muted">${esc(d.sector)}</span>`, onlyAll: true },
  price: { key: 'price', label: 'Price', num: true, get: (d) => d.analysis.price, render: (d) => money(d.analysis.price) },
  score: { key: 'score', label: 'Score', num: true, get: (d) => d.analysis[scoreKey()].score, render: (d) => `<strong>${d.analysis[scoreKey()].score}</strong>` },
};
const COLUMNS = {
  short: [
    COMMON.symbol, COMMON.sector, COMMON.price,
    { key: 'day', label: 'Day', num: true, get: (d) => d.analysis.changePct, render: (d) => pctCell(d.analysis.changePct) },
    { key: 'm1', label: '1 mo', num: true, get: (d) => d.analysis.oneMonth, render: (d) => pctCell(d.analysis.oneMonth) },
    { key: 'rs', label: 'vs S&P', num: true, get: (d) => d.analysis.rs3m, render: (d) => pctCell(d.analysis.rs3m) },
    { key: 'setup', label: 'Setup', get: (d) => d.analysis.shortTerm.setup?.label || '', render: (d) => (d.analysis.shortTerm.setup ? `<span class="setup-tag setup-${d.analysis.shortTerm.setup.key}">${esc(d.analysis.shortTerm.setup.label)}</span>` : '<span class="muted small">—</span>') },
    COMMON.score,
  ],
  long: [
    COMMON.symbol, COMMON.sector, COMMON.price,
    { key: 'y1', label: '1 yr', num: true, get: (d) => d.analysis.longTerm.oneYear, render: (d) => pctCell(d.analysis.longTerm.oneYear, 0) },
    { key: 'pe', label: 'P/E', num: true, get: (d) => f(d).forwardPE ?? f(d).trailingPE, render: (d) => { const pe = f(d).forwardPE ?? f(d).trailingPE; return pe ? `${pe.toFixed(1)}×` : '—'; } },
    { key: 'growth', label: 'Sales growth', num: true, get: (d) => f(d).revenueGrowth, render: (d) => (f(d).revenueGrowth != null ? pctCell(f(d).revenueGrowth, 0) : '—') },
    { key: 'upside', label: 'Analyst upside', num: true, get: (d) => d.analysis.longTerm.upside, render: (d) => (d.analysis.longTerm.upside != null ? pctCell(d.analysis.longTerm.upside, 0) : '—') },
    { key: 'div', label: 'Dividend', num: true, get: (d) => f(d).dividendYield, render: (d) => (f(d).dividendYield ? pct(f(d).dividendYield, 1) : '—') },
    COMMON.score,
  ],
};

export async function renderIdeas(app) {
  app.innerHTML = `
    <section class="page-head">
      <h1>Top Ideas</h1>
      <p class="lede">We scan ${STOCKS.length} large US stocks across all 11 market sectors and rank them. <strong>Short-term</strong> looks for momentum you can trade over days to weeks. <strong>Long-term</strong> looks for steady, durable uptrends worth holding for months or years.</p>
    </section>
    <div class="seg big" id="tabs"><button data-tab="short">Short-term buys</button><button data-tab="long">Long-term buys</button></div>
    <p class="muted small tab-explain" id="tab-explain"></p>
    <div id="ideas-body"><div class="loading">Scanning the market…</div></div>`;

  const items = await getScan();
  const stocks = items.filter((i) => i.sector !== 'ETF');
  const bySym = Object.fromEntries(items.map((i) => [i.symbol, i]));
  const body = app.querySelector('#ideas-body');
  const tabs = app.querySelector('#tabs');

  const draw = () => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    app.querySelector('#tab-explain').innerHTML = state.tab === 'short'
      ? '<strong>Short-term buys</strong> are swing trades held for days to weeks. We look for a clear chart setup, strength vs. the S&amp;P 500, healthy momentum, and no earnings report about to hit. Every pick comes with a stop and targets.'
      : '<strong>Long-term buys</strong> are stocks to own for years. The score is half <em>price trend</em> and half <em>business quality</em>: profits, growth, valuation and what analysts expect. Buy in stages and hold while the trend stays healthy.';
    const key = scoreKey();
    const s = settings();
    const profile = RISK_PROFILES[s.profile];

    // --- sector strength ---
    const sectors = SECTORS.map((sec) => {
      const members = stocks.filter((x) => x.sector === sec.name);
      const avg = members.length ? Math.round(members.reduce((a, x) => a + x.analysis[key].score, 0) / members.length) : null;
      const etf = bySym[sec.etf];
      const score = etf ? etf.analysis[key].score : avg;
      return { ...sec, members, avg, etf, score, buys: members.filter((x) => x.analysis[key].score >= 58).length };
    }).filter((x) => x.score != null).sort((a, b) => b.score - a.score);

    let inView = state.sector === 'all' ? stocks : stocks.filter((x) => x.sector === state.sector);
    if (state.tab === 'short' && state.setup !== 'all') inView = inView.filter((x) => x.analysis.shortTerm.setup?.key === state.setup);
    const ranked = [...inView].sort((a, b) => b.analysis[key].score - a.analysis[key].score);
    const top = ranked.filter((x) => x.analysis[key].score >= 58).slice(0, 6);
    const sel = sectors.find((x) => x.name === state.sector);

    const tabCols = COLUMNS[state.tab];
    const col = tabCols.find((c) => c.key === state.sort) || tabCols.at(-1);
    const table = [...inView].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * state.dir;
    });
    const cols = tabCols.filter((c) => !c.onlyAll || state.sector === 'all');
    const setupCounts = Object.fromEntries(SETUPS.map(([k]) => [k, (state.sector === 'all' ? stocks : stocks.filter((x) => x.sector === state.sector)).filter((x) => x.analysis.shortTerm.setup?.key === k).length]));

    body.innerHTML = `
      ${demoNotice(items)}
      <section class="card">
        <div class="card-head"><h2>Sector strength <span class="muted small">${state.tab === 'short' ? 'short-term' : 'long-term'} score of each sector's ETF</span></h2></div>
        <p class="muted small">Money rotates between sectors. Stocks in strong sectors have the wind at their back. Click a sector to see its stocks.</p>
        <div class="sector-list" role="list">
          ${sectors.map((x) => `
            <button class="sector-row ${state.sector === x.name ? 'on' : ''}" data-sector="${esc(x.name)}" role="listitem"
              title="${esc(x.name)}: ${x.etf ? `${x.etf.symbol} score ${x.score}` : `average ${x.avg}`} · ${x.buys} of ${x.members.length} stocks rated Buy">
              <span class="sector-name">${esc(x.name)}<span class="sub">${x.buys}/${x.members.length} Buy${x.etf ? ` · ${esc(x.etf.symbol)}` : ''}</span></span>
              <span class="sector-bar">${scoreBar(x.score)}</span>
              ${badge(rate(x.score))}
              <span class="num sector-ret ${toneOf(x.etf?.analysis.oneMonth)}">${x.etf ? `${pct(x.etf.analysis.oneMonth, 1, true)}<span class="sub">1 mo</span>` : ''}</span>
            </button>`).join('')}
        </div>
      </section>

      <div class="chips" role="group" aria-label="Filter by sector">
        <button class="chip ${state.sector === 'all' ? 'on' : ''}" data-sector="all">All sectors <span>${stocks.length}</span></button>
        ${SECTORS.map((x) => `<button class="chip ${state.sector === x.name ? 'on' : ''}" data-sector="${esc(x.name)}">${esc(x.name)} <span>${stocks.filter((y) => y.sector === x.name).length}</span></button>`).join('')}
      </div>

      ${state.tab === 'short' ? `<div class="chips setups" role="group" aria-label="Filter by setup">
        <span class="chips-label">Setup:</span>
        <button class="chip ${state.setup === 'all' ? 'on' : ''}" data-setup="all">Any</button>
        ${SETUPS.map(([k, label, hint]) => `<button class="chip ${state.setup === k ? 'on' : ''}" data-setup="${k}" title="${esc(hint)}">${esc(label)} <span>${setupCounts[k]}</span></button>`).join('')}
      </div>` : ''}

      ${sel ? `<section class="card sector-intro">
        <div><h2>${esc(sel.name)}</h2><p class="muted">${esc(sel.blurb)}</p></div>
        ${sel.etf ? `<a class="sector-etf" href="#/stock/${encodeURIComponent(sel.etf.symbol)}">
          <span class="small muted">Buy the whole sector in one fund</span>
          <strong>${esc(sel.etf.symbol)}</strong> ${money(sel.etf.analysis.price)} ${badge(sel.etf.analysis[key])}</a>` : ''}
      </section>` : ''}

      <h2 class="section-title">Top ${state.tab === 'short' ? 'short-term' : 'long-term'} buys${sel ? ` in ${esc(sel.name)}` : ''}${state.tab === 'short' && state.setup !== 'all' ? ` · ${esc(SETUPS.find(([k]) => k === state.setup)[1])} setups` : ''}</h2>
      ${top.length ? `<div class="ideas-grid">${top.map((d) => card(d, key, s, profile)).join('')}</div>`
        : `<div class="card"><p>Nothing ${sel ? 'in this sector ' : ''}${state.tab === 'short' && state.setup !== 'all' ? 'with this setup ' : ''}scores a Buy right now. That's a signal too: when nothing qualifies, holding cash or broad index funds is often the best move.</p></div>`}

      <section class="card">
        <div class="card-head"><h2>All ${inView.length} ${sel ? esc(sel.name) : ''} stocks${state.tab === 'short' && state.setup !== 'all' ? ' with this setup' : ''}</h2><span class="muted small">Click a column to sort · click a row for the full analysis</span></div>
        <div class="table-wrap"><table class="table compact" id="rank-table">
          <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}"><button class="sort ${state.sort === c.key ? 'on' : ''}" data-sort="${c.key}" aria-label="Sort by ${c.label}">${c.label}${state.sort === c.key ? (state.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}<th>Rating</th></tr></thead>
          <tbody>${(state.showAll ? table : table.slice(0, ROWS)).map((d) => `<tr class="clickable" data-href="#/stock/${encodeURIComponent(d.symbol)}">
              ${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(d)}</td>`).join('')}
              <td>${badge(d.analysis[key])}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        ${table.length > ROWS ? `<button class="btn ghost small-btn show-all" data-showall>${state.showAll ? 'Show top 25' : `Show all ${table.length}`}</button>` : ''}
      </section>
      <p class="muted small">Scores are 0–100. Short-term uses the chart (trend, momentum, setup, strength vs. the S&amp;P 500) plus the earnings calendar. Long-term is half price trend, half business fundamentals. Neither reads the news. Always check the stock page and set your stop before buying.</p>`;
  };

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) {
      state.tab = b.dataset.tab;
      if (!COLUMNS[state.tab].some((c) => c.key === state.sort)) { state.sort = 'score'; state.dir = -1; }
      draw();
    }
  });
  body.addEventListener('click', (e) => {
    const sec = e.target.closest('[data-sector]');
    if (sec) {
      state.sector = state.sector === sec.dataset.sector && sec.classList.contains('sector-row') ? 'all' : sec.dataset.sector;
      if (state.sort === 'sector' && state.sector !== 'all') state.sort = 'score';
      draw();
      if (sec.classList.contains('sector-row')) body.querySelector('.chips').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('[data-showall]')) { state.showAll = !state.showAll; draw(); return; }
    const setup = e.target.closest('[data-setup]');
    if (setup) { state.setup = setup.dataset.setup; draw(); return; }
    const sort = e.target.closest('[data-sort]');
    if (sort) {
      const k = sort.dataset.sort;
      if (state.sort === k) state.dir *= -1;
      else { state.sort = k; state.dir = ['symbol', 'sector'].includes(k) ? 1 : -1; }
      draw();
      return;
    }
    const row = e.target.closest('tr[data-href]');
    if (row) location.hash = row.dataset.href;
  });
  draw();
}

function card(d, key, s, profile) {
  const a = d.analysis, r = a[key];
  let detail, sizing;
  if (key === 'shortTerm') {
    const st = r.setup;
    detail = `<div class="idea-meta">${st ? `<span class="setup-tag setup-${st.key}">${esc(st.label)}</span>` : '<span class="setup-tag">No setup</span>'}
      <span class="small muted">Hold ${esc(r.hold)}</span>
      ${a.rs3m != null ? `<span class="small ${toneOf(a.rs3m)}">${pct(a.rs3m, 0, true)} vs S&amp;P</span>` : ''}</div>
      ${a.daysToEarnings != null && a.daysToEarnings <= 7 ? `<div class="small down">⚠ Earnings in ${a.daysToEarnings} days</div>` : ''}`;
    const pos = positionSize({ account: s.account, riskPct: profile.riskPerTrade, entry: a.plan.entry, stop: a.plan.stop, maxPositionPct: profile.maxPosition, fractional: s.fractional });
    sizing = pos && !pos.error && pos.shares > 0
      ? `<div class="idea-plan"><span>Buy <strong>${shares(pos.shares)}</strong> sh ≈ ${money(pos.cost, 0)}</span><span>Stop <strong class="down">${money(a.plan.stop)}</strong></span><span>Target <strong class="up">${money(a.plan.targets[0])}</strong></span></div>`
      : '<div class="idea-plan muted">Too expensive for your risk settings</div>';
  } else {
    detail = r.grades
      ? `${gradeChips(r.grades).replace('class="grades"', 'class="grades compact"')}<div class="small muted">Trend ${r.trendScore} · Business ${r.fundScore}${r.upside != null ? ` · analysts see <span class="${toneOf(r.upside)}">${pct(r.upside, 0, true)}</span>` : ''}</div>`
      : '<div class="small muted">Price trend only (no company data)</div>';
    const budget = s.account * profile.maxPosition;
    const sh = s.fractional ? Math.floor((budget * 0.4 / a.price) * 1000) / 1000 : Math.floor(budget * 0.4 / a.price);
    const start = sh > 0 ? `<span>Start with <strong>${shares(sh)}</strong> sh now</span>` : `<span class="muted">1 share is over your first-stage budget (${money(budget * 0.4, 0)}). Turn on fractional shares or wait</span>`;
    sizing = `<div class="idea-plan">${start}<span>Add near <strong>${money(a.ltPlan.tranches[1].price)}</strong></span><span>1y <strong class="${toneOf(r.oneYear)}">${pct(r.oneYear, 0, true)}</strong></span></div>`;
  }
  const best = r.reasons.filter((x) => x.points > 0).sort((p, q) => q.points - p.points).slice(0, 3);
  return `<a class="idea card" href="#/stock/${encodeURIComponent(d.symbol)}">
    <div class="idea-top"><div><strong class="sym">${esc(d.symbol)}</strong> <span class="muted">${esc(d.name)}</span><div class="sub muted">${esc(d.sector)}</div></div>${badge(r)}</div>
    <div class="idea-price">${money(a.price)} <span class="${toneOf(a.changePct)}">${pct(a.changePct, 2, true)}</span></div>
    <div class="score-row">${scoreBar(r.score)}</div>
    ${detail}
    <ul class="mini-reasons">${best.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>
    ${sizing}
  </a>`;
}
