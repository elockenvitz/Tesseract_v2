import { useState } from 'react'
import { clsx } from 'clsx'
import { useSymbolHistory } from '../../../hooks/mobile/useSymbolHistory'
import { canChart, priceIdentity } from '../../../lib/signals/price-availability'
import { Sparkline } from '../../signals/Sparkline'
import { PRICE_RANGES, type PricePoint, type RangeKey } from '../../signals/PriceContext'
import type { PairLegRow } from '../../../lib/signals/pair-shape'
import { legSide, survivingLegs } from '../../../lib/signals/pair-shape'

/**
 * Market context for the securities expressing the pair.
 *
 * ── The distinction this pane exists to hold ──────────────────────────────
 *
 * "How has the PAIR performed" and "what is happening in each LEG" are
 * different questions with different evidence requirements. The first needs
 * defensible data for the whole expression plus a weighting rule, and no live
 * pair in production has either — see `canRepresentPairPerformance`. The
 * second needs only truthful data for one asset, and several legs have it.
 *
 * Blocking the first was right. Letting it block the second was an
 * overextension: a card can honestly say what LLY has done without claiming to
 * say what the pair has done. So the legs get their own charts, side by side,
 * and nothing here combines them.
 *
 * ── What is deliberately NOT drawn ────────────────────────────────────────
 *
 * No summed line, no ratio, no long-minus-short, no "pair +X%". Two sparklines
 * next to each other are two facts; overlaying or differencing them would be a
 * calculated pair return, which is the claim the data cannot support.
 */

interface PairLegsPaneProps {
  legs: readonly PairLegRow[]
  /** Facts straight off the leg rows. Nothing derived. */
  factsFor?: (leg: PairLegRow) => { currentPrice?: number | null; targetPrice?: number | null }
  /** Opens the shared fullscreen chart for one leg. */
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
 * One leg: what it is, what it costs, and its tape where there is one.
 *
 * Its own component because the fetch is a hook and the number of legs varies —
 * the same reason `PricePane` is a component rather than a value.
 */
function LegBlock({
  leg, range, factsFor, onExpandLeg, tradedSymbolOf,
}: {
  leg: PairLegRow
  range: RangeKey | null
  factsFor?: PairLegsPaneProps['factsFor']
  onExpandLeg?: PairLegsPaneProps['onExpandLeg']
  tradedSymbolOf?: (s: string) => string
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
  // The row's own price where the tape has none — a stored mark, shown as a
  // number without a date claim rather than dressed as a quote.
  const price = last ?? facts.currentPrice ?? null

  const target = facts.targetPrice ?? null
  /**
   * To-target only when BOTH numbers are real. A percentage against a missing
   * price is the class of invented figure this whole pass exists to avoid.
   */
  const toTarget = price != null && target != null && price > 0
    ? ((target - price) / price) * 100
    : null

  return (
    <div className="min-w-0" data-pair-leg-block={raw} data-leg-charted={drawable}>
      <div className="flex items-baseline gap-1.5">
        <span className="truncate text-[15px] font-bold text-gray-900 dark:text-white">{raw || '—'}</span>
        <span className={clsx('text-[10px] font-bold uppercase tracking-wide', SIDE_TONE[side])}>
          {side === 'unknown' ? String(leg.action ?? '') : side}
        </span>
      </div>

      <div className="mt-0.5 flex items-baseline gap-2 text-[12px] tabular-nums text-gray-600 dark:text-gray-300">
        {price != null && <span>{money(price)}</span>}
        {target != null && <span className="text-gray-400">tgt {money(target)}</span>}
      </div>
      {toTarget != null && (
        <div className="text-[11px] tabular-nums text-gray-400">
          {toTarget >= 0 ? '+' : '−'}{Math.abs(toTarget).toFixed(0)}% to target
        </div>
      )}

      {isLoading ? (
        <div className="mt-1.5 h-8 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true" />
      ) : drawable ? (
        <button
          type="button"
          data-leg-expand={raw}
          aria-label={`Expand ${raw} chart`}
          onClick={() => onExpandLeg?.(traded, id.series, range)}
          className="mt-1.5 block h-8 w-full"
        >
          <Sparkline points={windowed.map(p => p.close)} />
        </button>
      ) : (
        /**
         * No box, no skeleton, no flat line. One quiet sentence, so the leg
         * still contributes its facts and the reader can tell "nothing cached"
         * from "still loading".
         */
        <p className="mt-1.5 text-[11px] leading-snug text-gray-400" data-leg-no-history>
          Price history unavailable
        </p>
      )}
    </div>
  )
}

export function PairLegsPane({
  legs, factsFor, onExpandLeg, tradedSymbolOf,
}: PairLegsPaneProps) {
  /**
   * ONE horizon for the pane, not one per chart.
   *
   * The pane's job is comparison, and four charts each on their own window
   * would be four different questions in a grid. A single selector also keeps
   * the chrome to one row where per-chart chips would have taken four.
   *
   * `6M` is `PriceContext`'s own default, matched so a leg looks the same here
   * as it does anywhere else in the product.
   */
  const [range, setRange] = useState<RangeKey | null>('6M')

  const surviving = survivingLegs(legs)
  if (surviving.length === 0) {
    return (
      <div className="flex h-full min-h-[92px] items-center" data-slot="pair-legs-empty">
        <p className="text-[13px] text-gray-500 dark:text-gray-400">No legs remain on this pair.</p>
      </div>
    )
  }

  const longs = surviving.filter(l => legSide(l) === 'long')
  const shorts = surviving.filter(l => legSide(l) !== 'long')

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="pair-legs">
      {/*
        The shared horizon list, not a second copy of it. `PRICE_RANGES` is the
        same constant `PriceContext` draws its own chips from, so the windows
        and their order cannot drift from Case vs Price or a single-name idea.

        A caveat worth knowing: a leg whose cache is shorter than the requested
        window draws what it has. Every covered symbol in this database holds a
        uniform ~260 closes, so the lines are comparable in practice; if
        coverage ever becomes ragged the honest upgrade is to derive this row
        from the SHORTEST covered leg.
      */}
      <div className="flex shrink-0 items-center justify-end gap-0.5" data-testid="pair-leg-ranges">
        {PRICE_RANGES.map(r => (
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
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
            )}
          >
            {r.key}
          </button>
        ))}
      </div>

      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
        {[
          { label: 'Long', rows: longs },
          { label: 'Short', rows: shorts },
        ].filter(g => g.rows.length > 0).map(group => (
          <div key={group.label} className="mb-2 last:mb-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-gray-400">
              {group.label}
            </div>
            {/* Two across where there are several, one across for a lone leg —
                a single block stretched over the full width reads as a chart
                that failed to have a neighbour. */}
            <div className={clsx('mt-1 grid gap-x-4 gap-y-2', group.rows.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
              {group.rows.map((l, i) => (
                <LegBlock
                  key={l.id ?? `${l.symbol}-${i}`}
                  leg={l}
                  range={range}
                  factsFor={factsFor}
                  onExpandLeg={onExpandLeg}
                  tradedSymbolOf={tradedSymbolOf}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
