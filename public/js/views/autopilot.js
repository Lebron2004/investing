import { getReplayData, getIntradayDays, settings, money, pct, esc, toneOf } from '../api.js';
import { SECTORS } from '../lib/universe.js';
import { nyClock, PHASES } from '../lib/daytrade.js';
import { normalizeRules, ruleWarnings, replay, tune, botStats, fmtMin, previewEntry, pickWatchlist, triggerOf, OPEN_MIN } from '../lib/autopilot.js';
import { botState, onBotChange, startBot, stopBot, stopForToday, saveRules, resetBot } from '../bot.js';

const SECTOR_NAMES = [...SECTORS.map((s) => s.name), 'ETF'];
const timeOpts = (list, sel) => list.map(([v, l]) => `<option value="${v}" ${Number(sel) === v ? 'selected' : ''}>${l}</option>`).join('');
const LAST_ENTRY = [[630, '10:30am'], [690, '11:30am'], [780, '1:00pm'], [840, '2:00pm'], [900, '3:00pm'], [930, '3:30pm']];
const FLAT = [[900, '3:00pm'], [930, '3:30pm'], [945, '3:45pm'], [955, '3:55pm']];

export async function renderAutopilot(app) {
  app.innerHTML = `
    <section class="page-head">
      <h1>AutoPilot <span class="badge flat">Paper money</span></h1>
      <p class="lede">A day-trading bot that follows <strong>your</strong> rules: how much money it may use today, how much it may lose, which markets it may trade and when. It trades a practice account with fake money, so you can watch how it behaves, test it on past days and train it before you trust any of its ideas with real money.</p>
    </section>
    <div class="notice small"><strong>Paper only.</strong> AutoPilot never touches your real brokerage account: StockWise can't log in to Schwab or place orders there. If you like what it does, you can copy any of its setups into your own account with the <a href="#/order">Order Helper</a>, and you press the button yourself.</div>
    <section class="card ap-status" id="ap-status"></section>
    <div class="ap-grid">
      <form class="card form" id="ap-rules" autocomplete="off"></form>
      <section class="card" id="ap-report"></section>
    </div>
    <section class="card" id="ap-lab"></section>
    <section class="card ap-how">
      <h2>How AutoPilot trades</h2>
      <ol>
        <li><strong>Before the open</strong> it picks a short watchlist: stocks your rules allow, ranked by StockWise's own AI (the "big move today" model that's been better than a coin flip on unseen days). No chatbot involved.</li>
        <li><strong>It waits</strong> for the opening range (the first 15, 30 or 60 minutes) to set a high and a low.</li>
        <li><strong>It buys</strong> only when the price breaks above that high, and only if the S&amp;P 500 is up on the day (unless you turn that filter off). It won't chase a stock that jumped too far past the trigger.</li>
        <li><strong>Every buy is protected</strong>: a stop-loss under the opening range and a profit target at 2× the risk (you choose). Once a trade is up 1× its risk, the stop moves to break-even.</li>
        <li><strong>It sells everything before the close.</strong> Nothing is held overnight.</li>
      </ol>
      <h3>Limits it can never break</h3>
      <ul class="small">
        <li>Never spends more than today's budget, and never more cash than the account has. Long only: no shorting, no options, no margin.</li>
        <li>Sizes every trade so the loss at the stop is no more than your risk per trade <em>and</em> what's left of your daily loss limit. It stops for the day when the limit is hit. (A price that jumps straight through a stop can still lose a bit more. That happens in real trading too.)</li>
        <li>Trades only the sectors or symbols you allow, inside your price range, during your hours, and no more trades or positions than you set.</li>
        <li>Optional pattern-day-trader rule (3 day trades per 5 business days) and cash-account rule (each dollar used once a day, because unsettled cash can't be reused).</li>
      </ul>
      <p class="small muted">Honest expectations: day trading is hard, and most people who do it lose money. The AI is decent at spotting stocks that will <em>move</em>, not which <em>direction</em>. That's why every trade waits for a breakout and has a stop. Judge the bot by weeks of paper results, not one good day.</p>
    </section>`;

  const statusEl = app.querySelector('#ap-status');
  const form = app.querySelector('#ap-rules');
  const reportEl = app.querySelector('#ap-report');
  const lab = app.querySelector('#ap-lab');

  drawRules(form, botState().rules);
  drawStatus(statusEl, botState());
  drawReport(reportEl, botState());
  drawLab(lab, form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const rules = saveRules(readRules(form));
    drawRules(form, rules, 'Saved. The bot uses these rules from now on.');
  });
  form.addEventListener('input', () => {
    const warn = ruleWarnings(normalizeRules(readRules(form)));
    form.querySelector('#ap-warn').innerHTML = warn.map((w) => `<li>${esc(w)}</li>`).join('');
    form.querySelector('.ap-sectors').classList.toggle('dim', !!form.elements.allow.value.trim());
  });

  statusEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'start') startBot();
    if (b.dataset.act === 'stop' && confirm('Turn AutoPilot off? Anything it holds is sold at the last price it saw.')) stopBot();
    if (b.dataset.act === 'today' && confirm('Stop trading for the rest of today? Anything it holds is sold at the last price it saw.')) stopForToday();
    if (b.dataset.act === 'notify') Notification.requestPermission().then(() => drawStatus(statusEl, botState()));
  });
  reportEl.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="reset"]')) return;
    const v = Number(prompt('Start a fresh paper account with how much (fake) money?', botState().account.startCash));
    if (v >= 10) { resetBot(v); drawRules(form, botState().rules); }
  });

  const off = onBotChange((st) => { drawStatus(statusEl, st); drawReport(reportEl, st); });
  const t = setInterval(() => drawStatus(statusEl, botState()), 15e3);
  return () => { off(); clearInterval(t); };
}

