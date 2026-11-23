import { money, pct, esc, toneOf } from '../api.js';
import { history } from '../cryptodata.js';
import { COINS, TIMEFRAMES, STRATEGIES, normalizeCryptoRules, replayCrypto, trainCrypto, describeCrypto, equity, cryptoStats } from '../lib/cryptobot.js';
import { cryptoState, onCryptoChange, startCrypto, stopCrypto, saveCryptoRules, resetCrypto, sellAllCrypto } from '../cryptorunner.js';

const TF_LABEL = { '1h': '1-hour candles (most trades)', '6h': '6-hour candles (balanced)', '1d': 'Daily candles (fewest trades)' };
const HISTORY_BARS = { '1h': 2000, '6h': 1500, '1d': 1000 }; // ~3 months, ~1 year, ~2.7 years
const fmtT = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtD = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const signed = (v) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;

export async function renderCrypto(app) {
  app.innerHTML = `
    <section class="page-head">
      <h1>Crypto AutoPilot <span class="badge flat">Paper money</span></h1>
      <p class="lede">A crypto trading bot that follows your rules and the methods of famous trend traders. It trades a practice account 24/7 on real Coinbase prices. Test it on past data, train it, and watch it before trusting it with anything real.</p>
    </section>
    <div class="notice small"><strong>Paper only, and honest numbers.</strong> Crypto swings hard and trades around the clock. Fees matter a lot on small accounts (Coinbase charges about 0.6% each way, and it's included here). On real prices from the last year, the bot's strategies mostly lost money or roughly broke even, while buying and holding the same coins lost even more. The bot runs while a StockWise page is open: close it and it pauses.</div>
    <section class="card ap-status" id="c-status"></section>
    <div class="ap-grid">
      <form class="card form" id="c-rules" autocomplete="off"></form>
      <section class="card" id="c-report"></section>
    </div>
    <section class="card" id="c-lab"></section>`;

  const status = app.querySelector('#c-status'), form = app.querySelector('#c-rules'), report = app.querySelector('#c-report'), lab = app.querySelector('#c-lab');
  drawRules(form, cryptoState().rules);
  drawStatus(status, cryptoState());
  drawReport(report, cryptoState());
  drawLab(lab, form);

  form.addEventListener('submit', (e) => { e.preventDefault(); drawRules(form, saveCryptoRules(readRules(form)), 'Saved. Applies from the next candle.'); });
  status.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') startCrypto();
    if (act === 'stop') stopCrypto();
    if (act === 'sell' && confirm('Sell every coin the bot holds now, at the latest price?')) sellAllCrypto();
  });
  report.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="reset"]')) return;
    const v = Number(prompt('Start a fresh crypto paper account with how much (fake) money?', cryptoState().account.startCash));
    if (v >= 10) { resetCrypto(v); drawRules(form, cryptoState().rules); }
  });
  const off = onCryptoChange((st) => { drawStatus(status, st); drawReport(report, st); });
  return () => off();
}

