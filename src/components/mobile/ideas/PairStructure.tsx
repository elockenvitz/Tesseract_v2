import { clsx } from 'clsx'
import type { PairLegRow } from '../../../lib/signals/pair-shape'
import { pairSides, sideLabel } from '../../../lib/signals/pair-shape'

/**
 * The pair, as one structure.
 *
 * ── What this refuses to be ───────────────────────────────────────────────
 *
 * Two miniature single-name cards side by side. A pair is a relative claim —
 * that this side beats that side — and rendering the halves as peers leaves
 * the reader to infer the relationship from adjacency. The sides are labelled
 * LONG and SHORT, stacked, with the direction carried in colour and in a word,
 * because "which half is which" is the first thing anybody asks and the last
 * thing that should be in small print.
 *
 * ── Sizes, not symbols, for the wide ones ─────────────────────────────────
 *
 * Production's widest pair carries ten legs. Listing them all would push the
 * rationale, the context and the judgment off the card, so a side shows its
 * first two symbols and a count. The complete list is in the detail, where
 * there is room for it.
 *
 * ── Empty sides are real ──────────────────────────────────────────────────
 *
 * One production group's surviving legs are two buys and two sells; another
 * has a side with no cached price at all. A one-sided pair is a half-built
 * pair and it renders as one rather than being hidden — the gap is the
 * finding.
 */

interface PairStructureProps {
  legs: readonly PairLegRow[]
  /** Per-leg facts the rows actually carry. Nothing derived. */
  factsFor?: (leg: PairLegRow) => { currentPrice?: number | null; targetPrice?: number | null }
  /** Compact drops the row to a single line for a summary context. */
  size?: 'md' | 'sm'
  className?: string
}

function money(n: number): string {
  return n >= 1000 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

/**
 * One side, as a column.
 *
 * The label sits ABOVE the names in its own weight and colour, so LONG and
 * SHORT are read before the tickers rather than after them. That ordering is
 * the whole point: on a relative expression, which side a name is on changes
 * what the claim means, and a reader scanning at speed takes the first line.
 */
function Side({
  label, tone, legs, factsFor, max, single,
}: {
  label: string
  tone: 'long' | 'short'
  legs: readonly PairLegRow[]
  factsFor?: PairStructureProps['factsFor']
  max: number
  single: boolean
}) {
  const facts = single && legs.length === 1 ? factsFor?.(legs[0]) : undefined
  return (
    <div className="min-w-0 flex-1" data-pair-side={tone}>
      <div
        className={clsx(
          'text-[10px] font-bold uppercase tracking-[0.10em]',
          tone === 'long'
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400',
        )}
      >
        {label}
      </div>
      <div
        className={clsx(
          'mt-1 truncate font-bold tracking-tight',
          single ? 'text-[26px] leading-none' : 'text-[17px] leading-tight',
          legs.length ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500',
        )}
      >
        {sideLabel(legs, max) || 'none'}
      </div>
      {/* Real facts only, and only where a single name makes them unambiguous.
          On a basket a price would belong to one leg and read as the side's. */}
      {facts && (facts.currentPrice != null || facts.targetPrice != null) && (
        <div className="mt-1.5 space-y-0.5 text-[12px] tabular-nums text-gray-500 dark:text-gray-400">
          {facts.currentPrice != null && <div>{money(facts.currentPrice)}</div>}
          {facts.targetPrice != null && <div>target {money(facts.targetPrice)}</div>}
        </div>
      )}
    </div>
  )
}

export function PairStructure({ legs, factsFor, size = 'md', className }: PairStructureProps) {
  const sides = pairSides(legs)
  const max = size === 'sm' ? 2 : 3
  /**
   * One name against one name gets the full treatment.
   *
   * The reported card was "two labels floating in blank space": a 1x1 pair had
   * the same restrained type as a ten-leg basket, so the most legible case in
   * the product looked the emptiest. A simple pair is the one shape where the
   * tickers can be large and carry their own prices, and where the opposition
   * can be stated by layout rather than by a divider.
   */
  const single = sides.long.length === 1 && sides.short.length === 1

  return (
    <div className={clsx('w-full', className)} data-pair-structure data-pair-simple={single}>
      <div className="flex items-start gap-3">
        <Side label="Long" tone="long" legs={sides.long} factsFor={factsFor} max={max} single={single} />
        {/*
          A full-height rule, not a 16px dash.
          The dash was reported as too weak to communicate the relationship —
          at four pixels of ink between two words it read as a hyphen. A rule
          that spans the block separates two columns, which is what the sides
          are, and it does that without a VS badge or any other decoration.
        */}
        <div
          className={clsx('w-px shrink-0 self-stretch bg-gray-200 dark:bg-gray-700', single ? 'my-0.5' : 'my-1')}
          aria-hidden
        />
        <Side label="Short" tone="short" legs={sides.short} factsFor={factsFor} max={max} single={single} />
      </div>

      {/* Legs whose action does not map to a side. Shown as themselves rather
          than filed under a guess — see `legSide`. */}
      {sides.unknown.length > 0 && (
        <div className="mt-2.5" data-pair-unplaced>
          <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-gray-400">
            Unplaced
          </div>
          <div className="mt-0.5 truncate text-[13px] text-gray-600 dark:text-gray-300">
            {sides.unknown
              .map(l => `${(l.symbol ?? '?').toUpperCase()} ${String(l.action ?? '').toUpperCase()}`.trim())
              .join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}
