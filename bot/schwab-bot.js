#!/usr/bin/env node
// StockWise AutoPilot for Schwab. Runs on your own computer (or a small cloud server) and trades
// your Schwab account by your AutoPilot rules. Setup guide: bot/README.md
//
//   node bot/schwab-bot.js setup      one time: your Schwab app key/secret and phone notifications
//   node bot/schwab-bot.js login      log in to Schwab (needed once a week, Schwab's rule)
//   node bot/schwab-bot.js check      test the connection (add --test-order to test placing an order)
//   node bot/schwab-bot.js run        start the bot (dry run until you switch to live)
//   node bot/schwab-bot.js golive     switch from dry run to real orders
//   node bot/schwab-bot.js dryrun     switch back to dry run
//   node bot/schwab-bot.js status     what the bot did today
//   node bot/schwab-bot.js stop       sell everything the bot holds and stop for today

import { readFile, writeFile, appendFile, mkdir, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Schwab, LoginNeeded } from './schwab.js';
import { createRunner } from './runner.js';
import { normalizeRules, DEFAULT_RULES, fmtMin } from '../public/js/lib/autopilot.js';
import { nyClock } from '../public/js/lib/daytrade.js';

const dir = fileURLToPath(new URL('./', import.meta.url));
const F = {
  config: `${dir}config.json`, tokens: `${dir}.tokens.json`, rules: `${dir}rules.json`,
  stop: `${dir}STOP`, logs: `${dir}logs/`, state: (mode) => `${dir}state-${mode}.json`,
};
const readJson = async (f, d = null) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const exists = (f) => access(f).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (n) => `••••${String(n).slice(-4)}`;

async function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(q)).trim(); } finally { rl.close(); }
}

async function config() {
  const c = await readJson(F.config);
  if (!c) { console.log('No bot/config.json yet. Run: node bot/schwab-bot.js setup'); process.exit(1); }
  return { mode: 'dry-run', callbackUrl: 'https://127.0.0.1', siteUrl: 'https://lebron2004.github.io/investing', ...c };
}
const client = (c) => new Schwab({ appKey: c.appKey, appSecret: c.appSecret, callbackUrl: c.callbackUrl, tokenFile: F.tokens });

async function rules() {
  const r = await readJson(F.rules);
  if (!r) console.log('No bot/rules.json found, so the default rules are used ($100 budget, $5 daily loss limit). Download yours from the AutoPilot page → "Download rules for the Schwab bot".');
  return normalizeRules({ ...DEFAULT_RULES, ...(r?.rules ?? r ?? {}) });
}

async function accountHash(api, c) {
  const list = await api.accounts();
  if (!list?.length) throw new Error('Schwab returned no accounts for this login.');
  const pick = c.accountNumber ? list.find((a) => String(a.accountNumber).endsWith(String(c.accountNumber).slice(-4))) : list[0];
  if (!pick) throw new Error(`Account ending ${String(c.accountNumber).slice(-4)} wasn't found. You have: ${list.map((a) => mask(a.accountNumber)).join(', ')}`);
  return { hash: pick.hashValue, number: pick.accountNumber, all: list };
}

function notifier(c) {
  return async (text) => {
    if (!c.ntfyTopic) return;
    try { await fetch(`https://ntfy.sh/${encodeURIComponent(c.ntfyTopic)}`, { method: 'POST', body: text, headers: { Title: 'StockWise AutoPilot' } }); } catch { /* offline */ }
  };
}

async function logger(text) {
  const line = `${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}  ${text}`;
  console.log(line);
  try { await mkdir(F.logs, { recursive: true }); await appendFile(`${F.logs}${nyClock().day}.log`, `${line}\n`); } catch { /* ignore */ }
}

// --- commands ---------------------------------------------------------------------------
async function setup() {
  console.log(`
StockWise AutoPilot for Schwab: one-time setup
================================================
You need a Schwab developer app first (see bot/README.md, step 1). On developer.schwab.com → Dashboard
→ your app, copy the "App Key" and "Secret". Its Callback URL must be exactly: https://127.0.0.1
`);
  const old = (await readJson(F.config)) || {};
  const appKey = (await ask(`App Key${old.appKey ? ' (Enter to keep)' : ''}: `)) || old.appKey;
  const appSecret = (await ask(`Secret${old.appSecret ? ' (Enter to keep)' : ''}: `)) || old.appSecret;
  console.log('\nPhone notifications (optional, free): install the "ntfy" app, subscribe to a topic name that only you know,\ne.g. stockwise-jash-83kd2, and type the same name here. Leave blank to skip.');
  const ntfyTopic = (await ask(`ntfy topic${old.ntfyTopic ? ` (Enter to keep "${old.ntfyTopic}")` : ''}: `)) || old.ntfyTopic || '';
  const accountNumber = (await ask('Last 4 digits of the Schwab account to trade (Enter = your first account): ')) || old.accountNumber || '';
  await writeFile(F.config, JSON.stringify({ ...old, appKey, appSecret, ntfyTopic, accountNumber, mode: old.mode || 'dry-run' }, null, 2), { mode: 0o600 });
  console.log('\nSaved bot/config.json (keep it private, it is never uploaded to GitHub). Next: node bot/schwab-bot.js login');
}

