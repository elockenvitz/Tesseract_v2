/**
 * The suggested-actions row under an assistant message.
 *
 * ── Why this is the whole UI change in this lane ──────────────────────────
 *
 * AI System V2's point is that the pane stops scraping prose to find out what
 * the model recommended. This component is the proof: it renders `actions`,
 * which arrived already validated against the catalogue and against the
 * conversation's own context. It parses nothing, matches no regex, and has no
 * opinion about what the model wrote.
 *
 * ── Nothing here executes anything consequential ──────────────────────────
 *
 * Every action in the catalogue either navigates or opens a compose form with
 * fields prefilled and nothing saved. The click is the user's approval of a
 * navigation, not of a write. When a writing action is added it must arrive
 * with its own confirmation step; this row must not become the approval seam
 * for one by accident.
 */

import { ArrowUpRight, PenLine, MessageSquare, LineChart, PlusCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { ACTION_SPECS, executeAiAction, type AiAction, type AiActionClass } from '../../lib/ai'

const CLASS_ICON: Record<AiActionClass, typeof ArrowUpRight> = {
  navigation: ArrowUpRight,
  investment: PenLine,
  capture: PlusCircle,
  collaboration: MessageSquare,
}

export function AISuggestedActions({ actions }: { actions: AiAction[] }) {
  if (!actions.length) return null

  return (
    <div className="mt-3 pt-2.5 border-t border-gray-200 dark:border-gray-700">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
        Suggested actions
      </p>
      <div className="flex flex-col gap-1">
        {actions.map(action => {
          const spec = ACTION_SPECS[action.action]
          const Icon = action.action === 'open_chart' ? LineChart : CLASS_ICON[spec.class]
          return (
            <button
              key={`${action.action}:${action.target?.id ?? 'none'}`}
              type="button"
              onClick={() => executeAiAction(action)}
              title={action.reason}
              className={clsx(
                'group/action flex items-start gap-2 w-full text-left rounded-md px-2 py-1.5',
                'text-xs transition-colors',
                'bg-white/60 dark:bg-gray-900/40',
                'hover:bg-primary-50 dark:hover:bg-primary-900/20',
                'border border-gray-200 dark:border-gray-700',
              )}
            >
              <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary-600 dark:text-primary-400" />
              <span className="min-w-0">
                <span className="block font-medium text-gray-900 dark:text-gray-100">
                  {action.label}
                </span>
                {action.reason && (
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                    {action.reason}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
