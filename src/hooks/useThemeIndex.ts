import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { chartDataService, type ChartDataRequest } from '../lib/chartData'

export type ThemeIndexLookback = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '2Y' | '5Y'
export type ThemeIndexMeasure = 'level' | 'return' | 'relative'

export interface ThemeIndexPoint {
  date: string // YYYY-MM-DD
  index: number
  benchmark: number
  /** Measure-specific value for index series */
  indexValue: number
  /** Measure-specific value for benchmark series */
  benchmarkValue: number
  /** Relative strength (always included for tooltip, index/benchmark*100) */
  relative: number
}

export interface UseThemeIndexArgs {
  symbols: string[]
  benchmark: string
  lookback: ThemeIndexLookback
  measure: ThemeIndexMeasure
  enabled?: boolean
}

const LOOKBACK_TO_RANGE: Record<ThemeIndexLookback, ChartDataRequest['range']> = {
  '1M': '1mo',
  '3M': '3mo',
  '6M': '6mo',
  'YTD': '1y',  // Yahoo's 'ytd' not in our union; fetch 1y and trim client-side below
  '1Y': '1y',
  '2Y': '2y',
  '5Y': '5y',
}

function fetchSeries(symbol: string, range: ChartDataRequest['range']) {
  return chartDataService.getChartData({ symbol, interval: '1d', range })
}

function ytdStartIso(): string {
  const now = new Date()
  const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  return jan1.toISOString().slice(0, 10)
}

/**
 * Builds an equal-weight index from related-asset daily closes and aligns
 * it to a benchmark, supporting level / cumulative-return / relative-strength views.
 * Dates where any constituent is missing are dropped (inner join).
 */
export function useThemeIndex({
  symbols,
  benchmark,
  lookback,
  measure,
  enabled = true,
}: UseThemeIndexArgs) {
  const range = LOOKBACK_TO_RANGE[lookback]
  const allSymbols = useMemo(
    () => [benchmark, ...symbols].filter((s, i, arr) => s && arr.indexOf(s) === i),
    [symbols, benchmark]
  )

  const queries = useQueries({
    queries: allSymbols.map((symbol) => ({
      queryKey: ['theme-index-series', symbol, range],
      queryFn: () => fetchSeries(symbol, range),
      enabled: enabled && !!symbol,
      staleTime: 5 * 60 * 1000,
    })),
  })

  const isLoading = queries.some(q => q.isLoading)
  const isError = queries.some(q => q.isError)

  const data: ThemeIndexPoint[] = useMemo(() => {
    if (!enabled || symbols.length === 0) return []

    // Build date → close maps per symbol, using only successful queries
    const perSymbol = new Map<string, Map<string, number>>()
    allSymbols.forEach((sym, i) => {
      const series = queries[i]?.data
      if (!series || series.length === 0) return
      const m = new Map<string, number>()
      for (const c of series) {
        const d = typeof c.time === 'string' && c.time.length >= 10 ? c.time.slice(0, 10) : String(c.time)
        if (Number.isFinite(c.close)) m.set(d, c.close)
      }
      perSymbol.set(sym, m)
    })

    const benchMap = perSymbol.get(benchmark)
    const constituentMaps = symbols
      .map(s => perSymbol.get(s))
      .filter((m): m is Map<string, number> => !!m && m.size > 0)

    if (!benchMap || constituentMaps.length === 0) return []

    // Intersection of dates across benchmark + all constituents with data
    const dates = [...benchMap.keys()]
      .filter(d => constituentMaps.every(m => m.has(d)))
      .sort()

    if (dates.length === 0) return []

    // Optional YTD trim
    const trimStart = lookback === 'YTD' ? ytdStartIso() : null
    const filteredDates = trimStart ? dates.filter(d => d >= trimStart) : dates
    if (filteredDates.length === 0) return []

    const first = filteredDates[0]
    const firstBench = benchMap.get(first)!
    const firstConstituents = constituentMaps.map(m => m.get(first)!)

    const out: ThemeIndexPoint[] = []
    for (const d of filteredDates) {
      const bench = benchMap.get(d)!
      // Equal-weight normalized index: mean of (close/closeAtFirst * 100) per constituent
      let sum = 0
      for (let i = 0; i < constituentMaps.length; i++) {
        sum += (constituentMaps[i].get(d)! / firstConstituents[i]) * 100
      }
      const indexLevel = sum / constituentMaps.length
      const benchLevel = (bench / firstBench) * 100
      const relative = benchLevel === 0 ? 0 : (indexLevel / benchLevel) * 100

      let indexValue = indexLevel
      let benchmarkValue = benchLevel
      if (measure === 'return') {
        indexValue = indexLevel - 100
        benchmarkValue = benchLevel - 100
      } else if (measure === 'relative') {
        indexValue = relative
        benchmarkValue = 100
      }

      out.push({
        date: d,
        index: indexLevel,
        benchmark: benchLevel,
        indexValue,
        benchmarkValue,
        relative,
      })
    }
    return out
  }, [queries, allSymbols, symbols, benchmark, enabled, measure, lookback])

  const stats = useMemo(() => {
    if (data.length < 2) {
      return { indexReturn: 0, benchmarkReturn: 0, excessReturn: 0, pointCount: data.length }
    }
    const last = data[data.length - 1]
    return {
      indexReturn: last.index - 100,
      benchmarkReturn: last.benchmark - 100,
      excessReturn: (last.index - 100) - (last.benchmark - 100),
      pointCount: data.length,
    }
  }, [data])

  // Count successful vs requested constituents (excluding benchmark)
  const { successfulConstituents, benchmarkAvailable } = useMemo(() => {
    let successful = 0
    let bench = false
    allSymbols.forEach((sym, i) => {
      const hasData = !!queries[i]?.data?.length
      if (sym === benchmark) {
        bench = hasData
      } else if (hasData) {
        successful++
      }
    })
    return { successfulConstituents: successful, benchmarkAvailable: bench }
  }, [queries, allSymbols, benchmark])

  return {
    data,
    stats,
    isLoading,
    isError,
    /** Number of constituents that actually returned data (benchmark excluded) */
    successfulConstituents,
    /** Number of constituents requested (benchmark excluded) */
    requestedConstituents: symbols.length,
    /** Whether the benchmark series was fetched successfully */
    benchmarkAvailable,
  }
}
