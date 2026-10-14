# StockWise

A stock-tracking and trading-education site:

- **My Portfolio**: import a positions CSV from your broker (Fidelity, Schwab, Vanguard, E*TRADE, …) or type holdings in. You get a step-by-step action plan: what to sell, trim, rebalance or buy more of, with share counts and a "sell if below" price for each holding. Your holdings never leave your browser.
- **Watchlist**: track stocks with live prices plus a short-term and long-term rating for each.
- **Stock analyzer**: candlestick chart (20/50/200-day averages, RSI, volume) and 0–100 scores where every point is explained. You also get a buy zone, stop-loss, three profit targets, how many shares to buy for *your* account, and a step-by-step plan for when to sell.
- **Top Ideas**: separate **Short-term buys** and **Long-term buys** lists across 133 large US stocks in all 11 sectors.
  - *Short-term* finds the chart setup (breakout, pullback, oversold bounce, momentum), checks strength vs. the S&P 500, and penalizes upcoming earnings. Each pick has a hold time, stop and targets.
  - *Long-term* is half price trend, half business fundamentals: quality, growth, value and analyst targets, graded A–F from Yahoo Finance company data.
  - The rest of Top Ideas: A *Sector strength* panel ranks the sectors by their sector ETF (XLK, XLF, XLV, …). Sector filters, top picks, and a sortable table of every stock (price, day, 1-month, 1-year, score).
- **Money Planner**: enter how much money you have, your risk style and goal. You get a split into cash, index funds, long-term picks and swing trades, with exact share counts.
- **Sizer & Trade Tracker**: the 1%-risk calculator with a scale-out selling plan. Click *Track this trade* and it replays every daily candle since your buy date. It marks when targets or the stop were hit, trails the stop as you profit, and tells you each day to **Hold**, **Watch**, or **Sell N shares**, with a chart and a day-by-day log.
- **Academy**: 18 lessons in 6 modules (basics, long-term investing, charts, indicators, risk management, building a plan), each with a quiz and progress tracking.

> Educational tool, not financial advice. Signals use price history plus company fundamentals (no news).

## Put it on GitHub Pages (free hosting)

1. In this repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Open the **Actions** tab, pick **Deploy site**, and click **Run workflow** (or push any commit).
3. After a minute or two the site is live at `https://<your-username>.github.io/<repo-name>/`.

GitHub Pages can only host files and can't run `server.js`. So the workflow in `.github/workflows/deploy.yml` downloads fresh daily prices and publishes them with the site. It runs on every push and automatically about 5 times each trading day.

**Tracking more stocks:** the site includes 133 big stocks plus 17 ETFs (broad market and the 11 sector funds). To add others (for example, ones you own), list them in [`symbols.txt`](symbols.txt), one per line, and commit. They show up after the next run.

> Pages on a **private** repo needs a paid GitHub plan. On a free account, make the repo public. Your portfolio is still private, because it's stored only in your browser and never in the repo.

## Run it on your computer

Requires Node.js 18+. No `npm install` is needed because there are no dependencies.

```bash
npm start            # http://localhost:3000, live prices from Yahoo Finance
npm run demo         # simulated prices, works offline
npm test
```

If Yahoo Finance can't be reached, the server falls back to simulated data and the UI shows a "Demo data" warning.

## How it works

| File | Purpose |
| --- | --- |
| `server.js` | Local server: static files + `/api/history`, `/api/batch`, `/api/search` (10-min cache) |
| `lib/market-data.js` | Price downloads: Yahoo Finance → Stooq → demo fallback |
| `scripts/build-static.js` | Builds the GitHub Pages version into `dist/` with prices baked in |
| `.github/workflows/deploy.yml` | Tests, builds and deploys to Pages on push and on a schedule |
| `public/js/lib/portfolio.js` | Broker CSV import and the portfolio action rules |
| `lib/fundamentals.js` | Company fundamentals (P/E, growth, margins, debt, analyst targets, earnings date) from Yahoo |
| `public/js/lib/scan.js` | Compact per-stock summaries for Top Ideas / Planner (`/api/scan` or `data/scan.json`) |
| `public/js/lib/tracker.js` | Candle-by-candle trade replay (targets, closing stop, trailing stop) |
| `public/js/lib/indicators.js` | SMA, EMA, RSI, MACD, ATR, Bollinger, pivots |
| `public/js/lib/analysis.js` | Scoring rules, support/resistance, trade and long-term plans |
| `public/js/lib/sizing.js` | Position sizing, sell plans, portfolio allocation |
| `public/js/lib/lessons.js` | Academy curriculum |
| `public/js/views/*` | One file per page |

Your account size, risk style, watchlist, portfolio and lesson progress are saved in your browser (localStorage).
