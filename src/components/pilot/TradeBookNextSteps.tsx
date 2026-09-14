import { Check, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { usePilotTradeBookSteps } from '../../hooks/usePilotTradeBookSteps'
import { TRADE_BOOK_STEPS, type TradeBookStepKey } from '../../lib/pilot/trade-book-steps'

/**
 * The phone's "Next steps" card for Trade Book basics.
 *
 * The step banner names three actions; on a phone none of them were in view.
 * This card sits at the top of the batch and makes each one a control that
 * takes you to it: Review the trade opens the first trade, Add your rationale
 * opens "Why this decision?", Open Outcomes goes there. Progress is the same
 * state the banner reads, so a step ticks off here the moment it is done
 * anywhere on the page.
 *
 * Retires with the banner once all three are done.
 */
export function TradeBookNextSteps({
  userId,
  orgId,
  onReview,
  onRationale,
  onOpenOutcomes,
}: {
  userId: string | undefined
  orgId: string | null | undefined
  onReview: () => void
  onRationale: () => void
  /** Navigation only; the step is recorded here. */
  onOpenOutcomes: () => void
}) {
  const { done, completedCount, dismissed, openOutcomes } = usePilotTradeBookSteps(userId, orgId)
  if (dismissed) return null

  const actions: Record<TradeBookStepKey, () => void> = {
    reviewed: onReview,
    rationale: onRationale,
    outcomes: () => openOutcomes(onOpenOutcomes),
  }
  const next = TRADE_BOOK_STEPS.find(s => !done[s.key])?.key

  return (
    <section data-slot="tradebook-next-steps" aria-label="Next steps" className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-[13px] font-semibold text-gray-900 dark:text-white">Next steps</h2>
        <span className="text-[11px] tabular-nums text-gray-400">{completedCount} of {TRADE_BOOK_STEPS.length} done</span>
      </div>
      <ol className="px-2 pb-2">
        {TRADE_BOOK_STEPS.map(step => {
          const isDone = done[step.key]
          const isNext = step.key === next
          return (
            <li key={step.key}>
              <button
                type="button"
                data-slot="tradebook-next-step"
                data-step={step.key}
                data-state={isDone ? 'done' : isNext ? 'next' : 'later'}
                onClick={actions[step.key]}
                className="w-full flex items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-gray-50 dark:active:bg-gray-800"
              >
                <span className={clsx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isNext
                      ? 'bg-amber-500 text-white'
                      : 'border border-gray-300 dark:border-gray-600 text-gray-500',
                )}>
                  {isDone ? <Check className="h-3.5 w-3.5" /> : step.n}
                </span>
                <span className={clsx(
                  'min-w-0 flex-1 text-sm',
                  isDone ? 'text-gray-400 line-through' : 'font-medium text-gray-900 dark:text-white',
                )}>
                  {step.title}
                </span>
                {isDone ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Done</span>
                ) : (
                  <span className={clsx(
                    'inline-flex items-center gap-0.5 text-[12px] font-semibold',
                    isNext ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400',
                  )}>
                    {step.actionLabel}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
