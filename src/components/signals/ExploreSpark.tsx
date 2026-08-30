import { clsx } from 'clsx'

import { Sparkline } from './Sparkline'

/**
 * The frame an Explore card's price line sits in.
 *
 * ── Why the frame is a component and not four class names ─────────────────
 *
 * It was four class names, written twice — once in `TileSparkline`, which the
 * app renders, and once inline in the gallery, which is where tile geometry is
 * reviewed and where the phone suite measures it. Two copies of a layout whose
 * entire job is consistency: §11 asks for the same horizontal padding across
 * card sizes, the same baseline, the same `1Y` placement, and there was no
 * single place that could promise any of it.
 *
 * So the frame lives here, pure, and both callers render it. `TileSparkline`
 * fetches and hands over points; the gallery hands over fixture points. Neither
 * decides the geometry.
 *
 * ── Why the caption comes out of the chart ────────────────────────────────
 *
 * `Sparkline` colours itself from the first close to the last, so a name that
 * fell today and rose over the year draws GREEN under a metric reading "-6.2%
 * TODAY" in red. Both are true, and a chart that names no period reads as a
 * contradiction the reader has to resolve — usually by distrusting the number,
 * which was the one unambiguous thing on the card.
 *
 * The 12px caption is taken FROM the chart's height rather than added to it, so
 * saying which window it covers changes no card's height.
 */

interface ExploreSparkProps {
  /** Closing prices, oldest first. Two or more, or the caller renders nothing. */
  points: number[]
  /** The window the line covers — `1Y`, `6M`. Never omitted. */
  window: string
  /** A featured card is wider, so its line gets more room to say something. */
  feature?: boolean
  /**
   * Where the line sits on the card.
   *
   * ── Why one component and not three ─────────────────────────────────────
   *
   * The brief asks for the line in three places — beside a metric, along the
   * lower edge, and as the card's own picture — and three components would be
   * three chances for the geometry to drift, which is the exact reason this
   * frame was extracted in the first place. One component, three placements,
   * one set of paddings and one caption rule.
   */
  form?: 'primary' | 'edge' | 'inline'
  /**
   * What the START of the window means: `Last look`, `Idea`, `Published`.
   *
   * The caption already says how long the window is. Where the card's finding
   * is ABOUT a moment — a review, a call, a publication — naming that moment
   * is what turns a price line into the answer to the card's own sentence.
   * Absent for a plain recent path, which is anchored to nothing.
   */
  sinceLabel?: string | null
}

export function ExploreSpark({
  points, window, feature, form = 'primary', sinceLabel,
}: ExploreSparkProps) {
  /**
   * An inline line is punctuation on a number, so it is short, unlabelled and
   * sits on the metric's baseline rather than under it.
   */
  if (form === 'inline') {
    return (
      <span
        data-explore-spark-frame
        data-explore-spark-form="inline"
        className="ml-2 inline-block h-4 w-14 shrink-0 align-middle"
      >
        <Sparkline points={points} />
      </span>
    )
  }

  return (
    <div
      data-explore-spark-frame
      data-explore-spark-form={form}
      className={clsx(
        // Full card width inside the card's own padding, at both sizes — the
        // line must not have padding of its own or a feature and a compact
        // card would indent their charts differently.
        'w-full pt-2',
        // Taller than the 28px this started at, which flattened a month of
        // movement until every name looked like the same gentle slope.
        form === 'edge' ? 'h-11' : feature ? 'h-16' : 'h-12',
      )}
    >
      <div className="h-[calc(100%-12px)]">
        <Sparkline points={points} />
      </div>
      {/* One caption line, carrying the anchor where there is one.
          `LAST LOOK · 10M` reads as a window with a meaning; `10M` alone
          reads as a chart setting. Same height either way, so naming the
          anchor costs no card. */}
      <p
        data-explore-spark-window
        className="flex h-3 items-center gap-1 text-[9px] font-semibold uppercase tracking-wide leading-3 text-gray-400"
      >
        {sinceLabel && (
          <>
            <span data-explore-spark-anchor className="text-gray-500 dark:text-gray-400">{sinceLabel}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span>{window}</span>
      </p>
    </div>
  )
}

/**
 * How long a window a series covers, as a label.
 *
 * Shared for the same reason the frame is: the gallery computed this from the
 * fixture's dates with its own arithmetic, so a change to the app's rounding
 * would have shown up nowhere in review.
 */
export function sparkWindowLabel(firstDate: string, lastDate: string): string {
  const first = new Date(firstDate).getTime()
  const last = new Date(lastDate).getTime()
  if (!Number.isFinite(first) || !Number.isFinite(last)) return ''
  const months = Math.max(1, Math.round((last - first) / (30 * 86_400_000)))
  return months >= 12 ? `${Math.round(months / 12)}Y` : `${months}M`
}
