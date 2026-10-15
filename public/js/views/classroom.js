import { getHistory, store, money, pct, esc, toneOf, demoNotice } from '../api.js';
import { STOCKS } from '../lib/universe.js';
import { mountChart } from '../chart.js';
import {
  pickScenario, gradeStop, gradeTarget, expectedShares, classTrade, replayTo, finalResult, TREND_TEXT,
  CLASS_ACCOUNT, CLASS_RISK, CLASS_MAX_POSITION, MAX_HOLD_DAYS,
} from '../lib/classroom.js';

const STEPS = ['Start', 'Trend', 'Setup', 'Stop-loss', 'Target', 'Shares', 'Trade it', 'Results'];
const SETUP_CHOICES = [
  ['breakout', 'Breakout', 'Closes above recent highs on heavy volume'],
  ['pullback', 'Pullback', 'Dips to its 20-day average inside an uptrend'],
  ['bounce', 'Oversold bounce', 'Sold off hard (RSI low) and turning up'],
  ['momentum', 'Momentum', 'Riding steadily above rising averages'],
];
export const classHistory = () => store.get('class:history', []);

let st = null; // the current class session (kept while you browse other pages)
const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export async function renderClass(app, q) {
  if (!st || q.get('new') === '1') {
    app.innerHTML = '<div class="loading">Finding a real chart for your class…</div>';
    st = await newSession();
    if (q.get('new') === '1') history.replaceState(null, '', '#/class');
  }
  let chart = null;

  const draw = () => {
    const sc = st.sc;
    const visible = st.candles.slice(0, sc.d + 1 + st.revealed);
    app.innerHTML = `
      ${demoNotice(st.data)}
      <nav class="crumbs"><a href="#/academy">Academy</a> › Trading Class</nav>
      <section class="page-head class-head">
        <div>
          <h1>Trading Class: make a trade, step by step</h1>
          <p class="lede">A real chart from the past, with the stock's name hidden so you can't cheat. You make every decision, the coach checks each one, and then you live through what actually happened.</p>
        </div>
        <a class="btn ghost small-btn" href="#/class?new=1">New trade</a>
      </section>
      <ol class="stepper">${STEPS.map((s, i) => `<li class="${i < st.step ? 'done' : i === st.step ? 'on' : ''}"><span>${i < st.step ? '✓' : i + 1}</span>${s}</li>`).join('')}</ol>
      <div class="class-grid">
        <section class="card class-chart">
          <div class="card-head"><h2>Mystery stock <span class="muted small">${st.step >= 6 ? `day ${st.revealed} of the trade` : `as of ${fmtDay(st.candles[sc.d].t)}`}</span></h2><span class="price small-price">${money(visible.at(-1).close)}</span></div>
          <div class="legend"><span class="k ma20">20-day</span><span class="k ma50">50-day</span><span class="k ma200">200-day</span>${st.answers.stop ? '<span class="k stop">Your stop</span>' : ''}${st.answers.target ? '<span class="k tgt">Your target</span>' : ''}<span class="k buy">Entry</span></div>
          <div id="class-chart" class="chart-box"></div>
        </section>
        <section class="card class-step" id="step"></section>
      </div>`;
    drawChart();
    renderStep(app.querySelector('#step'), draw, drawChart);
  };

  // Redraws only the chart (used while you type a stop or target, so the step panel stays put).
  const drawChart = () => {
    const sc = st.sc;
    const visible = st.candles.slice(0, sc.d + 1 + st.revealed);
    const levels = [{ price: sc.entry, label: 'Entry', tone: 'buy' }];
    if (st.answers.stop && st.step < 6) levels.push({ price: st.answers.stop, label: 'Stop', tone: 'stop' });
    if (st.answers.target) levels.push({ price: st.answers.target, label: 'Target', tone: 'tgt' });
    const markers = [];
    const paths = [];
    if (st.step >= 6) {
      markers.push({ i: sc.d, price: sc.entry, label: 'Buy', tone: 'buy' });
      for (const e of st.rules.events) {
        if (e.type === 'target') markers.push({ i: e.i, price: e.price, label: `Sell ${e.shares}`, tone: 'sell' });
        if (e.type === 'stop') markers.push({ i: e.i, price: e.price, label: 'Stop', tone: 'stop' });
      }
      if (st.manual) markers.push({ i: visible.length - 1, price: st.manual.price, label: 'You sold', tone: 'stop' });
      paths.push({ series: st.rules.stopPath, cls: 'trail' });
    }
    chart?.destroy();
    chart = mountChart(app.querySelector('#class-chart'), { candles: visible, ind: sc.ind, levels, bars: 100 + st.revealed, paths, markers });
  };
  draw();
  return () => chart?.destroy();
}

