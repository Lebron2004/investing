// Crypto prices from Coinbase's free public market data (no account or key; works from the browser).

const API = 'https://api.exchange.coinbase.com';
const memo = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Coinbase rows are [time (s), low, high, open, close, volume], newest first.
const toBar = ([t, low, high, open, close, volume]) => ({ t: t * 1000, open, high, low, close, volume });

async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`Coinbase ${r.status}`);
    return r.json();
  }
  throw new Error('Coinbase is rate-limiting, try again in a minute');
}

// The most recent candles (up to 300), oldest first. Includes the bar that's still forming.
export async function recentBars(coin, seconds) {
  const rows = await get(`${API}/products/${coin}-USD/candles?granularity=${seconds}`);
  return rows.map(toBar).sort((a, b) => a.t - b.t);
}

// `count` candles of history, oldest first (paged 300 at a time). Cached for the session.
export async function history(coin, seconds, count) {
  const key = `${coin}:${seconds}:${count}`;
  if (!memo.has(key)) {
    const p = (async () => {
      const bars = new Map();
      let end = Math.floor(Date.now() / 1000 / seconds) * seconds;
      while (bars.size < count) {
        const start = end - 300 * seconds;
        const rows = await get(`${API}/products/${coin}-USD/candles?granularity=${seconds}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`);
        if (!rows.length) break;
        for (const r of rows) bars.set(r[0], toBar(r));
        end = start;
        await sleep(120); // stay well under Coinbase's public rate limit
      }
      return [...bars.values()].sort((a, b) => a.t - b.t).slice(-count);
    })();
    memo.set(key, p);
    p.catch(() => memo.delete(key));
  }
  return memo.get(key);
}

export async function tickers(coins) {
  const out = {};
  await Promise.all(coins.map(async (c) => {
    try { out[c] = Number((await get(`${API}/products/${c}-USD/ticker`)).price); } catch { /* skip */ }
  }));
  return out;
}
