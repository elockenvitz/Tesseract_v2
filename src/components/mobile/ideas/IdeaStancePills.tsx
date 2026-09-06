import { clsx } from 'clsx'
import type { MaturityShape, StanceShape } from '../../../lib/signals/idea-shape'

/**
 * The two things a reader has to know before reading a word: what is being
 * proposed, and how finished the thinking is.
 *
 * ── Why two pills and not one badge ───────────────────────────────────────
 *
 * The feed had one BUY/SELL badge, so a buy somebody sketched this morning and
 * a buy sitting in front of a PM looked identical. They are the same stance at
 * opposite ends of a pipeline, and the second is the one that needs an answer
 * today.
 *
 * They are separate pills because they are separate facts, and the maturity
 * pill never replaces the stance. An early-stage buy is a BUY the desk is still
 * working — not a "watch", which is a state this product does not have and
 * which would throw away the direction its author was most explicit about.
 *
 * ── Colour carries direction, never maturity ──────────────────────────────
 *
 * `add` takes the same green as `buy` and `trim` the same red as `sell`,
 * because the direction of the money is the same. The LABEL keeps them apart:
 * buy and sell open or close a position, add and trim resize one already on,
 * and a card that says BUY when the author said ADD describes a trade nobody
 * asked for.
 *
 * Maturity is deliberately monochrome. Giving it a hue would put two colour
 * systems on one row and invite the reader to read "researching" as a warning.
 */

interface IdeaStancePillsProps {
  stance: StanceShape | null
  maturity: MaturityShape
  /** Compact drops the maturity pill's letter-spacing for narrow panes. */
  size?: 'md' | 'sm'
  className?: string
}

const DIRECTION_TONE = {
  increase: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-gray-900',
  decrease: 'bg-rose-600 text-white dark:bg-rose-500 dark:text-gray-900',
} as const

export function IdeaStancePills({ stance, maturity, size = 'md', className }: IdeaStancePillsProps) {
  // Neither present is a real state — an idea with an unreadable action and no
  // stage. Rendering an empty row of nothing is better than inventing either.
  if (!stance && !maturity.label) return null

  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5', className)} data-idea-pills>
      {stance && (
        <span
          data-idea-stance={stance.stance}
          className={clsx(
            'inline-flex items-center rounded-md font-black tracking-wide',
            DIRECTION_TONE[stance.direction],
            size === 'md' ? 'px-2 py-[3px] text-[12px]' : 'px-1.5 py-[2px] text-[10px]',
          )}
        >
          {stance.label}
        </span>
      )}
      {maturity.label && (
        <span
          data-idea-maturity={maturity.maturity}
          className={clsx(
            'inline-flex items-center rounded-md border font-bold uppercase',
            // A decision-ready idea is asking for something; a researching one
            // is not. That is the only distinction worth a border weight, and
            // it is still monochrome.
            maturity.awaitingDesk
              ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
              : 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
            size === 'md' ? 'px-2 py-[2px] text-[10px] tracking-[0.06em]' : 'px-1.5 py-[1px] text-[9px]',
          )}
        >
          {maturity.label}
        </span>
      )}
    </div>
  )
}
