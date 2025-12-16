/**
 * Fundamental data fetching service
 * Provides access to financial metrics, earnings, dividends, and other company data
 */

// Data types
export interface EarningsData {
  date: string
  fiscalQuarter: string
  actualEPS: number | null
  estimatedEPS: number | null
  surprise: number | null
  surprisePercent: number | null
  revenue: number | null
  estimatedRevenue: number | null
}

export interface DividendData {
  exDate: string
  paymentDate: string
  amount: number
  yield?: number
}

export interface SplitData {
  date: string
  ratio: string // e.g., "4:1"
  splitFactor: number // e.g., 4
}

export interface FinancialMetrics {
  marketCap: number | null
  peRatio: number | null
  pegRatio: number | null
  priceToBook: number | null
  priceToSales: number | null
  enterpriseValue: number | null
  evToEbitda: number | null
  profitMargin: number | null
  operatingMargin: number | null
  returnOnAssets: number | null
  returnOnEquity: number | null
  revenueGrowth: number | null
  earningsGrowth: number | null
  debtToEquity: number | null
  currentRatio: number | null
  quickRatio: number | null
  freeCashFlow: number | null
  beta: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  fiftyDayMA: number | null
  twoHundredDayMA: number | null
  sharesOutstanding: number | null
  floatShares: number | null
  shortRatio: number | null
  shortPercentOfFloat: number | null
}

export interface CompanyProfile {
  symbol: string
  name: string
  exchange: string
  sector: string
  industry: string
  description: string
  website: string
  employees: number | null
  headquarters: string
  founded: string | null
  ceo: string | null
}

export interface FundamentalDataPoint {
  time: number // Unix timestamp
  value: number
  label?: string
}

// CORS proxies for bypassing restrictions
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?'
]

async function fetchWithProxy(url: string): Promise<any> {
  for (const proxy of CORS_PROXIES) {
    try {
      const response = await fetch(`${proxy}${encodeURIComponent(url)}`)
      if (response.ok) {
        return await response.json()
      }
    } catch {
      continue
    }
  }
  throw new Error('All proxies failed')
}

// Cache for fundamental data
const fundamentalCache = new Map<string, { data: any; timestamp: number }>()
const CACHE_DURATION = 15 * 60 * 1000 // 15 minutes

function getCachedData<T>(key: string): T | null {
  const cached = fundamentalCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data as T
  }
  return null
}

function setCachedData(key: string, data: any) {
  fundamentalCache.set(key, { data, timestamp: Date.now() })
}

/**
 * Fetch earnings history for a symbol
 */
export async function getEarningsHistory(symbol: string): Promise<EarningsData[]> {
  const cacheKey = `earnings_${symbol}`
  const cached = getCachedData<EarningsData[]>(cacheKey)
  if (cached) return cached

  try {
    // Using Yahoo Finance for earnings data
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=earningsHistory,earningsTrend`
    const data = await fetchWithProxy(url)

    const earningsHistory = data?.quoteSummary?.result?.[0]?.earningsHistory?.history || []

    const result: EarningsData[] = earningsHistory.map((e: any) => ({
      date: e.quarter?.fmt || '',
      fiscalQuarter: e.period || '',
      actualEPS: e.epsActual?.raw ?? null,
      estimatedEPS: e.epsEstimate?.raw ?? null,
      surprise: e.epsDifference?.raw ?? null,
      surprisePercent: e.surprisePercent?.raw ? e.surprisePercent.raw * 100 : null,
      revenue: null,
      estimatedRevenue: null
    }))

    setCachedData(cacheKey, result)
    return result
  } catch (error) {
    console.error('Error fetching earnings:', error)
    return []
  }
}

/**
 * Fetch dividend history for a symbol
 */
export async function getDividendHistory(symbol: string): Promise<DividendData[]> {
  const cacheKey = `dividends_${symbol}`
  const cached = getCachedData<DividendData[]>(cacheKey)
  if (cached) return cached

  try {
    // Yahoo Finance dividend data
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=5y&events=div`
    const data = await fetchWithProxy(url)

    const dividends = data?.chart?.result?.[0]?.events?.dividends || {}

    const result: DividendData[] = Object.values(dividends).map((d: any) => ({
      exDate: new Date(d.date * 1000).toISOString().split('T')[0],
      paymentDate: '', // Not available in this endpoint
      amount: d.amount,
      yield: undefined
    }))

    // Sort by date descending
    result.sort((a, b) => new Date(b.exDate).getTime() - new Date(a.exDate).getTime())

    setCachedData(cacheKey, result)
    return result
  } catch (error) {
    console.error('Error fetching dividends:', error)
    return []
  }
}

