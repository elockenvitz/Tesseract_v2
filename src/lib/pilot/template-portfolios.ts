/**
 * Template portfolios for pilot client onboarding.
 *
 * Realistic model portfolios using real tickers with plausible weights.
 * Used when clients can't share actual holdings during pilot evaluation.
 */

export interface TemplatePosition {
  symbol: string
  company_name: string
  sector: string
  shares: number
  price: number
  weight_pct: number
}

export interface TemplatePortfolio {
  id: string
  name: string
  description: string
  benchmark: string
  total_value: number
  positions: TemplatePosition[]
}

// ~$50M US Large Cap Growth — tech-heavy, 40 names
const US_LARGE_CAP_GROWTH: TemplatePortfolio = {
  id: 'tpl-us-large-cap-growth',
  name: 'US Large Cap Growth',
  description: 'Growth-oriented large cap portfolio with technology and consumer discretionary tilt',
  benchmark: 'S&P 500',
  total_value: 50_000_000,
  positions: [
    { symbol: 'AAPL', company_name: 'Apple Inc.', sector: 'Technology', shares: 12500, price: 228.50, weight_pct: 5.71 },
    { symbol: 'MSFT', company_name: 'Microsoft Corp.', sector: 'Technology', shares: 5800, price: 430.20, weight_pct: 4.99 },
    { symbol: 'NVDA', company_name: 'NVIDIA Corp.', sector: 'Technology', shares: 2200, price: 875.30, weight_pct: 3.85 },
    { symbol: 'AMZN', company_name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', shares: 9500, price: 196.80, weight_pct: 3.74 },
    { symbol: 'META', company_name: 'Meta Platforms Inc.', sector: 'Communication Services', shares: 3200, price: 530.40, weight_pct: 3.39 },
    { symbol: 'GOOGL', company_name: 'Alphabet Inc. Class A', sector: 'Communication Services', shares: 9800, price: 170.50, weight_pct: 3.34 },
    { symbol: 'AVGO', company_name: 'Broadcom Inc.', sector: 'Technology', shares: 850, price: 178.90, weight_pct: 3.04 },
    { symbol: 'CRM', company_name: 'Salesforce Inc.', sector: 'Technology', shares: 5200, price: 272.30, weight_pct: 2.83 },
    { symbol: 'ADBE', company_name: 'Adobe Inc.', sector: 'Technology', shares: 2800, price: 485.60, weight_pct: 2.72 },
    { symbol: 'AMD', company_name: 'Advanced Micro Devices', sector: 'Technology', shares: 7500, price: 168.40, weight_pct: 2.53 },
    { symbol: 'NFLX', company_name: 'Netflix Inc.', sector: 'Communication Services', shares: 1600, price: 780.20, weight_pct: 2.50 },
    { symbol: 'NOW', company_name: 'ServiceNow Inc.', sector: 'Technology', shares: 1500, price: 815.70, weight_pct: 2.45 },
    { symbol: 'UBER', company_name: 'Uber Technologies', sector: 'Industrials', shares: 14000, price: 82.30, weight_pct: 2.30 },
    { symbol: 'INTU', company_name: 'Intuit Inc.', sector: 'Technology', shares: 1800, price: 620.40, weight_pct: 2.23 },
    { symbol: 'ISRG', company_name: 'Intuitive Surgical', sector: 'Health Care', shares: 2100, price: 510.80, weight_pct: 2.15 },
    { symbol: 'SNPS', company_name: 'Synopsys Inc.', sector: 'Technology', shares: 1900, price: 555.20, weight_pct: 2.11 },
    { symbol: 'PANW', company_name: 'Palo Alto Networks', sector: 'Technology', shares: 3100, price: 328.50, weight_pct: 2.04 },
    { symbol: 'LRCX', company_name: 'Lam Research Corp.', sector: 'Technology', shares: 1200, price: 830.60, weight_pct: 1.99 },
    { symbol: 'ANET', company_name: 'Arista Networks', sector: 'Technology', shares: 3500, price: 278.90, weight_pct: 1.95 },
    { symbol: 'ABNB', company_name: 'Airbnb Inc.', sector: 'Consumer Discretionary', shares: 6200, price: 155.30, weight_pct: 1.93 },
    { symbol: 'MELI', company_name: 'MercadoLibre Inc.', sector: 'Consumer Discretionary', shares: 520, price: 1820.40, weight_pct: 1.89 },
    { symbol: 'LULU', company_name: 'Lululemon Athletica', sector: 'Consumer Discretionary', shares: 2400, price: 385.70, weight_pct: 1.85 },
    { symbol: 'DDOG', company_name: 'Datadog Inc.', sector: 'Technology', shares: 6800, price: 132.40, weight_pct: 1.80 },
    { symbol: 'WDAY', company_name: 'Workday Inc.', sector: 'Technology', shares: 3400, price: 260.80, weight_pct: 1.77 },
    { symbol: 'TEAM', company_name: 'Atlassian Corp.', sector: 'Technology', shares: 3600, price: 238.50, weight_pct: 1.72 },
    { symbol: 'CRWD', company_name: 'CrowdStrike Holdings', sector: 'Technology', shares: 2600, price: 325.60, weight_pct: 1.69 },
    { symbol: 'DASH', company_name: 'DoorDash Inc.', sector: 'Consumer Discretionary', shares: 5500, price: 148.90, weight_pct: 1.64 },
    { symbol: 'MNST', company_name: 'Monster Beverage', sector: 'Consumer Staples', shares: 15000, price: 53.20, weight_pct: 1.60 },
    { symbol: 'TTD', company_name: 'The Trade Desk', sector: 'Technology', shares: 7200, price: 108.30, weight_pct: 1.56 },
    { symbol: 'ZS', company_name: 'Zscaler Inc.', sector: 'Technology', shares: 3800, price: 198.70, weight_pct: 1.51 },
    { symbol: 'VEEV', company_name: 'Veeva Systems', sector: 'Health Care', shares: 3200, price: 228.40, weight_pct: 1.46 },
    { symbol: 'HUBS', company_name: 'HubSpot Inc.', sector: 'Technology', shares: 1100, price: 655.80, weight_pct: 1.44 },
    { symbol: 'NET', company_name: 'Cloudflare Inc.', sector: 'Technology', shares: 6500, price: 108.20, weight_pct: 1.41 },
    { symbol: 'COIN', company_name: 'Coinbase Global', sector: 'Financials', shares: 2800, price: 245.60, weight_pct: 1.38 },
    { symbol: 'ROKU', company_name: 'Roku Inc.', sector: 'Communication Services', shares: 8500, price: 78.40, weight_pct: 1.33 },
    { symbol: 'SPOT', company_name: 'Spotify Technology', sector: 'Communication Services', shares: 2000, price: 325.80, weight_pct: 1.30 },
    { symbol: 'BILL', company_name: 'BILL Holdings', sector: 'Technology', shares: 8200, price: 75.60, weight_pct: 1.24 },
    { symbol: 'TWLO', company_name: 'Twilio Inc.', sector: 'Technology', shares: 7500, price: 78.90, weight_pct: 1.18 },
    { symbol: 'DUOL', company_name: 'Duolingo Inc.', sector: 'Technology', shares: 2400, price: 238.50, weight_pct: 1.14 },
    { symbol: 'CELH', company_name: 'Celsius Holdings', sector: 'Consumer Staples', shares: 12000, price: 45.80, weight_pct: 1.10 },
  ],
}

// ~$75M Concentrated Value — 25 names, financials/industrials/energy
const CONCENTRATED_VALUE: TemplatePortfolio = {
  id: 'tpl-concentrated-value',
  name: 'Concentrated Value',
  description: 'High-conviction value portfolio focused on financials, industrials, and energy',
  benchmark: 'Russell 1000 Value',
  total_value: 75_000_000,
  positions: [
    { symbol: 'BRK.B', company_name: 'Berkshire Hathaway B', sector: 'Financials', shares: 8500, price: 465.20, weight_pct: 5.28 },
    { symbol: 'JPM', company_name: 'JPMorgan Chase', sector: 'Financials', shares: 15200, price: 248.30, weight_pct: 5.04 },
    { symbol: 'XOM', company_name: 'Exxon Mobil Corp.', sector: 'Energy', shares: 28000, price: 118.50, weight_pct: 4.43 },
    { symbol: 'GE', company_name: 'GE Aerospace', sector: 'Industrials', shares: 16500, price: 195.40, weight_pct: 4.30 },
    { symbol: 'UNH', company_name: 'UnitedHealth Group', sector: 'Health Care', shares: 5200, price: 585.60, weight_pct: 4.06 },
    { symbol: 'CAT', company_name: 'Caterpillar Inc.', sector: 'Industrials', shares: 7800, price: 382.70, weight_pct: 3.98 },
    { symbol: 'CVX', company_name: 'Chevron Corp.', sector: 'Energy', shares: 17500, price: 162.30, weight_pct: 3.79 },
    { symbol: 'BAC', company_name: 'Bank of America', sector: 'Financials', shares: 62000, price: 44.80, weight_pct: 3.71 },
    { symbol: 'GS', company_name: 'Goldman Sachs', sector: 'Financials', shares: 5400, price: 510.20, weight_pct: 3.67 },
    { symbol: 'RTX', company_name: 'RTX Corp.', sector: 'Industrials', shares: 22000, price: 118.90, weight_pct: 3.49 },
    { symbol: 'HON', company_name: 'Honeywell International', sector: 'Industrials', shares: 11500, price: 218.40, weight_pct: 3.35 },
    { symbol: 'PFE', company_name: 'Pfizer Inc.', sector: 'Health Care', shares: 75000, price: 28.60, weight_pct: 2.86 },
    { symbol: 'C', company_name: 'Citigroup Inc.', sector: 'Financials', shares: 28000, price: 72.40, weight_pct: 2.70 },
    { symbol: 'MMM', company_name: '3M Company', sector: 'Industrials', shares: 14500, price: 138.50, weight_pct: 2.68 },
    { symbol: 'MET', company_name: 'MetLife Inc.', sector: 'Financials', shares: 24000, price: 82.30, weight_pct: 2.64 },
    { symbol: 'EOG', company_name: 'EOG Resources', sector: 'Energy', shares: 14200, price: 135.80, weight_pct: 2.57 },
    { symbol: 'DE', company_name: 'Deere & Co.', sector: 'Industrials', shares: 4200, price: 445.60, weight_pct: 2.50 },
    { symbol: 'GM', company_name: 'General Motors', sector: 'Consumer Discretionary', shares: 38000, price: 48.70, weight_pct: 2.47 },
    { symbol: 'VLO', company_name: 'Valero Energy', sector: 'Energy', shares: 11800, price: 155.20, weight_pct: 2.44 },
    { symbol: 'ALL', company_name: 'Allstate Corp.', sector: 'Financials', shares: 10200, price: 178.90, weight_pct: 2.43 },
    { symbol: 'CI', company_name: 'Cigna Group', sector: 'Health Care', shares: 4800, price: 365.40, weight_pct: 2.34 },
    { symbol: 'F', company_name: 'Ford Motor Co.', sector: 'Consumer Discretionary', shares: 120000, price: 13.80, weight_pct: 2.21 },
    { symbol: 'USB', company_name: 'U.S. Bancorp', sector: 'Financials', shares: 28500, price: 52.60, weight_pct: 2.00 },
    { symbol: 'NUE', company_name: 'Nucor Corp.', sector: 'Materials', shares: 9800, price: 148.30, weight_pct: 1.94 },
    { symbol: 'IP', company_name: 'International Paper', sector: 'Materials', shares: 28000, price: 48.20, weight_pct: 1.80 },
  ],
}

// ~$100M Diversified Core — 80 names, broad sector exposure
const US_CORE_EQUITY: TemplatePortfolio = {
  id: 'tpl-us-core-equity',
  name: 'US Core Equity',
  description: 'Diversified core equity portfolio with broad sector and market-cap exposure',
  benchmark: 'S&P 500',
  total_value: 100_000_000,
  positions: [
    // Technology ~28%
    { symbol: 'AAPL', company_name: 'Apple Inc.', sector: 'Technology', shares: 18000, price: 228.50, weight_pct: 4.11 },
    { symbol: 'MSFT', company_name: 'Microsoft Corp.', sector: 'Technology', shares: 8200, price: 430.20, weight_pct: 3.53 },
    { symbol: 'NVDA', company_name: 'NVIDIA Corp.', sector: 'Technology', shares: 3200, price: 875.30, weight_pct: 2.80 },
    { symbol: 'AVGO', company_name: 'Broadcom Inc.', sector: 'Technology', shares: 1200, price: 178.90, weight_pct: 2.15 },
    { symbol: 'CRM', company_name: 'Salesforce Inc.', sector: 'Technology', shares: 5800, price: 272.30, weight_pct: 1.58 },
    { symbol: 'ADBE', company_name: 'Adobe Inc.', sector: 'Technology', shares: 2800, price: 485.60, weight_pct: 1.36 },
    { symbol: 'AMD', company_name: 'Advanced Micro Devices', sector: 'Technology', shares: 7500, price: 168.40, weight_pct: 1.26 },
    { symbol: 'INTC', company_name: 'Intel Corp.', sector: 'Technology', shares: 30000, price: 32.80, weight_pct: 0.98 },
    { symbol: 'CSCO', company_name: 'Cisco Systems', sector: 'Technology', shares: 16000, price: 56.40, weight_pct: 0.90 },
    { symbol: 'TXN', company_name: 'Texas Instruments', sector: 'Technology', shares: 4800, price: 185.20, weight_pct: 0.89 },
    // Health Care ~13%
    { symbol: 'UNH', company_name: 'UnitedHealth Group', sector: 'Health Care', shares: 3500, price: 585.60, weight_pct: 2.05 },
    { symbol: 'JNJ', company_name: 'Johnson & Johnson', sector: 'Health Care', shares: 10000, price: 158.40, weight_pct: 1.58 },
    { symbol: 'LLY', company_name: 'Eli Lilly & Co.', sector: 'Health Care', shares: 1600, price: 825.30, weight_pct: 1.32 },
    { symbol: 'ABBV', company_name: 'AbbVie Inc.', sector: 'Health Care', shares: 6800, price: 178.50, weight_pct: 1.21 },
    { symbol: 'PFE', company_name: 'Pfizer Inc.', sector: 'Health Care', shares: 40000, price: 28.60, weight_pct: 1.14 },
    { symbol: 'MRK', company_name: 'Merck & Co.', sector: 'Health Care', shares: 7200, price: 128.30, weight_pct: 0.92 },
    { symbol: 'TMO', company_name: 'Thermo Fisher Scientific', sector: 'Health Care', shares: 1500, price: 585.40, weight_pct: 0.88 },
    { symbol: 'ABT', company_name: 'Abbott Laboratories', sector: 'Health Care', shares: 6500, price: 118.70, weight_pct: 0.77 },
    { symbol: 'BMY', company_name: 'Bristol-Myers Squibb', sector: 'Health Care', shares: 12000, price: 52.80, weight_pct: 0.63 },
    // Financials ~13%
    { symbol: 'JPM', company_name: 'JPMorgan Chase', sector: 'Financials', shares: 7500, price: 248.30, weight_pct: 1.86 },
    { symbol: 'BRK.B', company_name: 'Berkshire Hathaway B', sector: 'Financials', shares: 3800, price: 465.20, weight_pct: 1.77 },
    { symbol: 'BAC', company_name: 'Bank of America', sector: 'Financials', shares: 35000, price: 44.80, weight_pct: 1.57 },
    { symbol: 'GS', company_name: 'Goldman Sachs', sector: 'Financials', shares: 2400, price: 510.20, weight_pct: 1.22 },
    { symbol: 'MS', company_name: 'Morgan Stanley', sector: 'Financials', shares: 9500, price: 105.40, weight_pct: 1.00 },
    { symbol: 'WFC', company_name: 'Wells Fargo', sector: 'Financials', shares: 15000, price: 62.30, weight_pct: 0.93 },
    { symbol: 'SCHW', company_name: 'Charles Schwab', sector: 'Financials', shares: 10000, price: 78.50, weight_pct: 0.79 },
    { symbol: 'AXP', company_name: 'American Express', sector: 'Financials', shares: 3200, price: 245.60, weight_pct: 0.79 },
    { symbol: 'PGR', company_name: 'Progressive Corp.', sector: 'Financials', shares: 3500, price: 218.40, weight_pct: 0.76 },
    // Consumer Discretionary ~10%
    { symbol: 'AMZN', company_name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', shares: 12000, price: 196.80, weight_pct: 2.36 },
    { symbol: 'TSLA', company_name: 'Tesla Inc.', sector: 'Consumer Discretionary', shares: 4500, price: 252.30, weight_pct: 1.14 },
    { symbol: 'HD', company_name: 'Home Depot', sector: 'Consumer Discretionary', shares: 2800, price: 385.40, weight_pct: 1.08 },
    { symbol: 'MCD', company_name: "McDonald's Corp.", sector: 'Consumer Discretionary', shares: 3500, price: 298.60, weight_pct: 1.05 },
    { symbol: 'NKE', company_name: 'Nike Inc.', sector: 'Consumer Discretionary', shares: 8500, price: 98.40, weight_pct: 0.84 },
    { symbol: 'SBUX', company_name: 'Starbucks Corp.', sector: 'Consumer Discretionary', shares: 7500, price: 92.30, weight_pct: 0.69 },
    { symbol: 'LOW', company_name: "Lowe's Companies", sector: 'Consumer Discretionary', shares: 2500, price: 258.70, weight_pct: 0.65 },
    { symbol: 'TJX', company_name: 'TJX Companies', sector: 'Consumer Discretionary', shares: 5500, price: 108.60, weight_pct: 0.60 },
    // Communication Services ~9%
    { symbol: 'META', company_name: 'Meta Platforms Inc.', sector: 'Communication Services', shares: 4000, price: 530.40, weight_pct: 2.12 },
    { symbol: 'GOOGL', company_name: 'Alphabet Inc. Class A', sector: 'Communication Services', shares: 10500, price: 170.50, weight_pct: 1.79 },
    { symbol: 'NFLX', company_name: 'Netflix Inc.', sector: 'Communication Services', shares: 1200, price: 780.20, weight_pct: 0.94 },
    { symbol: 'DIS', company_name: 'Walt Disney Co.', sector: 'Communication Services', shares: 6500, price: 115.80, weight_pct: 0.75 },
    { symbol: 'CMCSA', company_name: 'Comcast Corp.', sector: 'Communication Services', shares: 15000, price: 38.50, weight_pct: 0.58 },
    { symbol: 'TMUS', company_name: 'T-Mobile US', sector: 'Communication Services', shares: 3200, price: 175.40, weight_pct: 0.56 },
    // Industrials ~8%
    { symbol: 'GE', company_name: 'GE Aerospace', sector: 'Industrials', shares: 6500, price: 195.40, weight_pct: 1.27 },
    { symbol: 'CAT', company_name: 'Caterpillar Inc.', sector: 'Industrials', shares: 2800, price: 382.70, weight_pct: 1.07 },
    { symbol: 'RTX', company_name: 'RTX Corp.', sector: 'Industrials', shares: 7500, price: 118.90, weight_pct: 0.89 },
    { symbol: 'HON', company_name: 'Honeywell International', sector: 'Industrials', shares: 3500, price: 218.40, weight_pct: 0.76 },
    { symbol: 'UPS', company_name: 'United Parcel Service', sector: 'Industrials', shares: 4500, price: 148.20, weight_pct: 0.67 },
    { symbol: 'DE', company_name: 'Deere & Co.', sector: 'Industrials', shares: 1400, price: 445.60, weight_pct: 0.62 },
    { symbol: 'LMT', company_name: 'Lockheed Martin', sector: 'Industrials', shares: 1200, price: 468.30, weight_pct: 0.56 },
    { symbol: 'UNP', company_name: 'Union Pacific', sector: 'Industrials', shares: 2200, price: 248.50, weight_pct: 0.55 },
    // Consumer Staples ~6%
    { symbol: 'PG', company_name: 'Procter & Gamble', sector: 'Consumer Staples', shares: 6500, price: 168.40, weight_pct: 1.09 },
    { symbol: 'KO', company_name: 'Coca-Cola Co.', sector: 'Consumer Staples', shares: 14000, price: 62.30, weight_pct: 0.87 },
    { symbol: 'PEP', company_name: 'PepsiCo Inc.', sector: 'Consumer Staples', shares: 4500, price: 172.50, weight_pct: 0.78 },
    { symbol: 'COST', company_name: 'Costco Wholesale', sector: 'Consumer Staples', shares: 800, price: 895.40, weight_pct: 0.72 },
    { symbol: 'WMT', company_name: 'Walmart Inc.', sector: 'Consumer Staples', shares: 6000, price: 82.60, weight_pct: 0.50 },
    { symbol: 'PM', company_name: 'Philip Morris Intl', sector: 'Consumer Staples', shares: 4800, price: 102.30, weight_pct: 0.49 },
    // Energy ~5%
    { symbol: 'XOM', company_name: 'Exxon Mobil Corp.', sector: 'Energy', shares: 12000, price: 118.50, weight_pct: 1.42 },
    { symbol: 'CVX', company_name: 'Chevron Corp.', sector: 'Energy', shares: 6000, price: 162.30, weight_pct: 0.97 },
    { symbol: 'COP', company_name: 'ConocoPhillips', sector: 'Energy', shares: 5500, price: 115.40, weight_pct: 0.63 },
    { symbol: 'SLB', company_name: 'Schlumberger Ltd.', sector: 'Energy', shares: 9500, price: 48.60, weight_pct: 0.46 },
    { symbol: 'EOG', company_name: 'EOG Resources', sector: 'Energy', shares: 2800, price: 135.80, weight_pct: 0.38 },
    // Utilities ~3%
    { symbol: 'NEE', company_name: 'NextEra Energy', sector: 'Utilities', shares: 12000, price: 82.40, weight_pct: 0.99 },
    { symbol: 'SO', company_name: 'Southern Company', sector: 'Utilities', shares: 8500, price: 85.30, weight_pct: 0.73 },
    { symbol: 'DUK', company_name: 'Duke Energy', sector: 'Utilities', shares: 5500, price: 108.20, weight_pct: 0.60 },
    // Real Estate ~3%
    { symbol: 'PLD', company_name: 'Prologis Inc.', sector: 'Real Estate', shares: 6000, price: 128.50, weight_pct: 0.77 },
    { symbol: 'AMT', company_name: 'American Tower', sector: 'Real Estate', shares: 3200, price: 218.40, weight_pct: 0.70 },
    { symbol: 'SPG', company_name: 'Simon Property Group', sector: 'Real Estate', shares: 3800, price: 158.30, weight_pct: 0.60 },
    // Materials ~2%
    { symbol: 'LIN', company_name: 'Linde plc', sector: 'Materials', shares: 2000, price: 478.50, weight_pct: 0.96 },
    { symbol: 'APD', company_name: 'Air Products', sector: 'Materials', shares: 2500, price: 285.40, weight_pct: 0.71 },
  ],
}

// ~$60M Tech & Consumer Growth — 35 names, software/internet/consumer brands
const TECH_CONSUMER_GROWTH: TemplatePortfolio = {
  id: 'tpl-tech-consumer-growth',
  name: 'Tech & Consumer Growth',
  description: 'Growth portfolio focused on technology platforms, software, and consumer brands',
  benchmark: 'NASDAQ 100',
  total_value: 60_000_000,
  positions: [
    // Mega-cap tech platforms ~25%
    { symbol: 'AAPL', company_name: 'Apple Inc.', sector: 'Technology', shares: 10500, price: 228.50, weight_pct: 4.00 },
    { symbol: 'MSFT', company_name: 'Microsoft Corp.', sector: 'Technology', shares: 4800, price: 430.20, weight_pct: 3.44 },
    { symbol: 'GOOGL', company_name: 'Alphabet Inc. Class A', sector: 'Communication Services', shares: 11000, price: 170.50, weight_pct: 3.13 },
    { symbol: 'AMZN', company_name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', shares: 9200, price: 196.80, weight_pct: 3.02 },
    { symbol: 'META', company_name: 'Meta Platforms Inc.', sector: 'Communication Services', shares: 3000, price: 530.40, weight_pct: 2.65 },
    { symbol: 'NVDA', company_name: 'NVIDIA Corp.', sector: 'Technology', shares: 1500, price: 875.30, weight_pct: 2.19 },
    // Software & Cloud ~22%
    { symbol: 'CRM', company_name: 'Salesforce Inc.', sector: 'Technology', shares: 4500, price: 272.30, weight_pct: 2.04 },
    { symbol: 'ADBE', company_name: 'Adobe Inc.', sector: 'Technology', shares: 2400, price: 485.60, weight_pct: 1.94 },
    { symbol: 'NOW', company_name: 'ServiceNow Inc.', sector: 'Technology', shares: 1300, price: 815.70, weight_pct: 1.77 },
    { symbol: 'SHOP', company_name: 'Shopify Inc.', sector: 'Technology', shares: 12000, price: 82.40, weight_pct: 1.65 },
    { symbol: 'CRWD', company_name: 'CrowdStrike Holdings', sector: 'Technology', shares: 2800, price: 325.60, weight_pct: 1.52 },
    { symbol: 'DDOG', company_name: 'Datadog Inc.', sector: 'Technology', shares: 6500, price: 132.40, weight_pct: 1.43 },
    { symbol: 'WDAY', company_name: 'Workday Inc.', sector: 'Technology', shares: 3000, price: 260.80, weight_pct: 1.30 },
    { symbol: 'HUBS', company_name: 'HubSpot Inc.', sector: 'Technology', shares: 1100, price: 655.80, weight_pct: 1.20 },
    { symbol: 'NET', company_name: 'Cloudflare Inc.', sector: 'Technology', shares: 6200, price: 108.20, weight_pct: 1.12 },
    { symbol: 'ZS', company_name: 'Zscaler Inc.', sector: 'Technology', shares: 3200, price: 198.70, weight_pct: 1.06 },
    { symbol: 'TEAM', company_name: 'Atlassian Corp.', sector: 'Technology', shares: 2500, price: 238.50, weight_pct: 0.99 },
    { symbol: 'DUOL', company_name: 'Duolingo Inc.', sector: 'Technology', shares: 2200, price: 238.50, weight_pct: 0.87 },
    // Internet & Digital Media ~15%
    { symbol: 'NFLX', company_name: 'Netflix Inc.', sector: 'Communication Services', shares: 1100, price: 780.20, weight_pct: 1.43 },
    { symbol: 'SPOT', company_name: 'Spotify Technology', sector: 'Communication Services', shares: 2400, price: 325.80, weight_pct: 1.30 },
    { symbol: 'UBER', company_name: 'Uber Technologies', sector: 'Industrials', shares: 9000, price: 82.30, weight_pct: 1.23 },
    { symbol: 'ABNB', company_name: 'Airbnb Inc.', sector: 'Consumer Discretionary', shares: 4500, price: 155.30, weight_pct: 1.16 },
    { symbol: 'DASH', company_name: 'DoorDash Inc.', sector: 'Consumer Discretionary', shares: 4200, price: 148.90, weight_pct: 1.04 },
    { symbol: 'TTD', company_name: 'The Trade Desk', sector: 'Technology', shares: 5500, price: 108.30, weight_pct: 0.99 },
    { symbol: 'PINS', company_name: 'Pinterest Inc.', sector: 'Communication Services', shares: 15000, price: 38.40, weight_pct: 0.96 },
    { symbol: 'ROKU', company_name: 'Roku Inc.', sector: 'Communication Services', shares: 6500, price: 78.40, weight_pct: 0.85 },
    // Consumer Brands ~18%
    { symbol: 'TSLA', company_name: 'Tesla Inc.', sector: 'Consumer Discretionary', shares: 4200, price: 252.30, weight_pct: 1.77 },
    { symbol: 'NKE', company_name: 'Nike Inc.', sector: 'Consumer Discretionary', shares: 9500, price: 98.40, weight_pct: 1.56 },
    { symbol: 'LULU', company_name: 'Lululemon Athletica', sector: 'Consumer Discretionary', shares: 2200, price: 385.70, weight_pct: 1.41 },
    { symbol: 'SBUX', company_name: 'Starbucks Corp.', sector: 'Consumer Discretionary', shares: 8500, price: 92.30, weight_pct: 1.31 },
    { symbol: 'MELI', company_name: 'MercadoLibre Inc.', sector: 'Consumer Discretionary', shares: 380, price: 1820.40, weight_pct: 1.15 },
    { symbol: 'MNST', company_name: 'Monster Beverage', sector: 'Consumer Staples', shares: 12000, price: 53.20, weight_pct: 1.06 },
    { symbol: 'CELH', company_name: 'Celsius Holdings', sector: 'Consumer Staples', shares: 14000, price: 45.80, weight_pct: 1.07 },
    { symbol: 'ELF', company_name: 'e.l.f. Beauty', sector: 'Consumer Staples', shares: 4800, price: 118.50, weight_pct: 0.95 },
    { symbol: 'DECK', company_name: 'Deckers Outdoor', sector: 'Consumer Discretionary', shares: 600, price: 895.20, weight_pct: 0.90 },
  ],
}

export const TEMPLATE_PORTFOLIOS: TemplatePortfolio[] = [
  US_LARGE_CAP_GROWTH,
  TECH_CONSUMER_GROWTH,
  CONCENTRATED_VALUE,
  US_CORE_EQUITY,
]
