import { getAnalysis, settings, saveSettings, money, pct, num, shares, toneOf, esc, badge, scoreBar, demoNotice, gradeChips, bigMoney } from '../api.js';
import { positionSize, sellPlan, RISK_PROFILES } from '../lib/sizing.js';
import { mountChart } from '../chart.js';
import { signalLine } from '../lib/signal.js';
import { getWatchlist, toggleWatch } from './watchlist.js';

const isBuy = (r) => r.score >= 58;
const isSell = (r) => r.score < 43;

export function verdict(a) {
  const st = a.shortTerm, lt = a.longTerm;
  if (isBuy(st) && isBuy(lt)) return { tone: 'up', title: 'Buy candidate on both timeframes', text: `The short-term and long-term trends agree. Traders can buy in the buy zone with the stop below. Long-term investors can start a position in stages.` };
  if (isBuy(st) && !isBuy(lt)) return { tone: 'flat', title: 'Short-term trade only', text: `Momentum is up for now, but the long-term trend isn't confirmed. If you take it, keep it a quick swing trade with a firm stop at ${money(a.plan.stop)}. Don't turn it into a long-term hold.` };
  if (!isBuy(st) && isBuy(lt) && !isSell(st)) return { tone: 'flat', title: 'Good long-term stock, wait on timing', text: `The long-term trend is healthy but short-term momentum is soft. Investors can buy in stages (see the long-term plan). Traders should wait for the short-term score to improve.` };
  if (isSell(st) && isBuy(lt)) return { tone: 'flat', title: 'Pullback in a long-term uptrend', text: `Short-term selling is under way inside a long-term uptrend. Don't chase it. Long-term buyers can scale in near ${money(a.ltPlan.tranches[1].price)}–${money(a.ltPlan.tranches[2].price)}.` };
  if (isSell(st) || isSell(lt)) return { tone: 'down', title: 'Avoid buying right now', text: `The trend is against you. Don't open new positions. If you already own it, consider selling or tightening your stop. A close below ${money(a.levels.support[0].price)} (nearest support) would be a further warning.` };
  return { tone: 'flat', title: 'No clear edge, hold or wait', text: 'Signals are mixed. Holding an existing position is reasonable; new money is better spent on stronger setups (see Top Ideas).' };
}

