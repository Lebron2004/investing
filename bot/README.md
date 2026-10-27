# AutoPilot for Schwab: let the bot trade your Schwab account

This small program runs on **your computer** (or a cheap cloud server). It trades your Schwab
account by the rules you set on the AutoPilot page: today's budget, risk per trade, daily loss
limit, which stocks and sectors, and trading hours. Its trades show up in thinkorswim like any
other order.

It uses the same AutoPilot "brain" as the website (the one you can **Test** and **Train** there).

**What you'll still have to do:** log in to Schwab once a week. Schwab makes every app do this,
and the bot reminds you on your phone. Everything else is automatic.

---

## How it trades your money safely

- **One bracket order per trade.** Every buy goes to Schwab as a *1st Triggers OCO* order: a limit
  buy (never more than 0.5% above the breakout price), plus a **stop-loss** and a **profit target**
  that sit at Schwab. If your computer crashes or the internet drops, the stop is still there.
- It **never spends more than your budget** or the cash Schwab says is available to trade.
- It **never sells shares it didn't buy.** Anything else you own is left alone.
- If a buy doesn't fill within 90 seconds, it **cancels the buy** instead of chasing the price.
- It moves the stop to break-even when a trade is up, and it **sells everything by 3:55pm**
  (your setting). Nothing is held overnight.
- After the daily loss limit, or any error talking to Schwab, it **stops opening new trades**
  for the day.
- **Dry run first.** Out of the box it uses real Schwab prices but sends **no orders**. You switch
  to real orders yourself with `golive`.

---

## Step 1: Get Schwab API access (one time, takes a few days)

1. Go to **developer.schwab.com** and create an account. It's separate from your trading login.
   Use the same email.
2. Go to **Dashboard → Apps → Create App**.
   - **API products:** choose **Accounts and Trading Production** *and* **Market Data Production**.
   - **Callback URL:** type exactly `https://127.0.0.1`
   - **Order limit:** 120 per minute is fine.
3. Submit. The status goes from *Approved – Pending* to **Ready For Use**. That usually takes a
   few business days.
4. Open the app and copy its **App Key** and **Secret**. You'll paste them in Step 3.

> Schwab's website wording changes now and then. If a label looks different, pick the closest match.

## Step 2: Install Node.js and download StockWise

1. Install **Node.js LTS** from **nodejs.org** (the big green button). Use the default options.
2. On GitHub, open this repository → green **Code** button → **Download ZIP**. Unzip it, e.g. into
   `Documents\investing`.
3. Open a terminal in that folder:
   - **Windows:** open the folder in File Explorer, click the address bar, type `cmd` and press Enter.
   - **Mac:** right-click the folder → *New Terminal at Folder*.

## Step 3: Set it up

```
node bot/schwab-bot.js setup
```

Paste your App Key and Secret. It also asks two more things:

- **An ntfy topic (optional, recommended).** This sends notifications to your phone.
  1. Install the free **ntfy** app.
  2. Subscribe to a hard-to-guess topic name, e.g. `stockwise-jash-83kd2`.
  3. Type the same name here.
- **The last 4 digits of the account to trade.** Press Enter to use your first account.

Your keys are saved in `bot/config.json` on your computer only. That file is never uploaded to
GitHub.

## Step 4: Your rules

1. On the website's **AutoPilot** page, set your rules.
2. Press **Download rules for the Schwab bot**.
3. Save the file as `bot/rules.json` inside the folder from Step 2.

Change your rules any time the same way, then restart the bot.

## Step 5: Log in and test

```
node bot/schwab-bot.js login
```

1. Open the link it prints and log in with your normal Schwab username and password.
2. Approve access.
3. The browser lands on a page that **won't load** (`https://127.0.0.1/?code=...`). That's expected.
4. Copy the whole address from the address bar and paste it into the terminal.
5. Do this within about 30 seconds: the code expires.

Then check the connection:

```
node bot/schwab-bot.js check
node bot/schwab-bot.js check --test-order
```

`check` shows:

- your account type,
- the cash it can trade,
- a live SPY price,
- your rules.

`--test-order` places a real buy order for 1 share of Ford at **half price**, so it won't fill,
then cancels it. That proves orders work before any real trade.

## Step 6: Dry run (do this for a couple of weeks)

```
node bot/schwab-bot.js run
```

Leave the window open. It wakes up before 9:30am New York time, picks its watchlist, and does
everything except send orders. Instead it prints `[dry run] Would send: ...` and keeps paper results.

- `node bot/schwab-bot.js status` shows today's activity (run it in a second window).
- Daily logs are saved in `bot/logs/`.

## Step 7: Go live

When you're happy with the dry-run results:

```
node bot/schwab-bot.js golive      (type LIVE to confirm)
node bot/schwab-bot.js run
```

Go back with `node bot/schwab-bot.js dryrun`.

---

## Keeping it running "without touching anything"

- **Your computer must be on and awake from about 9:15am to 4:05pm New York time** on weekdays.
  - **Windows:** Settings → System → Power → *Sleep: Never* (when plugged in).
  - **Mac:** System Settings → Battery/Energy → prevent sleep when the display is off.
- **To start it automatically each morning on Windows:**
  1. Open Task Scheduler → *Create Basic Task* → Daily, 9:00am.
  2. Choose *Start a program*.
  3. Program: `node`. Arguments: `bot/schwab-bot.js run`. Start in: your StockWise folder.
- **Or rent a small always-on server** (any $5/month Linux VPS) and run it there with the same commands.

## Stopping it (kill switches)

Any of these cancels the bot's open orders, sells what *the bot* bought, and stops trading for the day:

- Press **Ctrl+C** in the bot window.
- Run `node bot/schwab-bot.js stop` (it creates a `bot/STOP` file; the bot starts fresh the next day).
- **From your phone:** in the ntfy app, publish any message to your topic name plus `-stop`
  (e.g. `stockwise-jash-83kd2-stop`).

You can also always close a position yourself in thinkorswim. The bot notices and moves on.

## The weekly login

Schwab's login lasts **7 days**. Your phone gets a reminder about a day before it runs out.

To renew, open a second terminal in the folder and run `node bot/schwab-bot.js login`. The running
bot picks up the new login by itself. If the login runs out, the bot pauses safely. Orders already
at Schwab, including your stops, stay in place.

## Honest limits

- **It hasn't traded a real Schwab account yet.** The order handling is tested against a simulated
  Schwab, not the real one, so do the dry run and `check --test-order` first, and watch the first
  live trades in thinkorswim.
- **Cash accounts:** money from a sale settles the next business day. The bot uses each dollar only
  once per day, so with $100 it makes about one trade a day.
- **Margin accounts under $25,000:** the bot counts day trades and stops at 3 in 5 business days.
- **Prices can jump straight through a stop.** For example, bad news can make a stock jump past your
  stop. When that happens, the loss can be bigger than planned. That's true for every trader.
- The AI ranks which stocks are likely to *move*, not which direction. Day trading is risky, and most
  day traders lose money. Only use money you can afford to lose.
