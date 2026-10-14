// The stocks and ETFs the "Top Ideas" scanner covers, grouped into the 11 standard market sectors.

export const SECTORS = [
  { name: 'Technology', etf: 'XLK', blurb: 'Software, chips, hardware and IT services.' },
  { name: 'Communication Services', etf: 'XLC', blurb: 'Search, social media, streaming, telecom and games.' },
  { name: 'Consumer Discretionary', etf: 'XLY', blurb: 'Things people want but don\'t need: retail, autos, travel, restaurants.' },
  { name: 'Consumer Staples', etf: 'XLP', blurb: 'Everyday needs: food, drinks, household goods. Usually steadier.' },
  { name: 'Financials', etf: 'XLF', blurb: 'Banks, payments, brokers and asset managers.' },
  { name: 'Health Care', etf: 'XLV', blurb: 'Drug makers, insurers, medical devices and biotech.' },
  { name: 'Industrials', etf: 'XLI', blurb: 'Aerospace, defense, machinery, railroads, airlines and logistics.' },
  { name: 'Energy', etf: 'XLE', blurb: 'Oil, gas and refining. Moves with commodity prices.' },
  { name: 'Utilities', etf: 'XLU', blurb: 'Electric and gas utilities. Defensive, often pay dividends.' },
  { name: 'Real Estate', etf: 'XLRE', blurb: 'REITs: warehouses, cell towers, data centers, shops. High dividends.' },
  { name: 'Materials', etf: 'XLB', blurb: 'Chemicals, mining, steel and paints. Cyclical.' },
];

const S = (sector, list) => list.map(([symbol, name]) => ({ symbol, name, sector }));