async function login() {
  const c = await config();
  const api = client(c);
  console.log(`
1. Open this link and log in with your normal Schwab username and password:

   ${api.loginUrl()}

2. Approve access for your account.
3. Your browser then goes to a page that won't load (https://127.0.0.1/?code=...). That's expected.
   Copy the WHOLE address from the address bar and paste it below within 30 seconds.
`);
  const url = await ask('Paste the address here: ');
  await api.finishLogin(url);
  console.log(`\n✓ Logged in. Good for ${api.daysLeft().toFixed(1)} days. Next: node bot/schwab-bot.js check`);
}

async function check(args) {
  const c = await config();
  const api = client(c);
  await api.loadTokens();
  console.log(`Login: ${api.daysLeft() > 0 ? `OK, ${api.daysLeft().toFixed(1)} days left before you need to log in again` : 'EXPIRED. Run login first.'}`);
  if (api.daysLeft() <= 0) return;
  const { hash, number, all } = await accountHash(api, c);
  console.log(`Accounts: ${all.map((a) => mask(a.accountNumber)).join(', ')} → trading ${mask(number)}`);
  const a = await api.account(hash);
  const b = a?.currentBalances || {};
  console.log(`Account type: ${a?.type} · cash available to trade: $${(b.cashAvailableForTrading ?? b.availableFunds ?? 0).toFixed(2)}${a?.roundTrips != null ? ` · day trades (5 days): ${a.roundTrips}` : ''}`);
  const q = await api.quotes(['SPY']);
  console.log(`Market data: SPY $${q.SPY?.c ?? '?'}`);
  console.log(`Market open today: ${await api.marketOpenToday(nyClock().day)}`);
  const r = await rules();
  console.log(`Rules: budget $${r.budget}, ${(r.riskPct * 100).toFixed(1)}% risk/trade, $${r.maxDailyLoss} daily loss limit, ${r.maxTrades} trades/day, ${r.allow.length ? `only ${r.allow.join(', ')}` : r.sectors ? r.sectors.join(', ') : 'all sectors'}`);
  console.log(`Mode: ${c.mode === 'live' ? 'LIVE (real orders)' : 'dry run (no real orders)'}`);
  if (args.includes('--test-order')) {
    const sym = 'F';
    const last = (await api.quotes([sym]))[sym]?.c;
    const price = Math.max(1, Math.round(last * 0.5 * 100) / 100);
    if ((await ask(`\nThis places a REAL order: buy 1 ${sym} at $${price} (half the price, so it won't fill), then cancels it. Type yes: `)) !== 'yes') return;
    const id = await api.placeOrder(hash, { orderType: 'LIMIT', session: 'NORMAL', duration: 'DAY', orderStrategyType: 'SINGLE', price, orderLegCollection: [{ instruction: 'BUY', quantity: 1, instrument: { symbol: sym, assetType: 'EQUITY' } }] });
    await sleep(2000);
    console.log(`Order ${id}: ${(await api.getOrder(hash, id)).status}`);
    await api.cancelOrder(hash, id);
    await sleep(1500);
    console.log(`After cancel: ${(await api.getOrder(hash, id)).status}. ✓ Placing and cancelling orders works.`);
  }
}

async function setMode(mode) {
  const c = await config();
  if (mode === 'live') {
    console.log(`
Switching to LIVE trading: the bot will place REAL orders in your Schwab account.
  • It only trades by your rules in bot/rules.json (check them with: node bot/schwab-bot.js check)
  • Every buy has a stop-loss at Schwab. Day trading is risky: you can lose money.
  • Stop it any time: Ctrl+C, the STOP file, or your ntfy "-stop" topic (see README).
`);
    if ((await ask('Type LIVE to confirm: ')) !== 'LIVE') return console.log('Not changed.');
  }
  await writeFile(F.config, JSON.stringify({ ...c, mode }, null, 2), { mode: 0o600 });
  console.log(`Mode is now: ${mode === 'live' ? 'LIVE' : 'dry run'}. Restart the bot for it to take effect.`);
}

