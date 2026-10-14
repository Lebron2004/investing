# StockWise

A stock-tracking and trading-education site:

- **Watchlist**: track stocks with live prices plus a short-term and long-term rating for each.
- **Stock analyzer**: candlestick chart (20/50/200-day averages, RSI, volume) and 0–100 scores where every point is explained. You also get a buy zone, stop-loss, three profit targets, how many shares to buy for *your* account, and a step-by-step plan for when to sell.
- **Top Ideas**: scans ~32 large US stocks and ranks the best short-term and long-term setups, plus the weakest ones to avoid.
- **Money Planner**: enter how much money you have, your risk style and goal. You get a split into cash, index funds, long-term picks and swing trades, with exact share counts.
- **Position Sizer**: the 1%-risk calculator with a scale-out selling plan.
- **Academy**: 18 lessons in 6 modules (basics, long-term investing, charts, indicators, risk management, building a plan), each with a quiz and progress tracking.

> Educational tool, not financial advice. Signals use price and volume only.

## Run it

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
| `server.js` | Static file server + `/api/history`, `/api/batch`, `/api/search` (10-min cache) |
| `public/js/lib/indicators.js` | SMA, EMA, RSI, MACD, ATR, Bollinger, pivots |
| `public/js/lib/analysis.js` | Scoring rules, support/resistance, trade and long-term plans |
| `public/js/lib/sizing.js` | Position sizing, sell plans, portfolio allocation |
| `public/js/lib/lessons.js` | Academy curriculum |
| `public/js/views/*` | One file per page |

Your account size, risk style, watchlist and lesson progress are saved in your browser (localStorage).
