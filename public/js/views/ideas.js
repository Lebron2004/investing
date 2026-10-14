import { getBatch, settings, money, pct, shares, toneOf, esc, badge, scoreBar, demoNotice } from '../api.js';
import { STOCKS } from '../lib/universe.js';
import { positionSize, RISK_PROFILES } from '../lib/sizing.js';

let tab = 'short';

export async function renderIdeas(app) {
  app.innerHTML = `
    <section class="page-head">
      <h1>Top Ideas</h1>
      <p class="lede">We scan ${STOCKS.length} large, heavily-traded US stocks and rank them. <strong>Short-term</strong> looks for momentum you can trade over days to weeks. <strong>Long-term</strong> looks for steady, durable uptrends worth holding for months or years.</p>
    </section>
    <div class="seg big" id="tabs"><button data-tab="short">Short-term gains</button><button data-tab="long">Long-term gains</button></div>
    <div id="ideas-body"><div class="loading">Scanning the market…</div></div>`;

  const items = await getBatch(STOCKS.map((s) => s.symbol));
  const body = app.querySelector('#ideas-body');
  const tabs = app.querySelector('#tabs');

  const draw = () => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const key = tab === 'short' ? 'shortTerm' : 'longTerm';
    const ranked = [...items].sort((x, y) => y.analysis[key].score - x.analysis[key].score);
    const top = ranked.filter((i) => i.analysis[key].score >= 58).slice(0, 8);
    const avoid = ranked.filter((i) => i.analysis[key].score < 43).slice(-5).reverse();
    const s = settings();
    const profile = RISK_PROFILES[s.profile];

    const card = (d) => {
      const a = d.analysis, r = a[key];
      const meta = STOCKS.find((x) => x.symbol === d.symbol);
      let sizing = '';
      if (tab === 'short') {
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
        <div class="idea-top"><div><strong class="sym">${esc(d.symbol)}</strong> <span class="muted">${esc(meta?.name || d.name)}</span></div>${badge(r)}</div>
        <div class="idea-price">${money(a.price)} <span class="${toneOf(a.changePct)}">${pct(a.changePct, 2, true)}</span></div>
        <div class="score-row">${scoreBar(r.score)}</div>
        <ul class="mini-reasons">${r.reasons.filter((x) => x.points > 0).sort((p, q) => q.points - p.points).slice(0, 3).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>
        ${sizing}
      </a>`;
    };

    body.innerHTML = `
      ${demoNotice(items)}
      ${top.length ? `<div class="ideas-grid">${top.map(card).join('')}</div>`
        : '<div class="card"><p>No stock scores a Buy right now. That\'s a signal too: when nothing qualifies, holding cash or broad index funds is often the best move.</p></div>'}
      ${avoid.length ? `<section class="card"><h2>Weakest right now <span class="muted small">avoid new buys</span></h2>
        <div class="table-wrap"><table class="table compact"><tbody>${avoid.map((d) => `<tr class="clickable" data-href="#/stock/${encodeURIComponent(d.symbol)}"><td><strong>${esc(d.symbol)}</strong></td><td>${badge(d.analysis[key])}</td><td class="num">${money(d.analysis.price)}</td><td class="muted">${esc(d.analysis[key].reasons.filter((x) => x.points < 0).sort((p, q) => p.points - q.points)[0]?.text || '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <p class="muted small">Scores are 0–100 from price trends, momentum and volatility only. They don't know about earnings, news or valuation. Always check the stock page and set your stop before buying.</p>`;
  };

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { tab = b.dataset.tab; draw(); }
  });
  body.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row) location.hash = row.dataset.href;
  });
  draw();
}
