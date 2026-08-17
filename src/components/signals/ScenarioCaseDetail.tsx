import { clsx } from 'clsx'
import type { ScenarioCase } from '../../lib/signals/builders/scenarioGap'

interface ScenarioCaseDetailProps {
  price: number
  cases: ScenarioCase[]
  expected: number | null
}

/**
 * Every case the analyst wrote, in place on the card.
 *
 * This is the answer to "I want to see more about the cases without going to
 * the asset page". The ladder above shows *where* the price sits; this shows
 * *what each case says* — the target, its probability, its horizon and the
 * reasoning the analyst typed when they set it.
 *
 * Reasoning is the part that makes it worth opening. A row of numbers is
 * already in the ladder; the sentence explaining why the bear case is $325 is
 * the thing that has, until now, only existed behind three taps on a desktop
 * screen.
 *
 * Sorted high to low. The card's claim is almost always about an end of the
 * range, and reading a ladder top-down matches how the ladder is drawn.
 */
export function ScenarioCaseDetail({ price, cases, expected }: ScenarioCaseDetailProps) {
  const sorted = [...cases].sort((a, b) => b.price - a.price)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700" data-testid="case-detail">
      {sorted.map(c => {
        const gap = (c.price - price) / price
        return (
          <div
            key={`${c.name}-${c.price}`}
            className="border-b border-gray-100 px-3.5 py-3 last:border-b-0 dark:border-gray-800"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
                {c.name}
              </span>
              <span className="text-[15px] font-bold tabular-nums text-gray-900 dark:text-white">
                ${c.price.toFixed(2)}
              </span>
              {/* Distance from the tape, per case. The single most useful
                  number here and the one the ladder can only show
                  positionally. */}
              <span className={clsx(
                'text-[13px] font-semibold tabular-nums',
                gap >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}>
                {gap >= 0 ? '+' : ''}{(gap * 100).toFixed(0)}%
              </span>
              {c.probability != null && (
                <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {c.probability.toFixed(0)}%
                </span>
              )}
            </div>
            {c.timeframe && (
              <div className="mt-0.5 text-[12px] font-medium text-gray-400">{c.timeframe}</div>
            )}
            {/* The reasoning, verbatim. Not summarised: this is the analyst's
                own sentence and paraphrasing somebody's thesis back at them is
                how a surface loses their trust. */}
            {c.reasoning?.trim() && (
              <p className="mt-1.5 text-[14px] leading-[1.5] text-gray-600 dark:text-gray-300">
                {c.reasoning.trim()}
              </p>
            )}
          </div>
        )
      })}

      {expected != null && (
        <div className="flex items-baseline gap-2 bg-gray-50 px-3.5 py-3 dark:bg-gray-800/60">
          <span className="text-[13px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Expected
          </span>
          <span className="text-[15px] font-bold tabular-nums text-gray-900 dark:text-white">
            ${expected.toFixed(2)}
          </span>
          <span className="ml-auto text-[12px] font-medium text-gray-400">
            probability-weighted
          </span>
        </div>
      )}
    </div>
  )
}