/**
 * Fetch stock split history
 */
export async function getSplitHistory(symbol: string): Promise<SplitData[]> {
  const cacheKey = `splits_${symbol}`
  const cached = getCachedData<SplitData[]>(cacheKey)
  if (cached) return cached

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=10y&events=split`
    const data = await fetchWithProxy(url)

    const splits = data?.chart?.result?.[0]?.events?.splits || {}

    const result: SplitData[] = Object.values(splits).map((s: any) => ({
      date: new Date(s.date * 1000).toISOString().split('T')[0],
      ratio: `${s.numerator}:${s.denominator}`,
      splitFactor: s.numerator / s.denominator
    }))

    // Sort by date descending
    result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    setCachedData(cacheKey, result)
    return result
  } catch (error) {
    console.error('Error fetching splits:', error)
    return []
  }
}

/**
 * Fetch key financial metrics
 */
export async function getFinancialMetrics(symbol: string): Promise<FinancialMetrics | null> {
  const cacheKey = `metrics_${symbol}`
  const cached = getCachedData<FinancialMetrics>(cacheKey)
  if (cached) return cached

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail`
    const data = await fetchWithProxy(url)

    const result = data?.quoteSummary?.result?.[0]
    if (!result) return null

    const stats = result.defaultKeyStatistics || {}
    const financial = result.financialData || {}
    const summary = result.summaryDetail || {}

    const metrics: FinancialMetrics = {
      marketCap: summary.marketCap?.raw ?? null,
      peRatio: summary.trailingPE?.raw ?? null,
      pegRatio: stats.pegRatio?.raw ?? null,
      priceToBook: stats.priceToBook?.raw ?? null,
      priceToSales: summary.priceToSalesTrailing12Months?.raw ?? null,
      enterpriseValue: stats.enterpriseValue?.raw ?? null,
      evToEbitda: stats.enterpriseToEbitda?.raw ?? null,
      profitMargin: financial.profitMargins?.raw ?? null,
      operatingMargin: financial.operatingMargins?.raw ?? null,
      returnOnAssets: financial.returnOnAssets?.raw ?? null,
      returnOnEquity: financial.returnOnEquity?.raw ?? null,
      revenueGrowth: financial.revenueGrowth?.raw ?? null,
      earningsGrowth: financial.earningsGrowth?.raw ?? null,
      debtToEquity: financial.debtToEquity?.raw ?? null,
      currentRatio: financial.currentRatio?.raw ?? null,
      quickRatio: financial.quickRatio?.raw ?? null,
      freeCashFlow: financial.freeCashflow?.raw ?? null,
      beta: stats.beta?.raw ?? null,
      fiftyTwoWeekHigh: summary.fiftyTwoWeekHigh?.raw ?? null,
      fiftyTwoWeekLow: summary.fiftyTwoWeekLow?.raw ?? null,
      fiftyDayMA: summary.fiftyDayAverage?.raw ?? null,
      twoHundredDayMA: summary.twoHundredDayAverage?.raw ?? null,
      sharesOutstanding: stats.sharesOutstanding?.raw ?? null,
      floatShares: stats.floatShares?.raw ?? null,
      shortRatio: stats.shortRatio?.raw ?? null,
      shortPercentOfFloat: stats.shortPercentOfFloat?.raw ?? null
    }

    setCachedData(cacheKey, metrics)
    return metrics
  } catch (error) {
    console.error('Error fetching financial metrics:', error)
    return null
  }
}

/**
 * Fetch company profile
 */
