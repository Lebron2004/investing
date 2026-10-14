import { getHistory, store, money, pct, shares, toneOf, esc, demoNotice } from '../api.js';
import { computeIndicators } from '../lib/analysis.js';
import { replayTrade, dayOf } from '../lib/tracker.js';
import { mountChart } from '../chart.js';

export const loadTrades = () => store.get('trades', []);
const saveTrades = (t) => store.set('trades', t);

export function addTrade(trade) {
  const id = `${trade.symbol}-${Date.now().toString(36)}`;
  saveTrades([...loadTrades(), { ...trade, id, created: new Date().toISOString() }]);
  return id;
}

const ACTION_LABEL = { hold: 'Hold', watch: 'Watch', sell: 'Sell now', 'sell-all': 'Sell all now', closed: 'Closed' };
const actionBadge = (a) => `<span class="badge action-${a}">${ACTION_LABEL[a]}</span>`;
const fmtDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

async function replay(trade) {
  const data = await getHistory(trade.symbol);
  return { data, r: replayTrade(trade, data.candles) };
}

export async function renderTrackedList(el) {
  const trades = loadTrades();
  if (!trades.length) {
    el.innerHTML = '<p class="muted">No trades tracked yet. Fill in the sizer above and click <strong>Track this trade</strong>.</p>';
    return;
  }
  el.innerHTML = '<div class="loading">Checking the latest candles…</div>';
  const rows = await Promise.all(trades.map(async (t) => {
    try {
      const { r } = await replay(t);
      return `<tr class="clickable" data-href="#/trade/${encodeURIComponent(t.id)}">
        <td><strong>${esc(t.symbol)}</strong><div class="sub">${fmtDate(t.entryDate)} @ ${money(t.entry)}</div></td>
        <td>${actionBadge(r.today.action)}</td>
        <td class="num">${money(r.price)}</td>
        <td class="num">${shares(r.open)} / ${shares(t.shares)}</td>
        <td class="num ${toneOf(r.totalPL)}">${r.totalPL >= 0 ? '+' : ''}${money(r.totalPL)}<div class="sub">${pct(r.plPct, 1, true)}</div></td>
        <td class="num down hide-sm">${r.closed ? '—' : money(r.stop)}</td>
      </tr>`;
    } catch (err) {
      return `<tr><td><strong>${esc(t.symbol)}</strong></td><td colspan="5" class="muted">${esc(err.message)}</td></tr>`;
    }
  }));
  el.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th>Trade</th><th>Today</th><th class="num">Price</th><th class="num">Shares left</th><th class="num">Profit/loss</th><th class="num hide-sm">Stop</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
  el.querySelector('tbody').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row) location.hash = row.dataset.href;
  });
}

