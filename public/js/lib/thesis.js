// Plain-English reasoning for an idea: why it's on the list, what could go wrong, how to play it,
// and what would prove it wrong. Built only from the numbers StockWise already has (the chart,
// the business data, sector strength, and big-investor / Congress / insider filings).

const pctS = (v, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`;
const usd = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const GRADE_WORDS = { quality: 'profitability and balance sheet', growth: 'sales and earnings growth', value: 'valuation', analysts: 'analyst outlook' };

/**
 * d: a scan item ({ symbol, name, sector, analysis }), key: 'shortTerm' | 'longTerm'.
 * ctx: { sectorRank: { rank, of, score }, smart: data/smartmoney.json, congress: data/congress.json }
 * Returns { headline, why: [], risks: [], plan: [], wrongIf }.
 */
export function thesis(d, key, ctx = {}) {
  const a = d.analysis, r = a[key];
  const why = [], risks = [], plan = [];
  const pos = r.reasons.filter((x) => x.points > 0).sort((p, q) => q.points - p.points);
  const neg = r.reasons.filter((x) => x.points < 0).sort((p, q) => p.points - q.points);

  // --- Why ---
  if (key === 'shortTerm' && r.setup) why.push(`<b>The setup:</b> ${escape(r.setup.label.toLowerCase())}. ${escape(capital(r.setup.text))}.`);
  if (a.rs3m != null && Math.abs(a.rs3m) >= 0.03) why.push(a.rs3m > 0
    ? `<b>It's a leader:</b> up ${pctS(a.rs3m)} more than the S&amp;P 500 over 3 months. Big funds tend to keep buying what's already working.`
    : `It has lagged the S&amp;P 500 by ${pctS(-a.rs3m)} over 3 months, so this is a bet on a turnaround.`);
  if (a.sma200 && a.price > a.sma200) why.push(`<b>Long-term trend is up:</b> the price is ${pctS(a.price / a.sma200 - 1)} above its 200-day average, the line many big investors watch.`);
  if (ctx.sectorRank?.rank != null && ctx.sectorRank.rank <= 3) why.push(`<b>Tailwind:</b> ${d.sector} is the #${ctx.sectorRank.rank} strongest of ${ctx.sectorRank.of} sectors right now. Money is flowing into this part of the market.`);
  if (key === 'longTerm' && r.grades) {
    const good = Object.entries(r.grades).filter(([, g]) => g === 'A' || g === 'B').map(([k]) => GRADE_WORDS[k]);
    if (good.length) why.push(`<b>Solid business:</b> grades well on ${list(good)}.`);
    if (r.upside != null && r.upside > 0.08) why.push(`Wall Street analysts' average price target is ${pctS(r.upside)} above today's price.`);
  }
  for (const s of smartMoney(d.symbol, ctx)) why.push(s);
  for (const x of pos.slice(0, 3)) {
    if (why.length >= 7) break;
    if (!why.some((w) => w.includes(x.text.slice(0, 25)))) why.push(escape(capital(x.text)).replace(/\.?$/, '.'));
  }

  // --- Risks ---
  if (a.daysToEarnings != null && a.daysToEarnings <= 14) risks.push(`<b>Earnings in ${a.daysToEarnings} day${a.daysToEarnings === 1 ? '' : 's'}.</b> The stock can jump or drop 5–15% overnight, right past a stop.`);
  const atrPct = a.atr / a.price;
  if (atrPct > 0.035) risks.push(`<b>It's volatile:</b> it moves about ${(atrPct * 100).toFixed(1)}% on a normal day, so size smaller.`);
  if (a.rsi != null && a.rsi > 72) risks.push(`<b>It's stretched:</b> RSI ${a.rsi.toFixed(0)} means it has run up fast. Chasing here often means buying right before a pullback.`);
  if (a.maxDrawdown != null && a.maxDrawdown > 0.35) risks.push(`In the past year it fell as much as ${(a.maxDrawdown * 100).toFixed(0)}% from a high. Expect big swings.`);
  if (ctx.sectorRank?.rank != null && ctx.sectorRank.rank > ctx.sectorRank.of - 3) risks.push(`${d.sector} is one of the weakest sectors right now. The stock is swimming against the current.`);
  if (key === 'longTerm' && r.grades) {
    const bad = Object.entries(r.grades).filter(([, g]) => g === 'D' || g === 'F').map(([k]) => GRADE_WORDS[k]);
    if (bad.length) risks.push(`Weak spot${bad.length > 1 ? 's' : ''} in the business: ${list(bad)}.`);
  }
  for (const x of neg.slice(0, 3)) if (risks.length < 5 && !/Earnings report in/.test(x.text)) risks.push(escape(capital(x.text)).replace(/\.?$/, '.'));
  if (!risks.length) risks.push('No big red flags in the numbers. But every stock can fall, and markets drop together in a selloff.');

  // --- How to play it / what would prove it wrong ---
  let wrongIf;
  if (key === 'shortTerm') {
    const p = a.plan;
    if (r.setup?.howTo) plan.push(escape(r.setup.howTo));
    plan.push(`Buy around ${usd(p.buyZone[0])}–${usd(p.entry)}. Set the stop at <b>${usd(p.stop)}</b> (${(p.riskPct * 100).toFixed(1)}% below), so a loss stays small.`);
    plan.push(`Sell a third at each target: ${p.targets.map(usd).join(', ')}. After the first target, move the stop to your buy price. Expected hold: ${r.hold}.`);
    plan.push(`Reward vs risk to the first target: ${p.rewardRisk.toFixed(1)} to 1${p.rewardRisk < 1.5 ? '. That\'s thin, so be picky about the entry.' : '.'}`);
    wrongIf = `It closes below ${usd(p.stop)}. That means the setup failed: sell, no second-guessing.`;
  } else {
    const t = a.ltPlan.tranches;
    plan.push(`Buy in 3 stages instead of all at once: about 40% now, 30% near ${usd(t[1].price)} (${t[1].label.toLowerCase()}), 30% near ${usd(t[2].price)} (${t[2].label.toLowerCase()}).`);
    plan.push('Think in years, not weeks. Check it each quarter when the company reports earnings.');
    wrongIf = `It falls below ${usd(a.ltPlan.exitBelow)} (well under its 200-day average), or the business grades slip to D/F. Then the long-term story is broken: sell and move on.`;
  }

  // --- Headline ---
  const label = r.label?.toLowerCase() || 'buy';
  const top = [r.setup && key === 'shortTerm' ? `a ${r.setup.label.toLowerCase()} setup` : null,
    a.rs3m > 0.03 ? 'it\'s beating the market' : null,
    key === 'longTerm' && r.fundScore >= 60 ? 'the business is strong' : null,
    ctx.sectorRank?.rank <= 3 ? `its sector is hot` : null].filter(Boolean);
  const headline = `${d.symbol} is a ${key === 'shortTerm' ? 'short-term' : 'long-term'} ${label}${top.length ? ` because ${list(top)}` : ' on its overall score'}.`;
  return { headline, why: why.slice(0, 8), risks: risks.slice(0, 5), plan, wrongIf };
}

// Big funds, insiders and Congress (from the site's SEC and House data).
function smartMoney(symbol, ctx) {
  const out = [];
  const s = ctx.smart?.bySymbol?.[symbol];
  if (s?.funds?.length) out.push(`<b>Famous investors own it:</b> ${list(s.funds.slice(0, 3).map((f) => `${escape(f.manager)} (${(f.pct * 100).toFixed(1)}% of their portfolio${f.change === 'new' ? ', new this quarter' : f.change === 'added' ? ', added more' : ''})`))}.`);
  if (s?.insiderValue90 > 0) out.push(`<b>Insiders are buying:</b> company executives or directors bought about $${Math.round(s.insiderValue90 / 1000).toLocaleString('en-US')}K of stock with their own money in the last 90 days.`);
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const buyers = [...new Set((ctx.congress?.trades || []).filter((t) => t.ticker === symbol && t.type === 'buy' && t.filed >= since).map((t) => t.member))];
  if (buyers.length) out.push(`<b>Congress bought it:</b> ${list(buyers.slice(0, 3).map(escape))}${buyers.length > 3 ? ` and ${buyers.length - 3} more` : ''} reported buying in the last 60 days.`);
  return out;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
