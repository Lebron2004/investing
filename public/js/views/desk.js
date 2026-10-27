import { getDeskData, liveQuotes, liveStatus, settings, saveSettings, store, money, pct, esc, toneOf } from '../api.js';
import { nyClock, PHASES, rankDesk, applyQuote, deskTips } from '../lib/daytrade.js';
import { installAvailable, promptInstall } from '../install.js';

const LIVE_EVERY = 30e3;  // live quotes (Finnhub free plan: 60 requests/minute)
const DATA_EVERY = 60e3;  // AI forecasts + intraday snapshot from the site
const loadPrefs = () => ({ budget: 1000, riskPct: 0.01, ...store.get('desk', {}) });

export async function renderDesk(app, q) {
  const compact = q.get('compact') === '1';
  document.body.classList.toggle('compact-mode', compact);
  const prefs = loadPrefs();
  const s = settings();

  app.innerHTML = `
    <div class="desk ${compact ? 'compact' : ''}">
      <section class="desk-head">
        <div>
          <h1>${compact ? '⚡ Day Trade Desk' : 'Day Trade Desk'}</h1>
          ${compact ? '' : '<p class="lede">Today\'s best day-trade candidates for <em>your</em> budget, picked by StockWise\'s own AI model and updated through the day, with an exact entry, stop, target and share count for each. Keep it open beside your charts.</p>'}
        </div>
        <div class="desk-actions">
          ${compact ? `<a class="btn ghost small-btn" href="#/desk" target="_blank" rel="noopener">Full view ↗</a>`
            : `<button class="btn small-btn" id="side-panel">Open as side panel ↗</button>
               <button class="btn ghost small-btn" id="install" ${installAvailable() ? '' : 'hidden'}>⬇ Install app</button>`}
        </div>
      </section>
      <form class="card desk-form" id="desk-form">
        <label>Today's budget<div class="input-prefix"><span>$</span><input type="number" name="budget" min="50" step="any" value="${prefs.budget}"></div></label>
        <label>Risk per trade<select name="riskPct">
          ${[[0.005, '0.5% (careful)'], [0.01, '1% (standard)'], [0.02, '2% (aggressive)']].map(([v, l]) => `<option value="${v}" ${prefs.riskPct === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
        <label class="check"><input type="checkbox" name="fractional" ${s.fractional ? 'checked' : ''}> Fractional shares</label>
      </form>
      <div id="desk-body"><div class="loading">Loading today's candidates…</div></div>
    </div>`;

  let data = null;
  let quotes = {};
  let lastLive = null;
  let lastRanked = null;
  let busy = false;
  const body = app.querySelector('#desk-body');
  const form = app.querySelector('#desk-form');

  const draw = () => {
    if (!data) return;
    const f = Object.fromEntries(new FormData(form));
    const budget = Math.max(50, Number(f.budget) || 1000);
    const riskPct = Number(f.riskPct) || 0.01;
    const fractional = f.fractional === 'on';
    const clock = nyClock();
    const recs = data.stocks.map((r) => applyQuote(r, quotes[r.symbol], clock));
    const market = { spy: data.market?.spy && applyQuote(data.market.spy, quotes.SPY, clock), qqq: data.market?.qqq && applyQuote(data.market.qqq, quotes.QQQ, clock) };
    const useUpModel = (data.model?.up?.metrics?.auc ?? 0) >= 0.53;
    const ranked = rankDesk(recs, { budget, riskPct, fractional, top: compact ? 6 : 8, marketOpen: clock.open, useUpModel });
    lastRanked = ranked;
    const tips = deskTips({ clock, market, budget, riskPct, ranked });
    const live = settings().finnhubKey && liveStatus.ok && lastLive;
    const dataAge = Math.round((Date.now() - Date.parse(data.updated)) / 60000);
    body.innerHTML = `
      <section class="session-bar">
        <div><span class="phase phase-${clock.phase}">${PHASES[clock.phase]}</span>
          <span class="muted small">${clock.minutesToClose != null ? `${fmtMins(clock.minutesToClose)} to the close` : clock.minutesToOpen != null ? `opens in ${fmtMins(clock.minutesToOpen)}` : ''}</span></div>
        <div class="mkt">${['spy', 'qqq'].map((k) => mktChip(k.toUpperCase(), market[k])).join('')}</div>
        <div class="freshness ${live ? 'live' : ''}" title="${live ? 'Live quotes from Finnhub every 30 seconds' : 'Add a free Finnhub key (Watchlist → Your account) for live prices every 30 seconds'}">
          <span class="dot"></span>${live ? `Live · ${new Date(lastLive).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : `Data from ${dataAge <= 1 ? 'just now' : `${fmtMins(dataAge)} ago`}`}
        </div>
      </section>
      ${!settings().finnhubKey ? `<div class="notice warn small">For prices that update every 30 seconds, add a free Finnhub key under <a href="#/" ${compact ? 'target="_blank"' : ''}>Watchlist → Your account → Real-time prices</a>. Without it, prices here update when the site does (a few times a day).</div>` : ''}
      ${data.source === 'demo' ? '<div class="notice warn small"><strong>Demo data.</strong> Simulated prices. Don\'t trade on them.</div>' : ''}

      <section class="picks">
        <h2>${clock.open ? 'Top picks right now' : 'Watchlist for the next session'} <span class="muted small">for a ${money(budget, 0)} budget · ${ranked.eligible} of ${ranked.total} stocks fit</span></h2>
        ${ranked.picks.length ? ranked.picks.map((p, i) => pickCard({ ...p, useUpModel }, i, compact, clock)).join('')
          : '<p class="muted">Nothing fits this budget and risk right now. Try a bigger budget, fractional shares, or 1% risk.</p>'}
      </section>

      ${ranked.avoid.length && !compact ? `<section class="card avoid"><h3>Weak today: avoid buying</h3><p class="small muted">${ranked.avoid.map((a) => `<a href="#/stock/${encodeURIComponent(a.symbol)}">${esc(a.symbol)}</a> <span class="down">${pct(a.chg, 1, true)}</span>`).join(' · ')}. These are below VWAP and falling.</p></section>` : ''}

      <section class="tips">
        <h2>Tips for right now</h2>
        <ul>${tips.map((t) => `<li class="tip ${t.tone}">${esc(t.text)}</li>`).join('')}</ul>
      </section>

      ${compact ? '' : '<section class="card"><h3>🤖 Want it to trade these by itself?</h3><p class="small">AutoPilot paper-trades the AI\'s picks with your rules: budget, loss limit, sectors and hours. <a href="#/autopilot">Set it up →</a></p></section>'}
      ${data.model && !compact ? modelCard(data.model) : ''}
      <p class="muted small">AI-ranked ideas, not advice. Day trading is risky and most day traders lose money. Practice first on the <a href="#/practice">Practice</a> tab.</p>`;
  };

  const refreshData = async () => {
    try {
      data = await getDeskData();
      draw();
    } catch (err) {
      body.innerHTML = `<div class="card"><p class="down">${esc(err.message)}</p></div>`;
    }
  };

  const refreshLive = async () => {
    if (busy || !data || !settings().finnhubKey || document.hidden) return;
    busy = true;
    try {
      // Live quotes for the stocks that matter right now (stays under Finnhub's free limit).
      const symbols = [...new Set(['SPY', 'QQQ', ...(lastRanked?.picks ?? []).map((p) => p.symbol), ...topByAi(data.stocks, 16)])].slice(0, 24);
      const q = await liveQuotes(symbols);
      if (Object.keys(q).length) { quotes = { ...quotes, ...q }; lastLive = Date.now(); }
      draw();
    } finally {
      busy = false;
    }
  };

  form.addEventListener('input', () => {
    const f = Object.fromEntries(new FormData(form));
    store.set('desk', { budget: Number(f.budget) || 1000, riskPct: Number(f.riskPct) || 0.01 });
    saveSettings({ fractional: f.fractional === 'on' });
    draw();
  });
  app.querySelector('#side-panel')?.addEventListener('click', openSidePanel);
  app.querySelector('#install')?.addEventListener('click', promptInstall);

  await refreshData();
  refreshLive();
  const t1 = setInterval(refreshLive, LIVE_EVERY);
  const t2 = setInterval(refreshData, DATA_EVERY);
  const t3 = setInterval(draw, 15e3); // keeps the clock, countdown and tips current
  return () => {
    clearInterval(t1); clearInterval(t2); clearInterval(t3);
    document.body.classList.remove('compact-mode');
  };
}

export function openSidePanel() {
  const w = 440, h = Math.min(screen.availHeight || 900, 1000);
  const url = `${location.href.split('#')[0]}#/desk?compact=1`;
  const win = window.open(url, 'stockwise-desk', `popup,width=${w},height=${h},left=${(screen.availWidth || 1400) - w},top=0`);
  if (!win) location.hash = '#/desk?compact=1'; // popup blocked → open here
}

function topByAi(stocks, n) {
  return [...stocks].sort((a, b) => (b.pBig ?? 0) - (a.pBig ?? 0)).slice(0, n).map((s) => s.symbol);
}

const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

function mktChip(name, m) {
  if (!m) return '';
  const last = m.intraday?.last ?? m.livePrice;
  if (!last) return `<span class="mkt-chip">${name}</span>`;
  const chg = last / m.prevClose - 1;
  return `<span class="mkt-chip ${toneOf(chg)}">${name} ${pct(chg, 2, true)}</span>`;
}

function pickCard(p, i, compact, clock) {
  const pl = p.plan;
  const biasLabel = { long: 'LONG', watch: 'WATCH' }[p.bias];
  const facts = [
    p.pBig != null ? `<span title="AI probability of a big-range day (good for day trading)">AI move odds <strong>${pct(p.pBig, 0)}</strong></span>` : '',
    p.pUp != null && p.useUpModel ? `<span title="AI probability the stock closes above its open">up-day <strong>${pct(p.pUp, 0)}</strong></span>` : '',
    p.intraday?.rvol ? `<span title="Volume today vs. normal for this time of day">RVOL <strong>${p.intraday.rvol.toFixed(1)}×</strong></span>` : '',
    p.aboveVwap != null ? `<span class="${p.aboveVwap ? 'up' : 'down'}">${p.aboveVwap ? 'above' : 'below'} VWAP</span>` : '',
  ].filter(Boolean).join('<span class="sep">·</span>');
  const target = compact ? 'target="_blank" rel="noopener"' : '';
  return `<article class="pick bias-${p.bias}">
    <div class="pick-top">
      <span class="rank">${i + 1}</span>
      <a class="sym" href="#/stock/${encodeURIComponent(p.symbol)}" ${target}>${esc(p.symbol)}</a>
      <span class="pick-price">${money(p.price)}</span>
      ${p.intraday ? `<span class="${toneOf(p.chg)} small">${pct(p.chg, 1, true)}</span>` : ''}
      <span class="bias-tag ${p.bias}">${biasLabel}</span>
      <span class="pick-score" title="Desk score (0–100)">${p.score}</span>
    </div>
    <div class="pick-facts small">${facts}</div>
    <div class="pick-plan">
      <span>Entry <strong>${money(pl.entry)}</strong></span>
      <span>Stop <strong class="down">${money(pl.stop)}</strong></span>
      <span>Targets <strong class="up">${money(pl.t1)}</strong> / <strong class="up">${money(pl.t2)}</strong></span>
    </div>
    <div class="pick-size small">Buy <strong>${pl.shares}</strong> sh ≈ ${money(pl.cost, 0)} · max loss <span class="down">${money(pl.maxLoss)}</span> · sell ½ at target 1, move stop to entry</div>
    ${brokerTicket({ ...p, compact })}
    ${compact ? '' : `<div class="pick-how small muted">${esc(pl.how)}${p.why?.length ? ` <em>AI is watching: ${p.why.map((w) => esc(w.label.toLowerCase())).join(', ')}.</em>` : ''}</div>`}
  </article>`;
}

// The exact order to type into a broker ticket (Schwab / thinkorswim and most others):
// a "1st Triggers OCO" bracket: buy first; once filled, a stop-loss and a profit target go live,
// and whichever fills first cancels the other.
function brokerTicket(p) {
  const pl = p.plan;
  const breakout = pl.entry > p.price * 1.0005;
  return `<details class="broker-ticket small">
    <summary>How to enter this at your broker</summary>
    <p>Conditional: <strong>1st Triggers OCO</strong> (not plain "OCO": that's only for exiting shares you already own).</p>
    <ol>
      <li><strong>Order 1 (entry):</strong> Buy ${pl.shares} ${esc(p.symbol)} · ${breakout ? `<strong>Stop market</strong> ${money(pl.entry)}` : `<strong>Limit</strong> ${money(pl.entry)}`} · Day
        <div class="muted">${breakout ? 'A buy stop fills only if the price rises to the trigger: that\'s the breakout confirmation.' : 'A buy limit fills at this price or lower.'}</div></li>
      <li><strong>Order 2 (stop-loss):</strong> Sell ${pl.shares} ${esc(p.symbol)} · <strong>Stop market</strong> ${money(pl.stop)} · Day</li>
      <li><strong>Order 3 (profit target):</strong> Sell ${pl.shares} ${esc(p.symbol)} · <strong>Limit</strong> ${money(pl.t2)} · Day
        <div class="muted">Target 2 (2× your risk). If you'd rather lock in half early, sell half by hand at Target 1 (${money(pl.t1)}).</div></li>
    </ol>
    <p class="muted">Orders 2 and 3 only go live after Order 1 fills, and whichever fills first cancels the other. "Day" orders expire at 4:00 PM, so if you're still holding near the close, sell manually (day trades shouldn't go overnight). Review everything before you submit: you're placing it, not StockWise.</p>
    <a class="btn small-btn" href="#/order?symbol=${encodeURIComponent(p.symbol)}&shares=${pl.shares}&entryType=${breakout ? 'stop' : 'limit'}&entry=${pl.entry}&stop=${pl.stop}&target=${pl.t2}&timing=DAY" ${p.compact ? 'target="_blank" rel="noopener"' : ''}>Step-by-step guide for your broker →</a>
  </details>`;
}

function modelCard(m) {
  const b = m.big.metrics, u = m.up.metrics;
  return `<section class="card model-card">
    <h2>About the AI</h2>
    <p>StockWise trains its own machine-learning model (logistic regression, not a chatbot) on <strong>${m.samples.toLocaleString('en-US')}</strong> past trading days from about 130 stocks, every time the site updates. It looks at 12 things about yesterday (move, gap, range, volume, RSI, trend, volatility, momentum, strength vs. the S&amp;P 500…) and predicts tomorrow.</p>
    <div class="big-stats four">
      <div><span class="label">Big-mover hit rate</span><span class="value">${pct(b.top10Rate, 0)}</span><span class="sub">of its top-10% picks vs ${pct(b.baseRate, 0)} average</span></div>
      <div><span class="label">Big-mover AUC</span><span class="value">${b.auc.toFixed(2)}</span><span class="sub">0.50 = coin flip, 1.00 = perfect</span></div>
      <div><span class="label">Up-day AUC</span><span class="value">${u.auc.toFixed(2)}</span><span class="sub">${u.auc < 0.53 ? 'no better than a coin flip lately, so it\'s switched off in the score' : 'a small edge, so it gets a small vote'}</span></div>
      <div><span class="label">Tested on</span><span class="value">${m.testSamples.toLocaleString('en-US')}</span><span class="sub">unseen days since ${esc(m.testFrom)}</span></div>
    </div>
    <p class="small muted">Honest read: predicting <em>which</em> stocks will move a lot is doable. Predicting <em>direction</em> is close to a coin flip, which is why every pick needs a confirmation entry (a breakout or VWAP hold) and a stop. The desk score also blends in live momentum, relative volume and price vs. VWAP.</p>
  </section>`;
}
