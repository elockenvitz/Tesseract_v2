/**
 * The bound-object header, shared by both halves of the engagement pane.
 *
 * Its whole job is to make the binding visible. The architecture audit's
 * finding was that the pane took its context from the ACTIVE TAB rather than
 * from the item the user clicked, so the user had to recreate the ticker and
 * restate the problem. Now that the seam carries both, the pane has to show
 * what it bound — otherwise the user has no way to know whether it worked, and
 * "context was supplied" becomes a claim rather than a visible fact.
 */

import { Check } from 'lucide-react'
import { clsx } from 'clsx'
import { contextChipsFor } from '../../lib/engagement'
import type { EngagementMode, EngagementTarget } from '../../lib/engagement'

interface EngagementContextHeaderProps {
  target: EngagementTarget
  mode: EngagementMode
  className?: string
}

export function EngagementContextHeader({
  target,
  mode,
  className,
}: EngagementContextHeaderProps) {
  const chips = contextChipsFor(target)

  return (
    <div
      data-testid="engagement-context-header"
      className={clsx(
        'flex-shrink-0 px-3 py-2.5 border-b',
        'bg-gray-50/80 dark:bg-white/[0.03]',
        'border-gray-200/80 dark:border-white/10',
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {target.symbol && (
          <span className="font-mono text-[13px] font-semibold text-gray-900 dark:text-gray-100">
            {target.symbol}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-300">
          {target.label}
        </span>
      </div>

      {target.issue && (
        <div className="mt-1">
          <div className="text-[11.5px] font-semibold text-gray-900 dark:text-gray-100">
            {target.issue.title}
          </div>
          {target.issue.detail && (
            <div className="mt-0.5 text-[11.5px] leading-snug text-gray-600 dark:text-gray-400">
              {target.issue.detail}
            </div>
          )}
        </div>
      )}

      {chips.length > 0 && (
        <>
          <div className="mt-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-gray-500">
            Context already supplied {mode === 'ai' ? 'to the model' : 'to the thread'}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map(chip => (
              <span
                key={`${chip.label}:${chip.value}`}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px]',
                  'border-gray-200 dark:border-white/10',
                  'bg-white dark:bg-white/[0.04]',
                  'text-gray-600 dark:text-gray-400',
                )}
              >
                <Check className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
                {chip.label}
                <span className="font-mono font-semibold text-gray-900 dark:text-gray-200">
                  {chip.value}
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
