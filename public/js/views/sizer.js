import { settings, money, pct, shares, esc } from '../api.js';
import { positionSize, sellPlan, RISK_PROFILES } from '../lib/sizing.js';
import { addTrade, renderTrackedList } from './trade.js';

const today = () => new Date().toISOString().slice(0, 10);

export function renderSizer(app, q) {
  const s = settings();
  const p = RISK_PROFILES[s.profile];
  const val = (k, d = '') => esc(q.get(k) ?? d);
  app.innerHTML = `
    <section class="page-head">
      <h1>Position Sizer &amp; Trade Tracker</h1>
      <p class="lede">The most important question in trading isn't <em>what</em> to buy, it's <em>how much</em>. Enter where you'd buy and where you'd admit you're wrong. We work out how many shares to buy so one bad trade can't hurt your account. Then hit <strong>Track this trade</strong> and we'll follow every candle and tell you when to sell, and when not to.</p>
    </section>
    <div class="grid-2">
      <form class="card form" id="sizer">
        ${q.get('symbol') ? `<p class="muted">Pre-filled from <a href="#/stock/${encodeURIComponent(q.get('symbol'))}">${val('symbol')}</a></p>` : ''}
        <div class="row">
          <label>Stock symbol<input name="symbol" value="${val('symbol')}" placeholder="AAPL" autocapitalize="characters"></label>
          <label>Date you bought<input type="date" name="entryDate" value="${today()}" max="${today()}"></label>
        </div>
        <label>Account size<div class="input-prefix"><span>$</span><input type="number" name="account" min="1" step="any" value="${s.account}"></div></label>
        <label>Risk per trade <span class="muted">(% of account you'd lose if stopped out)</span>
          <div class="input-suffix"><input type="number" name="risk" min="0.1" max="10" step="0.1" value="${(p.riskPerTrade * 100).toFixed(1)}"><span>%</span></div></label>
        <div class="row">
          <label>Entry price<div class="input-prefix"><span>$</span><input type="number" name="entry" min="0" step="any" value="${val('entry', '100')}"></div></label>
          <label>Stop-loss<div class="input-prefix"><span>$</span><input type="number" name="stop" min="0" step="any" value="${val('stop', '94')}"></div></label>
        </div>
        <div class="row three">
          <label>Target 1<div class="input-prefix"><span>$</span><input type="number" name="t1" step="any" value="${val('t1', '109')}"></div></label>
          <label>Target 2<div class="input-prefix"><span>$</span><input type="number" name="t2" step="any" value="${val('t2', '118')}"></div></label>
          <label>Target 3<div class="input-prefix"><span>$</span><input type="number" name="t3" step="any" value="${val('t3', '130')}"></div></label>
        </div>
        <label>Max in one stock <div class="input-suffix"><input type="number" name="cap" min="1" max="100" step="1" value="${Math.round(p.maxPosition * 100)}"><span>%</span></div></label>
        <label>Shares you actually bought <span class="muted">(optional, for tracking; blank = the suggested amount)</span><input type="number" name="owned" min="0" step="any" placeholder="e.g. 20"></label>
        <label class="check"><input type="checkbox" name="fractional" ${s.fractional ? 'checked' : ''}> Allow fractional shares</label>
      </form>
      <section class="card" id="sizer-out"></section>
    </div>
    <section class="card">
      <div class="card-head"><h2>Tracked trades</h2><span class="muted small">Re-checked against the latest candles every time you open this page</span></div>
      <div id="tracked"></div>
    </section>`;

  const form = app.querySelector('#sizer');
  const out = app.querySelector('#sizer-out');
  const calc = () => {
    const f = Object.fromEntries(new FormData(form));
    const n = (k) => Number(f[k]);
    const fractional = f.fractional === 'on';
    const pos = positionSize({ account: n('account'), riskPct: n('risk') / 100, entry: n('entry'), stop: n('stop'), maxPositionPct: n('cap') / 100, fractional });
    if (!pos) { out.innerHTML = '<p class="muted">Enter your account size and entry price.</p>'; return; }
    if (pos.error) { out.innerHTML = `<p class="down">${esc(pos.error)}</p>`; return; }
    const targets = [n('t1'), n('t2'), n('t3')];
    const valid = targets.every((t) => t > n('entry'));
    const sp = valid && pos.shares > 0 ? sellPlan(pos.shares, n('entry'), n('stop'), targets, fractional) : null;
    const rr = (n('t1') - n('entry')) / pos.riskPerShare;
    out.innerHTML = `
      <h2>Your plan</h2>
      <div class="big-stats">
        <div><span class="label">Buy</span><span class="value">${shares(pos.shares)} shares</span></div>
        <div><span class="label">Total cost</span><span class="value">${money(pos.cost)}</span><span class="sub">${pct(pos.pctOfAccount)} of account</span></div>
        <div><span class="label">Max loss</span><span class="value down">${money(pos.dollarsAtRisk)}</span><span class="sub">${pct(pos.dollarsAtRisk / n('account'), 2)} of account</span></div>
      </div>
      ${pos.tooExpensive ? '<p class="notice warn">Even one share risks more than your budget. Use fractional shares, a closer stop, or a cheaper stock.</p>' : ''}
      <p class="muted small">Risk per share ${money(pos.riskPerShare)} · risk budget ${money(pos.riskBudget)} · limited by ${pos.limitedBy === 'risk' ? 'risk budget' : 'max-per-stock cap'}</p>
      ${valid ? `<p>Reward : risk to Target 1 is <strong class="${rr >= 2 ? 'up' : rr >= 1.5 ? '' : 'down'}">${rr.toFixed(1)} : 1</strong>. ${rr < 1.5 ? 'That\'s thin. Most traders want at least 2 : 1.' : rr >= 2 ? 'A good setup.' : 'Acceptable.'}</p>` : '<p class="muted">Targets must be above your entry.</p>'}
      ${sp ? `<div class="track-actions"><button class="btn" type="button" id="track-btn">📈 Track this trade</button><span class="muted small" id="track-msg">Follows the candles from your buy date and tells you when to sell.</span></div>
      <h3>Selling plan</h3><ol class="steps">
        ${sp.steps.map((st) => `<li><strong>Sell ${shares(st.sell)} shares</strong> when ${esc(st.when.charAt(0).toLowerCase() + st.when.slice(1))}: about <span class="up">+${money(st.sell * (st.price - n('entry')))}</span>. <span class="muted">${esc(st.then)}.</span></li>`).join('')}
        <li><strong>Sell all</strong> on a close below ${money(n('stop'))}: about <span class="down">−${money(sp.maxLoss)}</span>.</li>
      </ol>
      <p>If every target hits: <strong class="up">+${money(sp.profitIfAllTargets)}</strong> (${pct(sp.profitIfAllTargets / n('account'), 1)} of account).</p>` : ''}
      <details class="explain"><summary>How is this calculated?</summary>
        <p><strong>Shares = (Account × Risk %) ÷ (Entry − Stop)</strong>, then capped so the position is never more than your max-per-stock percentage. Example: $10,000 × 1% = $100 risk. If you buy at $100 with a stop at $94 you risk $6 a share, so you buy 16 shares.</p>
        <p>With 1% risk you could be wrong 10 times in a row and still have about 90% of your account.</p>
      </details>`;
  };
  form.addEventListener('input', calc);
  calc();

  out.addEventListener('click', (e) => {
    if (e.target.id !== 'track-btn') return;
    const f = Object.fromEntries(new FormData(form));
    const symbol = String(f.symbol || '').trim().toUpperCase();
    const msg = out.querySelector('#track-msg');
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) { msg.className = 'small down'; msg.textContent = 'Enter the stock symbol first (top of the form).'; form.elements.symbol.focus(); return; }
    const fractional = f.fractional === 'on';
    const pos = positionSize({ account: +f.account, riskPct: +f.risk / 100, entry: +f.entry, stop: +f.stop, maxPositionPct: +f.cap / 100, fractional });
    const owned = Number(f.owned);
    const id = addTrade({ symbol, entryDate: f.entryDate || today(), entry: +f.entry, shares: owned > 0 ? owned : pos.shares, stop: +f.stop, targets: [+f.t1, +f.t2, +f.t3] });
    location.hash = `#/trade/${id}`;
  });
  renderTrackedList(app.querySelector('#tracked'));
}