export async function renderTrade(app, id) {
  const trade = loadTrades().find((t) => t.id === id);
  if (!trade) {
    app.innerHTML = '<div class="card"><h2>Trade not found</h2><p>It may have been deleted, or it was tracked in a different browser. <a href="#/sizer">Back to the tracker</a></p></div>';
    return;
  }
  const { data, r } = await replay(trade);
  const candles = data.candles;
  const ind = computeIndicators(candles);
  let entryIdx = -1;
  candles.forEach((c, i) => { if (dayOf(c.t) <= trade.entryDate) entryIdx = i; });
  const viewStart = Math.max(0, (entryIdx < 0 ? 0 : entryIdx) - 40);
  const t = r.today;

  const markers = [];
  if (entryIdx >= 0) markers.push({ i: entryIdx, price: trade.entry, label: 'Buy', tone: 'buy' });
  for (const e of r.events) {
    if (e.type === 'target') markers.push({ i: e.i, price: e.price, label: `Sell ${shares(e.shares)}`, tone: 'sell' });
    if (e.type === 'stop') markers.push({ i: e.i, price: e.price, label: `Stop: sell ${shares(e.shares)}`, tone: 'stop' });
    if (e.type === 'warn') markers.push({ i: e.i, price: candles[e.i].high, label: '', title: e.text, tone: 'warn' });
  }
  const levels = [{ price: trade.entry, label: 'Entry', tone: 'buy' }];
  trade.targets.forEach((p, i) => { if (i >= r.hits) levels.push({ price: p, label: `T${i + 1}`, tone: 'tgt' }); });

  const timeline = [
    { t: candles[entryIdx]?.t ?? Date.parse(trade.entryDate), type: 'buy', text: `Bought ${shares(trade.shares)} shares at ${money(trade.entry)}. Stop-loss ${money(trade.stop)}, targets ${trade.targets.map((x) => money(x)).join(' / ')}.` },
    ...r.events,
  ];
  const evBadge = { buy: '<span class="badge up">Buy</span>', target: '<span class="badge up">Sell</span>', stop: '<span class="badge down">Stop</span>', warn: '<span class="badge flat">Warning</span>', info: '<span class="badge flat">Note</span>' };

  app.innerHTML = `
    ${demoNotice(data)}
    <nav class="crumbs"><a href="#/sizer">Trade Tracker</a> › ${esc(trade.symbol)}</nav>
    <section class="stock-head">
      <div>
        <h1>${esc(trade.symbol)} <span class="name">trade</span></h1>
        <div class="muted">Bought ${shares(trade.shares)} shares at ${money(trade.entry)} on ${fmtDate(trade.entryDate)}</div>
      </div>
      <div class="head-actions">
        <a class="btn ghost" href="#/stock/${encodeURIComponent(trade.symbol)}">Full analysis</a>
        <button class="btn ghost" id="delete">Delete trade</button>
      </div>
    </section>

    <section class="signal ${t.action}">
      <span class="dot-big" aria-hidden="true"></span>
      <div>
        <p class="small muted">Today (${fmtDate(dayOf(candles[candles.length - 1].t))} close)</p>
        <p class="big">${esc(t.title)}</p>
        <p>${esc(t.text)}</p>
      </div>
    </section>

    <section class="card">
      <div class="big-stats four">
        <div><span class="label">Price</span><span class="value">${money(r.price)}</span></div>
        <div><span class="label">Profit / loss</span><span class="value ${toneOf(r.totalPL)}">${r.totalPL >= 0 ? '+' : ''}${money(r.totalPL)}</span><span class="sub">${pct(r.plPct, 1, true)} · ${money(r.realized)} locked in</span></div>
        <div><span class="label">Shares left</span><span class="value">${shares(r.open)}</span><span class="sub">of ${shares(trade.shares)}</span></div>
        <div><span class="label">${r.closed ? 'Final stop' : 'Stop now'}</span><span class="value down">${money(r.stop)}</span><span class="sub">${r.stop > trade.stop ? `raised from ${money(trade.stop)}` : 'sell if a day closes below'}</span></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Candles since you bought</h2></div>
      <div class="legend"><span class="k buy">Entry</span><span class="k trail">Your stop (moves up as you profit)</span><span class="k tgt">Targets</span><span class="k ma20">20-day</span><span class="k ma50">50-day</span></div>
      <div id="chart" class="chart-box"></div>
      <p class="muted small">▲ = buy, ▼ green = sell at a target, ▼ red = stop hit, ▼ yellow = warning (not a sell). Hover the chart for each day's prices.</p>
    </section>

    <section class="card">
      <h2>What happened, day by day</h2>
      <ol class="timeline">${[...timeline].reverse().map((e) => `<li><span class="date">${fmtDate(dayOf(e.t))}</span>${evBadge[e.type]}<span>${esc(e.text)}${e.pl != null ? ` <strong class="${toneOf(e.pl)}">${e.pl >= 0 ? '+' : ''}${money(e.pl)}</strong>` : ''}</span></li>`).join('')}</ol>
      ${r.events.length ? '' : '<p class="muted small">No sell signals yet. Days with no event are "hold" days.</p>'}
    </section>

    <details class="card explain">
      <summary>How does the tracker decide?</summary>
      <ul class="bullets small">
        <li><strong>Targets</strong> are limit sells: when a day's high reaches one, sell a third. At Target 1 the stop moves to your entry price (a free trade). At Target 2 it moves to Target 1. Target 3 sells the rest.</li>
        <li>After Target 1 the stop also <strong>trails</strong> 3× the average daily range below the highest close, so it only ever moves up.</li>
        <li>The stop is a <strong>closing stop</strong>: a dip below it during the day doesn't count. Sell only if the day <em>closes</em> below it. That keeps normal shakeouts from knocking you out.</li>
        <li>Closing below the 20-day average or RSI over 75 are <strong>warnings, not sells</strong>. The plan doesn't change unless the stop or a target is hit.</li>
        <li>Prices are daily closes, so a signal appears after the day ends. If your broker filled an order at a different price, results will differ slightly.</li>
      </ul>
    </details>`;

  const chart = mountChart(app.querySelector('#chart'), {
    candles, ind, levels,
    bars: candles.length - viewStart,
    paths: [{ series: r.stopPath, cls: 'trail' }],
    markers,
  });
  app.querySelector('#delete').addEventListener('click', () => {
    if (!confirm(`Stop tracking this ${trade.symbol} trade?`)) return;
    saveTrades(loadTrades().filter((x) => x.id !== id));
    location.hash = '#/sizer';
  });
  return () => chart.destroy();
}
