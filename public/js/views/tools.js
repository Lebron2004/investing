import { getHistory, money, esc, demoNotice } from '../api.js';
import { computeIndicators } from '../lib/analysis.js';
import { signalLine, SIGNAL_DEFAULTS } from '../lib/signal.js';
import { mountChart } from '../chart.js';
import { openSidePanel } from './desk.js';
import { promptInstall } from '../install.js';

const FILES = {
  pine: { path: 'tools/stockwise-signal.pine', name: 'stockwise-signal.pine' },
  tos: { path: 'tools/stockwise-signal.ts', name: 'StockWise_Signal_Line.ts' },
};

export async function renderTools(app, q) {
  const symbol = (q.get('symbol') || 'SPY').toUpperCase();
  app.innerHTML = `
    <section class="page-head">
      <h1>StockWise Signal Line</h1>
      <p class="lede">A line for your candle charts that tells you at a glance whether to <strong class="up">buy</strong>, <strong>hold</strong> or <strong class="down">sell</strong>. Download it for TradingView or thinkorswim, or switch it on in StockWise's own charts. Turn it on or off whenever you want.</p>
    </section>

    <section class="card desk-promo">
      <div>
        <span class="eyebrow">New · updates all day</span>
        <h2>⚡ Day Trade Desk</h2>
        <p>Which stocks to day-trade today for your budget, picked by StockWise's own AI model, with entry, stop, targets and share counts, plus tips for the time of day. Keep it open in a narrow window next to your charts, or install StockWise as an app on your computer.</p>
        <div class="dl-row">
          <a class="btn" href="#/desk">Open the Desk</a>
          <button class="btn ghost" data-sidepanel>Open as side panel ↗</button>
          <button class="btn ghost" data-install>⬇ Install as app</button>
        </div>
      </div>
    </section>

    <div class="grid-2 tools-top">
      <section class="card">
        <h2>How to read it</h2>
        <ul class="read-list">
          <li><span class="swatch up-line"></span><div><strong>Green line under the candles: HOLD.</strong> The trend is up. The line is your trailing stop: it only moves up, and if a day closes below it, the line flips.</div></li>
          <li><span class="swatch down-line"></span><div><strong>Red line above the candles: SELL / stay out.</strong> The trend is down. Wait until price closes above the line.</div></li>
          <li><span class="tag-sample buy">BUY</span><div>The line just flipped up and price is above its 200-day average. A fresh uptrend.</div></li>
          <li><span class="tag-sample wait">WAIT</span><div>Flipped up, but the long-term trend is still down. Often a short bounce, so be careful.</div></li>
          <li><span class="tag-sample sell">SELL</span><div>The line just flipped down. Exit, or at least tighten up.</div></li>
          <li><span class="swatch zone"></span><div><strong>Shaded zone</strong> (TradingView / thinkorswim): light green between the line and price = hold zone, light red = stay-out zone. Turn it off with the <em>Shade</em> / <em>showCloud</em> setting. There's also a setting to <em>color the candles</em> by trend.</div></li>
          <li><span class="dot-sample"></span><div><strong>Orange dot:</strong> overheated (RSI over 75). Don't chase it. Consider taking some profit.</div></li>
        </ul>
      </section>
      <section class="card">
        <div class="card-head"><h2>Live preview</h2>
          <form id="preview-form" class="sym-row compact-row"><input name="sym" value="${esc(symbol)}" aria-label="Symbol" autocapitalize="characters"><button class="btn ghost small-btn">Show</button></form>
        </div>
        <div id="preview-status" class="small"></div>
        <div id="preview" class="chart-box"><div class="loading">Loading…</div></div>
      </section>
    </div>

    <h2 class="section-title">Get it for your charts</h2>
    <div class="platforms">
      <section class="card platform">
        <div class="platform-head"><h3>TradingView</h3><span class="badge up">Free account works</span></div>
        <p class="muted small">Also the charts inside many brokers and websites. Works on any stock and any timeframe.</p>
        <div class="dl-row"><a class="btn" href="${FILES.pine.path}" download="${FILES.pine.name}">⬇ Download .pine</a><button class="btn ghost" data-copy="pine">Copy code</button></div>
        <ol class="install">
          <li>Open any chart on <a href="https://www.tradingview.com/chart/" target="_blank" rel="noopener">tradingview.com</a>.</li>
          <li>At the bottom, click <strong>Pine Editor</strong>.</li>
          <li>Delete what's there and <strong>paste</strong> the code (or open the downloaded file and copy it).</li>
          <li>Click <strong>Save</strong> (name it "StockWise"), then <strong>Add to chart</strong>.</li>
        </ol>
        <p class="small"><strong>On / off:</strong> hover "StockWise" at the top-left of the chart and click the 👁 eye. <strong>Settings:</strong> the ⚙ gear. <strong>Alerts:</strong> Create Alert → Condition: StockWise Signal Line → "StockWise BUY" or "SELL". It's saved under <em>Indicators → My scripts</em> for every chart.</p>
      </section>

      <section class="card platform">
        <div class="platform-head"><h3>thinkorswim</h3><span class="badge flat">Schwab</span></div>
        <p class="muted small">Desktop, web and mobile (once added on desktop). Any stock, any timeframe.</p>
        <div class="dl-row"><a class="btn" href="${FILES.tos.path}" download="${FILES.tos.name}">⬇ Download .ts</a><button class="btn ghost" data-copy="tos">Copy code</button></div>
        <ol class="install">
          <li>Open a chart and click the <strong>Studies</strong> button (beaker icon) → <strong>Edit studies…</strong></li>
          <li>Click <strong>Create…</strong> (bottom-left). Name it <code>StockWise_Signal_Line</code>.</li>
          <li>Delete the sample line and <strong>paste</strong> the code. Click <strong>OK</strong>.</li>
          <li>Back in the list, double-click it to add it, then <strong>Apply</strong>.</li>
        </ol>
        <p class="small">Or use <strong>Import</strong> in the Edit Studies window and pick the downloaded .ts file. <strong>On / off:</strong> Studies → Edit studies → remove it from "Added studies", or add it back anytime from the list. Labels at the top-left show HOLD / SELL and the stop price.</p>
      </section>

      <section class="card platform">
        <div class="platform-head"><h3>Webull · Robinhood · Fidelity · others</h3></div>
        <p class="muted small">These apps don't let you install custom indicators, so here are two easy options:</p>
        <ol class="install">
          <li><strong>StockWise charts:</strong> every stock page has a <strong>Signal line</strong> switch above the chart. It's on by default, and you can flip it off anytime.</li>
          <li><strong>Built-in SuperTrend:</strong> many platforms include an indicator called <em>SuperTrend</em>. Add it with <strong>ATR period ${SIGNAL_DEFAULTS.atrLength}</strong> and <strong>multiplier ${SIGNAL_DEFAULTS.multiplier}</strong>, plus a <strong>${SIGNAL_DEFAULTS.trendLength}-period simple moving average</strong>, and you get the same line. (BUY = line flips green above the ${SIGNAL_DEFAULTS.trendLength} SMA.)</li>
          <li>Or open the same stock on a free TradingView account and add the indicator above.</li>
        </ol>
        <a class="btn ghost" href="#/stock/${encodeURIComponent(symbol)}">Open ${esc(symbol)} on StockWise</a>
      </section>
    </div>

    <section class="card">
      <h2>How it decides</h2>
      <div class="grid-2 plain">
        <div>
          <p>The line is an <strong>ATR trailing stop</strong> (known as <em>SuperTrend</em>). It sits ${SIGNAL_DEFAULTS.multiplier}× the stock's average daily range (ATR, ${SIGNAL_DEFAULTS.atrLength} bars) away from the price:</p>
          <ul class="bullets">
            <li>In an uptrend it trails <em>below</em> the price and only ever moves up.</li>
            <li>When a candle <em>closes</em> on the other side of the line, the trend has flipped.</li>
            <li>A <strong>BUY</strong> only counts if price is above its ${SIGNAL_DEFAULTS.trendLength}-bar average. Otherwise it's a <strong>WAIT</strong>.</li>
          </ul>
        </div>
        <div>
          <p><strong>Good to know</strong></p>
          <ul class="bullets">
            <li>It follows trends, it doesn't predict them. Signals come after a move has started.</li>
            <li>In choppy, sideways markets it can flip back and forth ("whipsaw"). That's when the WAIT filter and your judgment matter most.</li>
            <li>Bigger multiplier = fewer, slower signals. Smaller = faster, more false signals.</li>
            <li>Use it with position sizing and the rest of StockWise. One line is never the whole story.</li>
          </ul>
        </div>
      </div>
      <p class="muted small">Educational tool, not financial advice.</p>
    </section>`;

  let chart = null;
  const preview = async (sym) => {
    const box = app.querySelector('#preview');
    const status = app.querySelector('#preview-status');
    try {
      const data = await getHistory(sym);
      const ind = computeIndicators(data.candles);
      const sig = signalLine(data.candles);
      const st = sig.status;
      status.innerHTML = `${demoNotice(data)}<strong>${esc(sym)}</strong> ${money(data.candles.at(-1).close)} · Signal: <span class="signal-chip ${st.action}"><strong>${esc(st.label)}</strong></span> · ${st.action === 'sell' ? 'flips up above' : 'stop'} ${money(st.stop)}`;
      chart?.destroy();
      chart = mountChart(box, {
        candles: data.candles, ind, bars: 180,
        paths: [
          { series: sig.line.map((v, i) => (sig.dir[i] === 1 ? v : null)), cls: 'sig-up' },
          { series: sig.line.map((v, i) => (sig.dir[i] === -1 ? v : null)), cls: 'sig-down' },
        ],
        markers: sig.signals.filter((x) => x.type !== 'hot').map((x) => {
          const c = data.candles[x.i];
          return x.type === 'sell' ? { i: x.i, price: c.high, label: 'SELL', tone: 'stop' } : { i: x.i, price: c.low, label: x.type === 'buy' ? 'BUY' : 'WAIT', tone: x.type === 'buy' ? 'buy' : 'warn', up: true };
        }),
      });
    } catch (err) {
      box.innerHTML = `<p class="down small">${esc(err.message)}</p>`;
      status.innerHTML = '';
    }
  };
  app.querySelector('#preview-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.elements.sym.value.trim().toUpperCase();
    if (v) preview(v);
  });
  app.querySelector('[data-sidepanel]').addEventListener('click', openSidePanel);
  app.querySelector('[data-install]').addEventListener('click', promptInstall);
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const f = FILES[b.dataset.copy];
    try {
      const code = await (await fetch(f.path)).text();
      await navigator.clipboard.writeText(code);
      b.textContent = '✓ Copied!';
    } catch {
      b.textContent = 'Copy failed: use Download';
    }
    setTimeout(() => { b.textContent = 'Copy code'; }, 2500);
  }));
  await preview(symbol);
  return () => chart?.destroy();
}
