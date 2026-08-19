import { useState } from 'react'
import { clsx } from 'clsx'

interface HorizonTimelineProps {
  /** When the view was stated. ISO. */
  statedAt: string
  /** When its own stated horizon ran out. ISO. */
  horizonAt: string
  /** The horizon as the analyst wrote it: "12 months", "2 years". */
  timeframe?: string | null
  /** Today, injectable so the overdue segment is testable without mocking. */
  now?: Date
}

const DAY = 86_400_000

function months(ms: number): number {
  return ms / (30.44 * DAY)
}

/** "14 months", "3 weeks", "6 days". Whole units, never "1.7 months". */
function elapsed(ms: number): string {
  const days = Math.round(ms / DAY)
  if (days < 14) return `${Math.max(days, 0)} day${days === 1 ? '' : 's'}`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  const m = Math.round(months(ms))
  if (m < 24) return `${m} months`
  return `${(m / 12).toFixed(1)} years`
}

function shortUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * A view's own stated lifespan, and how far past it we are.
 *
 * ── Why this is a chart and not a sentence ────────────────────────────────
 *
 * The stale-target card carries two durations that are easy to confuse: how
 * long ago the view was written, and how long ago it *expired*. A twelve-month
 * target set fourteen months ago is two months overdue; a three-month target
 * set fourteen months ago is eleven. Written as prose those read almost
 * identically, and the card was leading with a bare "5mo" that could plausibly
 * have been either.
 *
 * Drawn as one track they cannot be confused: the honoured stretch and the
 * overdue stretch are different lengths of the same line, and the ratio between
 * them is the finding.
 *
 * ── Why the segments are tappable ─────────────────────────────────────────
 *
 * Same reason `WeightBars` makes its delta a tap. Printing all four numbers at
 * once puts a table on a 390px card and buries the one the reader wants;
 * tapping a segment states that one span in a sentence. Tap rather than hover,
 * because there is no hover, and tap rather than swipe, because this can sit in
 * a carousel pane and must never be mistaken for a page gesture.
 */
export function HorizonTimeline({ statedAt, horizonAt, timeframe, now }: HorizonTimelineProps) {
  const [picked, setPicked] = useState<'honoured' | 'overdue' | null>(null)

  const t0 = new Date(statedAt).getTime()
  const t1 = new Date(horizonAt).getTime()
  const t2 = (now ?? new Date()).getTime()

  // A horizon that has not run out is not this component's claim, and neither
  // is an unparseable date. Rendering nothing beats drawing a track backwards.
  if (![t0, t1, t2].every(Number.isFinite) || t1 <= t0 || t2 <= t1) return null

  const honouredMs = t1 - t0
  const overdueMs = t2 - t1
  const totalMs = t2 - t0
  // Floor the honoured share so a badly overdue target still shows the stretch
  // it was actually given, rather than a sliver too small to read.
  const honouredPct = Math.min(Math.max((honouredMs / totalMs) * 100, 12), 88)

  return (
    <div
      className="flex h-full min-h-[92px] flex-col gap-2 overflow-y-auto [justify-content:safe_center]"
      data-testid="horizon-timeline"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          Stated horizon
        </span>
        <span className="text-[13px] font-bold text-gray-900 dark:text-white">
          {timeframe ?? elapsed(honouredMs)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
          {elapsed(overdueMs)} over
        </span>
      </div>

      <div className="flex h-[14px] w-full items-stretch gap-0.5 overflow-hidden rounded-full">
        <button
          type="button"
          data-horizon-segment="honoured"
          aria-pressed={picked === 'honoured'}
          onClick={() => setPicked(p => (p === 'honoured' ? null : 'honoured'))}
          style={{ width: `${honouredPct}%` }}
          className={clsx(
            'rounded-l-full bg-gray-300 transition-opacity dark:bg-gray-600 no-touch-target',
            picked === 'honoured' && 'ring-1 ring-gray-900 dark:ring-white',
          )}
          aria-label="Time the view was given"
        />
        <button
          type="button"
          data-horizon-segment="overdue"
          aria-pressed={picked === 'overdue'}
          onClick={() => setPicked(p => (p === 'overdue' ? null : 'overdue'))}
          style={{ width: `${100 - honouredPct}%` }}
          className={clsx(
            'rounded-r-full bg-amber-500 transition-opacity no-touch-target',
            picked === 'overdue' && 'ring-1 ring-gray-900 dark:ring-white',
          )}
          aria-label="Time past the horizon"
        />
      </div>

      {/* Both ends dated, and the join in between. Without the middle date the
          track is two colours with no stated boundary. */}
      <div className="flex items-center justify-between text-[9px] font-semibold text-gray-400">
        <span>set {shortUtc(statedAt)}</span>
        <span className="text-amber-600 dark:text-amber-400">ran out {shortUtc(horizonAt)}</span>
        <span>today</span>
      </div>

      <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400" data-testid="horizon-readout">
        {picked === 'honoured'
          ? `The view ran its stated course for ${elapsed(honouredMs)} before the horizon closed.`
          : picked === 'overdue'
            ? `It has stood unrevised for ${elapsed(overdueMs)} past the date it was meant to be answered.`
            : `Written ${elapsed(totalMs)} ago. Tap either stretch to read it out.`}
      </p>
    </div>
  )
}
