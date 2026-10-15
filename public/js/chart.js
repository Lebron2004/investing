// Lightweight SVG candlestick chart with moving averages, trade levels, volume and an RSI pane.
import { money } from './api.js';

const NS = 'http://www.w3.org/2000/svg';

// opts.paths:   [{ series (aligned with candles, null = gap), cls }] extra lines, e.g. a trailing stop
// opts.markers: [{ i (candle index), price, label, tone: 'buy'|'sell'|'stop'|'warn' }]
export function mountChart(container, { candles, ind, levels = [], bars = 126, paths = [], markers = [] }) {
  const state = { bars, levels, paths, markers };
  const draw = () => render(container, candles, ind, state.levels, state.bars, state.paths, state.markers);
  const ro = new ResizeObserver(() => draw());
  ro.observe(container);
  draw();
  return {
    setBars(n) { state.bars = n; draw(); },
    // Replace any of { levels, paths, markers } and redraw.
    update(next) { Object.assign(state, next); draw(); },
    destroy() { ro.disconnect(); },
  };
}

function render(container, candles, ind, levels, bars, paths = [], markers = []) {
  const width = Math.max(320, container.clientWidth);
  const priceH = width < 560 ? 260 : 340;
  const rsiH = 90, gap = 18, padL = 8, padR = 64, padT = 10;
  const height = padT + priceH + gap + rsiH + 22;
  const n = candles.length;
  const start = Math.max(0, n - bars);
  const view = candles.slice(start);
  const idx = (i) => i - start;

  let lo = Math.min(...view.map((c) => c.low));
  let hi = Math.max(...view.map((c) => c.high));
  for (const l of levels) {
    // Only stretch the axis for levels reasonably close to the visible range.
    if (l.price > lo * 0.85 && l.price < hi * 1.15) { lo = Math.min(lo, l.price); hi = Math.max(hi, l.price); }
  }
  for (const p of paths) for (let i = start; i < n; i++) if (p.series[i] != null) { lo = Math.min(lo, p.series[i]); hi = Math.max(hi, p.series[i]); }
  const padP = (hi - lo) * 0.06;
  lo -= padP; hi += padP;

  const plotW = width - padL - padR;
  const step = plotW / view.length;
  const x = (i) => padL + idx(i) * step + step / 2;
  const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * priceH;
  const rsiTop = padT + priceH + gap;
  const yr = (v) => rsiTop + (1 - v / 100) * rsiH;
  const maxVol = Math.max(...view.map((c) => c.volume || 0)) || 1;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Price chart');

  let html = '';
  // grid + price axis
  for (let k = 0; k <= 5; k++) {
    const p = lo + ((hi - lo) * k) / 5;
    html += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${y(p)}" y2="${y(p)}"/>`;
    html += `<text class="axis" x="${width - padR + 6}" y="${y(p) + 4}">${p.toFixed(p < 10 ? 2 : 0)}</text>`;
  }
  // month labels
  let lastMonth = -1;
  view.forEach((c, j) => {
    const d = new Date(c.t);
    if (d.getUTCMonth() !== lastMonth && j > 2) {
      lastMonth = d.getUTCMonth();
      const label = d.toLocaleDateString('en-US', { month: 'short', ...(d.getUTCMonth() === 0 ? { year: '2-digit' } : {}), timeZone: 'UTC' });
      if (view.length <= 300 || d.getUTCMonth() % 3 === 0) html += `<text class="axis" x="${padL + j * step}" y="${height - 4}">${label}</text>`;
    } else if (j <= 2) lastMonth = d.getUTCMonth();
  });
  // volume
  view.forEach((c, j) => {
    const vh = ((c.volume || 0) / maxVol) * priceH * 0.18;
    html += `<rect class="vol ${c.close >= c.open ? 'up' : 'down'}" x="${padL + j * step + step * 0.15}" y="${padT + priceH - vh}" width="${Math.max(1, step * 0.7)}" height="${vh}"/>`;
  });
  // candles
  view.forEach((c, j) => {
    const i = start + j;
    const cls = c.close >= c.open ? 'up' : 'down';
    const bw = Math.max(1, step * 0.65);
    const top = y(Math.max(c.open, c.close)), bot = y(Math.min(c.open, c.close));
    html += `<line class="wick ${cls}" x1="${x(i)}" x2="${x(i)}" y1="${y(c.high)}" y2="${y(c.low)}"/>`;
    html += `<rect class="body ${cls}" x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}"/>`;
  });
  // moving averages
  const line = (series, cls) => {
    let d = '';
    for (let i = start; i < n; i++) if (series[i] != null) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(series[i]).toFixed(1)}`;
    return d ? `<path class="ma ${cls}" d="${d}"/>` : '';
  };
  html += line(ind.sma20, 'ma20') + line(ind.sma50, 'ma50') + line(ind.sma200, 'ma200');
  for (const p of paths) {
    // Step line: holds each value until the next day.
    let d = '';
    for (let i = start; i < n; i++) {
      const v = p.series[i];
      if (v == null) continue;
      const x0 = x(i) - step / 2, x1 = x(i) + step / 2;
      d += `${d && p.series[i - 1] != null && i > start ? 'L' : 'M'}${x0.toFixed(1)},${y(v).toFixed(1)}L${x1.toFixed(1)},${y(v).toFixed(1)}`;
    }
    if (d) html += `<path class="path ${p.cls}" d="${d}"/>`;
  }
  for (const m of markers) {
    if (m.i < start || m.price < lo || m.price > hi) continue;
    const mx = x(m.i), my = y(m.price);
    const up = m.up ?? m.tone === 'buy';
    const tri = up ? `${mx},${my + 3} ${mx - 6},${my + 13} ${mx + 6},${my + 13}` : `${mx},${my - 3} ${mx - 6},${my - 13} ${mx + 6},${my - 13}`;
    html += `<polygon class="marker ${m.tone}" points="${tri}"><title>${m.title || m.label}</title></polygon>`;
    if (m.label) html += `<text class="marker-label ${m.tone}" x="${mx}" y="${up ? my + 25 : my - 17}" text-anchor="middle">${m.label}</text>`;
  }
  // trade levels
  for (const l of levels) {
    if (l.price < lo || l.price > hi) continue;
    html += `<line class="level ${l.tone}" x1="${padL}" x2="${width - padR}" y1="${y(l.price)}" y2="${y(l.price)}"/>`;
    html += `<rect class="level-tag ${l.tone}" x="${width - padR + 2}" y="${y(l.price) - 9}" width="${padR - 4}" height="18" rx="3"/>`;
    html += `<text class="level-text" x="${width - padR + 6}" y="${y(l.price) + 4}">${l.label}</text>`;
  }
  // RSI pane
  html += `<rect class="rsi-bg" x="${padL}" y="${yr(70)}" width="${plotW}" height="${yr(30) - yr(70)}"/>`;
  for (const v of [30, 50, 70]) {
    html += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${yr(v)}" y2="${yr(v)}"/><text class="axis" x="${width - padR + 6}" y="${yr(v) + 4}">${v}</text>`;
  }
  let rd = '';
  for (let i = start; i < n; i++) if (ind.rsi14[i] != null) rd += `${rd ? 'L' : 'M'}${x(i).toFixed(1)},${yr(ind.rsi14[i]).toFixed(1)}`;
  html += `<path class="rsi-line" d="${rd}"/><text class="axis pane-label" x="${padL + 4}" y="${rsiTop + 12}">RSI 14</text>`;
  // crosshair
  html += `<line class="cross" x1="0" x2="0" y1="${padT}" y2="${rsiTop + rsiH}" visibility="hidden"/>`;
  svg.innerHTML = html;

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const cross = svg.querySelector('.cross');
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const j = Math.min(view.length - 1, Math.max(0, Math.floor((px - padL) / step)));
    const c = view[j], i = start + j;
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const date = new Date(c.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    tip.innerHTML = `<strong>${date}</strong><br>Open ${money(c.open)} · High ${money(c.high)}<br>Low ${money(c.low)} · Close ${money(c.close)}<br>RSI ${ind.rsi14[i]?.toFixed(0) ?? '—'}`;
    tip.hidden = false;
    const left = (x(i) / width) * r.width;
    tip.style.left = `${left > r.width / 2 ? left - 190 : left + 12}px`;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });

  container.replaceChildren(svg, tip);
}