// --- Rules form -----------------------------------------------------------------------------
function drawRules(form, r, saved = '') {
  form.innerHTML = `
    <h2>Your rules</h2>
    <fieldset><legend>Money</legend>
      <div class="row">
        <label>Today's budget<div class="input-prefix"><span>$</span><input name="budget" type="number" min="10" step="any" value="${r.budget}"></div><span class="hint">Most it can put into trades in one day.</span></label>
        <label>Risk per trade<select name="riskPct">${[[0.005, '0.5% of budget'], [0.01, '1% of budget'], [0.02, '2% of budget'], [0.03, '3% of budget']].map(([v, l]) => `<option value="${v}" ${r.riskPct === v ? 'selected' : ''}>${l} (${money(r.budget * v)})</option>`).join('')}</select><span class="hint">Most it can lose on one trade.</span></label>
      </div>
      <div class="row three">
        <label>Daily loss limit<div class="input-prefix"><span>$</span><input name="maxDailyLoss" type="number" min="0.5" step="any" value="${r.maxDailyLoss}"></div></label>
        <label>Trades per day<input name="maxTrades" type="number" min="1" max="20" value="${r.maxTrades}"></label>
        <label>Positions at once<input name="maxOpen" type="number" min="1" max="5" value="${r.maxOpen}"></label>
      </div>
      <label class="check"><input type="checkbox" name="cashAccount" ${r.cashAccount ? 'checked' : ''}> Cash account: use each dollar only once a day (money from a sale isn't settled until the next business day)</label>
      <label class="check"><input type="checkbox" name="pdt" ${r.pdt ? 'checked' : ''}> Pattern-day-trader rule: at most 3 day trades in 5 business days</label>
      <label class="check"><input type="checkbox" name="fractional" ${r.fractional ? 'checked' : ''}> Fractional shares</label>
    </fieldset>
    <fieldset><legend>Markets it may trade</legend>
      <div class="ap-sectors ${r.allow.length ? 'dim' : ''}">${SECTOR_NAMES.map((n) => `<label class="chip-check"><input type="checkbox" name="sector" value="${esc(n)}" ${!r.sectors || r.sectors.includes(n) ? 'checked' : ''}> ${n === 'ETF' ? 'Sector ETFs' : esc(n)}</label>`).join('')}</div>
      <label>Only these symbols <span class="hint">(optional, overrides sectors)</span><input name="allow" value="${esc(r.allow.join(', '))}" placeholder="e.g. SOFI, F, PLTR"></label>
      <label>Never these symbols<input name="block" value="${esc(r.block.join(', '))}" placeholder="e.g. TSLA"></label>
      <div class="row three">
        <label>Min price<div class="input-prefix"><span>$</span><input name="minPrice" type="number" min="0" step="any" value="${r.minPrice}"></div></label>
        <label>Max price<div class="input-prefix"><span>$</span><input name="maxPrice" type="number" min="0" step="any" value="${r.maxPrice || ''}" placeholder="no limit"></div></label>
        <label>Stocks to watch<input name="watch" type="number" min="1" max="12" value="${r.watch}"></label>
      </div>
    </fieldset>
    <fieldset><legend>Timing and exits</legend>
      <div class="row three">
        <label>Opening range<select name="orMinutes">${timeOpts([[15, 'First 15 min'], [30, 'First 30 min'], [60, 'First hour']], r.orMinutes)}</select></label>
        <label>Last buy by<select name="lastEntryMin">${timeOpts(LAST_ENTRY, r.lastEntryMin)}</select></label>
        <label>Sell everything at<select name="flatMin">${timeOpts(FLAT, r.flatMin)}</select></label>
      </div>
      <div class="row">
        <label>Profit target<select name="targetR">${timeOpts([[1, '1× the risk'], [1.5, '1.5× the risk'], [2, '2× the risk'], [3, '3× the risk']], r.targetR)}</select></label>
        <label>Break-even stop<select name="breakevenR">${timeOpts([[1, 'At 1× profit'], [0, 'Off']], r.breakevenR)}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="marketFilter" ${r.marketFilter ? 'checked' : ''}> Only buy while the S&amp;P 500 (SPY) is up on the day</label>
    </fieldset>
    <ul class="ap-warn small" id="ap-warn">${ruleWarnings(r).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
    <div class="ap-save"><button class="btn" type="submit">Save rules</button><span class="small up">${esc(saved)}</span></div>
    <p class="small muted">Paper account: ${money(r.startCash)} to start. To change that, use "Start over" in the report card.</p>`;
}