async function status() {
  const c = await config();
  const st = await readJson(F.state(c.mode), {});
  const s = st.today;
  if (!s) return console.log('No trading day recorded yet.');
  console.log(`${s.day} (${c.mode}): ${s.trades} trade(s), realized ${s.realized >= 0 ? '+' : '−'}$${Math.abs(s.realized).toFixed(2)}${s.halted ? ` · ${s.halted}` : ''}`);
  for (const p of s.positions) console.log(`  holding ${p.shares} ${p.symbol} @ $${p.entry} · stop $${p.stop} · target $${p.target}`);
  for (const l of s.log.slice(-15)) console.log(`  ${fmtMin(l.m).padStart(7)}  ${l.text}`);
}

async function stopNow() {
  await writeFile(F.stop, `stop requested ${new Date().toISOString()}\n`);
  console.log('Created bot/STOP. The running bot will sell what it holds and stop for today within 15 seconds.\nDelete bot/STOP (or just restart tomorrow, it is cleared each morning) to let it trade again.');
}

async function run() {
  const c = await config();
  const api = client(c);
  await api.loadTokens();
  const notify = notifier(c);
  const live = c.mode === 'live';
  const { hash, number } = await accountHash(api, c);
  const stateFile = F.state(c.mode);
  const state = await readJson(stateFile, {});
  const save = (s) => writeFile(stateFile, JSON.stringify(s)).catch(() => {});
  const runner = createRunner({
    api, accountHash: hash, rules: await rules(), mode: c.mode, state, save,
    getSiteData: async () => {
      const r = await fetch(`${c.siteUrl}/data/daytrade.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    notify, log: logger,
  });
  await logger(`AutoPilot started in ${live ? 'LIVE mode (real orders)' : 'DRY-RUN mode (no real orders)'} on account ${mask(number)}. Press Ctrl+C to stop (it sells what it holds first).`);
  notify(`AutoPilot started (${live ? 'LIVE' : 'dry run'}).`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    await logger('Stopping: closing anything the bot holds…');
    await runner.stopAll('You stopped the bot.').catch((e) => logger(`⚠ ${e.message}`));
    await notify('AutoPilot stopped.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let lastDay = null, loginWarned = null, ntfySince = Math.floor(Date.now() / 1000);
  for (;;) {
    const clock = nyClock();
    if (clock.day !== lastDay) {
      lastDay = clock.day;
      await rm(F.stop, { force: true }); // a new day clears yesterday's stop request
      const left = api.daysLeft();
      if (left > 0 && left < 1.5) { await logger(`⚠ Schwab login expires in ${(left * 24).toFixed(0)} hours. Run: node bot/schwab-bot.js login`); notify(`Log in to Schwab again soon (expires in ${(left * 24).toFixed(0)}h): node bot/schwab-bot.js login`); }
    }
    // Kill switches: the STOP file, or any message to your "<topic>-stop" ntfy topic.
    let stopReason = (await exists(F.stop)) ? 'Stopped by the STOP file.' : null;
    if (!stopReason && c.ntfyTopic && clock.open) {
      try {
        const r = await fetch(`https://ntfy.sh/${encodeURIComponent(`${c.ntfyTopic}-stop`)}/json?poll=1&since=${ntfySince}`);
        if (r.ok && (await r.text()).includes('"event":"message"')) stopReason = 'Stopped from your phone (ntfy).';
        ntfySince = Math.floor(Date.now() / 1000);
      } catch { /* offline */ }
    }
    if (stopReason && runner.state.today && !runner.state.today.stopped && !runner.state.today.done) {
      await logger(stopReason);
      await runner.stopAll(stopReason);
      notify(`${stopReason} Anything the bot held was sold. It starts fresh tomorrow.`);
    }
    try {
      await runner.tick();
    } catch (err) {
      if (err instanceof LoginNeeded) {
        if (loginWarned !== clock.day) { loginWarned = clock.day; await logger(`⚠ ${err.message}`); notify(`⚠ ${err.message}`); }
        await sleep(5 * 60e3);
        await api.loadTokens(); // pick up a login done in another window
        continue;
      }
      await logger(`⚠ ${err.message}`);
    }
    await sleep(clock.open ? 15e3 : 60e3);
  }
}

const [cmd = 'help', ...args] = process.argv.slice(2);
const commands = { setup, login, check: () => check(args), run, golive: () => setMode('live'), dryrun: () => setMode('dry-run'), status, stop: stopNow };
if (!commands[cmd]) {
  console.log((await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
} else {
  try { await commands[cmd](); } catch (err) { console.error(`\n✗ ${err.message}`); process.exit(1); }
}
