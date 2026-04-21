import React, { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, BarChart3, AlertCircle } from 'lucide-react'
import {
  useThemeIndex,
  type ThemeIndexLookback,
  type ThemeIndexMeasure,
} from '../../hooks/useThemeIndex'

interface ThemeIndexChartProps {
  symbols: string[]
  themeName?: string
}

const LOOKBACKS: { value: ThemeIndexLookback; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: '2Y', label: '2Y' },
  { value: '5Y', label: '5Y' },
]

const MEASURES: { value: ThemeIndexMeasure; label: string; hint: string }[] = [
  { value: 'level',    label: 'Price Level',       hint: 'Index normalized to 100 at start' },
  { value: 'return',   label: 'Cumulative Return', hint: '% change from start' },
  { value: 'relative', label: 'Relative Strength', hint: 'Index ÷ benchmark × 100' },
]

const BENCHMARKS: { value: string; label: string }[] = [
  { value: '^GSPC', label: 'S&P 500' },
  { value: '^IXIC', label: 'Nasdaq' },
  { value: '^RUT',  label: 'Russell 2000' },
  { value: '^DJI',  label: 'Dow Jones' },
]

function formatAxis(value: number, measure: ThemeIndexMeasure): string {
  if (measure === 'return') return `${value.toFixed(0)}%`
  return value.toFixed(0)
}

function formatTooltip(value: number, measure: ThemeIndexMeasure): string {
  if (measure === 'return') return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  return value.toFixed(2)
}

export function ThemeIndexChart({ symbols, themeName }: ThemeIndexChartProps) {
  const [lookback, setLookback] = useState<ThemeIndexLookback>('1Y')
  const [measure, setMeasure] = useState<ThemeIndexMeasure>('level')
  const [benchmark, setBenchmark] = useState<string>('^GSPC')

  const enabled = symbols.length > 0
  const {
    data,
    stats,
    isLoading,
    isError,
    successfulConstituents,
    requestedConstituents,
    benchmarkAvailable,
  } = useThemeIndex({
    symbols,
    benchmark,
    lookback,
    measure,
    enabled,
  })

  const missingConstituents = Math.max(0, requestedConstituents - successfulConstituents)
  const hasPartialWarning = !isLoading && data.length > 0 && (missingConstituents > 0 || !benchmarkAvailable)

  const benchmarkLabel = BENCHMARKS.find(b => b.value === benchmark)?.label || benchmark

  const indexColor = useMemo(() => (stats.indexReturn >= stats.benchmarkReturn ? '#10b981' : '#ef4444'), [stats])

  // In relative-strength mode, the benchmark is flat at 100; collapse its line.
  const showBenchmarkLine = measure !== 'relative'
  const referenceLineY = measure === 'return' ? 0 : 100

  if (!enabled) {
    return (
      <div className="bg-gray-50 rounded-lg p-12 text-center">
        <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-3" />
        <h3 className="text-base font-medium text-gray-900 mb-1">No related assets</h3>
        <p className="text-sm text-gray-500">Add assets to this theme to see its index.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Lookback pill group */}
          <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
            {LOOKBACKS.map(lb => (
              <button
                key={lb.value}
                onClick={() => setLookback(lb.value)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                  lookback === lb.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                )}
              >
                {lb.label}
              </button>
            ))}
          </div>

          {/* Measure selector */}
          <select
            value={measure}
            onChange={(e) => setMeasure(e.target.value as ThemeIndexMeasure)}
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
            title={MEASURES.find(m => m.value === measure)?.hint}
          >
            {MEASURES.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          {/* Benchmark selector */}
          <select
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value)}
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            {BENCHMARKS.map(b => (
              <option key={b.value} value={b.value}>vs {b.label}</option>
            ))}
          </select>
        </div>

        {/* Summary stats */}
        {data.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Index:</span>
              <span className={clsx('font-semibold tabular-nums', stats.indexReturn >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {stats.indexReturn >= 0 ? '+' : ''}{stats.indexReturn.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">{benchmarkLabel}:</span>
              <span className={clsx('font-semibold tabular-nums', stats.benchmarkReturn >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {stats.benchmarkReturn >= 0 ? '+' : ''}{stats.benchmarkReturn.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Excess:</span>
              <span className={clsx('font-semibold tabular-nums', stats.excessReturn >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {stats.excessReturn >= 0 ? '+' : ''}{stats.excessReturn.toFixed(2)}%
                {stats.excessReturn >= 0 ? <TrendingUp className="inline w-3 h-3 ml-0.5" /> : <TrendingDown className="inline w-3 h-3 ml-0.5" />}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Partial-fetch warning */}
      {hasPartialWarning && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>
            {missingConstituents > 0 && (
              <>Price data unavailable for {missingConstituents} of {requestedConstituents} constituent{requestedConstituents === 1 ? '' : 's'}. Index shown uses {successfulConstituents} symbol{successfulConstituents === 1 ? '' : 's'}.</>
            )}
            {missingConstituents > 0 && !benchmarkAvailable && <> </>}
            {!benchmarkAvailable && <>Benchmark data unavailable; excess-return comparison disabled.</>}
          </span>
        </div>
      )}

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        {isLoading ? (
          <div className="h-[360px] flex items-center justify-center">
            <div className="text-sm text-gray-500">Loading chart…</div>
          </div>
        ) : isError || data.length === 0 ? (
          <div className="h-[360px] flex flex-col items-center justify-center text-center">
            <AlertCircle className="h-8 w-8 text-gray-400 mb-2" />
            <p className="text-sm text-gray-700 font-medium">No price data available</p>
            <p className="text-xs text-gray-500 mt-1">
              Could not fetch historical prices for {themeName ? `"${themeName}" constituents` : 'these symbols'}.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(d: string) => d.slice(5)}
                minTickGap={32}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => formatAxis(v, measure)}
                domain={['auto', 'auto']}
                width={52}
              />
              <Tooltip
                formatter={(v: number, name: string) => [formatTooltip(v, measure), name]}
                labelClassName="font-medium"
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={referenceLineY} stroke="#d1d5db" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="indexValue"
                name={themeName ? `${themeName} (EW index)` : 'Theme index'}
                stroke={indexColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {showBenchmarkLine && (
                <Line
                  type="monotone"
                  dataKey="benchmarkValue"
                  name={benchmarkLabel}
                  stroke="#6b7280"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-500">
        Equal-weighted index of {symbols.length} asset{symbols.length === 1 ? '' : 's'}, rebased to 100 at start of window. Daily closes via Yahoo Finance.
      </p>
    </div>
  )
}
