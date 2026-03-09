import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../../../lib/supabase'
import type { PortfolioHolding } from './portfolio-tab-types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PerformanceTabProps {
  portfolioId: string
  holdings: PortfolioHolding[] | undefined
  totalValue: number
  totalReturn: number
  returnPercentage: number
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Timeframe = '1D' | 'WTD' | 'MTD' | 'YTD' | '1Y' | 'ALL'

interface NavPoint {
  date: string
  value: number
}

// ---------------------------------------------------------------------------
// Formatting helpers (matching OverviewTab)
// ---------------------------------------------------------------------------

function fmtCcy(value: number, opts?: { compact?: boolean; sign?: boolean }) {
  const abs = Math.abs(value)
  const prefix = opts?.sign ? (value >= 0 ? '+' : '') : (value < 0 ? '-' : '')
  if (opts?.compact && abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(1)}M`
  if (opts?.compact && abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(0)}K`
  if (abs >= 1_000) return `${prefix}$${abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `${prefix}$${abs.toFixed(2)}`
}

function fmtPct(value: number, opts?: { sign?: boolean }) {
  const prefix = opts?.sign ? (value >= 0 ? '+' : '') : ''
  return `${prefix}${value.toFixed(2)}%`
}

function clr(v: number) {
  if (v > 0) return 'text-emerald-600'
  if (v < 0) return 'text-red-600'
  return 'text-gray-500'
}

// ---------------------------------------------------------------------------
// Timeframe → date range
// ---------------------------------------------------------------------------

const TIMEFRAMES: Timeframe[] = ['1D', 'WTD', 'MTD', 'YTD', '1Y', 'ALL']

function getStartDate(tf: Timeframe, earliestDate?: string): string {
  const now = new Date()
  let d: Date
  switch (tf) {
    case '1D': {
      d = new Date(now)
      d.setDate(d.getDate() - 1)
      if (d.getDay() === 0) d.setDate(d.getDate() - 2)
      if (d.getDay() === 6) d.setDate(d.getDate() - 1)
      break
    }
    case 'WTD': {
      d = new Date(now)
      const day = d.getDay()
      const diff = day === 0 ? 6 : day - 1
      d.setDate(d.getDate() - diff)
      break
    }
    case 'MTD':
      d = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'YTD':
      d = new Date(now.getFullYear(), 0, 1)
      break
    case '1Y':
      d = new Date(now)
      d.setFullYear(d.getFullYear() - 1)
      break
    case 'ALL':
      return earliestDate || '2020-01-01'
    default:
      d = new Date(now.getFullYear(), 0, 1)
  }
  return d.toISOString().split('T')[0]
}

// ---------------------------------------------------------------------------
// Risk computations
// ---------------------------------------------------------------------------

function computeDailyReturns(series: NavPoint[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1].value > 0) {
      returns.push((series[i].value - series[i - 1].value) / series[i - 1].value)
    }
  }
  return returns
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

function calcMaxDrawdown(series: NavPoint[]): number {
  if (series.length < 2) return 0
  let peak = series[0].value
  let mdd = 0
  for (const p of series) {
    if (p.value > peak) peak = p.value
    const dd = peak > 0 ? (peak - p.value) / peak : 0
    if (dd > mdd) mdd = dd
  }
  return mdd
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PerformanceTab({
  portfolioId,
  holdings,
  totalValue,
  totalReturn,
  returnPercentage,
}: PerformanceTabProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('YTD')

  // ── Symbols ────────────────────────────────────────────
  const symbols = useMemo(
    () => (holdings || []).map(h => h.assets?.symbol).filter(Boolean) as string[],
    [holdings],
  )

  // ── Holding metrics (no live quotes — pure analytical) ─
  const holdingMetrics = useMemo(() => {
    if (!holdings?.length) return []
    return holdings.map(h => {
      const symbol = h.assets?.symbol || '?'
      const sector = h.assets?.sector || 'Unknown'
      const shares = parseFloat(h.shares) || 0
      const price = parseFloat(h.price) || 0
      const cost = parseFloat(h.cost) || 0
      const mv = shares * price
      const cb = shares * cost
      const gl = mv - cb
      const weight = totalValue > 0 ? (mv / totalValue) * 100 : 0
      return { symbol, sector, shares, price, cost, mv, cb, gl, weight }
    })
  }, [holdings, totalValue])

  // ── Total cost basis ───────────────────────────────────
  const totalCost = useMemo(() => holdingMetrics.reduce((s, h) => s + h.cb, 0), [holdingMetrics])

  // ── Price history query ────────────────────────────────
  const fetchSince = useMemo(() => getStartDate('ALL'), [])

  const { data: priceHistory } = useQuery({
    queryKey: ['perf-price-history', portfolioId, symbols.join(',')],
    enabled: symbols.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_history_cache')
        .select('symbol, date, close')
        .in('symbol', symbols)
        .gte('date', fetchSince)
        .order('date', { ascending: true })
      if (error) throw error
      return (data || []) as Array<{ symbol: string; date: string; close: number }>
    },
  })

  // ── Reconstruct NAV series ─────────────────────────────
  const navSeries = useMemo<NavPoint[]>(() => {
    if (!priceHistory?.length || !holdings?.length) return []

    const sharesMap: Record<string, number> = {}
    for (const h of holdings) {
      const sym = h.assets?.symbol
      if (sym) sharesMap[sym] = parseFloat(h.shares) || 0
    }

    const dateMap: Record<string, Record<string, number>> = {}
    for (const row of priceHistory) {
      if (!dateMap[row.date]) dateMap[row.date] = {}
      dateMap[row.date][row.symbol] = Number(row.close)
    }

    const dates = Object.keys(dateMap).sort()
    const series: NavPoint[] = []
    for (const date of dates) {
      const prices = dateMap[date]
      let nav = 0
      let hasAny = false
      for (const sym of symbols) {
        if (prices[sym] !== undefined && sharesMap[sym]) {
          nav += sharesMap[sym] * prices[sym]
          hasAny = true
        }
      }
      if (hasAny) series.push({ date, value: nav })
    }
    return series
  }, [priceHistory, holdings, symbols])

  const hasPriceHistory = navSeries.length >= 2

  // ── Filter series to timeframe ─────────────────────────
  const earliestDate = navSeries.length > 0 ? navSeries[0].date : undefined
  const tfStartDate = useMemo(() => getStartDate(timeframe, earliestDate), [timeframe, earliestDate])

  const filteredSeries = useMemo(() => {
    if (!hasPriceHistory) return []
    return navSeries.filter(p => p.date >= tfStartDate)
  }, [navSeries, tfStartDate, hasPriceHistory])

  // ── Period metrics ─────────────────────────────────────
  const periodMetrics = useMemo(() => {
    if (filteredSeries.length >= 2) {
      const startNav = filteredSeries[0].value
      const endNav = filteredSeries[filteredSeries.length - 1].value
      const periodReturn = startNav > 0 ? ((endNav - startNav) / startNav) * 100 : 0
      const periodPnl = endNav - startNav
      return { periodReturn, periodPnl, hasData: true }
    }
    // Fallback to inception-to-date from props
    return { periodReturn: returnPercentage, periodPnl: totalReturn, hasData: false }
  }, [filteredSeries, returnPercentage, totalReturn])

  // ── Chart data — cumulative return % ───────────────────
  const chartData = useMemo(() => {
    if (filteredSeries.length < 2) return []
    const baseValue = filteredSeries[0].value
    if (baseValue <= 0) return []
    return filteredSeries.map(p => ({
      date: p.date,
      return: ((p.value - baseValue) / baseValue) * 100,
    }))
  }, [filteredSeries])

  const chartColor = periodMetrics.periodPnl >= 0 ? '#10b981' : '#ef4444'

  // ── Period-based start/end price maps ──────────────────
  const periodPriceMaps = useMemo(() => {
    if (!hasPriceHistory || filteredSeries.length < 2) return null
    const startDate = filteredSeries[0].date
    const endDate = filteredSeries[filteredSeries.length - 1].date
    const startPrices: Record<string, number> = {}
    const endPrices: Record<string, number> = {}
    for (const row of priceHistory || []) {
      if (row.date === startDate) startPrices[row.symbol] = Number(row.close)
      if (row.date === endDate) endPrices[row.symbol] = Number(row.close)
    }
    return { startPrices, endPrices }
  }, [hasPriceHistory, filteredSeries, priceHistory])

  // ── Contributors & Detractors (period-based) ───────────
  const { contributors, detractors } = useMemo(() => {
    if (!holdingMetrics.length) return { contributors: [], detractors: [] }

    const withContrib = holdingMetrics.map(h => {
      let contrib: number
      if (periodPriceMaps) {
        const sp = periodPriceMaps.startPrices[h.symbol]
        const ep = periodPriceMaps.endPrices[h.symbol]
        contrib = (sp !== undefined && ep !== undefined) ? h.shares * (ep - sp) : h.gl
      } else {
        contrib = h.gl // Inception fallback
      }
      return { ...h, contrib }
    })

    const totalPeriodPnl = withContrib.reduce((s, h) => s + h.contrib, 0)
    const enrichedContrib = withContrib.map(h => ({
      ...h,
      contribPct: totalPeriodPnl !== 0 ? (h.contrib / Math.abs(totalPeriodPnl)) * 100 : 0,
    }))

    const sorted = [...enrichedContrib].sort((a, b) => b.contrib - a.contrib)
    return {
      contributors: sorted.filter(h => h.contrib > 0).slice(0, 5),
      detractors: sorted.filter(h => h.contrib < 0).slice(-5).reverse(),
    }
  }, [holdingMetrics, periodPriceMaps])

  // ── Sector Attribution (period-based) ──────────────────
  const sectorAttribution = useMemo(() => {
    if (!holdingMetrics.length) return []

    const sectorMap: Record<string, { weight: number; contrib: number }> = {}
    for (const h of holdingMetrics) {
      if (!sectorMap[h.sector]) sectorMap[h.sector] = { weight: 0, contrib: 0 }
      sectorMap[h.sector].weight += h.weight

      if (periodPriceMaps) {
        const sp = periodPriceMaps.startPrices[h.symbol]
        const ep = periodPriceMaps.endPrices[h.symbol]
        sectorMap[h.sector].contrib += (sp !== undefined && ep !== undefined) ? h.shares * (ep - sp) : h.gl
      } else {
        sectorMap[h.sector].contrib += h.gl
      }
    }

    return Object.entries(sectorMap)
      .map(([sector, { weight, contrib }]) => ({ sector, weight, contrib }))
      .sort((a, b) => b.contrib - a.contrib)
  }, [holdingMetrics, periodPriceMaps])

  // ── Risk Metrics (full history) ────────────────────────
  const riskMetrics = useMemo(() => {
    const series = hasPriceHistory ? navSeries : []
    const dailyReturns = computeDailyReturns(series)
    const hasEnough = dailyReturns.length >= 5

    if (!hasEnough) return { volatility: null, maxDD: null, sharpe: null }

    const vol = stdDev(dailyReturns) * Math.sqrt(252) * 100
    const mdd = calcMaxDrawdown(series) * 100

    const totalRet = series.length >= 2
      ? (series[series.length - 1].value - series[0].value) / series[0].value
      : 0
    const daysSpan = series.length > 1 ? series.length : 1
    const annualizedReturn = totalRet * (252 / daysSpan) * 100
    const sharpe = vol > 0 ? (annualizedReturn - 5) / vol : 0

    return { volatility: vol, maxDD: mdd, sharpe }
  }, [navSeries, hasPriceHistory])

  // ── Tooltip formatters ─────────────────────────────────
  const formatDate = (date: string) => {
    try {
      const d = new Date(date + 'T00:00:00')
      if (timeframe === 'ALL' || timeframe === '1Y') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch { return date }
  }

  const timeframeLabel = timeframe === 'ALL' ? 'Since Inception' : timeframe
  const noHoldings = !holdings?.length

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <div className="space-y-2.5">

      {/* ─── HEADER + TIMEFRAME ───────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Performance Analysis</span>
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors ${
                timeframe === tf
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tf === 'ALL' ? 'All' : tf}
            </button>
          ))}
        </div>
      </div>

      {/* ─── KPI STRIP ────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
        {/* Period Return */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">
            {timeframeLabel} Return
          </p>
          <p className={`text-[17px] font-semibold mt-1 tabular-nums leading-none ${clr(periodMetrics.periodReturn)}`}>
            {fmtPct(periodMetrics.periodReturn, { sign: true })}
          </p>
          {!periodMetrics.hasData && (
            <p className="text-[8px] text-gray-400 mt-0.5 italic">Inception-to-date</p>
          )}
        </div>

        {/* Period P&L */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">
            {timeframeLabel} P&L
          </p>
          <p className={`text-[17px] font-semibold mt-1 tabular-nums leading-none ${clr(periodMetrics.periodPnl)}`}>
            {fmtCcy(periodMetrics.periodPnl, { sign: true, compact: true })}
          </p>
          {!periodMetrics.hasData && (
            <p className="text-[8px] text-gray-400 mt-0.5 italic">Inception-to-date</p>
          )}
        </div>

        {/* Benchmark Return — scaffold */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">
            Benchmark
          </p>
          <p className="text-[17px] font-semibold text-gray-300 mt-1 tabular-nums leading-none">&mdash;</p>
          <p className="text-[8px] text-gray-400 mt-0.5">No benchmark linked</p>
        </div>

        {/* Excess Return — scaffold */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">
            Excess Return
          </p>
          <p className="text-[17px] font-semibold text-gray-300 mt-1 tabular-nums leading-none">&mdash;</p>
          <p className="text-[8px] text-gray-400 mt-0.5">Requires benchmark</p>
        </div>
      </div>

      {/* ─── CUMULATIVE RETURN CHART ──────────────────────── */}
      <div className="border border-gray-200 rounded overflow-hidden">
        <div className="px-2.5 py-1 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Cumulative Return — {timeframeLabel}
          </span>
          {hasPriceHistory && (
            <span className="text-[8px] text-gray-400 italic">Static positions · end-of-day</span>
          )}
        </div>

        {chartData.length >= 2 ? (
          <div className="px-2 pt-3 pb-1">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="perfReturnFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor} stopOpacity={0.12} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={v => `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`}
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(value: number) => [fmtPct(value, { sign: true }), 'Return']}
                  labelFormatter={formatDate}
                  contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
                />
                <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" strokeWidth={1} />
                <Area
                  type="monotone"
                  dataKey="return"
                  stroke={chartColor}
                  strokeWidth={1.5}
                  fill="url(#perfReturnFill)"
                  dot={false}
                  activeDot={{ r: 3, fill: chartColor }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-1">
              {noHoldings ? (
                <p className="text-[11px] text-gray-400">No positions to analyze</p>
              ) : (
                <>
                  <p className="text-[11px] text-gray-500">Historical price data not yet available</p>
                  <p className="text-[10px] text-gray-400">
                    Once daily prices are cached, this chart will show cumulative return for the selected period.
                  </p>
                  <div className="pt-2">
                    <p className="text-[10px] text-gray-400">
                      Inception Return: <span className={`font-semibold ${clr(returnPercentage)}`}>
                        {fmtPct(returnPercentage, { sign: true })}
                      </span>
                      {' '}({fmtCcy(totalReturn, { sign: true, compact: true })})
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── ATTRIBUTION ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">

        {/* Period Contributors & Detractors */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-2.5 py-1 bg-gray-50 border-b border-gray-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {timeframeLabel} Attribution
            </span>
          </div>
          {holdingMetrics.length > 0 ? (
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              {/* Contributors */}
              <div className="px-2.5 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 mb-0.5">Contributors</p>
                {contributors.length > 0 && (
                  <div className="flex items-center py-px mb-px">
                    <span className="text-[8px] font-medium text-gray-400 uppercase w-12">Ticker</span>
                    <span className="text-[8px] font-medium text-gray-400 uppercase ml-auto">Contrib</span>
                    <span className="text-[8px] font-medium text-gray-400 uppercase w-16 text-right">P&L</span>
                  </div>
                )}
                {contributors.length > 0 ? contributors.map(h => (
                  <div key={h.symbol} className="flex items-center py-px">
                    <span className="text-[11px] font-semibold text-gray-900 w-12 tabular-nums">{h.symbol}</span>
                    <span className="text-[10px] text-gray-500 tabular-nums ml-auto">
                      {h.contribPct.toFixed(0)}%
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600 tabular-nums w-16 text-right">
                      {fmtCcy(h.contrib, { sign: true, compact: true })}
                    </span>
                  </div>
                )) : (
                  <p className="text-[10px] text-gray-400 py-px">None</p>
                )}
              </div>

              {/* Detractors */}
              <div className="px-2.5 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-red-400 mb-0.5">Detractors</p>
                {detractors.length > 0 && (
                  <div className="flex items-center py-px mb-px">
                    <span className="text-[8px] font-medium text-gray-400 uppercase w-12">Ticker</span>
                    <span className="text-[8px] font-medium text-gray-400 uppercase ml-auto">Contrib</span>
                    <span className="text-[8px] font-medium text-gray-400 uppercase w-16 text-right">P&L</span>
                  </div>
                )}
                {detractors.length > 0 ? detractors.map(h => (
                  <div key={h.symbol} className="flex items-center py-px">
                    <span className="text-[11px] font-semibold text-gray-900 w-12 tabular-nums">{h.symbol}</span>
                    <span className="text-[10px] text-gray-500 tabular-nums ml-auto">
                      {Math.abs(h.contribPct).toFixed(0)}%
                    </span>
                    <span className="text-[10px] font-semibold text-red-500 tabular-nums w-16 text-right">
                      {fmtCcy(h.contrib, { sign: true, compact: true })}
                    </span>
                  </div>
                )) : (
                  <p className="text-[10px] text-gray-400 py-px">None</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-3">
              <p className="text-[10px] text-gray-400">No positions to attribute</p>
            </div>
          )}
          {!periodMetrics.hasData && holdingMetrics.length > 0 && (
            <div className="px-2.5 py-1 border-t border-gray-100">
              <p className="text-[8px] text-gray-400 italic">Inception-to-date · historical attribution requires price data</p>
            </div>
          )}
        </div>

        {/* Sector Attribution */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-2.5 py-1 bg-gray-50 border-b border-gray-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Sector Attribution
            </span>
          </div>
          {sectorAttribution.length > 0 ? (
            <div>
              {sectorAttribution.map(s => (
                <div key={s.sector} className="flex items-center gap-1.5 px-2.5 py-[5px]">
                  <span className="text-[11px] text-gray-700 truncate flex-1 min-w-0">{s.sector}</span>
                  <div className="w-14 h-[3px] bg-gray-100 rounded-full overflow-hidden shrink-0">
                    <div
                      className={`h-full rounded-full ${s.contrib >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(s.weight, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-gray-500 w-10 text-right tabular-nums shrink-0">
                    {s.weight.toFixed(1)}%
                  </span>
                  <span className={`text-[10px] font-semibold w-14 text-right tabular-nums shrink-0 ${clr(s.contrib)}`}>
                    {fmtCcy(s.contrib, { sign: true, compact: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-center text-[10px] text-gray-400">No positions</div>
          )}
        </div>
      </div>

      {/* ─── RISK METRICS ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
        {/* Volatility */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Volatility (ann.)</p>
          {riskMetrics.volatility !== null ? (
            <p className="text-[17px] font-semibold text-gray-900 mt-1 tabular-nums leading-none">
              {riskMetrics.volatility.toFixed(1)}%
            </p>
          ) : (
            <>
              <p className="text-[17px] font-semibold text-gray-300 mt-1 tabular-nums leading-none">&mdash;</p>
              <p className="text-[8px] text-gray-400 mt-0.5">Requires price history</p>
            </>
          )}
        </div>

        {/* Max Drawdown */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Max Drawdown</p>
          {riskMetrics.maxDD !== null ? (
            <p className="text-[17px] font-semibold text-red-600 mt-1 tabular-nums leading-none">
              -{riskMetrics.maxDD.toFixed(1)}%
            </p>
          ) : (
            <>
              <p className="text-[17px] font-semibold text-gray-300 mt-1 tabular-nums leading-none">&mdash;</p>
              <p className="text-[8px] text-gray-400 mt-0.5">Requires price history</p>
            </>
          )}
        </div>

        {/* Sharpe Ratio */}
        <div className="bg-white px-3.5 py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Sharpe Ratio</p>
          {riskMetrics.sharpe !== null ? (
            <p className={`text-[17px] font-semibold mt-1 tabular-nums leading-none ${clr(riskMetrics.sharpe)}`}>
              {riskMetrics.sharpe.toFixed(2)}
            </p>
          ) : (
            <>
              <p className="text-[17px] font-semibold text-gray-300 mt-1 tabular-nums leading-none">&mdash;</p>
              <p className="text-[8px] text-gray-400 mt-0.5">Requires price history</p>
            </>
          )}
        </div>
      </div>

    </div>
  )
}