// Line chart of account value vs. a benchmark. points: [{ day: 'YYYY-MM-DD', value, bench }]
export function mountLineChart(container, points, { labels = ['Your account', 'S&P 500'] } = {}) {
  const draw = () => renderLine(container, points, labels);
  const ro = new ResizeObserver(draw);
  ro.observe(container);
  draw();
  return { destroy() { ro.disconnect(); } };
}

function renderLine(container, points, labels) {
  const width = Math.max(300, container.clientWidth);
  const height = 220, padL = 8, padR = 70, padT = 12, padB = 24;
  const vals = points.flatMap((p) => [p.value, p.bench]).filter((v) => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < hi * 0.02) { lo *= 0.99; hi *= 1.01; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const n = points.length;
  const x = (i) => padL + (n === 1 ? (width - padL - padR) / 2 : (i / (n - 1)) * (width - padL - padR));
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (height - padT - padB);
  const path = (key) => points.map((p, i) => (p[key] == null ? '' : `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)).join('');
  const fmt = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
  let html = '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    html += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${width - padR + 6}" y="${y(v) + 4}">${fmt(v)}</text>`;
  }
  const step = Math.max(1, Math.ceil(n / 6));
  points.forEach((p, i) => {
    if (i % step === 0) html += `<text class="axis" x="${x(i)}" y="${height - 6}" text-anchor="middle">${new Date(`${p.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>`;
  });
  html += `<path class="eq-line bench" d="${path('bench')}"/><path class="eq-line acct" d="${path('value')}"/>`;
  const lastP = points[n - 1];
  html += `<circle class="eq-dot acct" cx="${x(n - 1)}" cy="${y(lastP.value)}" r="4"/>`;
  if (lastP.bench != null) html += `<circle class="eq-dot bench" cx="${x(n - 1)}" cy="${y(lastP.bench)}" r="4"/>`;
  html += `<line class="cross" x1="0" x2="0" y1="${padT}" y2="${height - padB}" visibility="hidden"/>`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${labels[0]} compared with ${labels[1]}`);
  svg.innerHTML = html;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const cross = svg.querySelector('.cross');
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - padL) / (width - padL - padR)) * (n - 1))));
    const p = points[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<strong>${new Date(`${p.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong><br><span class="k-acct">■</span> ${labels[0]}: ${fmt(p.value)}${p.bench != null ? `<br><span class="k-bench">■</span> ${labels[1]}: ${fmt(p.bench)}` : ''}`;
    tip.hidden = false;
    const left = (x(i) / width) * r.width;
    tip.style.left = `${left > r.width / 2 ? left - 190 : left + 12}px`;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  container.replaceChildren(svg, tip);
}
