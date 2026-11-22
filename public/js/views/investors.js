import { getSmartMoney, money, pct, esc } from '../api.js';
import { TIPS } from '../lib/playbook.js';

const CHANGE = { new: ['NEW', 'up'], added: ['ADDED', 'up'], trimmed: ['TRIMMED', 'down'], held: ['', ''] };
const changeTag = (c) => (CHANGE[c]?.[0] ? `<span class="badge ${CHANGE[c][1]}">${CHANGE[c][0]}</span>` : '');
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const stockLink = (h) => (h.symbol ? `<a href="#/stock/${encodeURIComponent(h.symbol)}"><strong>${esc(h.symbol)}</strong></a>` : '');
const bigUsd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : money(n, 0));

export async function renderInvestors(app) {
  app.innerHTML = '<div class="loading">Loading big-investor filings…</div>';
  const d = await getSmartMoney();
  const funds = d.funds || [];
  const insiders = Object.entries(d.insiders || {}).flatMap(([symbol, list]) => list.map((x) => ({ symbol, ...x })))
    .sort((a, b) => b.filed.localeCompare(a.filed) || b.value - a.value).slice(0, 40);

  app.innerHTML = `
    <section class="page-head">
      <h1>Big Investors</h1>
      <p class="lede">What famous investors own, and which company insiders are buying their own stock, straight from their public SEC filings. Updated automatically every day.</p>
    </section>
    <section class="card copy-promo"><h2>🏛️ Copy Congress trades</h2><p>See every stock trade members of the House report, like Nancy Pelosi, and test copying them with fake money.</p><a class="btn" href="#/copy">Open Copy Trades</a></section>
    <div class="notice small"><strong>Read this first:</strong> funds file what they owned at the end of each quarter, and they have 45 days to do it. So this is a look in the rear-view mirror: they may have sold since. It's a great source of ideas and a vote of confidence, not a buy signal on its own. AutoPilot can use it as a filter, and its <a href="#/autopilot">Train</a> button tests whether that actually helps.</div>
    ${d.errors?.length && !funds.length ? `<div class="notice warn small">The SEC data couldn't be downloaded on the last update: ${esc(d.errors[0])}</div>` : ''}

    <section class="card">
      <h2>Insiders buying their own stock <span class="muted small">last 120 days · open-market purchases only (SEC Form 4)</span></h2>
      <p class="small muted">Executives and directors get plenty of shares as pay, so their <em>sales</em> mean little. A <em>purchase</em> with their own cash is different. As Peter Lynch put it, they buy for only one reason.</p>
      ${insiders.length ? `<div class="table-wrap"><table class="table compact"><thead><tr><th>Stock</th><th>Who</th><th class="num">Bought</th><th class="num">Price</th><th class="num">Filed</th></tr></thead><tbody>
        ${insiders.map((x) => `<tr><td>${stockLink(x)}</td><td>${esc(x.owner)}<div class="sub">${esc(x.role)}</div></td><td class="num">${bigUsd(x.value)}<div class="sub">${x.shares.toLocaleString('en-US')} sh</div></td><td class="num">${x.price ? money(x.price) : '—'}</td><td class="num">${fmtDate(x.filed)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No insider purchases in the stocks StockWise tracks in the last 120 days (or the data hasn\'t loaded yet).</p>'}
    </section>

    <h2 class="section-title">Famous investors' portfolios <span class="muted small">latest 13F filing</span></h2>
    ${funds.length ? `<div class="fund-grid">${funds.map(fundCard).join('')}</div>` : '<p class="muted">Fund filings appear after the next site update.</p>'}

    <section class="card">
      <h2>Their trading rules, built into AutoPilot</h2>
      <ul class="small">${TIPS.map((t) => `<li><strong>${esc(t.who)}: ${esc(t.title)}.</strong> ${esc(t.idea)}</li>`).join('')}</ul>
      <a class="btn" href="#/autopilot">Use them in AutoPilot</a>
    </section>
    <p class="small muted">Source: SEC EDGAR (13F-HR and Form 4 filings). Company names in 13F filings are matched to tickers automatically, so a few small holdings may be missing. Data updated ${esc(new Date(d.updated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}. Not financial advice.</p>`;
}

function fundCard(f) {
  return `<section class="card fund">
    <div class="card-head"><h3>${esc(f.manager)} <span class="muted small">${esc(f.label)}</span></h3>${f.stale ? '<span class="badge flat" title="No new filing in over 6 months">Old filing</span>' : ''}</div>
    <p class="small muted">Quarter ending ${fmtDate(f.period)} · filed ${fmtDate(f.filed)} · ${f.positions} positions</p>
    <ol class="holdings">${f.top.slice(0, 10).map((h) => `<li>${stockLink(h)} <span class="muted small">${esc(h.name || '')}</span><span class="pct">${pct(h.pct, 1)}</span> ${changeTag(h.change)}</li>`).join('')}</ol>
    ${f.newBuys?.length ? `<p class="small"><strong>New this quarter:</strong> ${f.newBuys.map((h) => `${stockLink(h)} <span class="muted">(${pct(h.pct, 1)})</span>`).join(', ')}</p>` : ''}
  </section>`;
}

// The "Big investors" box on a stock's page.
export async function smartBox(el, symbol) {
  try {
    const d = await getSmartMoney();
    const s = d.bySymbol?.[symbol];
    const ins = d.insiders?.[symbol] || [];
    if (!el.isConnected || (!s?.funds?.length && !ins.length)) { el.remove(); return; }
    el.innerHTML = `<section class="card smart-box">
      <div class="card-head"><h2>Big investors <span class="muted small">SEC filings</span></h2><a class="small" href="#/investors">All big investors →</a></div>
      ${s?.funds?.length ? `<p>${s.funds.map((f) => `<span class="chip">${esc(f.manager)} <strong>${pct(f.pct, 1)}</strong> of portfolio ${changeTag(f.change)}</span>`).join(' ')}</p>` : ''}
      ${ins.length ? `<p class="small"><strong>Insider buying:</strong> ${ins.slice(0, 3).map((x) => `${esc(x.owner)} (${esc(x.role)}) bought ${bigUsd(x.value)} on ${fmtDate(x.date || x.filed)}`).join('; ')}.</p>` : ''}
      <p class="small muted">Funds report holdings up to 45 days after each quarter ends, so they may have changed since.</p>
    </section>`;
  } catch { el.remove(); }
}
