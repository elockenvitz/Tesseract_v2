/**
 * PilotTradeLabIntroBanner — top-of-page onboarding strip for pilots
 * landing in Trade Lab. Walks the user through the three concrete
 * moves they need to make to commit a trade:
 *   1. Open the recommendation in the Trade Ideas panel
 *   2. Adjust Sim Wt / Sim Shares to size the position
 *   3. Execute the trade — snapshot + commit
 *
 * Pilot UX update (2026-04-25): the banner is taller and more
 * prominent — pilots told us the slim version blended with the
 * header. Step pills now have descriptive copy + a quiet hint
 * underneath each so the user knows exactly what to do, not just
 * "Step 1 of 3." Dismissible per-user via localStorage so a
 * returning pilot isn't re-nagged.
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
    <div className="flex-shrink-0 bg-gradient-to-r from-amber-50 via-amber-50/90 to-amber-100/30 dark:from-amber-900/25 dark:via-amber-900/15 dark:to-gray-900/40 border-b border-amber-200 dark:border-amber-800/60">
      <div className="px-6 py-3 flex items-start gap-4">
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-semibold shrink-0 mt-0.5">
          <Sparkles className="h-4 w-4" />
          <span className="text-[12px] uppercase tracking-wider">Get started</span>
        </div>
        <div className="flex items-start gap-x-4 text-gray-700 dark:text-gray-300 min-w-0 flex-wrap">
          <Step
            n={1}
            title="Review the recommendation"
            hint="The pilot recommendation sits in the Trade Ideas panel on the left."
          />
          <ArrowRight className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <Step
            n={2}
            title="Size the trade"
            hint="Adjust Sim Wt or Sim Shares in the holdings table to set the target."
          />
          <ArrowRight className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <Step
            n={3}
            title="Execute"
            hint="Click Execute to commit — the decision lands on the Trade Book."
          />
        </div>
        <button
          onClick={dismiss}
          className="ml-auto -my-1 p-1.5 rounded text-amber-500 hover:text-amber-700 hover:bg-amber-100/60 dark:text-amber-400 dark:hover:text-amber-200 dark:hover:bg-amber-900/30 transition-colors shrink-0"
          title="Dismiss"
          aria-label="Dismiss Trade Lab intro"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function Step({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px] font-bold tabular-nums shadow-sm">
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-gray-900 dark:text-white leading-tight whitespace-nowrap">
          {title}
        </div>
        <div className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug whitespace-nowrap">
          {hint}
        </div>
      </div>
    </div>
  )
}
