import { getScan, settings, money, pct, shares, toneOf, esc, badge, scoreBar, demoNotice } from '../api.js';
import { SECTORS, STOCKS } from '../lib/universe.js';
import { positionSize, RISK_PROFILES } from '../lib/sizing.js';
import { rate } from '../lib/analysis.js';

// Remembered while you move around the site.
const state = { tab: 'short', sector: 'all', sort: 'score', dir: -1 };

const COLUMNS = [
  { key: 'symbol', label: 'Stock', get: (d) => d.symbol, num: false },
  { key: 'sector', label: 'Sector', get: (d) => d.sector, num: false, onlyAll: true },
  { key: 'price', label: 'Price', get: (d) => d.analysis.price, num: true },
  { key: 'day', label: 'Day', get: (d) => d.analysis.changePct, num: true },
  { key: 'm1', label: '1 mo', get: (d) => d.analysis.oneMonth, num: true },
  { key: 'y1', label: '1 yr', get: (d) => d.analysis.longTerm.oneYear, num: true },
  { key: 'score', label: 'Score', get: (d) => d.analysis[state.tab === 'short' ? 'shortTerm' : 'longTerm'].score, num: true },
];

export async function renderIdeas(app) {
  app.innerHTML = `
    <section class="page-head">
      <h1>Top Ideas</h1>
      <p class="lede">We scan ${STOCKS.length} large US stocks across all 11 market sectors and rank them. <strong>Short-term</strong> looks for momentum you can trade over days to weeks. <strong>Long-term</strong> looks for steady, durable uptrends worth holding for months or years.</p>
    </section>
    <div class="seg big" id="tabs"><button data-tab="short">Short-term gains</button><button data-tab="long">Long-term gains</button></div>
    <div id="ideas-body"><div class="loading">Scanning the market…</div></div>`;

  const items = await getScan();
  const stocks = items.filter((i) => i.sector !== 'ETF');
  const bySym = Object.fromEntries(items.map((i) => [i.symbol, i]));
  const body = app.querySelector('#ideas-body');
  const tabs = app.querySelector('#tabs');

  const draw = () => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    const key = state.tab === 'short' ? 'shortTerm' : 'longTerm';
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

    const inView = state.sector === 'all' ? stocks : stocks.filter((x) => x.sector === state.sector);
    const ranked = [...inView].sort((a, b) => b.analysis[key].score - a.analysis[key].score);
    const top = ranked.filter((x) => x.analysis[key].score >= 58).slice(0, 6);
    const sel = sectors.find((x) => x.name === state.sector);

    const col = COLUMNS.find((c) => c.key === state.sort) || COLUMNS.at(-1);
    const table = [...inView].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * state.dir;
    });
    const cols = COLUMNS.filter((c) => !c.onlyAll || state.sector === 'all');

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

      ${sel ? `<section class="card sector-intro">
        <div><h2>${esc(sel.name)}</h2><p class="muted">${esc(sel.blurb)}</p></div>
        ${sel.etf ? `<a class="sector-etf" href="#/stock/${encodeURIComponent(sel.etf.symbol)}">
          <span class="small muted">Buy the whole sector in one fund</span>
          <strong>${esc(sel.etf.symbol)}</strong> ${money(sel.etf.analysis.price)} ${badge(sel.etf.analysis[key])}</a>` : ''}
      </section>` : ''}

      <h2 class="section-title">Top picks${sel ? ` in ${esc(sel.name)}` : ''}</h2>
      ${top.length ? `<div class="ideas-grid">${top.map((d) => card(d, key, s, profile)).join('')}</div>`
        : `<div class="card"><p>Nothing ${sel ? 'in this sector ' : ''}scores a Buy right now. That's a signal too: when nothing qualifies, holding cash or broad index funds is often the best move.</p></div>`}

      <section class="card">
        <div class="card-head"><h2>All ${inView.length} ${sel ? esc(sel.name) : ''} stocks</h2><span class="muted small">Click a column to sort · click a row for the full analysis</span></div>
        <div class="table-wrap"><table class="table compact" id="rank-table">
          <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}"><button class="sort ${state.sort === c.key ? 'on' : ''}" data-sort="${c.key}" aria-label="Sort by ${c.label}">${c.label}${state.sort === c.key ? (state.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}<th>Rating</th></tr></thead>
          <tbody>${table.map((d) => {
            const a = d.analysis, r = a[key];
            return `<tr class="clickable" data-href="#/stock/${encodeURIComponent(d.symbol)}">
              <td><strong>${esc(d.symbol)}</strong><div class="sub">${esc(d.name)}</div></td>
              ${state.sector === 'all' ? `<td class="small muted">${esc(d.sector)}</td>` : ''}
              <td class="num">${money(a.price)}</td>
              <td class="num ${toneOf(a.changePct)}">${pct(a.changePct, 1, true)}</td>
              <td class="num ${toneOf(a.oneMonth)}">${pct(a.oneMonth, 1, true)}</td>
              <td class="num ${toneOf(a.longTerm.oneYear)}">${pct(a.longTerm.oneYear, 0, true)}</td>
              <td class="num"><strong>${r.score}</strong></td>
              <td>${badge(r)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>
      <p class="muted small">Scores are 0–100 from price trends, momentum and volatility only. They don't know about earnings, news or valuation. Always check the stock page and set your stop before buying.</p>`;
  };

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { state.tab = b.dataset.tab; draw(); }
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
  let sizing;
  if (key === 'shortTerm') {
    const pos = positionSize({ account: s.account, riskPct: profile.riskPerTrade, entry: a.plan.entry, stop: a.plan.stop, maxPositionPct: profile.maxPosition, fractional: s.fractional });
    sizing = pos && !pos.error && pos.shares > 0
      ? `<div class="idea-plan"><span>Buy <strong>${shares(pos.shares)}</strong> sh ≈ ${money(pos.cost, 0)}</span><span>Stop <strong class="down">${money(a.plan.stop)}</strong></span><span>Target <strong class="up">${money(a.plan.targets[0])}</strong></span></div>`
      : '<div class="idea-plan muted">Too expensive for your risk settings</div>';
  } else {
    const budget = s.account * profile.maxPosition;
    const sh = s.fractional ? Math.floor((budget * 0.4 / a.price) * 1000) / 1000 : Math.floor(budget * 0.4 / a.price);
    sizing = `<div class="idea-plan"><span>Start with <strong>${shares(sh)}</strong> sh now</span><span>Add near <strong>${money(a.ltPlan.tranches[1].price)}</strong></span><span>1y <strong class="${toneOf(r.oneYear)}">${pct(r.oneYear, 0, true)}</strong></span></div>`;
  }
  return `<a class="idea card" href="#/stock/${encodeURIComponent(d.symbol)}">
    <div class="idea-top"><div><strong class="sym">${esc(d.symbol)}</strong> <span class="muted">${esc(d.name)}</span><div class="sub muted">${esc(d.sector)}</div></div>${badge(r)}</div>
    <div class="idea-price">${money(a.price)} <span class="${toneOf(a.changePct)}">${pct(a.changePct, 2, true)}</span></div>
    <div class="score-row">${scoreBar(r.score)}</div>
    <ul class="mini-reasons">${r.reasons.filter((x) => x.points > 0).sort((p, q) => q.points - p.points).slice(0, 3).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>
    ${sizing}
  </a>`;
}
