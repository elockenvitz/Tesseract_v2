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
}

export function ExploreSpark({ points, window, feature }: ExploreSparkProps) {
  return (
    <div
      data-explore-spark-frame
      className={clsx(
        // Full card width inside the card's own padding, at both sizes — the
        // line must not have padding of its own or a feature and a compact
        // card would indent their charts differently.
        'w-full pt-2',
        // Taller than the 28px this started at, which flattened a month of
        // movement until every name looked like the same gentle slope.
        feature ? 'h-16' : 'h-12',
      )}
    >
      <div className="h-[calc(100%-12px)]">
        <Sparkline points={points} />
      </div>
      <p
        data-explore-spark-window
        className="h-3 text-[9px] font-semibold uppercase tracking-wide leading-3 text-gray-400"
      >
        {window}
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