export const UNIVERSE = [
  ...S('Technology', [
    ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['AVGO', 'Broadcom'], ['AMD', 'Advanced Micro Devices'],
    ['ORCL', 'Oracle'], ['CRM', 'Salesforce'], ['ADBE', 'Adobe'], ['INTC', 'Intel'], ['CSCO', 'Cisco'],
    ['QCOM', 'Qualcomm'], ['TXN', 'Texas Instruments'], ['IBM', 'IBM'], ['NOW', 'ServiceNow'], ['INTU', 'Intuit'],
    ['AMAT', 'Applied Materials'], ['MU', 'Micron'], ['LRCX', 'Lam Research'], ['ANET', 'Arista Networks'], ['PANW', 'Palo Alto Networks'],
    ['CRWD', 'CrowdStrike'], ['SNOW', 'Snowflake'], ['PLTR', 'Palantir'], ['SHOP', 'Shopify'], ['DELL', 'Dell'],
  ]),
  ...S('Communication Services', [
    ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'], ['NFLX', 'Netflix'], ['DIS', 'Walt Disney'], ['TMUS', 'T-Mobile US'],
    ['VZ', 'Verizon'], ['T', 'AT&T'], ['CMCSA', 'Comcast'], ['SPOT', 'Spotify'], ['RBLX', 'Roblox'],
    ['CHTR', 'Charter Communications'], ['TTWO', 'Take-Two Interactive'],
  ]),
  ...S('Consumer Discretionary', [
    ['AMZN', 'Amazon'], ['TSLA', 'Tesla'], ['HD', 'Home Depot'], ['MCD', 'McDonald\'s'], ['NKE', 'Nike'],
    ['SBUX', 'Starbucks'], ['LOW', 'Lowe\'s'], ['BKNG', 'Booking Holdings'], ['TJX', 'TJX Companies'], ['CMG', 'Chipotle'],
    ['ABNB', 'Airbnb'], ['LULU', 'Lululemon'], ['F', 'Ford'], ['GM', 'General Motors'], ['ORLY', 'O\'Reilly Automotive'],
  ]),
  ...S('Consumer Staples', [
    ['WMT', 'Walmart'], ['COST', 'Costco'], ['PG', 'Procter & Gamble'], ['KO', 'Coca-Cola'], ['PEP', 'PepsiCo'],
    ['PM', 'Philip Morris'], ['MO', 'Altria'], ['CL', 'Colgate-Palmolive'], ['MDLZ', 'Mondelez'], ['KHC', 'Kraft Heinz'],
    ['TGT', 'Target'], ['KR', 'Kroger'],
  ]),
  ...S('Financials', [
    ['JPM', 'JPMorgan Chase'], ['BAC', 'Bank of America'], ['WFC', 'Wells Fargo'], ['GS', 'Goldman Sachs'], ['MS', 'Morgan Stanley'],
    ['C', 'Citigroup'], ['V', 'Visa'], ['MA', 'Mastercard'], ['AXP', 'American Express'], ['BLK', 'BlackRock'],
    ['SCHW', 'Charles Schwab'], ['PYPL', 'PayPal'], ['COF', 'Capital One'], ['SOFI', 'SoFi Technologies'], ['HOOD', 'Robinhood'],
  ]),
  ...S('Health Care', [
    ['LLY', 'Eli Lilly'], ['UNH', 'UnitedHealth'], ['JNJ', 'Johnson & Johnson'], ['MRK', 'Merck'], ['ABBV', 'AbbVie'],
    ['PFE', 'Pfizer'], ['TMO', 'Thermo Fisher'], ['ABT', 'Abbott Labs'], ['AMGN', 'Amgen'], ['ISRG', 'Intuitive Surgical'],
    ['GILD', 'Gilead Sciences'], ['CVS', 'CVS Health'], ['BMY', 'Bristol-Myers Squibb'], ['VRTX', 'Vertex Pharmaceuticals'],
  ]),
  ...S('Industrials', [
    ['CAT', 'Caterpillar'], ['GE', 'GE Aerospace'], ['BA', 'Boeing'], ['HON', 'Honeywell'], ['UPS', 'UPS'],
    ['UNP', 'Union Pacific'], ['DE', 'Deere'], ['LMT', 'Lockheed Martin'], ['RTX', 'RTX'], ['MMM', '3M'],
    ['UBER', 'Uber'], ['DAL', 'Delta Air Lines'], ['FDX', 'FedEx'], ['ETN', 'Eaton'],
  ]),
  ...S('Energy', [
    ['XOM', 'Exxon Mobil'], ['CVX', 'Chevron'], ['COP', 'ConocoPhillips'], ['SLB', 'SLB (Schlumberger)'], ['OXY', 'Occidental Petroleum'],
    ['EOG', 'EOG Resources'], ['PSX', 'Phillips 66'], ['MPC', 'Marathon Petroleum'],
  ]),
  ...S('Utilities', [
    ['NEE', 'NextEra Energy'], ['DUK', 'Duke Energy'], ['SO', 'Southern Company'], ['D', 'Dominion Energy'], ['AEP', 'American Electric Power'],
    ['CEG', 'Constellation Energy'],
  ]),
  ...S('Real Estate', [
    ['PLD', 'Prologis'], ['AMT', 'American Tower'], ['EQIX', 'Equinix'], ['O', 'Realty Income'], ['SPG', 'Simon Property'],
    ['PSA', 'Public Storage'],
  ]),
  ...S('Materials', [
    ['LIN', 'Linde'], ['SHW', 'Sherwin-Williams'], ['FCX', 'Freeport-McMoRan'], ['NEM', 'Newmont'], ['APD', 'Air Products'],
    ['NUE', 'Nucor'],
  ]),
  ...S('ETF', [
    ['SPY', 'SPDR S&P 500 ETF'], ['VOO', 'Vanguard S&P 500 ETF'], ['QQQ', 'Invesco QQQ (Nasdaq-100)'], ['VTI', 'Vanguard Total Stock Market ETF'],
    ['VXUS', 'Vanguard Total International ETF'], ['BND', 'Vanguard Total Bond Market ETF'],
  ]),
  ...SECTORS.map((s) => ({ symbol: s.etf, name: `${s.name} Select Sector SPDR`, sector: 'ETF' })),
];

export const STOCKS = UNIVERSE.filter((u) => u.sector !== 'ETF');
export const sectorOf = (symbol) => UNIVERSE.find((u) => u.symbol === symbol)?.sector;