export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const cacheKey = `profile_${symbol}`
  const cached = getCachedData<CompanyProfile>(cacheKey)
  if (cached) return cached

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,quoteType`
    const data = await fetchWithProxy(url)

    const result = data?.quoteSummary?.result?.[0]
    if (!result) return null

    const profile = result.assetProfile || {}
    const quoteType = result.quoteType || {}

    const companyProfile: CompanyProfile = {
      symbol: symbol.toUpperCase(),
      name: quoteType.longName || quoteType.shortName || symbol,
      exchange: quoteType.exchange || '',
      sector: profile.sector || '',
      industry: profile.industry || '',
      description: profile.longBusinessSummary || '',
      website: profile.website || '',
      employees: profile.fullTimeEmployees ?? null,
      headquarters: profile.city && profile.country ? `${profile.city}, ${profile.country}` : '',
      founded: null,
      ceo: profile.companyOfficers?.[0]?.name || null
    }

    setCachedData(cacheKey, companyProfile)
    return companyProfile
  } catch (error) {
    console.error('Error fetching company profile:', error)
    return null
  }
}

/**
 * Get quarterly revenue data as time series
 */
export async function getRevenueHistory(symbol: string): Promise<FundamentalDataPoint[]> {
  const cacheKey = `revenue_${symbol}`
  const cached = getCachedData<FundamentalDataPoint[]>(cacheKey)
  if (cached) return cached

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=incomeStatementHistoryQuarterly`
    const data = await fetchWithProxy(url)

    const statements = data?.quoteSummary?.result?.[0]?.incomeStatementHistoryQuarterly?.incomeStatementHistory || []

    const result: FundamentalDataPoint[] = statements.map((s: any) => ({
      time: new Date(s.endDate?.fmt).getTime() / 1000,
      value: s.totalRevenue?.raw ?? 0,
      label: s.endDate?.fmt
    }))

    // Sort by time ascending
    result.sort((a, b) => a.time - b.time)

    setCachedData(cacheKey, result)
    return result
  } catch (error) {
    console.error('Error fetching revenue history:', error)
    return []
  }
}

/**
 * Get quarterly net income data as time series
 */
export async function getNetIncomeHistory(symbol: string): Promise<FundamentalDataPoint[]> {
  const cacheKey = `netincome_${symbol}`
  const cached = getCachedData<FundamentalDataPoint[]>(cacheKey)
  if (cached) return cached

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=incomeStatementHistoryQuarterly`
    const data = await fetchWithProxy(url)

    const statements = data?.quoteSummary?.result?.[0]?.incomeStatementHistoryQuarterly?.incomeStatementHistory || []

    const result: FundamentalDataPoint[] = statements.map((s: any) => ({
      time: new Date(s.endDate?.fmt).getTime() / 1000,
      value: s.netIncome?.raw ?? 0,
      label: s.endDate?.fmt
    }))

    // Sort by time ascending
    result.sort((a, b) => a.time - b.time)

    setCachedData(cacheKey, result)
    return result
  } catch (error) {
    console.error('Error fetching net income history:', error)
    return []
  }
}

/**
 * Convert earnings to chart events
 */
export function earningsToChartEvents(earnings: EarningsData[]): import('./chartData').ChartEvent[] {
  return earnings
    .filter(e => e.date)
    .map((e, i) => ({
      id: `earnings_${i}`,
      time: new Date(e.date).getTime() / 1000,
      type: 'earnings' as const,
      title: `EPS: ${e.actualEPS?.toFixed(2) ?? 'N/A'}`,
      description: e.surprise
        ? `Surprise: ${e.surprise > 0 ? '+' : ''}${e.surprise.toFixed(2)} (${e.surprisePercent?.toFixed(1)}%)`
        : undefined,
      color: e.surprise && e.surprise > 0 ? '#22c55e' : e.surprise && e.surprise < 0 ? '#ef4444' : '#6b7280'
    }))
}

/**
 * Convert dividends to chart events
 */
export function dividendsToChartEvents(dividends: DividendData[]): import('./chartData').ChartEvent[] {
  return dividends.map((d, i) => ({
    id: `dividend_${i}`,
    time: new Date(d.exDate).getTime() / 1000,
    type: 'dividend' as const,
    title: `Dividend: $${d.amount.toFixed(2)}`,
    color: '#22c55e'
  }))
}

/**
 * Convert splits to chart events
 */
export function splitsToChartEvents(splits: SplitData[]): import('./chartData').ChartEvent[] {
  return splits.map((s, i) => ({
    id: `split_${i}`,
    time: new Date(s.date).getTime() / 1000,
    type: 'split' as const,
    title: `Split: ${s.ratio}`,
    color: '#f59e0b'
  }))
}

// Aggregated service
export const fundamentalDataService = {
  getEarningsHistory,
  getDividendHistory,
  getSplitHistory,
  getFinancialMetrics,
  getCompanyProfile,
  getRevenueHistory,
  getNetIncomeHistory,
  earningsToChartEvents,
  dividendsToChartEvents,
  splitsToChartEvents
}