function drawRules(form, r, saved = '') {
  form.innerHTML = `
    <h2>Your rules</h2>
    <fieldset><legend>Strategy</legend>
      <div class="tips-list">${Object.entries(STRATEGIES).map(([k, s]) => `<label class="tip-check"><input type="radio" name="strategy" value="${k}" ${r.strategy === k ? 'checked' : ''}><span><strong>${esc(s.name)}</strong> <span class="muted">(${esc(s.who)})</span><span class="hint">${esc(s.idea)}</span></span></label>`).join('')}</div>
      <label class="check"><input type="checkbox" name="trendFilter" ${r.trendFilter ? 'checked' : ''}> Only buy above the 200-candle average (Paul Tudor Jones' rule)</label>
      <label>Candles<select name="timeframe">${Object.keys(TIMEFRAMES).map((k) => `<option value="${k}" ${r.timeframe === k ? 'selected' : ''}>${TF_LABEL[k]}</option>`).join('')}</select></label>
      <input type="hidden" name="turtleEntry" value="${r.turtleEntry}"><input type="hidden" name="turtleExit" value="${r.turtleExit}">
      <input type="hidden" name="emaFast" value="${r.emaFast}"><input type="hidden" name="emaSlow" value="${r.emaSlow}"><input type="hidden" name="rsiBuyBelow" value="${r.rsiBuyBelow}">
      <p class="small muted">Settings: ${esc(describeCrypto(r))}. Train can tune these.</p>
    </fieldset>
    <fieldset><legend>Coins it may trade</legend>
      <div class="ap-sectors">${COINS.map(([s, n]) => `<label class="chip-check"><input type="checkbox" name="coin" value="${s}" ${r.coins.includes(s) ? 'checked' : ''}> ${s} <span class="muted">${n}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset><legend>Money</legend>
      <div class="row">
        <label>Budget<div class="input-prefix"><span>$</span><input name="budget" type="number" min="5" step="any" value="${r.budget}"></div></label>
        <label>Risk per trade<select name="riskPct">${[[0.01, '1%'], [0.02, '2%'], [0.03, '3%']].map(([v, l]) => `<option value="${v}" ${r.riskPct === v ? 'selected' : ''}>${l} of budget (${money(r.budget * v)})</option>`).join('')}</select></label>
      </div>
      <div class="row three">
        <label>Coins at once<input name="maxPositions" type="number" min="1" max="10" value="${r.maxPositions}"></label>
        <label>Daily loss limit<div class="input-prefix"><span>$</span><input name="maxDailyLoss" type="number" min="0.5" step="any" value="${r.maxDailyLoss}"></div></label>
        <label>Circuit breaker<select name="maxDrawdownPct">${[[0.1, 'Stop at −10%'], [0.25, 'Stop at −25%'], [0.4, 'Stop at −40%']].map(([v, l]) => `<option value="${v}" ${r.maxDrawdownPct === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label>Fee per trade<select name="fee">${[[0.006, '0.6% (Coinbase, small account)'], [0.004, '0.4% (limit orders)'], [0.001, '0.1% (low-fee exchange)']].map(([v, l]) => `<option value="${v}" ${r.fee === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </fieldset>
    <div class="ap-save"><button class="btn" type="submit">Save rules</button><span class="small up">${esc(saved)}</span></div>
    <p class="small muted">Spot only: it buys coins and sells them. No borrowing, no shorting, no leverage. Paper account: ${money(r.startCash)}.</p>`;
}

function readRules(form) {
  const f = new FormData(form);
  const n = (k) => Number(f.get(k));
  return {
    strategy: f.get('strategy'), trendFilter: f.get('trendFilter') === 'on', timeframe: f.get('timeframe'), coins: f.getAll('coin'),
    budget: n('budget'), riskPct: n('riskPct'), maxPositions: n('maxPositions'), maxDailyLoss: n('maxDailyLoss'), maxDrawdownPct: n('maxDrawdownPct'), fee: n('fee'),
    turtleEntry: n('turtleEntry'), turtleExit: n('turtleExit'), emaFast: n('emaFast'), emaSlow: n('emaSlow'), rsiBuyBelow: n('rsiBuyBelow'),
  };
}

function drawStatus(el, st) {
  const a = st.account;
  const eq = equity(a, st.prices || {});
  const stale = st.enabled && st.lastTick && Date.now() - st.lastTick > 5 * 60e3;
  el.innerHTML = `
    <div class="ap-head">
      <div class="ap-switch ${st.enabled ? 'on' : ''}"><span class="dot"></span><strong>Crypto AutoPilot is ${st.enabled ? 'ON' : 'OFF'}</strong><span class="muted small">${esc(describeCrypto(st.rules))} · ${esc(st.rules.timeframe)} candles · ${st.rules.coins.join(', ') || 'no coins'}</span></div>
      <div class="ap-buttons">${st.enabled ? `${a.positions.length ? '<button class="btn ghost small-btn" data-act="sell" type="button">Sell everything</button>' : ''}<button class="btn danger small-btn" data-act="stop" type="button">■ Turn off</button>` : '<button class="btn" data-act="start" type="button">▶ Start Crypto AutoPilot</button>'}</div>
    </div>
    <p class="small muted">${!st.enabled ? 'Off. When on, it checks Coinbase prices every minute, around the clock, while a StockWise page is open.' : st.status === 'running' ? `Running. Last check ${st.lastTick ? fmtT(st.lastTick) : '—'}. It acts when each ${st.rules.timeframe} candle closes.` : esc(st.status || 'Starting…')}</p>
    ${stale ? '<div class="notice warn small">No price check in over 5 minutes. Keep a StockWise page open (a background tab is fine) and the computer awake.</div>' : ''}
    ${a.halted ? `<div class="notice warn small">${esc(a.halted)}</div>` : ''}
    <div class="big-stats four">
      <div><span class="label">Account value</span><span class="value">${money(eq)}</span><span class="sub">started with ${money(a.startCash)}</span></div>
      <div><span class="label">Profit / loss</span><span class="value ${toneOf(eq - a.startCash)}">${signed(eq - a.startCash)}</span><span class="sub">${pct(eq / a.startCash - 1, 1, true)}</span></div>
      <div><span class="label">Cash</span><span class="value">${money(a.cash)}</span><span class="sub">${a.positions.length} of ${st.rules.maxPositions} coins held</span></div>
      <div><span class="label">From peak</span><span class="value ${eq < a.peak ? 'down' : ''}">${pct(eq / a.peak - 1, 1)}</span><span class="sub">breaker at −${(st.rules.maxDrawdownPct * 100).toFixed(0)}%</span></div>
    </div>
    ${a.positions.length ? `<h3>Holding</h3><div class="table-wrap"><table class="table compact"><thead><tr><th>Coin</th><th class="num">Amount</th><th class="num">Bought at</th><th class="num">Now</th><th class="num">Stop</th><th class="num">Gain</th></tr></thead><tbody>
      ${a.positions.map((p) => { const now = st.prices?.[p.coin] ?? p.entry; const g = p.qty * now - p.cost - p.fees; return `<tr><td><strong>${p.coin}</strong><div class="sub">since ${fmtT(p.entryT)}</div></td><td class="num">${p.qty}</td><td class="num">${money(p.entry)}</td><td class="num">${money(now)}</td><td class="num down">${money(p.stop)}</td><td class="num ${toneOf(g)}">${signed(g)}</td></tr>`; }).join('')}
    </tbody></table></div>` : ''}
    ${a.log.length ? `<h3>What it's doing</h3><ul class="ap-log">${a.log.slice(-30).reverse().map((l) => `<li class="log-${l.kind}"><span class="t">${fmtT(l.t)}</span> ${esc(l.text)}</li>`).join('')}</ul>` : ''}`;
}

function drawReport(el, st) {
  const a = st.account;
  const s = cryptoStats(a, [], st.rules);
  el.innerHTML = `<h2>Report card <span class="muted small">live paper trading</span></h2>
    ${a.trades.length ? `<div class="big-stats four">
      <div><span class="label">Closed trades</span><span class="value">${s.trades}</span><span class="sub">${s.winRate != null ? pct(s.winRate, 0) : '—'} winners</span></div>
      <div><span class="label">Realized P/L</span><span class="value ${toneOf(s.pl)}">${signed(a.trades.reduce((x, t) => x + t.pl, 0))}</span><span class="sub">after fees</span></div>
      <div><span class="label">Fees paid</span><span class="value">${money(s.fees)}</span><span class="sub">what trading costs</span></div>
      <div><span class="label">Best / worst</span><span class="value small-value"><span class="up">${signed(s.best)}</span> / <span class="down">${signed(s.worst)}</span></span><span class="sub">single trades</span></div>
    </div>
    <div class="table-wrap"><table class="table compact"><thead><tr><th>Coin</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">P/L</th><th>Why it sold</th></tr></thead><tbody>
      ${a.trades.slice(-12).reverse().map((t) => `<tr><td><strong>${t.coin}</strong><div class="sub">${fmtT(t.entryT)}</div></td><td class="num">${money(t.entry)}</td><td class="num">${money(t.exit)}</td><td class="num ${toneOf(t.pl)}">${signed(t.pl)}</td><td class="small">${esc(t.why)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No finished trades yet. Trend strategies can wait days for a signal, especially on 6-hour or daily candles. For answers now, use Test below.</p>'}
    <button class="btn ghost small-btn" data-act="reset" type="button">Start over with a new paper account</button>`;
}

function drawLab(el, form) {
  el.innerHTML = `<h2>Test &amp; train on real past prices</h2>
    <p>Runs your rules on Coinbase history: about 3 months of 1-hour candles, 1 year of 6-hour candles, or 2.7 years of daily candles, including fees. Always compared with simply buying and holding the same coins.</p>
    <div class="ap-lab-controls"><button class="btn" id="c-test" type="button">▶ Test my rules</button><button class="btn ghost" id="c-train" type="button">🎓 Train: find better settings</button></div>
    <div id="c-out"></div>`;
  const out = el.querySelector('#c-out');
  const load = async (rules) => {
    const hist = {};
    let n = 0;
    for (const c of rules.coins) {
      out.innerHTML = `<p class="loading">Downloading ${c} prices from Coinbase… (${++n} of ${rules.coins.length})</p>`;
      hist[c] = await history(c, TIMEFRAMES[rules.timeframe], HISTORY_BARS[rules.timeframe]);
    }
    return hist;
  };
  el.querySelector('#c-test').addEventListener('click', async () => {
    const rules = normalizeCryptoRules({ ...readRules(form), startCash: cryptoState().account.startCash });
    if (!rules.coins.length) { out.innerHTML = '<p class="muted">Pick at least one coin.</p>'; return; }
    try {
      const hist = await load(rules);
      const r = replayCrypto(rules, hist);
      const hold = r.hold.at(-1)?.value ?? rules.startCash;
      out.innerHTML = `<p class="small muted">${fmtD(r.curve[0]?.t)} to ${fmtD(r.curve.at(-1)?.t)}, ${esc(describeCrypto(rules))}, ${rules.coins.join(', ')}.</p>
        <div class="big-stats four">
          <div><span class="label">Bot</span><span class="value ${toneOf(r.stats.ret)}">${pct(r.stats.ret, 1, true)}</span><span class="sub">${money(rules.startCash, 0)} → ${money(rules.startCash + r.stats.pl, 0)}</span></div>
          <div><span class="label">Buy &amp; hold</span><span class="value ${toneOf(hold / rules.startCash - 1)}">${pct(hold / rules.startCash - 1, 1, true)}</span><span class="sub">${r.stats.ret > hold / rules.startCash - 1 ? 'the bot did better' : 'holding did better'}</span></div>
          <div><span class="label">Trades</span><span class="value">${r.stats.trades}</span><span class="sub">${r.stats.winRate != null ? pct(r.stats.winRate, 0) : '—'} winners · ${money(r.stats.fees)} fees</span></div>
          <div><span class="label">Worst drop</span><span class="value down">${pct(-r.stats.maxDrawdown, 1)}</span><span class="sub">${r.stats.halted ? 'circuit breaker tripped' : 'from the peak'}</span></div>
        </div>
        ${curveSvg(r.curve, r.hold)}
        <details class="small"><summary>Every trade (${r.account.trades.length})</summary><ul class="ap-log">${r.account.log.filter((l) => l.kind !== 'skip').slice(-80).reverse().map((l) => `<li class="log-${l.kind}"><span class="t">${fmtT(l.t)}</span> ${esc(l.text)}</li>`).join('')}</ul></details>`;
    } catch (err) { out.innerHTML = `<p class="down">${esc(err.message)}</p>`; }
  });
  el.querySelector('#c-train').addEventListener('click', async () => {
    const rules = normalizeCryptoRules({ ...readRules(form), startCash: cryptoState().account.startCash });
    if (!rules.coins.length) { out.innerHTML = '<p class="muted">Pick at least one coin.</p>'; return; }
    try {
      const hist = await load(rules);
      out.innerHTML = '<p class="loading">Training: trying 16 strategy settings…</p>';
      await new Promise((r) => setTimeout(r, 30));
      const t = trainCrypto(rules, hist);
      const row = (label, x) => `<tr><td>${label}</td><td>${esc(describeCrypto({ ...rules, ...x.settings }))}</td><td class="num ${toneOf(x.train.ret)}">${pct(x.train.ret, 1, true)} <span class="sub">${x.train.trades} trades</span></td><td class="num ${toneOf(x.test.ret)}"><strong>${pct(x.test.ret, 1, true)}</strong> <span class="sub">${x.test.trades} trades</span></td></tr>`;
      out.innerHTML = `<p class="small muted">Picked on ${fmtD(t.from)} – ${fmtD(t.cut)}, then checked on ${fmtD(t.cut)} – ${fmtD(t.to)}, data it never saw. Buy &amp; hold over that newer stretch: <strong class="${toneOf(t.best.test.holdRet)}">${pct(t.best.test.holdRet, 1, true)}</strong>.</p>
        <div class="table-wrap"><table class="table compact"><thead><tr><th></th><th>Settings</th><th class="num">Training period</th><th class="num">Unseen period</th></tr></thead><tbody>
          ${row('<strong>Best found</strong>', t.best)}${row('Your current', { settings: {}, ...t.current })}
        </tbody></table></div>
        ${t.heldUp ? `<div class="notice small"><strong>The trained settings also did better on the unseen period.</strong>${t.beatHold ? ' They even beat buying and holding.' : ' They still didn\'t beat simply holding, though.'} <button class="btn small-btn" type="button" data-apply='${esc(JSON.stringify(t.best.settings))}'>Use these settings</button></div>`
          : '<div class="notice warn small"><strong>Nothing held up on the unseen period</strong> (or it lost money there). Switching would just be fitting the past. Keep your settings and let it paper trade.</div>'}`;
      out.querySelector('[data-apply]')?.addEventListener('click', (e) => {
        drawRules(form, saveCryptoRules({ ...readRules(form), ...JSON.parse(e.target.dataset.apply) }), 'Trained settings saved.');
        e.target.textContent = '✓ Using these settings'; e.target.disabled = true;
      });
    } catch (err) { out.innerHTML = `<p class="down">${esc(err.message)}</p>`; }
  });
}

function curveSvg(curve, hold) {
  if (curve.length < 2) return '';
  const vals = [...curve, ...hold].map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), W = 640, H = 200, pad = 6;
  const pts = (arr) => arr.map((p, i) => `${(pad + (i / (arr.length - 1)) * (W - 2 * pad)).toFixed(1)},${(pad + (1 - (p.value - lo) / (hi - lo || 1)) * (H - 2 * pad)).toFixed(1)}`).join(' ');
  return `<svg class="copy-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bot vs buy and hold"><polyline class="bench" points="${pts(hold)}"/><polyline class="real" points="${pts(curve)}"/></svg>
    <div class="legend small"><span><i class="sw real"></i>Bot</span><span><i class="sw"></i>Buy &amp; hold</span></div>`;
}
