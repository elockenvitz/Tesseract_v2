import { clsx } from 'clsx'
import type { PairLegRow } from '../../../lib/signals/pair-shape'
import { legSide, survivingLegs } from '../../../lib/signals/pair-shape'

/**
 * The legs, as facts.
 *
 * ── One pane, not one pane per leg ────────────────────────────────────────
 *
 * The previous pair card gave every leg its own price pane, so a two-leg pair
 * paged through two charts and a ten-leg pair would have paged through ten.
 * That is the "two independent cards glued together" failure in carousel form:
 * the reader swipes past a series of single names and is never shown the pair.
 *
 * One pane lists the structure. It scales to production's widest group without
 * changing shape, and it leaves the pair itself as the card's subject.
 *
 * ── Only what the row holds ───────────────────────────────────────────────
 *
 * Symbol, side, the author's action, and a target where one was set. No hedge
 * ratio, no beta or dollar neutrality, no spread target, no pair-level
 * conviction — none of those exist in the model, and a pair card is exactly
 * the surface where inventing them would look most plausible.
 */

interface PairLegsPaneProps {
  legs: readonly PairLegRow[]
  /** Per-leg target, keyed by leg id, where the row carried one. */
  targetFor?: (leg: PairLegRow) => number | null
  /** Cap for the card. The detail passes Infinity. */
  limit?: number
}

const SIDE_TONE = {
  long: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  short: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
} as const

function money(n: number): string {
  return n >= 1000 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

export function PairLegsPane({ legs, targetFor, limit = 5 }: PairLegsPaneProps) {
  const surviving = survivingLegs(legs)
  const shown = surviving.slice(0, limit)
  const hidden = surviving.length - shown.length

  if (shown.length === 0) {
    return (
      <div className="flex h-full min-h-[92px] items-center" data-slot="pair-legs-empty">
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          No legs remain on this pair.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[92px] flex-col justify-center" data-slot="pair-legs">
      <ul className="space-y-1.5">
        {shown.map((l, i) => {
          const side = legSide(l)
          const target = targetFor?.(l) ?? null
          return (
            <li
              key={l.id ?? `${l.symbol}-${i}`}
              data-pair-leg={side}
              className="flex items-center gap-2"
            >
              <span
                className={clsx(
                  'w-12 shrink-0 rounded px-1.5 py-[2px] text-center text-[10px] font-bold uppercase',
                  SIDE_TONE[side],
                )}
              >
                {/* An unplaceable leg shows the author's own verb rather than a
                    guessed side. */}
                {side === 'unknown' ? String(l.action ?? '?').slice(0, 5) : side}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gray-900 dark:text-white">
                {(l.symbol ?? '—').toUpperCase()}
              </span>
              {target != null && (
                <span className="shrink-0 text-[12px] tabular-nums text-gray-500 dark:text-gray-400">
                  target {money(target)}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <p className="mt-2 text-[11px] text-gray-400" data-pair-legs-more>
          {hidden} more {hidden === 1 ? 'leg' : 'legs'} — open the pair to see all of them.
        </p>
      )}
    </div>
  )
}
