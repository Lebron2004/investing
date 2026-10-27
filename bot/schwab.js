// Minimal Schwab Trader API client (https://developer.schwab.com). No dependencies, Node 18+.
//
//   • Log-in (OAuth): you sign in on Schwab's own page; this file only ever sees the one-time code
//     and the tokens Schwab returns. Your Schwab password never touches this program.
//   • Access tokens last 30 minutes and are refreshed automatically.
//   • The refresh token lasts 7 days. After that Schwab requires you to log in again
//     (node bot/schwab-bot.js login). That's Schwab's rule; no program can skip it.

import { readFile, writeFile, rename } from 'node:fs/promises';

const API = 'https://api.schwabapi.com';
export const REFRESH_DAYS = 7;

// --- Order builders (pure: these are the exact JSON bodies sent to Schwab) ------------------
const px = (n) => Number(n >= 1 ? n.toFixed(2) : n.toFixed(4));
const leg = (instruction, symbol, quantity) => ({ instruction, quantity, instrument: { symbol, assetType: 'EQUITY' } });
const single = (instruction, symbol, qty, type, price) => ({
  orderStrategyType: 'SINGLE', session: 'NORMAL', duration: 'DAY', orderType: type,
  ...(type === 'STOP' ? { stopPrice: px(price) } : type === 'LIMIT' ? { price: px(price) } : {}),
  orderLegCollection: [leg(instruction, symbol, qty)],
});

// "1st Triggers OCO": buy with a limit (the most it will pay); once filled, a stop-loss and a profit
// target go live and whichever fills first cancels the other.
export function bracketOrder({ symbol, shares, limit, stop, target }) {
  if (!(shares > 0) || !(stop < limit) || !(target > limit)) throw new Error(`Refusing a malformed bracket for ${symbol}`);
  return {
    ...single('BUY', symbol, shares, 'LIMIT', limit),
    orderStrategyType: 'TRIGGER',
    childOrderStrategies: [exitOco({ symbol, shares, stop, target })],
  };
}

// Stop-loss + profit target for shares already owned (used after moving the stop to break-even).
export function exitOco({ symbol, shares, stop, target }) {
  return {
    orderStrategyType: 'OCO',
    childOrderStrategies: [single('SELL', symbol, shares, 'LIMIT', target), single('SELL', symbol, shares, 'STOP', stop)],
  };
}

export const marketSell = ({ symbol, shares }) => single('SELL', symbol, shares, 'MARKET');

// --- Reading order status ---------------------------------------------------------------
// Every single order inside a (possibly nested) order, with its fill price.
export function flattenOrder(o, out = []) {
  if (!o) return out;
  if (o.orderLegCollection?.length) {
    out.push({
      orderId: String(o.orderId ?? ''), status: o.status, type: o.orderType,
      instruction: o.orderLegCollection[0].instruction, symbol: o.orderLegCollection[0].instrument?.symbol,
      quantity: o.quantity ?? o.orderLegCollection[0].quantity, filledQuantity: o.filledQuantity ?? 0,
      stopPrice: o.stopPrice, price: o.price, fillPrice: fillPrice(o),
    });
  }
  for (const c of o.childOrderStrategies || []) flattenOrder(c, out);
  return out;
}

export function fillPrice(o) {
  const legs = (o.orderActivityCollection || []).flatMap((a) => a.executionLegs || []);
  const qty = legs.reduce((a, l) => a + (l.quantity || 0), 0);
  return qty ? legs.reduce((a, l) => a + l.price * l.quantity, 0) / qty : null;
}

export const isDone = (status) => ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'REPLACED'].includes(status);

// --- Client ------------------------------------------------------------------------------
export class Schwab {
  constructor({ appKey, appSecret, callbackUrl = 'https://127.0.0.1', tokenFile, fetchImpl = fetch }) {
    if (!appKey || !appSecret) throw new Error('appKey and appSecret are missing from bot/config.json');
    Object.assign(this, { appKey, appSecret, callbackUrl, tokenFile, fetch: fetchImpl });
    this.tokens = null;
  }

  loginUrl() {
    return `${API}/v1/oauth/authorize?client_id=${encodeURIComponent(this.appKey)}&redirect_uri=${encodeURIComponent(this.callbackUrl)}`;
  }

  // After logging in, Schwab sends the browser to https://127.0.0.1/?code=...&session=...
  // (the page won't load: that's expected). Paste that whole address here.
  async finishLogin(redirectedUrl) {
    const code = new URL(redirectedUrl.trim()).searchParams.get('code');
    if (!code) throw new Error('That address has no ?code= in it. Copy the full address from the browser bar after logging in.');
    const t = await this.#token({ grant_type: 'authorization_code', code, redirect_uri: this.callbackUrl });
    await this.#saveTokens({ ...t, loggedInAt: Date.now() });
  }

