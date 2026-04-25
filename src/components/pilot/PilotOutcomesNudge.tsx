/**
 * PilotOutcomesNudge — banner shown at the top of Trade Book for pilot users
 * once they've unlocked Outcomes (i.e. they have at least one committed trade
 * visible). Single focus: nudge them to Outcomes to watch the decision play
 * out. (Capturing rationale lives on the trade row itself in Trade Book and
 * doesn't need a banner-level affordance — surfacing both was overkill.)
 * Clicking the CTA or the X both retire the banner via localStorage. The
 * dismiss flag is keyed per user+org so an analyst running multiple pilot
 * clients gets a fresh prompt in each new client.
 */

import { Target, X, ArrowRight, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

interface PilotOutcomesNudgeProps {
  userId: string | undefined
  /** Active org id, used to scope the banner state per pilot client. */
  orgId?: string | null
}

const DISMISS_KEY = (userId: string, orgId: string | null | undefined) =>
  `pilot_outcomes_nudge_dismissed_${userId}_${orgId || 'no-org'}`

export function PilotOutcomesNudge({ userId, orgId }: PilotOutcomesNudgeProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!userId) return false
    try {
      return localStorage.getItem(DISMISS_KEY(userId, orgId)) === '1'
    } catch {
      return false
    }
  })

  // Re-check when user or org changes (morph, switch client, etc.).
  useEffect(() => {
    if (!userId) return
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY(userId, orgId)) === '1')
    } catch {
      /* ignore */
    }
  }, [userId, orgId])

  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    if (userId) {
      try {
        localStorage.setItem(DISMISS_KEY(userId, orgId), '1')
      } catch {
        /* ignore */
      }
    }
  }

  // CTA + X both retire the banner — they signal "user has
  // acknowledged the next-step prompt." Sharing the dismissed flag
  // keeps the banner from re-appearing on later Trade Book visits.
  const handleGoToOutcomes = () => {
    if (userId) {
      try { localStorage.setItem(DISMISS_KEY(userId, orgId), '1') } catch { /* ignore */ }
    }
    setDismissed(true)
    window.dispatchEvent(
      new CustomEvent('decision-engine-action', {
        detail: { id: 'outcomes', title: 'Outcomes', type: 'outcomes', data: null },
      }),
    )
  }

  return (
    <div className="mx-6 mt-3 rounded-xl border border-primary-200 dark:border-primary-800/60 bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 dark:from-primary-950/40 dark:via-blue-950/20 dark:to-indigo-950/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center flex-shrink-0">
          <Target className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary-700 dark:text-primary-300">
              <Sparkles className="w-2.5 h-2.5" />
              Next step
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Watch how this decision plays out in Outcomes
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
            Outcomes scores the thesis as the result unfolds and prompts a reflection later.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleGoToOutcomes}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors whitespace-nowrap"
          >
            Open Outcomes
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-gray-800/60 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
