/**
 * PilotTradeLabIntroBanner — slim top-of-page onboarding hint for pilots.
 *
 * Sits above the Trade Lab header bar as a single narrow row that points the
 * user at the three moves they need to take on their first visit:
 *   1. Review the recommendation in the Trade Ideas panel
 *   2. Adjust the Sim Wt / Sim Shares columns
 *   3. Execute — save a snapshot and commit the trade
 *
 * Compact by design — the full table and portfolio controls shouldn't be
 * pushed off the fold. Dismissible per-user via localStorage so an
 * experienced pilot coming back later isn't re-nagged.
 */

import { useEffect, useState } from 'react'
import { Sparkles, X, ArrowRight } from 'lucide-react'

const storageKey = (userId: string) => `pilot_tradelab_intro_dismissed_${userId}`

export function PilotTradeLabIntroBanner({ userId }: { userId: string }) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey(userId)) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey(userId)) === '1')
    } catch {
      /* ignore */
    }
  }, [userId])

  if (dismissed) return null

  const dismiss = () => {
    try { localStorage.setItem(storageKey(userId), '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="flex-shrink-0 bg-gradient-to-r from-amber-50 via-amber-50/80 to-white dark:from-amber-900/20 dark:via-amber-900/10 dark:to-gray-900/40 border-b border-amber-200 dark:border-amber-800/60">
      <div className="px-6 py-1.5 flex items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-semibold shrink-0">
          <Sparkles className="h-3 w-3" />
          <span>Get started</span>
        </div>
        <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 min-w-0 overflow-hidden">
          <Step n={1} label="Adjust Sim Wt / Sim Shrs of the recommendation" />
          <ArrowRight className="h-3 w-3 text-amber-400 dark:text-amber-500 shrink-0" />
          <Step n={2} label="Execute trade" />
        </div>
        <button
          onClick={dismiss}
          className="ml-auto -my-1 p-1 rounded text-amber-500 hover:text-amber-700 hover:bg-amber-100/60 dark:text-amber-400 dark:hover:text-amber-200 dark:hover:bg-amber-900/30 transition-colors shrink-0"
          title="Dismiss"
          aria-label="Dismiss Trade Lab intro"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5 truncate">
      <span className="shrink-0 w-4 h-4 rounded-full bg-amber-500/10 text-amber-700 dark:bg-amber-300/20 dark:text-amber-200 flex items-center justify-center text-[10px] font-bold tabular-nums">
        {n}
      </span>
      <span className="truncate">{label}</span>
    </span>
  )
}