  async loadTokens() {
    try { this.tokens = JSON.parse(await readFile(this.tokenFile, 'utf8')); } catch { this.tokens = null; }
    return this.tokens;
  }

  // Days until Schwab requires a new login (negative = expired).
  daysLeft(now = Date.now()) {
    return this.tokens?.loggedInAt ? REFRESH_DAYS - (now - this.tokens.loggedInAt) / 864e5 : -1;
  }

  async #token(form) {
    const res = await this.fetch(`${API}/v1/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.appKey}:${this.appSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Schwab login failed (${res.status}): ${body.error_description || body.error || 'unknown error'}`);
    return { access_token: body.access_token, refresh_token: body.refresh_token, expiresAt: Date.now() + (body.expires_in || 1800) * 1000 };
  }

  async #saveTokens(t) {
    this.tokens = { ...this.tokens, ...t };
    const tmp = `${this.tokenFile}.tmp`;
    await writeFile(tmp, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
    await rename(tmp, this.tokenFile);
  }

  async #accessToken() {
    if (!this.tokens) await this.loadTokens();
    if (!this.tokens?.refresh_token) throw new LoginNeeded('Not logged in to Schwab yet. Run: node bot/schwab-bot.js login');
    if (this.daysLeft() <= 0) throw new LoginNeeded('Your weekly Schwab login has expired. Run: node bot/schwab-bot.js login');
    if (Date.now() > this.tokens.expiresAt - 60e3) {
      let t;
      try {
        t = await this.#token({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token });
      } catch (err) {
        // A new weekly login in another window replaces the refresh token: pick it up and retry.
        const before = this.tokens.loggedInAt;
        await this.loadTokens();
        if (!this.tokens || this.tokens.loggedInAt === before) throw new LoginNeeded(`Schwab refused the saved login (${err.message}). Run: node bot/schwab-bot.js login`);
        return this.#accessToken();
      }
      await this.#saveTokens({ access_token: t.access_token, expiresAt: t.expiresAt, refresh_token: t.refresh_token || this.tokens.refresh_token });
    }
    return this.tokens.access_token;
  }

  async request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.#accessToken()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0) { this.tokens.expiresAt = 0; continue; } // token revoked early: refresh once
      if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      const text = await res.text();
      const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : null;
      if (!res.ok) throw new Error(`Schwab ${method} ${path.split('?')[0]} failed (${res.status}): ${json?.message || json?.errors?.[0]?.detail || text.slice(0, 200)}`);
      return { json, headers: res.headers, status: res.status };
    }
  }

  // --- Accounts & orders ---
  async accounts() { return (await this.request('GET', '/trader/v1/accounts/accountNumbers')).json; }
  async account(hash) { return (await this.request('GET', `/trader/v1/accounts/${hash}?fields=positions`)).json?.securitiesAccount; }

  async placeOrder(hash, order) {
    const { headers } = await this.request('POST', `/trader/v1/accounts/${hash}/orders`, order);
    const id = (headers.get('location') || '').split('/').pop();
    if (!id) throw new Error('Schwab accepted the order but didn\'t return an order number. Check thinkorswim before doing anything else.');
    return id;
  }
  async getOrder(hash, id) { return (await this.request('GET', `/trader/v1/accounts/${hash}/orders/${id}`)).json; }
  async cancelOrder(hash, id) { await this.request('DELETE', `/trader/v1/accounts/${hash}/orders/${id}`); }

  // --- Market data ---
  async quotes(symbols) {
    const { json } = await this.request('GET', `/marketdata/v1/quotes?symbols=${symbols.map(encodeURIComponent).join(',')}&fields=quote`);
    const out = {};
    for (const [sym, v] of Object.entries(json || {})) {
      const q = v?.quote;
      if (q?.lastPrice > 0) out[sym] = { c: q.lastPrice, o: q.openPrice, h: q.highPrice, l: q.lowPrice, pc: q.closePrice, t: Math.floor((q.tradeTime || q.quoteTime || Date.now()) / 1000) };
    }
    return out;
  }
  async fiveMinuteBars(symbol) {
    const { json } = await this.request('GET', `/marketdata/v1/pricehistory?symbol=${encodeURIComponent(symbol)}&periodType=day&period=1&frequencyType=minute&frequency=5&needExtendedHoursData=false`);
    return (json?.candles || []).map((c) => ({ t: c.datetime, open: c.open, high: c.high, low: c.low, close: c.close }));
  }
  async marketOpenToday(day) {
    const { json } = await this.request('GET', `/marketdata/v1/markets?markets=equity&date=${day}`);
    const eq = json?.equity?.EQ ?? json?.equity?.equity ?? Object.values(json?.equity || {})[0];
    return eq ? !!eq.isOpen : true;
  }
}

export class LoginNeeded extends Error {}
