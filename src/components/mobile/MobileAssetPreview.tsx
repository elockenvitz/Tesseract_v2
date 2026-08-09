import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Area, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, X } from 'lucide-react'
import { usePriceTargetChart } from '../../hooks/usePriceTargetChart'

const TIMEFRAMES = ['1M', '3M', '6M', '1Y', '2Y', '5Y'] as const
type Timeframe = (typeof TIMEFRAMES)[number]

interface MobileAssetPreviewProps {
  asset: { id: string; symbol: string; company_name?: string | null; sector?: string | null; industry?: string | null; country?: string | null; exchange?: string | null }
  onClose: () => void
  onOpenAssetPage: () => void
}

/**
 * A full-screen look at one name, before committing to its page.
 *
 * Opening the asset page replaces the list — a tab switch, a full research
 * surface, and the scroll position you had gone. Most taps from a watchlist are
 * not that; they are "what is this doing", answered by a chart and a few facts.
 * This sits between the two: the name gets the whole screen, and going further
 * stays one deliberate tap away.
 *
 * The series comes from usePriceTargetChart, the same hook the asset page's
 * chart uses, which fetches real candles. That matters here specifically: the
 * lighter-weight chart components in this codebase build their series with
 * ChartDataAdapter.generateHistoricalData, a seeded random walk anchored to the
 * current quote, and a drawn line beside a real price reads as real.
 */
export function MobileAssetPreview({ asset, onClose, onOpenAssetPage }: MobileAssetPreviewProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y')

  const { historicalPrices, currentPrice, priceChangePercent, loading, error } =
    usePriceTargetChart({ assetId: asset.id, symbol: asset.symbol, timeframe: timeframe as any })

  const series = useMemo(
    () => (historicalPrices ?? []).map(d => ({ t: new Date(d.time).getTime(), price: d.close })),
    [historicalPrices]
  )

  const domain = useMemo(() => {
    const values = series.map(p => p.price).filter(Number.isFinite)
    if (!values.length) return null
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo) * 0.08 || Math.max(hi * 0.05, 1)
    return [lo - pad, hi + pad] as [number, number]
  }, [series])

  const up = (priceChangePercent ?? 0) >= 0
  const lineColor = up ? '#10b981' : '#ef4444'

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-white dark:bg-gray-900">
      <div className="flex-shrink-0 flex items-start gap-2 px-4 h-16 pt-safe border-b border-gray-100 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold leading-tight text-gray-900 dark:text-white">{asset.symbol}</h2>
          <p className="truncate text-[12px] text-gray-500 dark:text-gray-400">{asset.company_name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 no-touch-target"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 pt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-white">
              {currentPrice != null ? currentPrice.toFixed(2) : '—'}
            </span>
            {priceChangePercent != null && (
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-md text-[13px] font-semibold tabular-nums text-white',
                  up ? 'bg-emerald-500' : 'bg-red-500'
                )}
              >
                {up ? '+' : ''}
                {priceChangePercent.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        <div className="h-56 px-1 pt-3">
          {loading ? (
            <div className="mx-3 h-full rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : error || !series.length ? (
            <div className="mx-3 h-full flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-400">Price history unavailable.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`map-${asset.symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v: number) => formatTick(v, timeframe)}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis domain={domain ?? ['dataMin', 'dataMax']} hide />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, padding: '4px 8px' }}
                  labelFormatter={(t: number) => new Date(t).toLocaleDateString()}
                  formatter={(v: number) => ['$' + v.toFixed(2), 'Price']}
                  cursor={{ stroke: '#9ca3af', strokeDasharray: '3 3' }}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={lineColor}
                  strokeWidth={1.75}
                  fill={`url(#map-${asset.symbol})`}
                  isAnimationActive={false}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex items-center gap-1 px-3 py-2">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              aria-pressed={tf === timeframe}
              className={clsx(
                'flex-1 h-8 rounded-lg text-xs font-semibold transition-colors no-touch-target',
                tf === timeframe
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
              )}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Only what the list row already carries. Coverage, targets and the
            case need the asset page, which is one tap below. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <Fact label="Sector" value={asset.sector} />
          <Fact label="Industry" value={asset.industry} />
          <Fact label="Country" value={asset.country} />
          <Fact label="Exchange" value={asset.exchange} />
        </dl>
      </div>

      <div className="flex-shrink-0 px-4 py-3 pb-safe border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onOpenAssetPage}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 text-white text-sm font-semibold no-touch-target"
        >
          Open {asset.symbol}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body
  )
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-gray-900 dark:text-gray-100">{value || '—'}</dd>
    </div>
  )
}

/** Tick labels sized to the span, so a year of candles does not overlap. */
function formatTick(value: number, timeframe: Timeframe): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  if (timeframe === '1M' || timeframe === '3M') {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }
  if (timeframe === '2Y' || timeframe === '5Y') {
    return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short' })
  }
  return d.toLocaleDateString(undefined, { month: 'short' })
}
