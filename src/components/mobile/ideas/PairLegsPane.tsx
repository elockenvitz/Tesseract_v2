import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Maximize2 } from 'lucide-react'
import { useSymbolHistory } from '../../../hooks/mobile/useSymbolHistory'
import { canChart, priceIdentity } from '../../../lib/signals/price-availability'
import { Sparkline } from '../../signals/Sparkline'
import { PRICE_RANGES, type PricePoint, type RangeKey } from '../../signals/PriceContext'
import type { PairLegRow } from '../../../lib/signals/pair-shape'
import { legSide, survivingLegs } from '../../../lib/signals/pair-shape'

/**
 * Market context for ONE leg at a time.
 *
 * ── Why one chart and not four ────────────────────────────────────────────
 *
 * The first version drew every covered leg at once, which turned an Idea card
 * into a monitoring dashboard: four series competing for attention, each too
 * small to read, on the surface whose whole premise is one object per screen.
 * Density was the defect, not the data.
 *
 * So the pane inspects. A selector names every surviving leg, and the chart
 * area belongs to whichever one is selected. Switching is a tap, and the
 * window does not move with it — which is what makes the comparison possible
 * without ever computing one.
 *
 * ── What is still not drawn ───────────────────────────────────────────────
 *
 * The legs are never overlaid. Raw prices across different securities share no
 * scale, and normalising them to 100 would begin to state a relative return —
 * the pair-level claim that stays deferred while coverage is incomplete and
 * weights are undefined. One selected asset, its own real prices.
 *
 * ── Why not `PriceContext` for the inline chart ───────────────────────────
 *
 * It owns its horizon internally and renders its own chip row. Mounting one
 * per leg would reset the window on every switch — exactly what this pane must
 * not do — and give each leg its own chips. The horizon therefore lives here,
 * over the shared `PRICE_RANGES`, and the expanded view is the shared
 * `FullscreenChart`, which is where the full instrument belongs.
 */

interface PairLegsPaneProps {
  legs: readonly PairLegRow[]
  /** Facts straight off the leg rows. Nothing derived. */
  factsFor?: (leg: PairLegRow) => { currentPrice?: number | null; targetPrice?: number | null }
  /** Opens the shared fullscreen chart for the selected leg. */
  onExpandLeg?: (symbol: string, series: PricePoint[], range: RangeKey | null) => void
  /** Resolves a display ticker to what the cache stores it under. */
  tradedSymbolOf?: (symbol: string) => string
}

const SIDE_TONE = {
  long: 'text-emerald-600 dark:text-emerald-400',
  short: 'text-rose-600 dark:text-rose-400',
  unknown: 'text-gray-500 dark:text-gray-400',
} as const

