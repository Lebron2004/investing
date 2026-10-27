// Simulated 5-minute bars for one session that match a daily candle exactly (open, high, low,
// close). Used when real intraday data can't be downloaded (DATA_SOURCE=demo, offline) and in tests.

function seeded(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

// Returns 78 bars [[minute, open, high, low, close], ...], minute = minutes after midnight New York.
export function demoIntradayDay(key, { open, high, low, close }) {
  const n = 78, r = seeded(key);
  const walk = [0];
  for (let i = 1; i <= n; i++) walk.push(walk[i - 1] + (r() - 0.5));
  const noise = walk.map((w, i) => w - (i / n) * walk[n]); // Brownian bridge: 0 at both ends
  const base = (i) => open + ((close - open) * i) / n;
  let iu = 0, il = 0;
  noise.forEach((v, i) => { if (v > noise[iu]) iu = i; if (v < noise[il]) il = i; });
  const up = noise[iu] > 0 ? (high - base(iu)) / noise[iu] : 0;
  const dn = noise[il] < 0 ? (base(il) - low) / -noise[il] : 0;
  const clamp = (v) => Math.min(high, Math.max(low, v));
  const p = noise.map((v, i) => clamp(base(i) + v * (v >= 0 ? up : dn)));
  p[0] = open; p[n] = close;
  // Make sure the day's high and low are actually touched (if not already at the ends).
  if (Math.max(...p) < high) p[iu > 0 && iu < n ? iu : Math.floor(n / 3)] = high;
  if (Math.min(...p) > low) p[il > 0 && il < n ? il : Math.floor((2 * n) / 3)] = low;
  const bars = [];
  for (let j = 0; j < n; j++) {
    const o = p[j], c = p[j + 1];
    const wick = Math.abs(c - o) * r() * 0.5;
    bars.push([570 + 5 * j, o, Math.min(high, Math.max(o, c) + wick), Math.max(low, Math.min(o, c) - wick), c]);
  }
  return bars;
}
