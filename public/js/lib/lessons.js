// StockWise Academy curriculum. Each lesson has HTML content and a short quiz.

export const MODULES = [
  {
    id: 'foundations',
    title: '1. Foundations',
    blurb: 'What you are actually buying and how orders work.',
    lessons: [
      {
        id: 'what-is-a-stock',
        title: 'What is a stock?',
        minutes: 4,
        body: `
<p>A <strong>stock</strong> (or share) is a small piece of ownership in a company. If a company has 1 billion shares and you own 100, you own one ten-millionth of it, along with a claim on its future profits.</p>
<p>Stock prices move because buyers and sellers constantly re-price that claim. Over the <em>long run</em>, prices follow a company's earnings. In the <em>short run</em>, they follow news, emotion, and supply and demand.</p>
<h4>Ways you make money</h4>
<ul><li><strong>Price appreciation</strong>: you sell for more than you paid.</li><li><strong>Dividends</strong>: some companies pay out part of their profits in cash, often every quarter.</li></ul>
<h4>ETFs</h4>
<p>An <strong>ETF</strong> (exchange-traded fund) is a basket of many stocks that trades like a single stock. <code>VOO</code> holds the 500 biggest US companies. Buying one share gives you a slice of all of them.</p>
<div class="callout">Key idea: a single stock can go to zero. A broad index fund has never done that, because it holds hundreds of companies.</div>`,
        quiz: [
          { q: 'Owning a share of a company means…', options: ['You lent the company money', 'You own a small piece of the company', 'The company owes you a fixed interest rate'], answer: 1, explain: 'Shares are ownership (equity). Lending money to a company is a bond.' },
          { q: 'What is VOO?', options: ['A single tech stock', 'An ETF that holds the S&P 500', 'A savings account'], answer: 1, explain: 'VOO is an ETF tracking the 500 largest US companies.' },
        ],
      },
      {
        id: 'order-types',
        title: 'Order types: market, limit, stop',
        minutes: 5,
        body: `
<p>How you place an order matters as much as what you buy.</p>
<ul>
<li><strong>Market order</strong>: buy or sell <em>right now</em> at the best available price. Fast, but you don't control the price exactly.</li>
<li><strong>Limit order</strong>: buy only at your price <em>or lower</em> (or sell at your price <em>or higher</em>). Use it to buy inside a "buy zone".</li>
<li><strong>Stop (stop-loss) order</strong>: becomes a market sell once the price falls to your stop. This is your safety net.</li>
<li><strong>Stop-limit</strong>: like a stop, but it turns into a limit order. Safer on price, but it may never fill in a fast crash.</li>
<li><strong>Trailing stop</strong>: a stop that rises automatically as the price rises, e.g. 20% below the highest price since you bought.</li>
</ul>
<div class="callout">Habit: every time you place a buy for a trade, place the stop-loss order right after it. Don't rely on remembering.</div>
<p><strong>Bid/ask spread:</strong> the bid is the highest price buyers offer, the ask is the lowest price sellers accept. Large stocks have tiny spreads. Tiny stocks can have big ones that quietly cost you money.</p>`,
        quiz: [
          { q: 'You want to buy AAPL only if it drops to $180. Which order?', options: ['Market order', 'Limit buy at $180', 'Stop-loss at $180'], answer: 1, explain: 'A limit buy fills at $180 or better.' },
          { q: 'What does a stop-loss do?', options: ['Locks in a profit target', 'Sells automatically if price falls to a level you choose', 'Prevents the stock from falling'], answer: 1, explain: 'It caps your loss by selling at (about) your stop price.' },
        ],
      },
      {
        id: 'investing-vs-trading',
        title: 'Investing vs. trading',
        minutes: 4,
        body: `
<table class="table compact"><thead><tr><th></th><th>Long-term investing</th><th>Short-term trading</th></tr></thead><tbody>
<tr><td>Holding time</td><td>Years</td><td>Days to weeks (swing trading)</td></tr>
<tr><td>Driven by</td><td>Business growth, compounding</td><td>Momentum, price patterns</td></tr>
<tr><td>Time needed</td><td>Minutes a month</td><td>Daily attention</td></tr>
<tr><td>Main tools</td><td>Index funds, 200-day trend</td><td>Stops, targets, RSI and MACD</td></tr>
<tr><td>Success rate</td><td>High for diversified investors</td><td>Most day traders lose money</td></tr>
</tbody></table>
<p>You don't have to pick one. Many people keep a <strong>core</strong> of index funds for the long term and a small <strong>satellite</strong> (5–20%) for trading. The Money Planner builds exactly this structure.</p>
<div class="callout">Never let a losing short-term trade turn into a "long-term investment". That's how small losses become big ones.</div>`,
        quiz: [
          { q: 'A losing swing trade hit its stop. You should…', options: ['Hold it, it\'s long-term now', 'Sell as planned', 'Buy more to average down'], answer: 1, explain: 'Respect the stop. Changing your timeframe after a loss is a classic mistake.' },
        ],
      },
    ],
  },
  {
    id: 'long-term',
    title: '2. Long-term investing',
    blurb: 'The slow, reliable way to build wealth.',
    lessons: [
      {
        id: 'compounding',
        title: 'Compounding & dollar-cost averaging',
        minutes: 5,
        body: `
<p><strong>Compounding</strong> means your gains earn gains. At 8% a year, $10,000 becomes about $21,600 in 10 years, $46,600 in 20, and $100,600 in 30. Most of the growth comes at the end, so <em>time in the market</em> is your biggest edge.</p>
<p><strong>Dollar-cost averaging (DCA)</strong> means investing a fixed amount on a schedule, say $300 every month, no matter what the market does. When prices are low your $300 buys more shares. When they're high it buys fewer.</p>
<ul><li>It removes the stress of trying to time the market.</li><li>It turns investing into a habit.</li><li>It's how most 401(k)s work automatically.</li></ul>
<div class="callout">Rule of 72: divide 72 by your yearly return to estimate how many years it takes to double. 72 ÷ 8% ≈ 9 years.</div>`,
        quiz: [
          { q: 'Using the Rule of 72, money growing 12% a year doubles in about…', options: ['3 years', '6 years', '12 years'], answer: 1, explain: '72 ÷ 12 = 6.' },
          { q: 'Dollar-cost averaging means…', options: ['Investing a fixed amount regularly', 'Only buying when the market crashes', 'Buying stocks under $1'], answer: 0, explain: 'A fixed amount on a schedule, regardless of price.' },
        ],
      },
      {
        id: 'diversification',
        title: 'Diversification & index funds',
        minutes: 4,
        body: `
<p>Don't put all your eggs in one basket. If one company fails, a diversified portfolio barely notices.</p>
<ul>
<li><strong>Across companies</strong>: no single stock should be more than about 10–25% of your money.</li>
<li><strong>Across sectors</strong>: tech, healthcare, financials, energy and consumer stocks behave differently.</li>
<li><strong>Across assets</strong>: bonds (e.g. <code>BND</code>) usually fall less than stocks in crashes.</li>
<li><strong>Across countries</strong>: international funds (e.g. <code>VXUS</code>).</li>
</ul>
<p>Low-cost index funds like VOO, VTI and QQQ give instant diversification for fees around 0.03–0.20% a year. Over decades, most professional fund managers fail to beat the S&P 500 after fees.</p>`,
        quiz: [
          { q: 'Which portfolio is most diversified?', options: ['100% in one tech stock', '5 tech stocks', 'An S&P 500 fund + a bond fund + an international fund'], answer: 2, explain: 'It spreads money across hundreds of companies, asset types and countries.' },
        ],
      },
      {
        id: 'when-to-sell-long',
        title: 'When to sell a long-term holding',
        minutes: 4,
        body: `
<p>Selling is harder than buying. For long-term holdings, decide your exit rules <em>before</em> you buy:</p>
<ol>
<li><strong>The story changed.</strong> The reason you bought (growth, a product, management) is no longer true.</li>
<li><strong>The trend broke.</strong> Price closes well below the 200-day moving average and the 200-day turns down. StockWise flags this as the "thesis broken" level.</li>
<li><strong>Trailing stop.</strong> Sell if it falls 20–25% from its highest close since you bought.</li>
<li><strong>It got too big.</strong> If one stock grows to 30% of your portfolio, trim it back. That's rebalancing, not giving up.</li>
<li><strong>You need the money</strong> within 1–3 years. Money you need soon shouldn't be in stocks.</li>
</ol>
<div class="callout">Don't sell just because the price dropped a little or the news is scary. Every great long-term stock has had multiple 20–30% drops.</div>`,
        quiz: [
          { q: 'One stock is now 35% of your portfolio after a big run. A sensible move is…', options: ['Sell it all', 'Trim it back toward your target weight', 'Buy more because it\'s winning'], answer: 1, explain: 'Rebalancing keeps one stock from dominating your risk while you keep some upside.' },
        ],
      },
    ],
  },
  {
    id: 'charts',
    title: '3. Reading charts',
    blurb: 'Candles, trends, support and resistance.',
    lessons: [
      {
        id: 'candlesticks',
        title: 'Candlesticks',
        minutes: 4,
        body: `
<p>Each candle shows one day: <strong>open, high, low and close</strong>.</p>
<ul><li><span class="up">Green</span> candle: closed higher than it opened (buyers won the day).</li><li><span class="down">Red</span> candle: closed lower than it opened (sellers won).</li><li>The thick <strong>body</strong> spans open to close. The thin <strong>wicks</strong> reach the day's high and low.</li></ul>
<p>Long lower wicks mean buyers stepped in after a drop. Long upper wicks mean sellers rejected higher prices.</p>
<p>Bars under the candles show <strong>volume</strong>, how many shares traded. Big moves on big volume are more meaningful than big moves on quiet days.</p>`,
        quiz: [
          { q: 'A candle opens at $50 and closes at $47. It is…', options: ['Green', 'Red'], answer: 1, explain: 'Close below open = red (down) candle.' },
        ],
      },
      {
        id: 'trends-moving-averages',
        title: 'Trends & moving averages',
        minutes: 5,
        body: `
<p>A <strong>moving average (MA)</strong> is the average closing price over the last N days. It smooths out noise so you can see the trend.</p>
<ul>
<li><strong>20-day</strong>: short-term trend (weeks).</li>
<li><strong>50-day</strong>: medium-term trend (months).</li>
<li><strong>200-day</strong>: long-term trend. Big funds watch it closely.</li>
</ul>
<p>Simple rules of thumb:</p>
<ul>
<li>Price above a rising 200-day = long-term uptrend. Price below a falling 200-day = downtrend.</li>
<li><strong>Golden cross</strong>: the 50-day crosses above the 200-day (bullish). <strong>Death cross</strong>: crosses below (bearish).</li>
<li>Uptrends make <em>higher highs and higher lows</em>. Downtrends make lower highs and lower lows.</li>
</ul>
<div class="callout">"The trend is your friend." Buying stocks in uptrends works far more often than catching falling knives.</div>`,
        quiz: [
          { q: 'Price is above a rising 200-day average. The long-term trend is…', options: ['Up', 'Down', 'Unknown'], answer: 0, explain: 'Above a rising 200-day MA is the textbook long-term uptrend.' },
          { q: 'A "golden cross" is when…', options: ['Price hits an all-time high', 'The 50-day MA crosses above the 200-day MA', 'RSI goes above 70'], answer: 1, explain: 'It signals medium-term momentum turning up versus the long-term trend.' },
        ],
      },
      {
        id: 'support-resistance',
        title: 'Support & resistance: where to buy and sell',
        minutes: 6,
        body: `
<p><strong>Support</strong> is a price where buyers have repeatedly stepped in and stopped a fall. <strong>Resistance</strong> is a price where sellers repeatedly stopped a rise.</p>
<p>They show up because traders remember prices: "I wish I'd bought at $100" turns into buy orders at $100.</p>
<h4>How traders use them</h4>
<ul>
<li><strong>Buy</strong> near support in an uptrend. You're buying where demand has shown up before.</li>
<li><strong>Stop-loss</strong> a little <em>below</em> support. If support breaks, the reason for the trade is gone.</li>
<li><strong>Take profits</strong> near resistance, where sellers tend to appear.</li>
<li>When resistance breaks it often becomes new support ("role reversal").</li>
</ul>
<p>StockWise finds these levels automatically from recent swing highs and lows, then builds the buy zone, stop and targets around them.</p>`,
        quiz: [
          { q: 'Where should a stop-loss usually go for a buy near support?', options: ['Just above support', 'Just below support', 'At resistance'], answer: 1, explain: 'Below support. If support fails, the trade idea is invalid.' },
          { q: 'Where do traders often take profits?', options: ['Near resistance', 'Near support', 'At the 20-day MA'], answer: 0, explain: 'Resistance is where selling pressure has shown up before.' },
        ],
      },
    ],
  },
  {
    id: 'indicators',
    title: '4. Indicators',
    blurb: 'RSI, MACD, volume and volatility.',
    lessons: [
      {
        id: 'rsi',
        title: 'RSI: overbought and oversold',
        minutes: 4,
        body: `
<p>The <strong>Relative Strength Index</strong> measures how strong recent gains are compared with recent losses, on a 0–100 scale (usually over 14 days).</p>
<ul><li><strong>Above 70</strong>: overbought. The stock has run hard and a pullback is more likely.</li><li><strong>Below 30</strong>: oversold. It has fallen hard and a bounce is more likely.</li><li><strong>50–70</strong>: healthy bullish momentum.</li></ul>
<div class="callout">Warning: in strong trends RSI can stay overbought (or oversold) for weeks. Use it for timing inside a trend, not as a buy or sell signal by itself.</div>`,
        quiz: [
          { q: 'RSI is 78. This suggests…', options: ['Oversold, likely to bounce', 'Overbought, pullback risk is higher', 'No information'], answer: 1, explain: 'Above 70 is overbought.' },
        ],
      },
      {
        id: 'macd',
        title: 'MACD: momentum',
        minutes: 4,
        body: `
<p><strong>MACD</strong> is the difference between a fast (12-day) and slow (26-day) exponential moving average. A 9-day "signal line" smooths it, and the <strong>histogram</strong> is MACD minus the signal line.</p>
<ul><li>Histogram above zero and growing: bullish momentum is accelerating.</li><li>Histogram above zero but shrinking: momentum is fading.</li><li>Crossing from negative to positive: a common short-term buy trigger.</li></ul>
<p>MACD lags because it is built from averages. It confirms moves rather than predicting them.</p>`,
        quiz: [
          { q: 'The MACD histogram is positive and getting bigger. Momentum is…', options: ['Strengthening to the upside', 'Weakening', 'Bearish'], answer: 0, explain: 'Positive and rising = accelerating bullish momentum.' },
        ],
      },
      {
        id: 'volume-atr',
        title: 'Volume & volatility (ATR)',
        minutes: 5,
        body: `
<p><strong>Volume</strong> confirms price. A breakout on 2× normal volume shows real buying. A breakout on thin volume often fails.</p>
<p><strong>ATR (Average True Range)</strong> is the average daily price range. If a $100 stock has an ATR of $3, a normal day moves it about 3%.</p>
<p>Why ATR matters:</p>
<ul><li><strong>Stop placement</strong>: a stop closer than about 1 ATR will be hit by normal noise. StockWise keeps stops 1–3 ATRs away.</li><li><strong>Position size</strong>: volatile stocks need wider stops, so you buy fewer shares for the same risk.</li></ul>`,
        quiz: [
          { q: 'Stock A has a $2 ATR, stock B a $8 ATR, same price. For the same dollar risk you should buy…', options: ['More of B', 'More of A', 'The same of each'], answer: 1, explain: 'B needs a wider stop, so you buy fewer shares of B (and more of A).' },
        ],
      },
    ],
  },
  {
    id: 'fundamentals',
    title: '5. Picking buys: setups & fundamentals',
    blurb: 'What makes a good short-term trade vs. a good long-term investment.',
    lessons: [
      {
        id: 'setups',
        title: 'The 4 short-term setups',
        minutes: 6,
        body: `
<p>A <strong>setup</strong> is a repeatable chart situation where the odds lean your way and you know exactly where you're wrong. StockWise looks for four:</p>
<table class="table compact"><thead><tr><th>Setup</th><th>What it looks like</th><th>Where you're wrong</th><th>Typical hold</th></tr></thead><tbody>
<tr><td><strong>Breakout</strong></td><td>Closes above its recent (20-day) high on 1.3×+ normal volume, above the 50-day average.</td><td>Falls back below the breakout level.</td><td>1–4 weeks</td></tr>
<tr><td><strong>Pullback</strong></td><td>An uptrend (50-day above 200-day) dips to its 20-day average while RSI cools to 40–55.</td><td>Breaks below recent support.</td><td>1–4 weeks</td></tr>
<tr><td><strong>Oversold bounce</strong></td><td>RSI under ~38 and turning up, while price holds near its 200-day average.</td><td>New low.</td><td>3 days – 2 weeks</td></tr>
<tr><td><strong>Momentum</strong></td><td>Steadily above rising 20- and 50-day averages, RSI 55–72, beating the S&amp;P 500.</td><td>Closes below the 20-day average.</td><td>2–8 weeks</td></tr>
</tbody></table>
<h4>Relative strength</h4>
<p>A stock up 5% while the S&amp;P 500 is up 10% is actually <em>weak</em>. StockWise compares every stock's 3-month return with the S&amp;P 500's. The leaders tend to keep leading.</p>
<div class="callout">Pullbacks are the most beginner-friendly: you buy a strong stock on a dip, close to a clear stop. Breakouts work best in a strong overall market. Bounces are quick trades, so take profits faster.</div>`,
        quiz: [
          { q: 'A stock closes above its 20-day high on 3× normal volume. This is a…', options: ['Pullback', 'Breakout', 'Oversold bounce'], answer: 1, explain: 'New high + heavy volume = breakout.' },
          { q: 'Stock A is up 4% in 3 months; the S&P 500 is up 9%. Stock A\'s relative strength is…', options: ['Strong', 'Weak', 'Neutral'], answer: 1, explain: 'It lagged the market by 5%, which is relative weakness.' },
        ],
      },
      {
        id: 'reading-fundamentals',
        title: 'Reading a company\'s numbers',
        minutes: 7,
        body: `
<p>For long-term buys you're buying a <em>business</em>. Four questions, the same four StockWise grades:</p>
<h4>1. Quality: is it a good business?</h4>
<ul><li><strong>Profit margin</strong>: profit per $1 of sales. Over 20% is excellent; negative means it's losing money.</li>
<li><strong>Return on equity (ROE)</strong>: profit generated on shareholders' money. Over 15–20% is strong.</li>
<li><strong>Debt/equity</strong>: under 1× is comfortable; over 2× can hurt when rates rise or sales fall.</li>
<li><strong>Free cash flow</strong>: real cash left after running the business. Positive is what you want.</li></ul>
<h4>2. Growth: is it getting bigger?</h4>
<p><strong>Revenue</strong> (sales) and <strong>earnings</strong> growth vs. a year ago. Sales growth above 10% a year is healthy; shrinking sales is a red flag.</p>
<h4>3. Value: is the price reasonable?</h4>
<ul><li><strong>P/E</strong> = price ÷ earnings per share. A P/E of 20 means you pay $20 for every $1 of yearly profit. The S&amp;P 500 has averaged roughly 15–20.</li>
<li><strong>PEG</strong> = P/E ÷ growth rate. It adjusts for growth: a P/E of 40 growing 40% a year (PEG 1) can be cheaper than a P/E of 15 growing 3% (PEG 5).</li></ul>
<h4>4. Analysts: what do the pros expect?</h4>
<p>Wall Street analysts publish 12-month <strong>price targets</strong> and Buy/Hold/Sell ratings. Useful as a sanity check, but they're often wrong and tend to be too optimistic.</p>
<div class="callout">Great company ≠ great stock at any price. The best long-term buys combine good fundamentals <em>and</em> a healthy price trend, which is why StockWise's long-term score is half each.</div>`,
        quiz: [
          { q: 'Company A: P/E 40, earnings growing 40%/yr. Company B: P/E 15, growing 3%/yr. Which has the better PEG?', options: ['A (PEG 1.0)', 'B (PEG 5.0)', 'They\'re equal'], answer: 0, explain: '40 ÷ 40 = 1.0 vs 15 ÷ 3 = 5.0. A is cheaper for its growth.' },
          { q: 'A profit margin of −8% means…', options: ['The company is losing money', 'The stock fell 8%', 'It pays an 8% dividend'], answer: 0, explain: 'Negative margin = it spends more than it earns.' },
        ],
      },
      {
        id: 'earnings-season',
        title: 'Earnings season & gap risk',
        minutes: 4,
        body: `
<p>Four times a year every company reports its results. The stock can <strong>gap</strong>: open 5–20% higher or lower the next morning, jumping straight past your stop-loss.</p>
<ul>
<li><strong>Short-term traders:</strong> StockWise lowers the short-term score when earnings are within 7 days and shows a warning. Common choices: wait until after the report, use half your normal size, or take profits before it.</li>
<li><strong>Long-term investors:</strong> earnings matter for the <em>trend</em> of results (is growth continuing?), not for one quarter's surprise. Don't panic-sell a great business over one miss.</li>
</ul>
<div class="callout">Your stop-loss protects you from slow declines, not from overnight gaps. That's another reason to keep position sizes small.</div>`,
        quiz: [
          { q: 'Earnings are in 2 days and you\'re opening a swing trade. The careful move is…', options: ['Use full size, since the stop protects you', 'Wait for the report or use a smaller position', 'Remove your stop'], answer: 1, explain: 'A gap can skip right past your stop, so reduce exposure to the event.' },
        ],
      },
    ],
  },
  {
    id: 'risk',
    title: '6. Risk management',
    blurb: 'The skill that keeps you in the game. Most important module.',
    lessons: [
      {
        id: 'position-sizing',
        title: 'Position sizing: how much to buy',
        minutes: 6,
        body: `
<p>Professional traders think about <em>how much they can lose</em> before how much they can make.</p>
<h4>The 1% rule</h4>
<p>Risk no more than <strong>1% of your account</strong> on any single trade (0.5% if conservative, up to 2% if aggressive). "Risk" means what you lose if your stop is hit, <em>not</em> the amount you invest.</p>
<div class="formula">Shares = (Account × Risk %) ÷ (Entry − Stop)</div>
<p><strong>Example:</strong> $5,000 account, 1% risk = $50. Buy at $40, stop at $37.50, so you risk $2.50 per share. $50 ÷ $2.50 = <strong>20 shares</strong> ($800 position).</p>
<p>Also cap any single stock at around 10–25% of your account, even if the formula allows more.</p>
<h4>Why it works</h4>
<p>At 1% risk, ten losses in a row leave you with about 90% of your account. At 10% risk, ten losses leave you with about 35%, and you'd need +186% just to get back to even.</p>`,
        quiz: [
          { q: '$10,000 account, 1% risk, entry $50, stop $45. How many shares?', options: ['20', '200', '10'], answer: 0, explain: '$100 risk ÷ $5 per share = 20 shares.' },
          { q: 'In the 1% rule, "1%" refers to…', options: ['The amount you invest', 'The amount you lose if the stop is hit', 'The expected gain'], answer: 1, explain: 'It\'s the loss if stopped out, not the position size.' },
        ],
      },
      {
        id: 'reward-risk',
        title: 'Stop-losses, targets & reward : risk',
        minutes: 5,
        body: `
<p><strong>Reward : risk</strong> compares potential profit with potential loss. Buying at $100 with a stop at $95 (risk $5) and a target of $110 (reward $10) is <strong>2 : 1</strong>.</p>
<p>With 2 : 1 trades you can be <em>wrong more than half the time</em> and still make money:</p>
<table class="table compact"><thead><tr><th>Win rate</th><th>1 : 1</th><th>2 : 1</th><th>3 : 1</th></tr></thead><tbody>
<tr><td>30%</td><td class="down">−40R</td><td class="down">−10R</td><td class="up">+20R</td></tr>
<tr><td>40%</td><td class="down">−20R</td><td class="up">+20R</td><td class="up">+60R</td></tr>
<tr><td>50%</td><td>0</td><td class="up">+50R</td><td class="up">+100R</td></tr></tbody></table>
<p class="muted small">Result per 100 trades, where R is the amount risked per trade.</p>
<h4>Scaling out</h4>
<p>StockWise suggests selling a third at Target 1, then moving your stop to break-even (now the trade can't become a loss), a third at Target 2, and letting the rest run.</p>`,
        quiz: [
          { q: 'Entry $20, stop $19, target $23. Reward : risk is…', options: ['1 : 1', '2 : 1', '3 : 1'], answer: 2, explain: 'Reward $3, risk $1 = 3 : 1.' },
          { q: 'After Target 1 hits, where does the stop move?', options: ['Lower, to give it room', 'Up to break-even (entry)', 'Remove it'], answer: 1, explain: 'Moving to break-even locks in a no-loss trade.' },
        ],
      },
      {
        id: 'psychology',
        title: 'Psychology & common mistakes',
        minutes: 5,
        body: `
<p>Most losses come from behavior, not bad analysis.</p>
<ul>
<li><strong>FOMO</strong>: chasing a stock after it's already up 30%. Wait for your buy zone.</li>
<li><strong>Moving your stop lower</strong> "to give it room". The stop was your plan. Respect it.</li>
<li><strong>Averaging down on trades</strong>: adding to losers. Add to <em>winners</em>, not losers.</li>
<li><strong>Revenge trading</strong>: bigger trades to win back a loss. Take a break instead.</li>
<li><strong>Overtrading</strong>: fees, taxes and mistakes add up. Fewer, better trades win.</li>
<li><strong>Leverage and options</strong> before you're consistently profitable. They magnify mistakes.</li>
<li><strong>Tips and hype</strong> from social media. If it's "guaranteed", it isn't.</li>
</ul>
<div class="callout">Keep a trading journal: entry, stop, target, reason, result, and how you felt. Review it every month. It's the fastest way to improve.</div>`,
        quiz: [
          { q: 'Your trade is approaching its stop. Best action?', options: ['Move the stop lower', 'Let the stop do its job', 'Double the position'], answer: 1, explain: 'Stops only work if you respect them.' },
        ],
      },
    ],
  },
  {
    id: 'plan',
    title: '7. Putting it together',
    blurb: 'Your personal playbook and how to use StockWise.',
    lessons: [
      {
        id: 'trading-plan',
        title: 'Your pre-trade checklist',
        minutes: 4,
        body: `
<p>Run through this before <em>every</em> trade:</p>
<ol>
<li>Is the long-term trend up (price above a rising 200-day)?</li>
<li>Is short-term momentum confirming (above the 20-day, MACD positive, RSI 45–70)?</li>
<li>Is the price in or near the buy zone, not far above it?</li>
<li>Where is my stop, and why there (below support, 1–3 ATRs away)?</li>
<li>Is reward : risk at least 2 : 1?</li>
<li>Is my size calculated with the 1% rule?</li>
<li>Are earnings coming up soon? (Earnings can gap a stock right past your stop.)</li>
<li>Can I accept losing my max-loss amount calmly?</li>
</ol>
<p>If any answer is "no", pass. Another setup will come.</p>`,
        quiz: [
          { q: 'Reward : risk is 1.2 : 1 and price is far above the buy zone. You should…', options: ['Buy now', 'Pass or wait for a better entry', 'Buy double'], answer: 1, explain: 'It fails two checklist items. Waiting is a valid decision.' },
        ],
      },
      {
        id: 'taxes-accounts',
        title: 'Accounts, taxes & costs (US basics)',
        minutes: 4,
        body: `
<ul>
<li><strong>Brokerage account</strong>: flexible, but gains are taxed. Gains on stocks held <em>over one year</em> get lower long-term capital-gains rates. Gains held one year or less are taxed like income.</li>
<li><strong>Roth IRA</strong>: invest after-tax money, then growth is tax-free in retirement. Great for long-term buckets if you're eligible.</li>
<li><strong>401(k)</strong>: often comes with an employer match. That's free money, so capture it first.</li>
<li><strong>Wash-sale rule</strong>: if you sell at a loss and rebuy the same stock within 30 days, you can't claim the loss yet.</li>
<li><strong>Costs</strong>: most brokers charge $0 commissions now, but watch fund expense ratios and bid/ask spreads.</li>
</ul>
<p class="muted small">Tax rules change and depend on your situation. Check with a tax professional.</p>`,
        quiz: [
          { q: 'Holding a winning stock for over a year usually means…', options: ['Higher taxes', 'Lower long-term capital-gains tax rate', 'No taxes ever'], answer: 1, explain: 'In the US, long-term gains are generally taxed at lower rates.' },
        ],
      },
      {
        id: 'using-stockwise',
        title: 'How to use StockWise',
        minutes: 3,
        body: `
<ol>
<li><strong>Set your account</strong> size and risk style on the Watchlist page. Every plan on the site sizes itself from it.</li>
<li><strong>Money Planner</strong>: split your money into cash, index funds, long-term picks and trades, with exact share counts.</li>
<li><strong>Top Ideas</strong>: the strongest short-term and long-term setups from the scan.</li>
<li><strong>Stock page</strong>: chart, both scores <em>with the reasons behind every point</em>, buy zone, stop, targets, how many shares to buy, and when to sell each part.</li>
<li><strong>Position Sizer</strong>: run the numbers on any trade idea of your own.</li>
<li><strong>Trading Class</strong> (top of the Academy): walk through a full trade on a real past chart, step by step, with a coach.</li>
<li><strong>Practice</strong>: a fake-money account at real prices. Practice entries, stop-losses and selling plans, get a coach grade on every buy, and see if you can beat the S&amp;P 500 before risking real money.</li>
</ol>
<div class="callout">Short-term scores read the chart and the earnings calendar. Long-term scores add company fundamentals. Neither reads the news, and fundamentals come from public data that can lag. Treat a high score as "worth researching", not "guaranteed to go up".</div>`,
        quiz: [
          { q: 'A StockWise "Strong Buy" score means…', options: ['The stock will go up', 'Price trends and momentum look favorable, so research it further', 'An analyst recommends it'], answer: 1, explain: 'It is a rules-based technical score, not a guarantee or an analyst opinion.' },
        ],
      },
    ],
  },
];

export const ALL_LESSONS = MODULES.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m })));