function readRules(form) {
  const f = new FormData(form);
  const n = (k) => (f.get(k) === '' || f.get(k) == null ? undefined : Number(f.get(k)));
  const sectors = f.getAll('sector');
  return {
    budget: n('budget'), riskPct: n('riskPct'), maxDailyLoss: n('maxDailyLoss'), maxTrades: n('maxTrades'), maxOpen: n('maxOpen'),
    cashAccount: f.get('cashAccount') === 'on', pdt: f.get('pdt') === 'on', fractional: f.get('fractional') === 'on',
    sectors: sectors.length === SECTOR_NAMES.length ? null : sectors.length ? sectors : ['(none)'],
    allow: f.get('allow'), block: f.get('block'), minPrice: n('minPrice') ?? 0, maxPrice: n('maxPrice') ?? 0, watch: n('watch'),
    orMinutes: n('orMinutes'), lastEntryMin: n('lastEntryMin'), flatMin: n('flatMin'), targetR: n('targetR'), breakevenR: n('breakevenR'),
    marketFilter: f.get('marketFilter') === 'on',
  };
}

// --- Live status ----------------------------------------------------------------------------
function drawStatus(el, st) {
  const clock = nyClock();
  const s = st.today?.day === clock.day ? st.today : null;
  const acct = st.account;
  const needsKey = st.enabled && (st.status === 'needs-key' || !settings().finnhubKey);
  const stale = st.enabled && st.lastTick && Date.now() - st.lastTick > 120e3;
  const statusText = !st.enabled ? 'Off. Press Start and keep a StockWise page open during market hours.'
    : needsKey ? '' : st.status === 'running' ? 'Running: checking prices every 30 seconds.' : st.status || 'Starting…';
  const open = s?.positions || [];
  const lastPx = (sym) => s?.watch[sym]?.last;
  const unreal = open.reduce((a, p) => a + ((lastPx(p.symbol) ?? p.entry) - p.entry) * p.shares, 0);
  const notifyBtn = 'Notification' in window && Notification.permission === 'default' ? '<button class="btn ghost small-btn" data-act="notify" type="button">🔔 Notify me of trades</button>' : '';

  el.innerHTML = `
    <div class="ap-head">
      <div class="ap-switch ${st.enabled ? 'on' : ''}">
        <span class="dot"></span><strong>${st.enabled ? 'AutoPilot is ON' : 'AutoPilot is OFF'}</strong>
        <span class="phase phase-${clock.phase}">${PHASES[clock.phase]}</span>
      </div>
      <div class="ap-buttons">
        ${st.enabled ? `${s && !s.done && !s.halted ? '<button class="btn ghost small-btn" data-act="today" type="button">Stop for today</button>' : ''}<button class="btn danger small-btn" data-act="stop" type="button">■ Turn off</button>`
          : '<button class="btn" data-act="start" type="button">▶ Start AutoPilot</button>'}
        ${notifyBtn}
      </div>
    </div>
    ${statusText ? `<p class="small muted">${esc(statusText)}</p>` : ''}
    ${needsKey ? '<div class="notice warn small"><strong>Live prices needed.</strong> AutoPilot needs real-time prices to trade. Add a free Finnhub key under <a href="#/">Watchlist → Your account → Real-time prices</a>. Takes about a minute. Meanwhile you can still <strong>Test</strong> and <strong>Train</strong> it on past days below.</div>' : ''}
    ${stale ? '<div class="notice warn small">The bot hasn\'t checked prices in over 2 minutes. Keep this site open (a background tab is fine), and keep your computer from sleeping during market hours.</div>' : ''}
    <div class="big-stats four">
      <div><span class="label">Paper cash</span><span class="value">${money(acct.cash + open.reduce((a, p) => a + p.shares * p.entry, 0) + unreal)}</span><span class="sub">started with ${money(acct.startCash)}</span></div>
      <div><span class="label">Today</span><span class="value ${toneOf(s ? s.realized + unreal : 0)}">${s ? `${s.realized + unreal >= 0 ? '+' : '−'}${money(Math.abs(s.realized + unreal))}` : '—'}</span><span class="sub">${s ? `${s.trades} of ${s.rules.maxTrades} trades used` : 'no trades yet today'}</span></div>
      <div><span class="label">Loss limit left</span><span class="value">${s ? money(Math.max(0, s.rules.maxDailyLoss + Math.min(0, s.realized))) : money(st.rules.maxDailyLoss)}</span><span class="sub">of ${money(st.rules.maxDailyLoss)} a day</span></div>
      <div><span class="label">Budget left</span><span class="value">${s ? money(Math.max(0, s.rules.budget - (s.rules.cashAccount ? s.spent : open.reduce((a, p) => a + p.shares * p.entry, 0)))) : money(st.rules.budget)}</span><span class="sub">${st.rules.pdt && s ? `${Math.min(3, s.pdtUsed)} of 3 day trades used (5 days)` : 'today'}</span></div>
    </div>
    ${s?.halted ? `<div class="notice warn small">${esc(s.halted)}</div>` : ''}
    ${s ? watchTable(s, acct) : ''}
    ${s?.log.length ? `<h3>What it's doing</h3><ul class="ap-log">${s.log.slice(-40).reverse().map((l) => `<li class="log-${l.kind}"><span class="t">${fmtMin(l.m)}</span>${esc(l.text)}</li>`).join('')}</ul>` : ''}`;
}

