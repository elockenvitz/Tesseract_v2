import { clsx } from 'clsx'
import type { ProcessHealth } from '../../lib/decision-intelligence'

/**
 * Review status for the Outcomes list on a phone: one quiet line of counts.
 *
 * It was a bordered card with a health pill, a headline and three large
 * numbers, and at 390px it competed with the batch cards it sits above. Now it
 * is a summary line — "2 to review · 1 not executed · 3 working" — that a
 * reader takes in at a glance and scrolls past.
 *
 * Every number is `buildProcessHealth`'s own count; nothing is re-derived.
 * "To review" is decisions missing a rationale or an outcome review;
 * "Not executed" is decisions approved but stalled or never matched to a trade.
 */
export function OutcomesReviewStatusCard({ health }: { health: ProcessHealth }) {
  const c = health.counts
  const stats = [
    { key: 'review', label: 'to review', value: c.needsReview + c.needsEvaluation, dot: 'bg-amber-500' },
    { key: 'execution', label: 'not executed', value: c.stalled + c.unmatched, dot: 'bg-red-500' },
    { key: 'working', label: 'working', value: c.working, dot: 'bg-emerald-500' },
  ]

  return (
    <section
      data-slot="outcomes-review-status"
      aria-label="Review status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-[12px] dark:bg-gray-900/60"
    >
      {stats.map(s => (
        <span
          key={s.key}
          data-stat={s.key}
          className={clsx('inline-flex items-center gap-1.5', s.value > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500')}
        >
          <span aria-hidden className={clsx('h-1.5 w-1.5 rounded-full', s.value > 0 ? s.dot : 'bg-gray-300 dark:bg-gray-600')} />
          <span className="font-semibold tabular-nums">{s.value}</span>
          <span>{s.label}</span>
        </span>
      ))}
    </section>
  )
}
