import { getCongress, getHistory, store, money, pct, esc, toneOf } from '../api.js';
import { copyPortfolio, memberSummary, lagDays, AMOUNT_LABEL, clusterBuys } from '../lib/copytrade.js';

const TYPE = { buy: ['BUY', 'up'], sell: ['SELL', 'down'], partial: ['SOLD SOME', 'down'], exchange: ['EXCHANGE', ''] };
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const loadPrefs = () => ({ members: [], budget: 1000, slicePct: 0.1, period: 365, maxLag: '', sort: 'trades', fastOnly: false, ...store.get('copyPrefs', {}) });
const CLUSTER = 'Cluster buys (2+ members)';
const FAST_DAYS = 15;

// "Cluster buys" as a member you can copy: buy when a second member reports buying the same stock
// within 30 days; sell when any of those members reports selling it.
function clusterTrades(trades) {
  const out = [];
  for (const c of clusterBuys(trades)) {
    out.push({ member: CLUSTER, ticker: c.ticker, type: 'buy', filed: c.filed, txDate: c.txFirst, lo: 0, hi: null, owner: 'self', asset: c.ticker });
    const sell = trades.filter((t) => t.ticker === c.ticker && c.members.includes(t.member) && (t.type === 'sell' || t.type === 'partial') && t.filed > c.filed)
      .sort((a, b) => a.filed.localeCompare(b.filed))[0];
    if (sell) out.push({ ...sell, member: CLUSTER, type: 'sell' });
  }
  return out;
}
const fmtEx = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`);

export async function renderCopy(app) {
  app.innerHTML = '<div class="loading">Loading Congress trades…</div>';
  const data = await getCongress();
  const scoreOf = Object.fromEntries((data.members || []).map((m) => [m.name, m.score]));
  const members = memberSummary(data.trades).map((m) => ({ ...m, score: scoreOf[m.name] ?? null }));
  const allTrades = [...data.trades, ...clusterTrades(data.trades)];
  const prefs = loadPrefs();
  if (!prefs.members.length) {
    const pelosi = members.find((m) => /Pelosi/.test(m.name));
    prefs.members = [pelosi?.name || members[0]?.name].filter(Boolean);
  }
  let follow = store.get('copyFollow', null);

  app.innerHTML = `
    <section class="page-head">
      <h1>Copy Trades</h1>
      <p class="lede">Copy the stock trades members of Congress report, like Nancy Pelosi, in a practice portfolio. See how it would have done, then follow them going forward with fake money.</p>
    </section>
    <div class="notice small"><strong>The big catch:</strong> by law, members have up to <strong>45 days</strong> to report a trade, so you always find out late. Every result here buys on the next trading day <em>after the report was filed</em>, which is what you could really have done. The dotted line shows what trading on their actual trade date would have made: the difference is what the delay costs.${data.source === 'demo' ? ' <strong class="down">Demo data: these trades are simulated.</strong>' : ''}</div>
    ${data.errors?.length && !data.trades.length ? `<div class="notice warn small">Congress data couldn't be loaded on the last update: ${esc(data.errors[0])}</div>` : ''}

    <div class="copy-grid">
      <section class="card">
        <h2>1. Who to copy</h2>
        <input id="member-search" type="search" placeholder="Search a member, e.g. Pelosi" aria-label="Search members">
        <div class="member-tools">
          <label>Sort<select id="member-sort">${[['trades', 'Most trades'], ['record', 'Best track record'], ['fast', 'Reports fastest']].map(([v, l]) => `<option value="${v}" ${prefs.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="fast-only" ${prefs.fastOnly ? 'checked' : ''}> Fast reporters only (usually within ${FAST_DAYS} days)</label>
        </div>
        <label class="member cluster-pick ${prefs.members.includes(CLUSTER) ? 'on' : ''}"><input type="checkbox" value="${CLUSTER}" ${prefs.members.includes(CLUSTER) ? 'checked' : ''}>
          <span><strong>🤝 ${CLUSTER}</strong><span class="small muted">Buys a stock once two or more members have reported buying it within 30 days.${data.clusterScore?.n30 ? ` Past clusters: ${fmtEx(data.clusterScore.avg30)} vs the S&amp;P 500 after 30 trading days on average (${data.clusterScore.n30} clusters).` : ''}</span></span></label>
        <div class="member-list" id="member-list"></div>
        <p class="small muted">House members only, from ${data.members?.length || members.length} who reported trades in the last ~13 months. Senate reports sit behind a separate legal agreement and aren't included yet.</p>
      </section>
      <form class="card form" id="copy-form">
        <h2>2. Your copy portfolio</h2>
        <label>Starting money (fake)<div class="input-prefix"><span>$</span><input name="budget" type="number" min="50" step="any" value="${prefs.budget}"></div></label>
        <label>Each new buy uses<select name="slicePct">${[[0.05, '5% of starting money'], [0.1, '10% of starting money'], [0.2, '20% of starting money']].map(([v, l]) => `<option value="${v}" ${prefs.slicePct === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Only copy buys reported within<select name="maxLag">${[['', 'any delay'], [7, '7 days'], [15, '15 days'], [30, '30 days']].map(([v, l]) => `<option value="${v}" ${String(prefs.maxLag) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Look back<select name="period">${[[90, '3 months'], [182, '6 months'], [365, '12 months']].map(([v, l]) => `<option value="${v}" ${prefs.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="small muted">Buys copy their purchases. When they sell, the portfolio sells (half, for a partial sale). Uses fractional shares so small amounts work.</p>
        <button class="btn" type="submit">▶ Show how copying would have done</button>
      </form>
    </div>
    <section class="card" id="copy-follow"></section>
    <div id="copy-out"></div>
    ${clusterCard(data)}
    <section class="card">
      <h2>Latest trades reported</h2>
      <div id="feed"></div>
    </section>
    <p class="small muted">Source: U.S. House Clerk, Periodic Transaction Reports (STOCK Act), read automatically every day. Amounts are reported only as ranges. Scanned paper filings can't be read and are skipped. By law (5 U.S.C. 13107) this information can't be used for commercial purposes, credit decisions or fundraising. Not financial advice.</p>`;

  const list = app.querySelector('#member-list');
  const form = app.querySelector('#copy-form');
  const out = app.querySelector('#copy-out');
  const selected = new Set(prefs.members);

  const drawMembers = () => {
    const q = app.querySelector('#member-search').value.trim().toLowerCase();
    const sort = app.querySelector('#member-sort').value;
    const fastOnly = app.querySelector('#fast-only').checked;
    const recordOf = (m) => (m.score?.n30 >= 5 ? m.score.avg30 : -Infinity);
    const sorted = [...members].sort(sort === 'record' ? (a, b) => recordOf(b) - recordOf(a) || b.trades - a.trades
      : sort === 'fast' ? (a, b) => (a.avgLag ?? 999) - (b.avgLag ?? 999) || b.trades - a.trades : (a, b) => b.trades - a.trades);
    const shown = sorted.filter((m) => (!q || m.name.toLowerCase().includes(q)) && (!fastOnly || (m.avgLag != null && m.avgLag <= FAST_DAYS))).slice(0, q ? 40 : 14);
    list.innerHTML = shown.map((m) => `<label class="member ${selected.has(m.name) ? 'on' : ''}">
      <input type="checkbox" value="${esc(m.name)}" ${selected.has(m.name) ? 'checked' : ''}>
      <span><strong>${esc(m.name)}</strong> <span class="muted small">${esc(m.state)}</span>
      <span class="small muted">${m.trades} trades (${m.buys} buys, ${m.sells} sells)${m.avgLag != null ? ` · reports ~${m.avgLag} days late` : ''}</span>
      ${scoreLine(m.score)}
      <span class="small">${m.top.map(esc).join(' · ')}</span></span></label>`).join('') || '<p class="muted">No member found.</p>';
  };
  const drawFeed = () => {
    const rows = data.trades.filter((t) => !selected.size || selected.has(t.member)).slice(0, 40);
    app.querySelector('#feed').innerHTML = rows.length ? `<div class="table-wrap"><table class="table compact"><thead><tr><th>Member</th><th>Stock</th><th>Trade</th><th class="num">Amount</th><th class="num">Traded</th><th class="num">Reported</th></tr></thead><tbody>
      ${rows.map((t) => `<tr><td>${esc(t.member)}${t.owner !== 'self' ? ` <span class="sub">(${{ SP: 'spouse', JT: 'joint', DC: 'child' }[t.owner] || t.owner})</span>` : ''}</td>
        <td><a href="#/stock/${encodeURIComponent(t.ticker)}"><strong>${esc(t.ticker)}</strong></a><div class="sub">${esc(t.asset.replace(/\s*\([A-Z.\-]+\)$/, '').slice(0, 48))}</div></td>
        <td><span class="badge ${TYPE[t.type]?.[1] || ''}">${TYPE[t.type]?.[0] || esc(t.type)}</span></td>
        <td class="num">${AMOUNT_LABEL(t.lo, t.hi)}</td><td class="num">${fmtDate(t.txDate)}</td>
        <td class="num">${fmtDate(t.filed)}<div class="sub">${lagDays(t.txDate, t.filed)} days later</div></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No trades for the selected members.</p>';
  };

  const savePicker = () => store.set('copyPrefs', { ...loadPrefs(), sort: app.querySelector('#member-sort').value, fastOnly: app.querySelector('#fast-only').checked });
  app.querySelector('#member-sort').addEventListener('change', () => { savePicker(); drawMembers(); });
  app.querySelector('#fast-only').addEventListener('change', () => { savePicker(); drawMembers(); });
  app.querySelector('.cluster-pick input').addEventListener('change', (e) => {
    e.target.checked ? selected.add(CLUSTER) : selected.delete(CLUSTER);
    e.target.closest('.member').classList.toggle('on', e.target.checked);
    store.set('copyPrefs', { ...loadPrefs(), members: [...selected] });
  });
  list.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    e.target.checked ? selected.add(e.target.value) : selected.delete(e.target.value);
    e.target.closest('.member').classList.toggle('on', e.target.checked);
    store.set('copyPrefs', { ...loadPrefs(), members: [...selected] });
    drawFeed();
  });
  app.querySelector('#member-search').addEventListener('input', drawMembers);

  // Prices for every stock the selected members traded (only ones this site tracks have them).
  const candleCache = new Map();
  const loadPrices = async (tickers, progress) => {
    const need = [...new Set(['SPY', ...tickers])].filter((s) => !candleCache.has(s));
    let done = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (need.length) {
        const s = need.shift();
        candleCache.set(s, await getHistory(s).then((d) => d.candles, () => null));
        progress?.(++done);
      }
    }));
  };
  const simulate = async (opts) => {
    const trades = allTrades.filter((t) => opts.members.includes(t.member));
    await loadPrices(trades.map((t) => t.ticker), (n) => { out.innerHTML = `<p class="loading">Loading prices… ${n}</p>`; });
    const base = { ...opts, bench: candleCache.get('SPY') };
    return {
      real: copyPortfolio(trades, (s) => candleCache.get(s), { ...base, when: 'filed' }),
      hindsight: copyPortfolio(trades, (s) => candleCache.get(s), { ...base, when: 'traded' }),
    };
  };
  const readForm = () => {
    const f = new FormData(form);
    return { ...loadPrefs(), members: [...selected], budget: Math.max(50, Number(f.get('budget')) || 1000), slicePct: Number(f.get('slicePct')) || 0.1, period: Number(f.get('period')) || 365, maxLag: f.get('maxLag') || '' };
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = readForm();
    store.set('copyPrefs', p);
    if (!p.members.length) { out.innerHTML = '<div class="card"><p class="muted">Pick at least one member to copy.</p></div>'; return; }
    out.innerHTML = '<p class="loading">Simulating…</p>';
    const res = await simulate({ members: p.members, budget: p.budget, slicePct: p.slicePct, start: daysAgo(p.period), maxLag: p.maxLag ? Number(p.maxLag) : null });
    out.innerHTML = resultCard(`If you had copied ${listNames(p.members)} for the last ${p.period >= 365 ? '12 months' : `${Math.round(p.period / 30)} months`}`, res, p, { canFollow: true });
  });
  out.addEventListener('click', (e) => {
    if (!e.target.closest('[data-follow]')) return;
    const p = readForm();
    follow = { members: p.members, budget: p.budget, slicePct: p.slicePct, maxLag: p.maxLag ? Number(p.maxLag) : null, since: new Date().toISOString().slice(0, 10) };
    store.set('copyFollow', follow);
    drawFollow();
    app.querySelector('#copy-follow').scrollIntoView({ behavior: 'smooth' });
  });

  const followEl = app.querySelector('#copy-follow');
  const drawFollow = async () => {
    if (!follow) {
      followEl.innerHTML = '<h2>Follow them with fake money</h2><p class="muted">Run a simulation below, then press <strong>Follow from today</strong>. From then on, every new trade they report is copied into a practice portfolio automatically: just come back to this page to see how it\'s doing.</p>';
      return;
    }
    followEl.innerHTML = '<p class="loading">Updating your copy portfolio…</p>';
    const res = await simulate({ members: follow.members, budget: follow.budget, slicePct: follow.slicePct, start: follow.since, maxLag: follow.maxLag ?? null });
    followEl.innerHTML = `${resultCard(`Your copy portfolio: following ${listNames(follow.members)} since ${fmtDate(follow.since)}`, res, follow, { live: true })}
      <button class="btn ghost small-btn" type="button" data-unfollow>Stop following</button>`;
  };
  followEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-unfollow]') && confirm('Stop following and delete this copy portfolio?')) { follow = null; store.set('copyFollow', null); drawFollow(); }
  });

  drawMembers();
  drawFeed();
  drawFollow();
}

function scoreLine(sc) {
  if (!sc?.n30) return '<span class="small muted">Track record: not enough buys with prices yet</span>';
  const thin = sc.n30 < 5 ? ' <em>(few trades: mostly luck)</em>' : '';
  return `<span class="small">Track record: buys did <strong class="${toneOf(sc.avg30)}">${fmtEx(sc.avg30)}</strong> vs the S&amp;P 500 in the 30 trading days after being reported, beating it ${pct(sc.hit30, 0)} of the time (${sc.n30} buys)${thin}</span>`;
}

function clusterCard(data) {
  const cl = data.clusters || [];
  const all = data.allScore, cs = data.clusterScore;
  return `<section class="card">
    <h2>🤝 Cluster buys <span class="muted small">2+ members bought the same stock within 30 days</span></h2>
    <p class="small muted">One member's trade can mean anything. Several buying the same stock is a stronger hint.${cs?.n30 && all?.n30 ? ` So far, after the second report was filed, cluster buys did <strong class="${toneOf(cs.avg30)}">${fmtEx(cs.avg30)}</strong> vs the S&amp;P 500 over 30 trading days (${cs.n30} clusters), compared with <strong class="${toneOf(all.avg30)}">${fmtEx(all.avg30)}</strong> for all Congress buys (${all.n30}). Small samples swing a lot.` : ''}</p>
    ${cl.length ? `<div class="table-wrap"><table class="table compact"><thead><tr><th>Stock</th><th>Members</th><th class="num">Known since</th><th class="num">30 days later vs S&amp;P</th></tr></thead><tbody>
      ${cl.slice(0, 15).map((c) => `<tr><td><a href="#/stock/${encodeURIComponent(c.ticker)}"><strong>${esc(c.ticker)}</strong></a><div class="sub">${c.trades} buys</div></td><td>${c.members.map(esc).join(', ')}</td><td class="num">${fmtDate(c.filed)}</td><td class="num ${toneOf(c.ex30)}">${c.ex30 == null ? '<span class="muted">too recent</span>' : fmtEx(c.ex30)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No cluster buys found yet. More appear as more reports are read.</p>'}
  </section>`;
}

const listNames = (names) => (names.length <= 2 ? names.map(esc).join(' and ') : `${esc(names[0])} and ${names.length - 1} others`);

function resultCard(title, { real, hindsight }, p, { canFollow = false, live = false } = {}) {
  const s = real.stats, h = hindsight.stats;
  const signed = (v) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
  const latestBuys = real.fills.filter((f) => f.side === 'buy').slice(-5).reverse();
  return `<section class="card copy-result">
    <h2>${title}</h2>
    ${!real.fills.length ? `<p class="muted">${live ? 'No new trades reported since you started following. New ones are copied automatically as they\'re filed.' : 'None of their stock trades in this period could be copied (no prices for those stocks on this site, or no trades).'}</p>` : `
    <div class="big-stats four">
      <div><span class="label">Copying (realistic)</span><span class="value ${toneOf(s.ret)}">${pct(s.ret, 1, true)}</span><span class="sub">${money(p.budget, 0)} → ${money(real.value, 0)} (${signed(real.value - p.budget)})</span></div>
      <div><span class="label">S&amp;P 500, same dates</span><span class="value ${toneOf(s.benchRet)}">${s.benchRet != null ? pct(s.benchRet, 1, true) : '—'}</span><span class="sub">${s.benchRet != null ? (s.ret > s.benchRet ? 'copying did better' : 'just buying the index did better') : ''}</span></div>
      <div><span class="label">If you knew instantly</span><span class="value ${toneOf(h.ret)}">${pct(h.ret, 1, true)}</span><span class="sub">impossible: trades on the day they did</span></div>
      <div><span class="label">Reporting delay</span><span class="value">${s.avgLag ?? '—'} days</span><span class="sub">${s.buys} buys, ${s.sells} sells copied · worst drop ${pct(-s.maxDrawdown, 1)}</span></div>
    </div>
    ${curveChart(real.curve, hindsight.curve, real.benchCurve)}
    ${real.holdings.length ? `<h3>What the copy portfolio holds now <span class="muted small">+ ${money(real.cash)} cash</span></h3>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Gain</th></tr></thead><tbody>
      ${real.holdings.map((x) => `<tr><td><a href="#/stock/${encodeURIComponent(x.symbol)}"><strong>${esc(x.symbol)}</strong></a></td><td class="num">${x.shares}</td><td class="num">${money(x.avg)}</td><td class="num">${money(x.price)}</td><td class="num">${money(x.value)}</td><td class="num ${toneOf(x.pl)}">${signed(x.pl)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    ${latestBuys.length ? `<h3>Copy a buy in your real account</h3><p class="small muted">Weeks may have passed since they bought. Check the chart and set a stop-loss before copying anything.</p>
      <div class="copy-buys">${latestBuys.map((f) => `<a class="chip" href="#/order?symbol=${encodeURIComponent(f.symbol)}&entryType=limit&timing=GTC">${esc(f.symbol)} <span class="muted">${esc(f.member.split(' ').at(-1))} bought ${fmtDate(f.txDate)}</span> →</a>`).join('')}</div>` : ''}
    <details class="small"><summary>Every copied trade (${real.fills.length})</summary>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Day</th><th>Trade</th><th class="num">Price</th><th>Copied from</th><th class="num">Delay</th></tr></thead><tbody>
      ${[...real.fills].reverse().map((f) => `<tr><td>${fmtDate(f.day)}</td><td><span class="${f.side === 'buy' ? 'up' : 'down'}">${f.side.toUpperCase()}</span> ${f.shares} <strong>${esc(f.symbol)}</strong>${f.pl != null ? ` <span class="${toneOf(f.pl)}">${signed(f.pl)}</span>` : ''}</td><td class="num">${money(f.price)}</td><td>${esc(f.member)} <span class="sub">${f.amount}</span></td><td class="num">${f.lag} days</td></tr>`).join('')}
      </tbody></table></div></details>`}
    ${real.skipped.length ? `<p class="small muted">${real.skipped.length} of their trades couldn't be copied (${summarizeSkips(real.skipped)}).</p>` : ''}
    ${canFollow ? '<button class="btn" type="button" data-follow>⭐ Follow from today (fake money)</button>' : ''}
  </section>`;
}

function summarizeSkips(list) {
  const c = {};
  for (const x of list) c[x.reason] = (c[x.reason] || 0) + 1;
  return Object.entries(c).map(([r, n]) => `${n} ${r}`).join(', ');
}

function curveChart(real, hind, bench) {
  if (real.length < 2) return '';
  const all = [...real, ...hind, ...bench].map((p) => p.value);
  const lo = Math.min(...all), hi = Math.max(...all);
  const W = 640, H = 200, pad = 6;
  const x = (i, n) => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const line = (pts, cls) => (pts.length > 1 ? `<polyline class="${cls}" points="${pts.map((p, i) => `${x(i, pts.length).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}"/>` : '');
  return `<svg class="copy-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Portfolio value over time">
      ${line(bench, 'bench')}${line(hind, 'hind')}${line(real, 'real')}
    </svg>
    <div class="legend small"><span><i class="sw real"></i>Copying (realistic)</span><span><i class="sw hind"></i>If you knew instantly</span><span><i class="sw bench"></i>S&amp;P 500</span>
    <span class="muted">${fmtDate(real[0].day)} → ${fmtDate(real.at(-1).day)}</span></div>`;
}