function watchTable(s, acct) {
  const syms = Object.keys(s.watch);
  if (!syms.length) return '<p class="muted small">Nothing on the watchlist today. Loosen your rules (more sectors, higher max price, bigger budget) to give it more choices.</p>';
  const rows = syms.map((sym) => {
    const w = s.watch[sym];
    const pos = s.positions.find((p) => p.symbol === sym);
    const orEndMin = OPEN_MIN + s.rules.orMinutes;
    let state, copy = '';
    if (pos) {
      const pl = ((w.last ?? pos.entry) - pos.entry) * pos.shares;
      state = `<span class="bias-tag long">HOLDING</span> ${pos.shares} @ ${money(pos.entry)} · stop ${money(pos.stop)} · target ${money(pos.target)} · <span class="${toneOf(pl)}">${pl >= 0 ? '+' : '−'}${money(Math.abs(pl))}</span>`;
    } else if (w.status === 'waiting') {
      const prev = previewEntry(s, sym, acct);
      state = w.orDone ? `Waiting for a break above <strong>${money(triggerOf(w))}</strong>${w.orEstimated ? ' <span class="muted">(range estimated)</span>' : ''}` : `Watching the opening range until ${fmtMin(orEndMin)}`;
      if (prev) copy = `<a class="small" href="#/order?symbol=${encodeURIComponent(sym)}&shares=${prev.shares}&entryType=stop&entry=${prev.trigger}&stop=${prev.stop}&target=${prev.target}&timing=DAY" title="Place the same bracket order in your own account">Copy setup →</a>`;
    } else {
      state = `<span class="muted">${w.status === 'done' ? 'Traded today' : esc(w.note || 'Skipped')}</span>`;
    }
    return `<tr><td><a href="#/stock/${encodeURIComponent(sym)}"><strong>${esc(sym)}</strong></a><div class="sub">AI move odds ${w.pBig != null ? pct(w.pBig, 0) : '—'}</div></td>
      <td class="num">${w.last != null ? money(w.last) : '—'}${w.orDone ? `<div class="sub">range ${money(w.orLow)}–${money(w.orHigh)}</div>` : ''}</td>
      <td>${state}</td><td class="num">${copy}</td></tr>`;
  }).join('');
  return `<h3>Today's watchlist</h3><div class="table-wrap"><table class="table compact"><thead><tr><th>Stock</th><th class="num">Price</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// --- Paper results ----------------------------------------------------------------------------
function drawReport(el, st) {
  const stats = botStats(st.account, st.rules);
  const trades = st.account.trades.slice(-15).reverse();
  el.innerHTML = `
    <h2>Report card <span class="muted small">live paper trading</span></h2>
    ${stats.days ? `
      ${statGrid(stats)}
      ${dayBars(st.account.days.slice(-30))}
      ${trades.length ? tradeTable(trades) : ''}
      <p class="small muted">Give it at least 20 trading days before judging. A handful of trades is mostly luck.</p>`
      : '<p class="muted">No finished days yet. Turn AutoPilot on during market hours (9:30am–4pm New York time) and keep a StockWise page open. Results show up here after each day. Want answers now? Use <strong>Test on past days</strong> below.</p>'}
    <button class="btn ghost small-btn" data-act="reset" type="button">Start over with a new paper account</button>`;
}

function statGrid(s) {
  return `<div class="big-stats four">
    <div><span class="label">Profit / loss</span><span class="value ${toneOf(s.pl)}">${s.pl >= 0 ? '+' : '−'}${money(Math.abs(s.pl))}</span><span class="sub">${pct(s.ret, 1, true)} over ${s.days} day${s.days === 1 ? '' : 's'}</span></div>
    <div><span class="label">Win rate</span><span class="value">${s.winRate != null ? pct(s.winRate, 0) : '—'}</span><span class="sub">${s.trades} trade${s.trades === 1 ? '' : 's'}</span></div>
    <div><span class="label">Avg. trade</span><span class="value ${toneOf(s.avgR)}">${s.avgR != null ? `${s.avgR > 0 ? '+' : ''}${s.avgR}R` : '—'}</span><span class="sub">R = what it risked. Above 0 = an edge</span></div>
    <div><span class="label">Worst drop</span><span class="value down">${money(s.maxDrawdown)}</span><span class="sub">worst day ${s.worstDay != null ? money(s.worstDay) : '—'}</span></div>
  </div>`;
}

function dayBars(days) {
  if (!days.length) return '';
  const max = Math.max(1e-9, ...days.map((d) => Math.abs(d.pl)));
  const W = 600, H = 120, bw = W / days.length;
  return `<svg class="ap-days" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profit or loss for each day">
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="zero"/>
    ${days.map((d, i) => {
      const h = (Math.abs(d.pl) / max) * (H / 2 - 4);
      return `<rect class="${d.pl >= 0 ? 'up' : 'down'}" x="${i * bw + bw * 0.15}" width="${bw * 0.7}" y="${d.pl >= 0 ? H / 2 - h : H / 2}" height="${Math.max(d.trades ? 1 : 0, h)}"><title>${d.day}: ${d.pl >= 0 ? '+' : '−'}$${Math.abs(d.pl).toFixed(2)} (${d.trades} trade${d.trades === 1 ? '' : 's'})${d.halted ? ' · loss limit hit' : ''}</title></rect>`;
    }).join('')}
  </svg><div class="small muted ap-days-cap"><span>${days[0].day}</span><span>Profit or loss each day</span><span>${days.at(-1).day}</span></div>`;
}

function tradeTable(trades, { replayable = false } = {}) {
  return `<div class="table-wrap"><table class="table compact ap-trades"><thead><tr><th>Day</th><th>Stock</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">P/L</th><th>Why it sold</th>${replayable ? '<th></th>' : ''}</tr></thead><tbody>
    ${trades.map((t, i) => `<tr><td>${t.day.slice(5)}<div class="sub">${fmtMin(t.entryM)}–${fmtMin(t.exitM)}</div></td><td><strong>${esc(t.symbol)}</strong><div class="sub">${t.shares} sh</div></td>
      <td class="num">${money(t.entry)}</td><td class="num">${money(t.exit)}</td>
      <td class="num ${toneOf(t.pl)}">${t.pl >= 0 ? '+' : '−'}${money(Math.abs(t.pl))}<div class="sub">${t.R > 0 ? '+' : ''}${t.R}R</div></td><td class="small">${esc(t.why)}</td>
      ${replayable ? `<td><button class="btn ghost small-btn" type="button" data-trade="${i}">Watch</button></td>` : ''}</tr>`).join('')}
  </tbody></table></div>`;
}

// --- Test & Train on past days ----------------------------------------------------------------
function drawLab(el, form) {
  el.innerHTML = `
    <h2>Test &amp; train on past days</h2>
    <p>Don't wait weeks to find out: run the bot, with the rules above, through recent trading days using real 5-minute prices. It makes the same decisions it would have made live, using only what it would have known that morning.</p>
    <div class="ap-lab-controls">
      <label>Days<select id="lab-scope"><option value="unseen">Days the AI never trained on (most honest)</option><option value="all">All recent days</option></select></label>
      <button class="btn" id="lab-test" type="button">▶ Test my rules</button>
      <button class="btn ghost" id="lab-train" type="button">🎓 Train: find better settings</button>
    </div>
    <div id="lab-out"></div>`;
  const out = el.querySelector('#lab-out');
  let last = null;
  const run = async (mode) => {
    const rules = normalizeRules({ ...readRules(form), startCash: botState().account.startCash });
    out.innerHTML = '<p class="loading">Loading past days…</p>';
    try {
      const days = await loadDays(rules, el.querySelector('#lab-scope').value, (msg) => { out.innerHTML = `<p class="loading">${esc(msg)}</p>`; });
      if (!days.length) { out.innerHTML = '<p class="muted">No past days are available yet. They appear after the next site update.</p>'; return; }
      await new Promise((r) => setTimeout(r, 0));
      if (mode === 'test') {
        const res = replay(rules, days.list);
        last = { res, days: days.list };
        out.innerHTML = testResult(res, days);
      } else {
        out.innerHTML = '<p class="loading">Training: trying 36 combinations of settings…</p>';
        await new Promise((r) => setTimeout(r, 30));
        out.innerHTML = trainResult(tune(rules, days.list), days);
      }
    } catch (err) {
      out.innerHTML = `<p class="down">${esc(err.message)}</p>`;
    }
  };
  el.querySelector('#lab-test').addEventListener('click', () => run('test'));
  el.querySelector('#lab-train').addEventListener('click', () => run('train'));
  out.addEventListener('click', (e) => {
    const b = e.target.closest('[data-trade]');
    if (b && last) {
      const t = last.res.account.trades[Number(b.dataset.trade)];
      const box = out.querySelector('#lab-watch');
      box.innerHTML = watchTrade(t, last);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const apply = e.target.closest('[data-apply]');
    if (apply) {
      const settingsJson = JSON.parse(apply.dataset.apply);
      const rules = saveRules({ ...readRules(form), ...settingsJson });
      drawRules(form, rules, 'Trained settings saved.');
      apply.textContent = '✓ Using these settings';
      apply.disabled = true;
    }
  });
}

// Loads the past sessions and the 5-minute bars of every stock the bot could have watched.
async function loadDays(rules, scope, progress) {
  const data = await getReplayData();
  let days = data.days || [];
  const unseen = scope === 'unseen' && data.testFrom;
  if (unseen) days = days.filter((d) => d >= data.testFrom);
  const list = days.map((day) => ({
    day,
    records: (data.records[day] || []).map(([symbol, prevClose, atr, pBig, dollarVol]) => ({ symbol, sector: data.sectors[symbol], prevClose, atr, pBig, dollarVol })),
    spy: data.spy[day] || [],
    bars: {},
  }));
  // Load a few extra per day: as cash changes, the watchlist can shift a little.
  const need = new Set();
  for (const d of list) {
    for (const r of pickWatchlist(d.records, { ...rules, watch: rules.watch + 4 }, null).watch) need.add(r.symbol);
  }
  const syms = [...need];
  let done = 0;
  const loaded = {};
  const q = [...syms];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const sym = q.shift();
      loaded[sym] = await getIntradayDays(sym).catch(() => ({}));
      progress(`Loading 5-minute prices… ${++done} of ${syms.length} stocks`);
    }
  }));
  for (const d of list) for (const sym of syms) if (loaded[sym]?.[d.day]) d.bars[sym] = loaded[sym][d.day];
  return { list, from: days[0], to: days.at(-1), unseen, source: data.source, length: list.length };
}

function testResult(res, days) {
  const s = res.stats;
  return `
    <p class="small muted">${days.length} trading days, ${esc(days.from)} to ${esc(days.to)}${days.unseen ? ', all after the AI\'s training cut-off' : ''}. Same rules, same ${money(s.rules.startCash)} paper account.${days.source === 'demo' ? ' <strong class="down">Simulated prices (demo data): the results are meaningless.</strong>' : ''}</p>
    ${statGrid(s)}
    ${verdict(s)}
    ${dayBars(res.account.days)}
    ${res.account.trades.length ? `<h3>Every trade it made</h3><p class="small muted">Press <strong>Watch</strong> to see the trade on that day's chart, with the bot's reasoning.</p><div id="lab-watch"></div>${tradeTable(res.account.trades, { replayable: true })}` : '<p class="muted">It didn\'t find a single trade that fit your rules. Try allowing more sectors, a higher max price, or turning off the S&amp;P 500 filter.</p>'}`;
}

function verdict(s) {
  if (s.trades < 10) return `<div class="notice small">Only ${s.trades} trades: too few to judge. Test over all recent days or loosen the rules for a bigger sample.</div>`;
  if (s.avgR > 0.15 && s.profitFactor > 1.2) return '<div class="notice small"><strong>Promising on these days.</strong> Past results don\'t guarantee anything. Next step: let it paper trade live for a few weeks and see if it holds up.</div>';
  if (s.avgR > 0) return '<div class="notice small"><strong>Roughly break-even.</strong> Slightly positive, but small enough to be luck. Keep it on paper.</div>';
  return '<div class="notice warn small"><strong>Lost money on these days.</strong> That\'s normal for most strategies in some markets, and exactly why you test on paper first. Try Train, or different sectors.</div>';
}

const describe = (x) => `${x.orMinutes}-min range · target ${x.targetR}× · break-even ${x.breakevenR ? 'on' : 'off'} · ${x.marketFilter ? 'S&P filter' : 'any market'}`;
const fmtR = (r) => `${r > 0 ? '+' : ''}${r.toFixed(1)}R`;

function trainResult(t, days) {
  const b = t.best, c = t.current;
  return `
    <p class="small muted">Training happens on the older half (${t.trainDays.length} days: ${esc(t.trainDays[0] ?? '')} to ${esc(t.trainDays.at(-1) ?? '')}). Then the winner is checked on the newer half it never saw (${t.testDays.length} days: ${esc(t.testDays[0] ?? '')} to ${esc(t.testDays.at(-1) ?? '')}). That second number is the one that matters: any setting can look great on days it was picked on.${days.source === 'demo' ? ' <strong class="down">Simulated prices (demo data).</strong>' : ''}</p>
    <div class="table-wrap"><table class="table compact"><thead><tr><th></th><th>Settings</th><th class="num">Training days</th><th class="num">Unseen days</th></tr></thead><tbody>
      <tr><td><strong>Best found</strong></td><td>${describe(b.settings)}</td><td class="num ${toneOf(b.train.totalR)}">${fmtR(b.train.totalR)} <span class="sub">${b.train.trades} trades</span></td><td class="num ${toneOf(b.test.totalR)}"><strong>${fmtR(b.test.totalR)}</strong> <span class="sub">${b.test.trades} trades</span></td></tr>
      <tr><td>Your current</td><td>${describe(c.settings)}</td><td class="num ${toneOf(c.train.totalR)}">${fmtR(c.train.totalR)} <span class="sub">${c.train.trades} trades</span></td><td class="num ${toneOf(c.test.totalR)}"><strong>${fmtR(c.test.totalR)}</strong> <span class="sub">${c.test.trades} trades</span></td></tr>
    </tbody></table></div>
    <p class="small muted">R = units of risk. +5R means it made 5× what it risked per trade in total (with 2% risk on $100, that's 5 × $2 = $10).</p>
    ${t.heldUp
      ? `<div class="notice small"><strong>The trained settings also did better on the unseen days.</strong> That's a good sign, though still no guarantee. <button class="btn small-btn" type="button" data-apply='${esc(JSON.stringify(b.settings))}'>Use these settings</button></div>`
      : `<div class="notice warn small"><strong>The "best" settings didn't hold up on unseen days</strong> (or nothing made money there). Changing settings would just be fitting past noise, so keep your current ones and gather more paper results. ${JSON.stringify(b.settings) !== JSON.stringify(c.settings) ? `<button class="btn ghost small-btn" type="button" data-apply='${esc(JSON.stringify(b.settings))}'>Use them anyway</button>` : ''}</div>`}
    <details class="small"><summary>Top 5 on the training days</summary><ol>${t.leaderboard.map((x) => `<li>${describe(x.settings)}: ${fmtR(x.train.totalR)} (${x.train.trades} trades, ${x.train.winRate != null ? pct(x.train.winRate, 0) : '—'} wins)</li>`).join('')}</ol></details>`;
}

// One past trade on its 5-minute chart, plus the bot's own log for that stock that day.
function watchTrade(t, { res, days }) {
  const d = days.find((x) => x.day === t.day);
  const bars = d?.bars[t.symbol] || [];
  const s = res.dayStates.find((x) => x.day === t.day);
  const w = s?.watch[t.symbol];
  const notes = (s?.log || []).filter((l) => l.symbol === t.symbol || l.kind === 'halt');
  return `<div class="ap-watch">
    <h3>${esc(t.symbol)} on ${esc(t.day)} <span class="${toneOf(t.pl)}">${t.pl >= 0 ? '+' : '−'}${money(Math.abs(t.pl))}</span></h3>
    ${bars.length ? dayChart(bars, { orEnd: OPEN_MIN + res.stats.rules.orMinutes, orHigh: w?.orHigh, orLow: w?.orLow, t }) : '<p class="muted">No chart for this day.</p>'}
    <ul class="ap-log">${notes.map((l) => `<li class="log-${l.kind}"><span class="t">${fmtMin(l.m)}</span>${esc(l.text)}</li>`).join('')}</ul>
  </div>`;
}

function dayChart(bars, { orEnd, orHigh, orLow, t }) {
  const W = 640, H = 240, padL = 8, padR = 54, padT = 10, padB = 18;
  const lo = Math.min(...bars.map((b) => b[3]), t.stop), hi = Math.max(...bars.map((b) => b[2]), t.target);
  const x = (m) => padL + ((m - OPEN_MIN) / 390) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const cw = Math.max(1.5, ((W - padL - padR) / 78) * 0.6);
  const hline = (v, cls, label) => `<line class="${cls}" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="lbl ${cls}" x="${W - padR + 4}" y="${y(v) + 4}">${label}</text>`;
  return `<svg class="ap-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="5-minute chart of ${esc(t.symbol)} on ${esc(t.day)}">
    ${orHigh ? `<rect class="or" x="${x(OPEN_MIN)}" width="${x(orEnd) - x(OPEN_MIN)}" y="${y(orHigh)}" height="${Math.max(1, y(orLow) - y(orHigh))}"/>` : ''}
    ${hline(t.target, 'tgt', 'target')}${hline(t.stop, 'stop', 'stop')}
    ${bars.map(([m, o, h, l, c]) => `<line class="wick ${c >= o ? 'up' : 'down'}" x1="${x(m + 2.5)}" x2="${x(m + 2.5)}" y1="${y(h)}" y2="${y(l)}"/><rect class="body ${c >= o ? 'up' : 'down'}" x="${x(m + 2.5) - cw / 2}" width="${cw}" y="${y(Math.max(o, c))}" height="${Math.max(0.8, Math.abs(y(o) - y(c)))}"/>`).join('')}
    <g class="mark buy"><circle cx="${x(t.entryM + 2.5)}" cy="${y(t.entry)}" r="6"/><text x="${x(t.entryM + 2.5) - 10}" y="${y(t.entry) + 4}" text-anchor="end">BUY</text></g>
    <g class="mark sell"><circle cx="${x(t.exitM + 2.5)}" cy="${y(t.exit)}" r="6"/><text x="${x(t.exitM + 2.5) + 10}" y="${y(t.exit) + 4}">SELL</text></g>
    ${[600, 720, 840, 960].map((m) => `<text class="axis" x="${x(m)}" y="${H - 4}" text-anchor="middle">${fmtMin(m)}</text>`).join('')}
  </svg>
  <p class="small muted">Shaded box = opening range. The bot buys on a break above its top. Dashed lines = the stop-loss and the profit target it set at the buy.</p>`;
}