function money(n: number): string {
  return n >= 1000 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

/** Points inside the requested window, measured from the series' own end. */
function slice(series: PricePoint[], range: RangeKey | null): PricePoint[] {
  const spec = PRICE_RANGES.find(r => r.key === range)
  if (!spec || spec.days == null) return series
  const end = new Date(series[series.length - 1].date).getTime()
  const cut = end - spec.days * 86_400_000
  const out = series.filter(p => new Date(p.date).getTime() >= cut)
  // Below two points there is no line; the full series says more than a stub.
  return out.length >= 2 ? out : series
}

/**
 * A selector chip that also reports whether its leg has anything to draw.
 *
 * ── Why the chip does the asking ──────────────────────────────────────────
 *
 * The default should land on a leg with a chart, and only a fetch can know
 * which legs have one. The chip is already mounted per leg and renders text,
 * so it is the cheapest place to ask — it multiplies a cached 260-row query,
 * never the chart rendering, which is the cost the density rule is about.
 *
 * The same report-upward pattern the single-name price pane uses.
 */
function LegChip({
  leg, active, onSelect, onAvailability, tradedSymbolOf,
}: {
  leg: PairLegRow
  active: boolean
  onSelect: () => void
  onAvailability: (symbol: string, has: boolean) => void
  tradedSymbolOf?: (s: string) => string
}) {
  const raw = (leg.symbol ?? '').toUpperCase()
  const traded = tradedSymbolOf?.(raw) ?? raw
  const { data, isLoading } = useSymbolHistory(traded)
  const has = !isLoading && canChart(priceIdentity(traded, () => data))

  useEffect(() => {
    if (!isLoading) onAvailability(raw, has)
  }, [isLoading, has, raw, onAvailability])

  return (
    <button
      type="button"
      data-leg-chip={raw}
      aria-pressed={active}
      onClick={onSelect}
      className={clsx(
        'shrink-0 rounded-lg border px-2.5 py-1 text-[13px] font-bold no-touch-target',
        active
          ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
          : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
      )}
    >
      {raw || '—'}
    </button>
  )
}

/** The selected leg: its facts, and its tape where there is one. */
function ActiveLeg({
  leg, range, factsFor, onExpandLeg, tradedSymbolOf, rangeRow,
}: {
  leg: PairLegRow
  range: RangeKey | null
  factsFor?: PairLegsPaneProps['factsFor']
  onExpandLeg?: PairLegsPaneProps['onExpandLeg']
  tradedSymbolOf?: (s: string) => string
  /** The pane's horizon row, injected — the window belongs to the pane, not
   *  to whichever leg happens to be selected. */
  rangeRow: React.ReactNode
}) {
  const raw = (leg.symbol ?? '').toUpperCase()
  const traded = tradedSymbolOf?.(raw) ?? raw
  const { data, isLoading } = useSymbolHistory(traded)
  const id = priceIdentity(traded, () => data)
  const side = legSide(leg)
  const facts = factsFor?.(leg) ?? {}

  const drawable = !isLoading && canChart(id)
  const windowed = drawable ? slice(id.series, range) : []
  const last = windowed.length ? windowed[windowed.length - 1].close : null
  // A dated close outranks `assets.current_price`, which carries no timestamp.
  const price = last ?? facts.currentPrice ?? null
  const target = facts.targetPrice ?? null
  const toTarget = price != null && target != null && price > 0
    ? ((target - price) / price) * 100
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-active-leg={raw} data-leg-charted={drawable}>
      <div className="flex items-baseline gap-2">
        <span className="text-[17px] font-bold text-gray-900 dark:text-white">{raw || '—'}</span>
        <span className={clsx('text-[10px] font-bold uppercase tracking-wide', SIDE_TONE[side])}>
          {side === 'unknown' ? String(leg.action ?? '') : side}
        </span>
      </div>

      <div className="mt-0.5 flex items-baseline gap-2 text-[13px] tabular-nums text-gray-600 dark:text-gray-300">
        {price != null && <span className="font-semibold">{money(price)}</span>}
        {target != null && <span className="text-gray-400">tgt {money(target)}</span>}
        {toTarget != null && (
          <span className="text-[11px] text-gray-400">
            {toTarget >= 0 ? '+' : '−'}{Math.abs(toTarget).toFixed(0)}% to target
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="mt-2 h-16 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true" />
      ) : drawable ? (
        <div className="mt-2 h-16 w-full">
          <Sparkline points={windowed.map(p => p.close)} />
        </div>
      ) : (
        /**
         * No box, no skeleton, no flat line. The facts above still stand and
         * the reader can select another leg immediately.
         */
        <p className="mt-2 text-[12px] leading-snug text-gray-400" data-leg-no-history>
          Price history unavailable
        </p>
      )}

      {/* The window, and the way out to the full instrument. Rendered under the
          chart because that is where `PriceContext` puts its own, so the two
          surfaces read the same way. */}
      <div className="mt-1.5 flex items-center gap-0.5" data-testid="pair-leg-ranges">
        {rangeRow}
        <span className="ml-auto">
          {drawable && onExpandLeg && (
            <button
              type="button"
              data-leg-expand={raw}
              aria-label={`Expand ${raw} chart`}
              onClick={() => onExpandLeg(traded, id.series, range)}
              className="rounded p-1 text-gray-400 no-touch-target"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

export function PairLegsPane({
  legs, factsFor, onExpandLeg, tradedSymbolOf,
}: PairLegsPaneProps) {
  /**
   * ONE horizon for the pane, and it does not move when the leg does.
   *
   * Selecting 3M and tapping through LLY, PFE and back leaves every one of
   * them on 3M. That is what makes switching comparative without the pane ever
   * computing a comparison — the reader does it, on a constant window.
   *
   * `6M` is `PriceContext`'s own default, so a leg looks here as it does
   * everywhere else.
   */
  const [range, setRange] = useState<RangeKey | null>('6M')
  /** Explicit choice. Null means "still on the default". */
  const [picked, setPicked] = useState<string | null>(null)
  const [available, setAvailable] = useState<Record<string, boolean>>({})

  const noteAvailability = useMemo(
    () => (symbol: string, has: boolean) =>
      setAvailable(prev => (prev[symbol] === has ? prev : { ...prev, [symbol]: has })),
    [],
  )

  const surviving = survivingLegs(legs)
  const longs = surviving.filter(l => legSide(l) === 'long')
  const shorts = surviving.filter(l => legSide(l) !== 'long')
  /** Deterministic inspection order: long side first, then everything else. */
  const ordered = [...longs, ...shorts]

  /**
   * The default leg — an initial inspection state, never a claim of importance.
   *
   * The first leg in the fixed order that has something to draw, so opening the
   * pane does not land on "Price history unavailable" while a real chart sits
   * one tap away. Before any availability is known, and when no leg has a tape,
   * it is simply the first surviving leg.
   */
  const defaultSymbol = useMemo(() => {
    const sym = (l: PairLegRow) => (l.symbol ?? '').toUpperCase()
    return ordered.find(l => available[sym(l)])?.symbol?.toUpperCase()
      ?? sym(ordered[0] ?? {} as PairLegRow)
      ?? null
  }, [ordered, available])

  const activeSymbol = picked ?? defaultSymbol
  const activeLeg = ordered.find(l => (l.symbol ?? '').toUpperCase() === activeSymbol) ?? ordered[0]

  /**
   * The horizon row, built here and injected.
   *
   * It reads and writes this component's state, so it is built where that
   * state lives. An earlier attempt hoisted it to a module-scope binding
   * reassigned during render — which would have leaked one card's window into
   * another's the moment two pairs were mounted at once.
   */
  const rangeRow = PRICE_RANGES.map(r => (
    <button
      key={r.key}
      type="button"
      data-leg-range={r.key}
      aria-pressed={range === r.key}
      onClick={() => setRange(r.key)}
      className={clsx(
        'rounded px-1.5 py-0.5 text-[10px] font-bold no-touch-target',
        range === r.key
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
          : 'text-gray-400',
      )}
    >
      {r.key}
    </button>
  ))

  if (surviving.length === 0) {
    return (
      <div className="flex h-full min-h-[92px] items-center" data-slot="pair-legs-empty">
        <p className="text-[13px] text-gray-500 dark:text-gray-400">No legs remain on this pair.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="pair-legs">
      {/* The selector. Grouped by side so direction stays legible while
          choosing, and horizontally scrollable so a ten-leg basket does not
          grow the pane — no leg is ever dropped from it. */}
      <div className="shrink-0 space-y-1">
        {[{ label: 'Long', rows: longs }, { label: 'Short', rows: shorts }]
          .filter(g => g.rows.length > 0)
          .map(group => (
            <div key={group.label} className="flex items-center gap-1.5">
              <span className="w-9 shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] text-gray-400">
                {group.label}
              </span>
              <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                {group.rows.map((l, i) => (
                  <LegChip
                    key={l.id ?? `${l.symbol}-${i}`}
                    leg={l}
                    active={(l.symbol ?? '').toUpperCase() === activeSymbol}
                    onSelect={() => setPicked((l.symbol ?? '').toUpperCase())}
                    onAvailability={noteAvailability}
                    tradedSymbolOf={tradedSymbolOf}
                  />
                ))}
              </div>
            </div>
          ))}
      </div>

      {/* One market-context area, belonging to whichever leg is selected.
          Keyed by symbol so switching replaces the chart rather than mutating
          one in place. */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {activeLeg && (
          <ActiveLeg
            key={(activeLeg.symbol ?? '').toUpperCase()}
            leg={activeLeg}
            range={range}
            factsFor={factsFor}
            onExpandLeg={onExpandLeg}
            tradedSymbolOf={tradedSymbolOf}
            rangeRow={rangeRow}
          />
        )}
      </div>
    </div>
  )
}
