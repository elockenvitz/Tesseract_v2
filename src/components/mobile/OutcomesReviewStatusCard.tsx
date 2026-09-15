import { clsx } from 'clsx'
import { HEALTH_DISPLAY, type ProcessHealth } from '../../lib/decision-intelligence'

/**
 * Review status for the Outcomes list on a phone.
 *
 * The desktop strip is a loose line — "ATTENTION · Review discipline" and a
 * headline — that wrapped over three lines at 390px and read as copy rather
 * than a status. Here it is one compact card: the health level as a pill, the
 * headline on one clamped line, and three counts a reader can scan.
 *
 * Every number is `buildProcessHealth`'s own count; nothing is re-derived.
 * "To review" is decisions waiting on context or an outcome review;
 * "Execution" is decisions approved but stalled or never matched to a trade.
 */
export function OutcomesReviewStatusCard({ health }: { health: ProcessHealth }) {
  const hd = HEALTH_DISPLAY[health.level]
  const c = health.counts
  const stats = [
    { key: 'review', label: 'To review', value: c.needsReview + c.needsEvaluation, tone: 'text-amber-700 dark:text-amber-400' },
    { key: 'execution', label: 'Execution', value: c.stalled + c.unmatched, tone: 'text-red-700 dark:text-red-400' },
    { key: 'working', label: 'Working', value: c.working, tone: 'text-emerald-700 dark:text-emerald-400' },
  ]

  return (
    <section
      data-slot="outcomes-review-status"
      aria-label="Review status"
      className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', hd.bgColor, hd.color)}>
          {hd.label}
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-gray-300">{health.headline}</p>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        {stats.map(s => (
          <div key={s.key} data-stat={s.key} className="min-w-0">
            <dt className="text-[11px] text-gray-500 dark:text-gray-400">{s.label}</dt>
            <dd className={clsx('text-[17px] font-semibold tabular-nums leading-tight', s.value > 0 ? s.tone : 'text-gray-300 dark:text-gray-600')}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
