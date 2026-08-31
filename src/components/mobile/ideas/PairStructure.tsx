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
  /** Compact drops the row to a single line for the card's header band. */
  size?: 'md' | 'sm'
  className?: string
}

function Side({
  label, symbols, tone, empty,
}: { label: string; symbols: string; tone: 'long' | 'short' | 'plain'; empty: string }) {
  return (
    <div className="min-w-0 flex-1" data-pair-side={label.toLowerCase()}>
      <div
        className={clsx(
          'text-[10px] font-bold uppercase tracking-[0.08em]',
          tone === 'long' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'short' && 'text-rose-600 dark:text-rose-400',
          tone === 'plain' && 'text-gray-400',
        )}
      >
        {label}
      </div>
      <div
        className={clsx(
          'mt-0.5 truncate text-[16px] font-bold tracking-tight',
          symbols ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500',
        )}
      >
        {symbols || empty}
      </div>
    </div>
  )
}

export function PairStructure({ legs, size = 'md', className }: PairStructureProps) {
  const sides = pairSides(legs)
  const max = size === 'sm' ? 2 : 3

  return (
    <div className={clsx('w-full', className)} data-pair-structure>
      <div className="flex items-start gap-3">
        <Side
          label="Long"
          tone="long"
          symbols={sideLabel(sides.long, max)}
          empty="none"
        />
        {/* A rule rather than the word "vs": the relationship is the point and
            a divider states it without spending a line on it. */}
        <div className="mt-3 h-px w-4 shrink-0 bg-gray-300 dark:bg-gray-600" aria-hidden />
        <Side
          label="Short"
          tone="short"
          symbols={sideLabel(sides.short, max)}
          empty="none"
        />
      </div>

      {/* Legs whose action does not map to a side. Shown as themselves rather
          than filed under a guess — see `legSide`. */}
      {sides.unknown.length > 0 && (
        <div className="mt-2" data-pair-unplaced>
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
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
