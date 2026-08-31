import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { useSymbolHistory } from '../../../hooks/mobile/useSymbolHistory'
import { canChart, priceIdentity } from '../../../lib/signals/price-availability'
import { PricePane } from '../../signals/PricePane'
import type { PriceBand, PricePoint, RangeKey } from '../../signals/PriceContext'
import type { PairLegRow } from '../../../lib/signals/pair-shape'
import { legSide, survivingLegs } from '../../../lib/signals/pair-shape'

/**
 * Market context for ONE leg at a time, on the product's own price chart.
 *
 * ── The correction this file records ──────────────────────────────────────
 *
 * The previous version drew a bespoke sparkline block. It was chosen to avoid
 * `PriceContext` owning its horizon internally — and that is the tail wagging
 * the dog: it traded the accepted chart, its axes, its window controls, its
 * scrub and its expand for a small line, in order to dodge adding one optional
 * prop to a shared component. A price chart in this product should look and
 * behave the same wherever it appears.
 *
 * So the pane is now a Pair-specific SELECTOR above the ordinary
 * `PricePane` — the same component the Case vs Price pane renders, through the
 * same `useSymbolHistory` fetch and the same `PriceContext`. The only
 * pair-specific interaction is choosing which leg the chart is about.
 *
 * ── Division of labour ────────────────────────────────────────────────────
 *
 * The selector owns which leg. `PriceContext` owns everything about the chart:
 * the window and its controls, the geometry, the axes, the read-out, the
 * scrub, and the handoff to the fullscreen view. Nothing here reimplements any
 * of it.
 *
 * ── Still not a pair chart ────────────────────────────────────────────────
 *
 * One leg's own prices. Never overlaid, never normalised, never differenced —
 * any of those would begin to state a relative return, which stays deferred
 * while coverage is incomplete and weights are undefined. A return shown here
 * belongs to the selected symbol over the selected window, which is exactly
 * what `PriceContext` already says it is.
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

/**
 * A selector chip that also reports whether its leg has anything to draw.
 *
 * The default should land on a leg with a chart, and only a fetch can know
 * which legs have one. The chip is mounted per leg and renders text, so it is
 * the cheapest place to ask — it multiplies a cached query, never the chart.
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

export function PairLegsPane({
  legs, factsFor, onExpandLeg, tradedSymbolOf,
}: PairLegsPaneProps) {
  /**
   * The window, remembered across leg switches.
   *
   * `PriceContext` owns its own range and renders its own chips — this is not
   * a second horizon control. The pane remounts the chart when the symbol
   * changes, so without somewhere to keep the window every switch would reset
   * to the default. It is handed back in through `initialRange` and updated
   * from `onRangeChange`; the reader still changes it on the chart's own chips.
   *
   * Null means "never chosen", which lets `PriceContext` apply its own default
   * rather than this pane asserting one.
   */
  const [range, setRange] = useState<RangeKey | null>(null)
  /** Explicit choice. Null means "still on the default leg". */
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
   * one tap away. Before availability is known, and when no leg has a tape, it
   * is simply the first surviving leg.
   */
  const defaultSymbol = useMemo(() => {
    const sym = (l: PairLegRow) => (l.symbol ?? '').toUpperCase()
    return ordered.find(l => available[sym(l)])?.symbol?.toUpperCase()
      ?? (ordered[0] ? sym(ordered[0]) : null)
  }, [ordered, available])

  const activeSymbol = picked ?? defaultSymbol
  const activeLeg = ordered.find(l => (l.symbol ?? '').toUpperCase() === activeSymbol) ?? ordered[0]

  if (surviving.length === 0) {
    return (
      <div className="flex h-full min-h-[92px] items-center" data-slot="pair-legs-empty">
        <p className="text-[13px] text-gray-500 dark:text-gray-400">No legs remain on this pair.</p>
      </div>
    )
  }

  const rawActive = (activeLeg?.symbol ?? '').toUpperCase()
  const tradedActive = tradedSymbolOf?.(rawActive) ?? rawActive
  const side = activeLeg ? legSide(activeLeg) : 'unknown'
  const facts = activeLeg ? factsFor?.(activeLeg) ?? {} : {}
  const charted = available[rawActive] === true

  /**
   * The author's target, drawn on the chart through the API it already has.
   *
   * `PriceContext` knows how to place a level that sits outside the price
   * action without flattening the line — so the target rides as a band rather
   * than becoming a pair-specific overlay.
   */
  const bands: PriceBand[] = facts.targetPrice != null
    ? [{ label: 'Target', price: facts.targetPrice, kind: 'target' }]
    : []

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="pair-legs">
      {/* The selector. Grouped by side so direction stays legible while
          choosing, horizontally scrollable so a ten-leg basket does not grow
          the pane, and no leg is ever dropped from it. */}
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

      {/* Which leg the chart below is about, plus the facts the chart cannot
          know. The price is shown only where there is NO chart — `PriceContext`
          carries its own read-out, and printing it twice would be the
          duplication this card has already been through once. */}
      <div className="mt-1.5 flex shrink-0 items-baseline gap-2" data-active-leg={rawActive} data-leg-charted={charted}>
        <span className="text-[14px] font-bold text-gray-900 dark:text-white">{rawActive || '—'}</span>
        <span className={clsx('text-[10px] font-bold uppercase tracking-wide', SIDE_TONE[side])}>
          {side === 'unknown' ? String(activeLeg?.action ?? '') : side}
        </span>
        {!charted && facts.currentPrice != null && (
          <span className="text-[13px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
            {money(facts.currentPrice)}
          </span>
        )}
        {facts.targetPrice != null && (
          <span className="text-[12px] tabular-nums text-gray-400">tgt {money(facts.targetPrice)}</span>
        )}
      </div>

      {/*
        The ordinary price chart — the same `PricePane` the Case vs Price pane
        renders, with the same fetch, the same `PriceContext`, the same window
        controls and the same expand. It also owns the honest empty state for a
        leg with nothing cached, so this pane does not need one of its own.

        Keyed by symbol so switching legs replaces the chart rather than
        mutating one in place; the window survives that remount because it is
        held here and handed back through `initialRange`.
      */}
      <div className="mt-1 min-h-0 flex-1">
        {rawActive && (
          <PricePane
            key={tradedActive}
            symbol={tradedActive}
            bands={bands}
            initialRange={range}
            onRangeChange={setRange}
            onExpand={onExpandLeg ? (series, r) => onExpandLeg(tradedActive, series, r) : undefined}
          />
        )}
      </div>
    </div>
  )
}