async function newSession() {
  const pool = [...STOCKS].sort(() => Math.random() - 0.5);
  for (const s of pool.slice(0, 10)) {
    try {
      const data = await getHistory(s.symbol);
      const sc = pickScenario(data.candles);
      if (sc) return { data, candles: data.candles, symbol: s.symbol, name: s.name, sc, step: 0, answers: {}, results: {}, revealed: 0, manual: null, rules: null };
    } catch { /* try another stock */ }
  }
  throw new Error('Could not find a usable chart right now. Try again in a moment.');
}

function feedback(g) {
  if (!g) return '';
  const cls = g.ok === true ? 'good' : g.ok === 'meh' ? 'meh' : 'bad';
  return `<div class="feedback-box ${cls}">${g.ok === true ? '✓ ' : g.ok === 'meh' ? '~ ' : '✗ '}${esc(g.text)}</div>`;
}

function renderStep(el, redraw, redrawChart) {
  const sc = st.sc;
  const a = sc.analysis;
  const next = (label = 'Next step →') => `<button class="btn" data-next>${label}</button>`;
  const showMeBtn = '<button class="btn ghost" data-show>Show me how</button>';
  const go = () => { st.step++; redraw(); };

  const steps = [
    // 0 — intro
    () => `
      <h2>Your mission</h2>
      <p>It's <strong>${fmtDay(st.candles[sc.d].t)}</strong>. This stock just closed at <strong>${money(sc.entry)}</strong>. You have <strong>${money(CLASS_ACCOUNT, 0)}</strong> of class money.</p>
      <p>Professional traders follow the same checklist every time. You'll do it in 5 steps:</p>
      <ol class="mini-steps"><li>Read the <strong>trend</strong></li><li>Name the <strong>setup</strong></li><li>Decide where you're wrong: the <strong>stop-loss</strong></li><li>Pick a <strong>target</strong> worth the risk</li><li>Work out <strong>how many shares</strong></li></ol>
      <p>Then you'll trade it, one day at a time, and see what really happened.</p>
      ${next('Start the class →')}`,

    // 1 — trend
    () => {
      const ans = st.answers.trend;
      return `
        <h2>1. What's the trend?</h2>
        <p>Look at where the price is compared with the moving averages: <span class="ma20-text">20-day</span>, <span class="ma50-text">50-day</span> and <span class="ma200-text">200-day</span>.</p>
        <div class="choice-row">${[['up', 'Uptrend ↗'], ['sideways', 'Sideways →'], ['down', 'Downtrend ↘']].map(([k, l]) => `<button class="choice ${ans === k ? (k === sc.trend ? 'right' : 'wrong') : ''}" data-trend="${k}" ${ans ? 'disabled' : ''}>${l}</button>`).join('')}</div>
        ${ans ? feedback({ ok: ans === sc.trend, text: `${ans === sc.trend ? 'Correct! ' : `Not quite. It's ${sc.trend === 'up' ? 'an uptrend' : sc.trend === 'down' ? 'a downtrend' : 'sideways'}. `}${TREND_TEXT[sc.trend]} Price ${money(sc.entry)} · 50-day ${money(sc.sma50)} · 200-day ${money(sc.sma200)}.` }) : ''}
        <div class="step-actions">${ans ? next() : showMeBtn}</div>
        <details class="explain"><summary>Why does the trend matter?</summary><p>"The trend is your friend." Buying in an uptrend means the bigger flow of money is on your side. Most failed trades are attempts to catch a falling stock.</p></details>`;
    },

    // 2 — setup
    () => {
      const ans = st.answers.setup;
      return `
        <h2>2. Which setup is this?</h2>
        <p>A setup is a pattern that tells you <em>why now</em>. Look at the last few candles, the volume bars and the 20-day average.</p>
        <div class="choice-col">${SETUP_CHOICES.map(([k, l, hint]) => `<button class="choice ${ans === k ? (k === sc.setup.key ? 'right' : 'wrong') : ans && k === sc.setup.key ? 'right' : ''}" data-setup="${k}" ${ans ? 'disabled' : ''}><strong>${l}</strong><span>${hint}</span></button>`).join('')}</div>
        ${ans ? feedback({ ok: ans === sc.setup.key, text: `${ans === sc.setup.key ? 'Correct! ' : `It's a ${sc.setup.label}. `}${sc.setup.text.charAt(0).toUpperCase()}${sc.setup.text.slice(1)}. ${sc.setup.howTo}` }) : ''}
        <div class="step-actions">${ans ? next() : showMeBtn}</div>`;
    },

    // 3 — stop
    () => {
      const g = st.results.stop;
      return `
        <h2>3. Where are you wrong?</h2>
        <p>Your <strong>stop-loss</strong> is the price where the idea is proven wrong, so you sell and take a small loss. Good stops sit just <em>below support</em> (where buyers stepped in before) and at least one normal daily move away.</p>
        <dl class="kv small"><dt>Entry</dt><dd>${money(sc.entry)}</dd><dt>Nearest support</dt><dd>${money(sc.support)}</dd><dt>Normal daily move (ATR)</dt><dd>${money(sc.atr)}</dd></dl>
        <label>Your stop-loss price<div class="input-prefix"><span>$</span><input type="number" step="0.01" id="stop-in" value="${st.answers.stop ?? ''}" placeholder="e.g. ${(sc.entry - 2 * sc.atr).toFixed(2)}"></div></label>
        ${feedback(g)}
        <div class="step-actions"><button class="btn ghost" data-check="stop">Check my stop</button>${g && g.ok !== false ? next() : showMeBtn}</div>`;
    },

    // 4 — target
    () => {
      const g = st.results.target;
      return `
        <h2>4. What's it worth?</h2>
        <p>Your risk is <strong>${money(sc.entry - st.answers.stop)}</strong> per share (entry ${money(sc.entry)} − stop ${money(st.answers.stop)}). Pick a <strong>target</strong> where you'll sell the first third. Aim for at least <strong>2× your risk</strong>, ideally near resistance.</p>
        <dl class="kv small"><dt>2 : 1 target</dt><dd>${money(sc.entry + 2 * (sc.entry - st.answers.stop))}</dd>${sc.resistance ? `<dt>Nearest resistance</dt><dd>${money(sc.resistance)}</dd>` : ''}</dl>
        <label>Your target price<div class="input-prefix"><span>$</span><input type="number" step="0.01" id="target-in" value="${st.answers.target ?? ''}"></div></label>
        ${feedback(g)}
        <div class="step-actions"><button class="btn ghost" data-check="target">Check my target</button>${g && g.ok !== false ? next() : showMeBtn}</div>`;
    },

    // 5 — shares
    () => {
      const g = st.results.shares;
      return `
        <h2>5. How many shares?</h2>
        <p>Rule: never lose more than <strong>${pct(CLASS_RISK, 0)}</strong> of your ${money(CLASS_ACCOUNT, 0)} on one trade (${money(CLASS_ACCOUNT * CLASS_RISK, 0)}), and never put more than ${pct(CLASS_MAX_POSITION, 0)} of the account in one stock.</p>
        <div class="formula">Shares = $${CLASS_ACCOUNT * CLASS_RISK} ÷ (entry − stop) = $${CLASS_ACCOUNT * CLASS_RISK} ÷ ${money(sc.entry - st.answers.stop)}</div>
        <label>Shares to buy<input type="number" step="1" min="0" id="shares-in" value="${st.answers.shares ?? ''}"></label>
        ${feedback(g)}
        ${g?.ok ? `<p class="small muted">You'll buy ${st.answers.shares} shares for ${money(st.answers.shares * sc.entry)}. If the stop hits you lose about ${money(st.answers.shares * (sc.entry - st.answers.stop))}.</p>` : ''}
        <div class="step-actions"><button class="btn ghost" data-check="shares">Check my math</button>${g?.ok ? next('Buy it and start the trade →') : showMeBtn}</div>`;
    },

    // 6 — trade
    () => {
      const r = st.rules;
      const day = st.candles[sc.d + st.revealed];
      const prev = st.candles[sc.d + st.revealed - 1];
      const todays = r.events.filter((e) => e.i === sc.d + st.revealed);
      const over = r.closed || st.manual || st.revealed >= MAX_HOLD_DAYS;
      const live = finalResult(sc, st.trade, r, st.manual);
      let coach;
      if (st.revealed === 0) coach = `You bought ${st.trade.shares} shares at ${money(sc.entry)}. Your stop-loss and target orders are set. Now the hard part: <strong>let the plan work</strong>. Click <em>Next day</em> to see what happened.`;
      else if (todays.length) coach = todays.map((e) => esc(e.text)).join('<br>');
      else if (st.manual) coach = `You sold everything at ${money(st.manual.price)}.`;
      else coach = esc(r.today.text);
      if (!r.closed && !st.manual && st.revealed >= MAX_HOLD_DAYS) coach += `<br><strong>Time's up.</strong> Swing trades have a time limit: after ${MAX_HOLD_DAYS} trading days the idea has had its chance, so the rest is sold at ${money(r.price)}.`;
      return `
        <h2>6. Trade it</h2>
        <div class="trade-status">
          <div><span class="label">Day</span><strong>${st.revealed} / ${MAX_HOLD_DAYS}</strong></div>
          <div><span class="label">Price</span><strong>${money(day.close)}</strong>${prev ? `<span class="${toneOf(day.close - prev.close)} small">${pct(day.close / prev.close - 1, 1, true)}</span>` : ''}</div>
          <div><span class="label">Shares left</span><strong>${st.manual ? 0 : r.open}</strong></div>
          <div><span class="label">Profit / loss</span><strong class="${toneOf(live.pl)}">${live.pl >= 0 ? '+' : '−'}${money(Math.abs(live.pl))}</strong></div>
        </div>
        <div class="coach-say"><span class="coach-label">Coach</span><p>${coach}</p></div>
        <div class="step-actions">${over ? next('See my results →') : `
          <button class="btn" data-day="1">Next day ▶</button>
          <button class="btn ghost" data-day="5">Skip 5 days ⏩</button>
          <button class="btn ghost danger" data-sellnow>Sell everything now</button>`}</div>
        <p class="muted small">Stop-loss: ${money(r.stop)}${r.stop > st.trade.stop ? ' (raised as the trade worked)' : ''} · Next target: ${r.nextTarget ? money(r.nextTarget) : '—'}</p>`;
    },

    // 7 — results
    () => {
      const r = st.rules;
      const mine = finalResult(sc, st.trade, r, st.manual ?? (r.closed ? null : { price: r.price }));
      const planRun = replayTo(st.candles, sc, st.trade, MAX_HOLD_DAYS);
      const plan = finalResult(sc, st.trade, planRun, planRun.closed ? null : { price: planRun.price });
      const earlyExit = st.manual && Math.abs(plan.pl - mine.pl) > 1;
      const checks = [
        [st.answers.trend === sc.trend, `Trend: you said ${st.answers.trend}, it was ${sc.trend}.`],
        [st.answers.setup === sc.setup.key, `Setup: ${sc.setup.label}.`],
        [st.results.stop?.ok === true, `Stop at ${money(st.answers.stop)}${st.results.stop?.ok === true ? ', well placed' : ', could be better placed'}.`],
        [st.results.target?.ok === true, `Target at ${money(st.answers.target)} (${st.results.target?.rr?.toFixed(1)} : 1 reward to risk).`],
        [st.results.shares?.ok === true && !st.results.shares?.helped, `Position size: ${st.answers.shares} shares${st.results.shares?.helped ? ' (with help)' : ''}.`],
        [!st.manual || mine.pl >= plan.pl, st.manual ? `You sold by hand on day ${st.revealed}${mine.pl >= plan.pl ? ' and it paid off' : '. Following the plan would have done better'}.` : 'You let the plan run without interfering.'],
      ];
      const score = checks.filter(([ok]) => ok).length;
      if (!st.saved) {
        st.saved = true;
        store.set('class:history', [...classHistory(), { symbol: st.symbol, day: sc.day, r: +mine.r.toFixed(2), pl: Math.round(mine.pl), score, at: new Date().toISOString() }].slice(-50));
      }
      return `
        <h2>Results</h2>
        <p class="reveal">The mystery stock was <strong>${esc(st.symbol)}</strong> (${esc(st.name)}), starting ${fmtDay(st.candles[sc.d].t)}.</p>
        <div class="trade-status">
          <div><span class="label">Your result</span><strong class="${toneOf(mine.pl)}">${mine.pl >= 0 ? '+' : '−'}${money(Math.abs(mine.pl))}</strong><span class="small muted">${mine.r >= 0 ? '+' : ''}${mine.r.toFixed(1)}R · ${pct(mine.pct, 2, true)} of account</span></div>
          <div><span class="label">Plan, followed exactly</span><strong class="${toneOf(plan.pl)}">${plan.pl >= 0 ? '+' : '−'}${money(Math.abs(plan.pl))}</strong><span class="small muted">${plan.r >= 0 ? '+' : ''}${plan.r.toFixed(1)}R</span></div>
          <div><span class="label">Checklist</span><strong>${score} / ${checks.length}</strong></div>
        </div>
        <ul class="checklist">${checks.map(([ok, t]) => `<li class="${ok ? 'ok' : 'warn'}">${ok ? '✓' : '✗'} ${esc(t)}</li>`).join('')}</ul>
        <div class="coach-say"><span class="coach-label">Coach</span><p>${esc(lesson(mine, plan, earlyExit))}</p></div>
        <p class="small muted"><strong>"R"</strong> = profit measured in units of the risk you planned. +2R means you made twice what you were willing to lose. Pros judge trades in R, not dollars.</p>
        <div class="step-actions"><a class="btn" href="#/class?new=1">Take another trade →</a><a class="btn ghost" href="#/practice">Practice with today's prices</a></div>`;
    },
  ];

  el.innerHTML = steps[st.step]();

  const stopIn = el.querySelector('#stop-in'), targetIn = el.querySelector('#target-in');
  const liveLine = (input, key) => input?.addEventListener('input', () => { const v = Number(input.value); if (v > 0) { st.answers[key] = v; redrawChart(); } });
  liveLine(stopIn, 'stop');
  liveLine(targetIn, 'target');

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, a');
    if (!b) return;
    if (b.dataset.next !== undefined) {
      if (st.step === 5) { st.trade = classTrade(sc, st.answers); st.rules = replayTo(st.candles, sc, st.trade, 0); }
      return go();
    }
    if (b.dataset.trend) { st.answers.trend = b.dataset.trend; return redraw(); }
    if (b.dataset.setup) { st.answers.setup = b.dataset.setup; return redraw(); }
    if (b.dataset.show !== undefined) return showMe();
    if (b.dataset.check === 'stop') { st.answers.stop = Number(stopIn.value); st.results.stop = gradeStop(sc, st.answers.stop); return redraw(); }
    if (b.dataset.check === 'target') { st.answers.target = Number(targetIn.value); st.results.target = gradeTarget(sc, st.answers.stop, st.answers.target); return redraw(); }
    if (b.dataset.check === 'shares') {
      const n = Number(el.querySelector('#shares-in').value);
      const exp = expectedShares(sc.entry, st.answers.stop);
      st.answers.shares = n;
      const ok = n > 0 && Math.abs(n - exp.shares) <= 1;
      st.results.shares = { ok, helped: st.results.shares?.helped, text: ok ? `Correct! ${exp.capped ? `The risk rule allows ${Math.floor(exp.byRisk)}, but the ${pct(CLASS_MAX_POSITION, 0)} cap limits you to ${exp.shares}.` : `$${CLASS_ACCOUNT * CLASS_RISK} ÷ ${money(sc.entry - st.answers.stop)} = ${exp.byRisk.toFixed(1)}, rounded down to ${exp.shares}.`}`
        : n > exp.shares ? `Too many: with ${n} shares a stop-out would cost ${money(n * (sc.entry - st.answers.stop))}, more than your ${money(CLASS_ACCOUNT * CLASS_RISK, 0)} limit${exp.capped ? ', or over the position cap' : ''}.` : `Too few. That's safe, but you're under-using your risk budget. Try the formula.` };
      return redraw();
    }
    if (b.dataset.day) {
      const add = Math.min(Number(b.dataset.day), MAX_HOLD_DAYS - st.revealed);
      for (let k = 0; k < add; k++) {
        st.revealed++;
        st.rules = replayTo(st.candles, sc, st.trade, st.revealed);
        if (st.rules.closed) break;
      }
      return redraw();
    }
    if (b.dataset.sellnow !== undefined) {
      if (!confirm('Sell everything at today\'s price? (The plan says hold unless the stop or a target is hit.)')) return;
      st.manual = { price: st.candles[sc.d + st.revealed].close, day: st.revealed };
      return redraw();
    }
  });

  function showMe() {
    const plan = a.plan;
    if (st.step === 1) st.answers.trend = sc.trend;
    if (st.step === 2) st.answers.setup = sc.setup.key;
    if (st.step === 3) {
      st.answers.stop = +plan.stop.toFixed(2);
      st.results.stop = { ok: true, text: `Here's how: nearest support is ${money(sc.support)}. Go half a daily move (ATR ${money(sc.atr)}) below it, but keep it 1–3 ATR from the entry. That gives ${money(plan.stop)}. If price closes below here, buyers didn't defend support and the idea is wrong.` };
    }
    if (st.step === 4) {
      const risk = sc.entry - st.answers.stop;
      const t = Math.max(plan.targets[0], sc.entry + 2 * risk);
      st.answers.target = +t.toFixed(2);
      st.results.target = { ...gradeTarget(sc, st.answers.stop, t), text: `Here's how: your risk is ${money(risk)} a share. Twice that above entry is ${money(sc.entry + 2 * risk)}${sc.resistance ? `, and resistance is at ${money(sc.resistance)}` : ''}, so ${money(t)} is a sensible first target.` };
    }
    if (st.step === 5) {
      const exp = expectedShares(sc.entry, st.answers.stop);
      st.answers.shares = exp.shares;
      st.results.shares = { ok: true, helped: true, text: `Here's how: you can risk $${CLASS_ACCOUNT * CLASS_RISK}. Each share risks ${money(sc.entry - st.answers.stop)}, so $${CLASS_ACCOUNT * CLASS_RISK} ÷ ${money(sc.entry - st.answers.stop)} = ${exp.byRisk.toFixed(1)} → ${Math.floor(exp.byRisk)} shares${exp.capped ? `. But that would be over ${pct(CLASS_MAX_POSITION, 0)} of the account, so the cap limits it to ${exp.shares}` : ''}.` };
    }
    redraw();
  }
}

function lesson(mine, plan, earlyExit) {
  if (earlyExit && plan.pl > mine.pl) return 'You sold before the plan said to, and the plan would have made more. The hardest skill in trading is doing nothing while the trade works. Trust your stop.';
  if (earlyExit && plan.pl < mine.pl) return 'Your early exit beat the plan this time. Ask yourself: was it a rule you could repeat, or a lucky feeling? Only repeatable rules help over many trades.';
  if (mine.pl < 0) return 'A loss, and that\'s fine. It was a small, planned loss: exactly what the stop is for. Good traders lose often but small. What matters is that your winners are bigger than your losers.';
  if (mine.r >= 2) return 'Excellent: you made at least twice what you risked by following the plan. One trade like this pays for two losing ones.';
  return 'A win. You followed a plan from start to finish: trend, setup, stop, target, size. Repeat that process and the results take care of themselves.';
}
