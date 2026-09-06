import { clsx } from 'clsx'

/**
 * The price against the number the author committed to.
 *
 * ── Why a track and not two figures ───────────────────────────────────────
 *
 * "Current $231.40 · Target $310" is two facts a reader has to subtract in
 * their head, and the answer they want is the distance. A track shows the gap
 * as a length, which is the one comparison the card exists to make.
 *
 * ── Direction, not arithmetic ─────────────────────────────────────────────
 *
 * The bar fills toward the target in the direction the IDEA wants. On a sell or
 * a trim the target sits below the price, and drawing that as a bar shrinking
 * leftward from a "current" origin would read as the thesis failing when it is
 * the thesis working. The track is therefore always "distance still to travel",
 * left to right, whichever way the money goes.
 *
 * ── What it will not draw ─────────────────────────────────────────────────
 *
 * Anything without both numbers. `ideaShapeFor` already refuses the target
 * family when either is missing, so this component being rendered at all is a
 * statement that both exist — but it re-checks, because a component that draws
 * half a comparison when handed half its inputs is the failure mode this whole
 * pass is about.
 */

interface IdeaTargetBarProps {
  symbol: string
  /** Last close. Never a holdings mark — see lib/signals/price-snapshot. */
  currentPrice: number
  targetPrice: number
  /** What the reference price is, so the card cannot imply a live quote. */
  priceLabel: string
  direction: 'increase' | 'decrease'
  /** Signed toward the idea's own direction. From `targetGapPct`. */
  gapPct: number | null
  /**
   * Fraction of the journey already travelled, 0–1, or null.
   *
   * Null whenever the window is not anchored to the idea — there is no honest
   * starting point to measure progress from, and measuring from today would
   * draw an empty bar on every card forever.
   */
  progress: number | null
  timeHorizon?: string | null
}

const HORIZON_LABEL: Record<string, string> = {
  short: 'short horizon',
  medium: 'medium horizon',
  long: 'long horizon',
}

function money(n: number): string {
  return n >= 1000 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

export function IdeaTargetBar({
  symbol, currentPrice, targetPrice, priceLabel, direction, gapPct, progress, timeHorizon,
}: IdeaTargetBarProps) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(targetPrice)) return null

  // Past the target in the stated direction. A real and common state, and the
  // one a reader most needs flagged: the idea has done what it said.
  const reached = gapPct != null && gapPct <= 0
  const fill = reached ? 1 : (progress ?? 0)

  return (
    <div className="flex h-full min-h-[92px] flex-col justify-center" data-idea-target-bar={symbol}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {priceLabel}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Target
        </span>
      </div>

      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-[19px] font-bold tabular-nums text-gray-900 dark:text-white">
          {money(currentPrice)}
        </span>
        <span className="text-[19px] font-bold tabular-nums text-gray-900 dark:text-white">
          {money(targetPrice)}
        </span>
      </div>

      {/* The track. A single rule with a fill and a marker, not a chart —
          there is no series here, only two numbers and the distance. */}
      <div className="relative mt-2.5 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          data-target-fill
          className={clsx(
            'absolute inset-y-0 left-0 rounded-full',
            direction === 'increase' ? 'bg-emerald-500' : 'bg-rose-500',
          )}
          style={{ width: `${Math.round(fill * 100)}%` }}
        />
        {/* Where the price stands. Drawn only when there is a real journey to
            stand inside — otherwise the dot would sit at zero on every card and
            read as "no progress" rather than "not measurable". */}
        {progress != null && !reached && (
          <span
            data-target-marker
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gray-900 shadow dark:border-gray-900 dark:bg-white"
            style={{ left: `${Math.round(fill * 100)}%` }}
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          data-target-gap
          className={clsx(
            'text-[13px] font-semibold tabular-nums',
            reached
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-gray-700 dark:text-gray-200',
          )}
        >
          {gapPct == null
            ? 'Gap unavailable'
            : reached
              // Not "0% upside". The idea reached its number, which is a result,
              // and the reader's next question is whether the view still holds.
              ? 'Target reached'
              : `${gapPct.toFixed(0)}% to go`}
        </span>
        {timeHorizon && HORIZON_LABEL[timeHorizon] && (
          <span className="text-[11px] text-gray-400">{HORIZON_LABEL[timeHorizon]}</span>
        )}
      </div>

      {/* Progress is unmeasurable more often than not — only an anchored window
          gives a starting price. Saying so beats a bar that is silently always
          empty. */}
      {progress == null && !reached && (
        <p className="mt-1 text-[11px] leading-snug text-gray-400">
          No price from when the idea was raised, so progress is not shown.
        </p>
      )}
    </div>
  )
}