export async function renderAnalyze(app, symbol) {
  const data = await getAnalysis(symbol);
  const a = data.analysis;
  const s = settings();
  const profile = RISK_PROFILES[s.profile];
  const pos = positionSize({ account: s.account, riskPct: profile.riskPerTrade, entry: a.plan.entry, stop: a.plan.stop, maxPositionPct: profile.maxPosition, fractional: s.fractional });
  const sp = pos && !pos.error && pos.shares > 0 ? sellPlan(pos.shares, a.plan.entry, a.plan.stop, a.plan.targets, s.fractional) : null;
  const v = verdict(a);
  const ltBudget = s.account * profile.maxPosition;
  const inList = getWatchlist().includes(symbol);

  const reasons = (r) => r.reasons.map((x) => `<li class="${toneOf(x.points)}"><span class="pts">${x.points > 0 ? '+' : ''}${x.points}</span>${esc(x.text)}</li>`).join('');

  app.innerHTML = `
    ${demoNotice(data)}
    <section class="stock-head">
      <div>
        <div class="muted">${esc(data.exchange || '')} ${esc(data.currency)}</div>
        <h1>${esc(symbol)} <span class="name">${esc(data.name)}</span></h1>
        <div class="price-line"><span class="price">${money(a.price)}</span> <span class="${toneOf(a.change)}">${a.change >= 0 ? '+' : ''}${num(a.change)} (${pct(a.changePct, 2, true)})</span> <span class="muted">last close</span></div>
      </div>
      <div class="head-actions">
        <button class="btn ${inList ? 'ghost' : ''}" id="watch-btn">${inList ? '✓ On watchlist' : '+ Add to watchlist'}</button>
        <a class="btn" href="#/practice?symbol=${encodeURIComponent(symbol)}">Practice trade</a>
        <a class="btn ghost" href="#/order?symbol=${encodeURIComponent(symbol)}&shares=${pos && !pos.error ? pos.shares : ''}&entryType=limit&entry=${a.plan.entry.toFixed(2)}&stop=${a.plan.stop.toFixed(2)}&target=${a.plan.targets[0].toFixed(2)}&timing=GTC">Place this order (guide)</a>
        <a class="btn ghost" href="#/sizer?entry=${a.plan.entry.toFixed(2)}&stop=${a.plan.stop.toFixed(2)}&t1=${a.plan.targets[0].toFixed(2)}&t2=${a.plan.targets[1].toFixed(2)}&t3=${a.plan.targets[2].toFixed(2)}&symbol=${encodeURIComponent(symbol)}">Open in sizer</a>
      </div>
    </section>

    <section class="verdict ${v.tone}">
      <h2>${esc(v.title)}</h2>
      <p>${esc(v.text)}</p>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Chart</h2>
        <div class="seg" id="range">
          <button data-bars="63">3M</button><button data-bars="126" class="on">6M</button><button data-bars="252">1Y</button><button data-bars="520">2Y</button>
        </div>
      </div>
      <div class="chart-tools">
        <label class="switch"><input type="checkbox" id="toggle-signal" ${s.signalLine !== false ? 'checked' : ''}><span class="slider"></span>Signal line</label>
        <label class="switch"><input type="checkbox" id="toggle-plan" ${s.planLines !== false ? 'checked' : ''}><span class="slider"></span>Plan lines</label>
        <span id="signal-chip"></span>
        <a class="small" href="#/tools">Get this line for TradingView / thinkorswim →</a>
      </div>
      <div class="legend" id="chart-legend"></div>
      <div id="chart" class="chart-box"></div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Short-term buy? <span class="muted small">days to weeks</span></h2>${badge(a.shortTerm)}</div>
        <div class="score-row">${scoreBar(a.shortTerm.score)}</div>
        ${setupBlock(a)}
        <ul class="reasons">${reasons(a.shortTerm)}</ul>
      </section>
      <section class="card">
        <div class="card-head"><h2>Long-term buy? <span class="muted small">${esc(a.longTerm.hold)}</span></h2>${badge(a.longTerm)}</div>
        <div class="score-row">${scoreBar(a.longTerm.score)}</div>
        ${ltBreakdown(a)}
        ${groupedReasons(a.longTerm.reasons)}
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <h2>Short-term trade plan</h2>
        <dl class="kv">
          <dt>Buy zone</dt><dd>${money(a.plan.buyZone[0])} – ${money(a.plan.buyZone[1])}</dd>
          <dt>Stop-loss (sell if it closes below)</dt><dd class="down">${money(a.plan.stop)} <span class="muted">(${pct(-a.plan.riskPct)})</span></dd>
          <dt>Target 1</dt><dd class="up">${money(a.plan.targets[0])} <span class="muted">(${pct((a.plan.targets[0] - a.price) / a.price, 1, true)})</span></dd>
          <dt>Target 2</dt><dd class="up">${money(a.plan.targets[1])} <span class="muted">(${pct((a.plan.targets[1] - a.price) / a.price, 1, true)})</span></dd>
          <dt>Target 3</dt><dd class="up">${money(a.plan.targets[2])} <span class="muted">(${pct((a.plan.targets[2] - a.price) / a.price, 1, true)})</span></dd>
          <dt>Reward : risk to Target 1</dt><dd>${num(a.plan.rewardRisk, 1)} : 1</dd>
        </dl>
        <h3>For your ${money(s.account, 0)} account <span class="muted small">(${profile.label.toLowerCase()}, ${pct(profile.riskPerTrade, 1)} risk)</span></h3>
        ${pos?.error ? `<p class="down">${esc(pos.error)}</p>`
          : pos.tooExpensive ? `<p>One share costs more than your risk rules allow. Turn on fractional shares in your account settings, or skip this one.</p>`
          : `<div class="big-stats">
              <div><span class="label">Buy</span><span class="value">${shares(pos.shares)} shares</span></div>
              <div><span class="label">Cost</span><span class="value">${money(pos.cost)}</span><span class="sub">${pct(pos.pctOfAccount)} of account</span></div>
              <div><span class="label">Max loss at stop</span><span class="value down">${money(pos.dollarsAtRisk)}</span></div>
            </div>
            <p class="muted small">Size limited by ${pos.limitedBy === 'risk' ? 'your per-trade risk budget' : `the ${pct(profile.maxPosition, 0)} max-per-stock cap`}.</p>
            <h3>When to sell</h3>
            <ol class="steps">
              ${sp.steps.map((st) => `<li><strong>Sell ${shares(st.sell)} shares</strong> when ${esc(st.when.charAt(0).toLowerCase() + st.when.slice(1))}. <span class="muted">${esc(st.then)}.</span></li>`).join('')}
              <li><strong>Sell everything</strong> if it closes below ${money(sp.stopLoss)}. Max loss ${money(sp.maxLoss)}.</li>
            </ol>
            <p class="muted small">Profit if all targets hit: <span class="up">${money(sp.profitIfAllTargets)}</span></p>`}
      </section>

      <section class="card">
        <h2>Long-term investing plan</h2>
        <p class="muted">Buy in stages instead of all at once. Suggested position: up to ${money(ltBudget, 0)} (${pct(profile.maxPosition, 0)} of your account).</p>
        <table class="table compact">
          <thead><tr><th>Stage</th><th class="num">Buy at</th><th class="num">Amount</th><th class="num">Shares</th></tr></thead>
          <tbody>${a.ltPlan.tranches.map((t) => {
            const dollars = ltBudget * t.weight;
            const sh = s.fractional ? Math.floor((dollars / t.price) * 1000) / 1000 : Math.floor(dollars / t.price);
            return `<tr><td>${esc(t.label)}</td><td class="num">${money(t.price)}</td><td class="num">${money(dollars, 0)}</td><td class="num">${shares(sh)}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <h3>When to sell a long-term holding</h3>
        <ul class="bullets">
          <li>The thesis is broken: price closes below <strong>${money(a.ltPlan.exitBelow)}</strong> (well under the 200-day average).</li>
          <li>Or use a ${pct(a.ltPlan.trailingStopPct, 0)} trailing stop from the highest close since you bought.</li>
          <li>Trim if one stock grows past ~${pct(profile.maxPosition * 1.5, 0)} of your portfolio.</li>
        </ul>
        <h3>Key levels</h3>
        <div class="levels">
          <div><span class="label">Resistance (sellers)</span>${a.levels.resistance.map((l) => `<span class="pill down">${money(l.price)}</span>`).join('')}</div>
          <div><span class="label">Support (buyers)</span>${a.levels.support.map((l) => `<span class="pill up">${money(l.price)}</span>`).join('')}</div>
        </div>
        <dl class="kv small">
          <dt>RSI (14)</dt><dd>${num(a.rsi, 0)}</dd>
          <dt>20 / 50 / 200-day avg</dt><dd>${money(a.sma20)} / ${money(a.sma50)} / ${money(a.sma200)}</dd>
          <dt>Daily range (ATR)</dt><dd>${money(a.atr)} (${pct(a.atr / a.price)})</dd>
          <dt>Volatility (1y)</dt><dd>${pct(a.longTerm.volatility)}</dd>
          <dt>Worst drop (1y)</dt><dd class="down">${pct(a.maxDrawdown)}</dd>
        </dl>
      </section>
    </div>
    ${fundamentalsCard(a)}`;

  const levels = [
    { price: a.plan.buyZone[0], label: 'Buy', tone: 'buy' },
    { price: a.plan.stop, label: 'Stop', tone: 'stop' },
    ...a.plan.targets.map((p, i) => ({ price: p, label: `T${i + 1}`, tone: 'tgt' })),
  ];
  const chart = mountChart(app.querySelector('#chart'), { candles: data.candles, ind: a.indicators, levels, bars: 126 });

  // StockWise Signal Line overlay (same rules as the TradingView / thinkorswim versions on the Tools page).
  const sig = signalLine(data.candles);
  const sigPaths = [
    { series: sig.line.map((v, i) => (sig.dir[i] === 1 ? v : null)), cls: 'sig-up' },
    { series: sig.line.map((v, i) => (sig.dir[i] === -1 ? v : null)), cls: 'sig-down' },
  ];
  const sigMarkers = sig.signals.map((x) => {
    const c = data.candles[x.i];
    if (x.type === 'buy') return { i: x.i, price: c.low, label: 'BUY', tone: 'buy', up: true };
    if (x.type === 'wait') return { i: x.i, price: c.low, label: 'WAIT', tone: 'warn', up: true };
    if (x.type === 'sell') return { i: x.i, price: c.high, label: 'SELL', tone: 'stop' };
    return { i: x.i, price: c.high, label: '', title: 'Overheated (RSI above 75)', tone: 'warn' };
  });
  const st = sig.status;
  app.querySelector('#signal-chip').innerHTML = st.stop == null ? '' : `<span class="signal-chip ${st.action}" title="StockWise Signal Line: ${st.action === 'sell' ? 'line is above price (downtrend)' : 'line is below price (uptrend)'}">Signal: <strong>${esc(st.label)}</strong> · ${st.action === 'sell' ? 'flips up above' : 'stop'} ${money(st.stop)}</span>`;
  const applyOverlays = () => {
    const showSig = app.querySelector('#toggle-signal').checked;
    const showPlan = app.querySelector('#toggle-plan').checked;
    chart.update({ levels: showPlan ? levels : [], paths: showSig ? sigPaths : [], markers: showSig ? sigMarkers : [] });
    app.querySelector('#signal-chip').hidden = !showSig;
    app.querySelector('#chart-legend').innerHTML = '<span class="k ma20">20-day</span><span class="k ma50">50-day</span><span class="k ma200">200-day</span>'
      + (showSig ? '<span class="k sig-up">Signal: hold (uptrend)</span><span class="k sig-down">Signal: sell (downtrend)</span>' : '')
      + (showPlan ? '<span class="k buy">Buy</span><span class="k stop">Stop</span><span class="k tgt">Targets</span>' : '');
    saveSettings({ signalLine: showSig, planLines: showPlan });
  };
  app.querySelector('#toggle-signal').addEventListener('change', applyOverlays);
  app.querySelector('#toggle-plan').addEventListener('change', applyOverlays);
  applyOverlays();
  app.querySelector('#range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    app.querySelectorAll('#range button').forEach((x) => x.classList.toggle('on', x === b));
    chart.setBars(Number(b.dataset.bars));
  });
  app.querySelector('#watch-btn').addEventListener('click', (e) => {
    const on = toggleWatch(symbol);
    e.target.textContent = on ? '✓ On watchlist' : '+ Add to watchlist';
    e.target.classList.toggle('ghost', on);
  });
  return () => chart.destroy();
}

function reasonItems(list) {
  return list.map((x) => `<li class="${toneOf(x.points)}"><span class="pts">${x.points > 0 ? '+' : x.points < 0 ? '' : '·'}${x.points || ''}</span>${esc(x.text)}</li>`).join('');
}

function groupedReasons(list) {
  const groups = [...new Set(list.map((r) => r.group || 'Trend'))];
  return groups.map((g) => `<h4 class="reason-group">${esc(g)}</h4><ul class="reasons">${reasonItems(list.filter((r) => (r.group || 'Trend') === g))}</ul>`).join('');
}

function setupBlock(a) {
  const st = a.shortTerm, s = st.setup;
  const earnings = a.daysToEarnings != null && a.daysToEarnings <= 14
    ? `<p class="notice warn small">⚠ Earnings in ${a.daysToEarnings} day${a.daysToEarnings === 1 ? '' : 's'}. Stocks often jump or drop 5–15% on earnings. Many traders wait until after the report or use a smaller position.</p>` : '';
  const rs = a.rs3m != null ? `<span class="pill ${a.rs3m >= 0 ? 'up' : 'down'}">${a.rs3m >= 0 ? 'Beating' : 'Lagging'} the S&amp;P 500 by ${pct(Math.abs(a.rs3m))} (3 mo)</span>` : '';
  return `${s
    ? `<div class="setup"><span class="setup-tag setup-${s.key}">${esc(s.label)}</span><div><strong>Setup found:</strong> ${esc(s.text)}.<div class="muted small">${esc(s.howTo)} Typical hold: ${esc(s.hold)}.</div></div></div>`
    : '<div class="setup none"><span class="setup-tag">No setup</span><div class="muted small">No clean breakout, pullback, bounce or momentum pattern right now. Waiting for one usually beats forcing a trade.</div></div>'}
    <div class="pill-row">${rs}</div>${earnings}`;
}

function ltBreakdown(a) {
  const lt = a.longTerm;
  if (lt.fundScore == null) {
    return '<p class="muted small">Company fundamentals aren\'t available for this symbol (ETFs don\'t have them), so this score is based on the price trend only.</p>';
  }
  return `<div class="split">
      <div><span class="label">Price trend</span>${scoreBar(lt.trendScore)}</div>
      <div><span class="label">Business fundamentals</span>${scoreBar(lt.fundScore)}</div>
    </div>
    ${gradeChips(lt.grades)}
    ${lt.upside != null ? `<p class="small">Analysts' average target: <strong>${money(a.fundamentals.targetMean)}</strong> (<span class="${toneOf(lt.upside)}">${pct(lt.upside, 1, true)}</span>)</p>` : ''}`;
}

function fundamentalsCard(a) {
  const f = a.fundamentals;
  if (!f) return '';
  const row = (label, value, hint = '', tone = '') => `<div class="metric"><span class="label">${label}</span><span class="value ${tone}">${value}</span>${hint ? `<span class="sub">${hint}</span>` : ''}</div>`;
  const pe = f.forwardPE ?? f.trailingPE;
  const earn = f.nextEarnings ? new Date(f.nextEarnings).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  return `<section class="card">
    <div class="card-head"><h2>The business${f.industry ? ` <span class="muted small">${esc(f.industry)}</span>` : ''}</h2>${f.source === 'demo' ? '<span class="badge flat">Simulated</span>' : ''}</div>
    ${f.summary ? `<p class="muted">${esc(f.summary)}</p>` : ''}
    <div class="metrics">
      ${row('Company size', bigMoney(f.marketCap), 'market value')}
      ${row('P/E ratio', pe ? `${pe.toFixed(1)}×` : 'n/a', f.forwardPE ? 'price ÷ next year\'s earnings' : 'price ÷ last year\'s earnings', pe && pe < 25 ? 'up' : pe > 40 ? 'down' : '')}
      ${row('PEG ratio', f.peg ? f.peg.toFixed(2) : '—', 'P/E ÷ growth; under 1.5 is cheap', f.peg && f.peg < 1.5 ? 'up' : f.peg > 3 ? 'down' : '')}
      ${row('Revenue growth', f.revenueGrowth != null ? pct(f.revenueGrowth, 1, true) : '—', 'vs. a year ago', toneOf(f.revenueGrowth))}
      ${row('Earnings growth', f.earningsGrowth != null ? pct(f.earningsGrowth, 1, true) : '—', 'vs. a year ago', toneOf(f.earningsGrowth))}
      ${row('Profit margin', f.profitMargin != null ? pct(f.profitMargin) : '—', 'profit per $1 of sales', toneOf(f.profitMargin))}
      ${row('Return on equity', f.roe != null ? pct(f.roe) : '—', 'profit on shareholders\' money', toneOf(f.roe))}
      ${row('Debt / equity', f.debtToEquity != null ? `${(f.debtToEquity / 100).toFixed(2)}×` : '—', 'under 1× is comfortable', f.debtToEquity > 200 ? 'down' : f.debtToEquity != null && f.debtToEquity < 100 ? 'up' : '')}
      ${row('Dividend yield', f.dividendYield ? pct(f.dividendYield, 2) : 'None', 'cash paid yearly')}
      ${row('Beta', f.beta != null ? f.beta.toFixed(2) : '—', f.beta > 1.3 ? 'swings more than the market' : f.beta != null && f.beta < 0.8 ? 'calmer than the market' : 'moves with the market')}
      ${row('Analyst target', f.targetMean ? money(f.targetMean) : '—', f.targetLow && f.targetHigh ? `range ${money(f.targetLow, 0)}–${money(f.targetHigh, 0)}` : '', toneOf(a.longTerm.upside))}
      ${row('Next earnings', earn, a.daysToEarnings != null ? `in ${a.daysToEarnings} days` : '')}
    </div>
    <p class="muted small">Company data from Yahoo Finance, updated daily. Fundamentals tell you <em>what</em> to own. The trend and setup tell you <em>when</em>.</p>
  </section>`;
}
