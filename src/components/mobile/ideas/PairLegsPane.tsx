import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Check } from 'lucide-react'
import { BottomSheet } from '../BottomSheet'
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
 * Asks whether one leg has a tape, and renders nothing.
 *
 * ── Why a component that draws nothing ────────────────────────────────────
 *
 * Two things need the answer: the default selection, which should land on a
 * leg that has a chart rather than on "Price history unavailable" with a real
 * one a tap away; and the chooser, which marks the legs that have none.
 *
 * Only a fetch can answer it, and a fetch is a hook, so it needs a component.
 * It used to be the selector chip — but the chips are gone, and the answer is
 * still needed. This is the residue: one cached query per leg, no markup, and
 * no chart work multiplied.
 */
function LegProbe({
  leg, onAvailability, tradedSymbolOf,
}: {
  leg: PairLegRow
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

  return null
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
  const [choosing, setChoosing] = useState(false)
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
      {/*
        ONE compact control, not a permanent grid of every symbol.

        The selector used to be two labelled rows of chips, which cost roughly
        a third of the fixed evidence band and squeezed the chart it exists to
        support. The chart is the evidence on this pane; the selector is
        navigation, and navigation collapses.

        The active ticker IS the affordance — tapping it opens the chooser —
        so the row states the current subject and offers the way to change it
        in the same space.
      */}
      {/* Availability, asked once per leg and drawn nowhere. */}
      {ordered.map((l, i) => (
        <LegProbe
          key={`probe-${l.id ?? `${l.symbol}-${i}`}`}
          leg={l}
          onAvailability={noteAvailability}
          tradedSymbolOf={tradedSymbolOf}
        />
      ))}

      <button
        type="button"
        data-leg-selector
        data-active-leg={rawActive}
        data-leg-charted={charted}
        aria-haspopup="dialog"
        onClick={() => setChoosing(true)}
        className="flex shrink-0 items-baseline gap-2 self-start rounded-lg py-0.5 text-left no-touch-target"
      >
        <span className="text-[15px] font-bold text-gray-900 dark:text-white">{rawActive || '—'}</span>
        <span className={clsx('text-[10px] font-bold uppercase tracking-wide', SIDE_TONE[side])}>
          {side === 'unknown' ? String(activeLeg?.action ?? '') : side}
        </span>
        {/* The stored price only where there is no chart — `PriceContext`
            carries its own read-out otherwise. */}
        {!charted && facts.currentPrice != null && (
          <span className="text-[13px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
            {money(facts.currentPrice)}
          </span>
        )}
        {facts.targetPrice != null && (
          <span className="text-[12px] tabular-nums text-gray-400">tgt {money(facts.targetPrice)}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
      </button>

      {/* Every surviving leg, grouped by side, in the sheet this app already
          uses for choices. Selecting closes it and changes nothing else — not
          the window, not the pane, not the judgment. */}
      <BottomSheet open={choosing} onClose={() => setChoosing(false)} title="Select leg" fitContent>
        <div className="px-3 pb-6" data-leg-chooser>
          {[{ label: 'Long', rows: longs }, { label: 'Short', rows: shorts }]
            .filter(g => g.rows.length > 0)
            .map(group => (
              <div key={group.label} className="mb-3 last:mb-0">
                <div className="px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
                  {group.label}
                </div>
                {group.rows.map((l, i) => {
                  const sym = (l.symbol ?? '').toUpperCase()
                  return (
                    <button
                      key={l.id ?? `${sym}-${i}`}
                      type="button"
                      data-leg-option={sym}
                      onClick={() => { setPicked(sym); setChoosing(false) }}
                      className="flex w-full items-center gap-2 rounded-lg px-1 py-2.5 text-left"
                    >
                      <span className="w-4 shrink-0">
                        {sym === activeSymbol && <Check className="h-4 w-4 text-primary-600" />}
                      </span>
                      <span className="flex-1 truncate text-[15px] font-semibold text-gray-900 dark:text-white">
                        {sym}
                      </span>
                      {available[sym] === false && (
                        <span className="shrink-0 text-[11px] text-gray-400">no chart</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
        </div>
      </BottomSheet>

      {/*
        The ordinary price chart — the same `PricePane` the Case vs Price pane
        renders, with the same fetch, the same `PriceContext`, the same window
        controls and the same expand. It also owns the honest empty state for a
        leg with nothing cached, so this pane does not need one of its own.

        Keyed by symbol so switching legs replaces the chart rather than
        mutating one in place; the window survives that remount because it is
        held here and handed back through `initialRange`.
      */}
      <div className="mt-1.5 min-h-0 flex-1">
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
