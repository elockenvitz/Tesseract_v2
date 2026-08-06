import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Area,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { usePriceTargetChart } from '../../../hooks/usePriceTargetChart'

interface MobilePriceTargetChartProps {
  assetId: string
  symbol: string
}

const TIMEFRAMES = ['3M', '6M', '1Y', '2Y'] as const
type Timeframe = (typeof TIMEFRAMES)[number]

/** Scenario ordering, as the case is argued rather than alphabetical. */
const ORDER = ['Bull', 'Base', 'Bear']

/**
 * Real price history with the case's targets drawn across it.
 *
 * Prices come from usePriceTargetChart, the same hook the desktop chart uses,
 * which fetches actual candles from Yahoo. That matters: the feed's chart
 * panel builds its series with ChartDataAdapter.generateHistoricalData, a
 * seeded random walk anchored to the current quote. Plotting real price
 * targets over invented prices would show a picture of analysis that never
 * happened.
 *
 * Targets collapse to one line per scenario — the average across analysts —
 * rather than a line each. A phone-width chart with a dozen labelled lines is
 * unreadable, and what the reader needs here is where the three cases sit
 * relative to the price, not who set which.
 */
export function MobilePriceTargetChart({ assetId, symbol }: MobilePriceTargetChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y')

  const { historicalPrices, priceTargets, currentPrice, priceChangePercent, loading, error } =
    usePriceTargetChart({ assetId, symbol, timeframe: timeframe as any })

  const series = useMemo(
    () =>
      (historicalPrices ?? []).map(d => ({
        t: new Date(d.time).getTime(),
        price: d.close,
      })),
    [historicalPrices]
  )

  // One line per scenario. Several analysts can hold a view on the same
  // scenario, and drawing each would crowd the plot without adding meaning at
  // this size.
  const scenarioLines = useMemo(() => {
    const groups = new Map<string, { name: string; color: string; prices: number[] }>()
    for (const t of priceTargets ?? []) {
      if (t.status === 'cancelled' || !Number.isFinite(t.price)) continue
      const key = t.scenarioName || 'Target'
      if (!groups.has(key)) {
        groups.set(key, { name: key, color: t.scenarioColor || '#6b7280', prices: [] })
      }
      groups.get(key)!.prices.push(t.price)
    }
    return [...groups.values()]
      .map(g => ({
        name: g.name,
        color: g.color,
        price: g.prices.reduce((sum, p) => sum + p, 0) / g.prices.length,
        count: g.prices.length,
      }))
      .sort((a, b) => {
        const ai = ORDER.indexOf(a.name)
        const bi = ORDER.indexOf(b.name)
        if (ai === -1 && bi === -1) return b.price - a.price
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
  }, [priceTargets])

  // The axis must cover both the price history and every target, or a target
  // above the range would be silently clipped off the top of the chart.
  const domain = useMemo(() => {
    const values = series.map(p => p.price).filter(Number.isFinite)
    for (const line of scenarioLines) values.push(line.price)
    if (!values.length) return null
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo) * 0.08 || Math.max(hi * 0.05, 1)
    return [lo - pad, hi + pad] as [number, number]
  }, [series, scenarioLines])

  if (loading) {
    return <div className="h-56 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  // No fabricated fallback: an empty series means the price feed failed, and
  // an invented line under real targets would be worse than no chart.
  if (error || !series.length) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
        <p className="text-sm text-gray-400">Price history unavailable for {symbol}.</p>
      </div>
    )
  }

  const up = (priceChangePercent ?? 0) >= 0
  const lineColor = up ? '#10b981' : '#ef4444'

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-baseline gap-2 px-3 pt-2.5">
        <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
          ${currentPrice?.toFixed(2)}
        </span>
        <span
          className={clsx(
            'text-xs font-semibold tabular-nums',
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          )}
        >
          {up ? '+' : ''}
          {priceChangePercent?.toFixed(2)}%
        </span>
        <span className="ml-auto text-[11px] text-gray-400">{timeframe}</span>
      </div>

      <div className="h-48 px-1 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 4, right: 44, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`mptc-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
            {/* Y axis hidden, as on the feed charts: the values that matter are
                labelled directly on the target lines. */}
            <YAxis domain={domain ?? ['dataMin', 'dataMax']} hide />

            <Area
              type="monotone"
              dataKey="price"
              stroke={lineColor}
              strokeWidth={1.75}
              fill={`url(#mptc-${symbol})`}
              isAnimationActive={false}
              dot={false}
            />

            {scenarioLines.map(line => (
              <ReferenceLine
                key={line.name}
                y={line.price}
                stroke={line.color}
                strokeDasharray="4 3"
                strokeWidth={1.25}
                label={{
                  value: `$${line.price.toFixed(0)}`,
                  position: 'right',
                  fill: line.color,
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between gap-0.5 px-2 py-1 border-t border-gray-100 dark:border-gray-800">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={clsx(
              'flex-1 py-1 rounded text-[11px] font-medium transition-colors no-touch-target',
              tf === timeframe
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                : 'text-gray-500 dark:text-gray-400'
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      {scenarioLines.length > 0 && (
        <ul className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
          {scenarioLines.map(line => {
            const upside =
              currentPrice > 0 ? ((line.price - currentPrice) / currentPrice) * 100 : null
            return (
              <li key={line.name} className="flex items-baseline gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: line.color }}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-gray-900 dark:text-white w-12 shrink-0">
                  {line.name}
                </span>
                <span className="text-sm tabular-nums text-gray-700 dark:text-gray-200">
                  ${line.price.toFixed(2)}
                </span>
                {line.count > 1 && (
                  <span className="text-[10px] text-gray-400">avg of {line.count}</span>
                )}
                {upside != null && (
                  <span
                    className={clsx(
                      'ml-auto text-xs font-semibold tabular-nums',
                      upside >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {upside >= 0 ? '+' : ''}
                    {upside.toFixed(0)}%
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
