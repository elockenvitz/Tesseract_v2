/**
 * PilotTradeLabIntroBanner — top-of-page onboarding strip for pilots
 * landing in Trade Lab. Walks them through the three concrete moves
 * to commit a trade:
 *   1. Click / expand the recommendation card to review the details
 *   2. Add the recommendation and size the trade
 *   3. Execute
 *
 * Steps tick off as the user does them — same progress pattern as the
 * Idea Pipeline banner. Each step listens for a window event:
 *   - 'pilot-tradelab:rec-reviewed'  (Step 1)
 *   - 'pilot-tradelab:rec-sized'     (Step 2)
 *   - 'pilot-tradelab:executed'      (Step 3)
 *
 * The banner auto-retires once all three are done. Users can also
 * manually dismiss via the X. State is keyed per user+org so each
 * new pilot client gets a fresh banner with all three steps unchecked.
 */

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, X, ArrowRight, Check } from 'lucide-react'
import { clsx } from 'clsx'

interface PilotTradeLabIntroBannerProps {
  userId: string
  /** Active org id, used to scope the banner state per pilot client. */
  orgId?: string | null
}

const STEP1 = 'rec_reviewed'
const STEP2 = 'rec_sized'
const STEP3 = 'executed'
const DISMISS = 'dismissed'

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_tradelab_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}

export function PilotTradeLabIntroBanner({ userId, orgId }: PilotTradeLabIntroBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => readFlag(userId, orgId, DISMISS))
  const [step1, setStep1] = useState<boolean>(() => readFlag(userId, orgId, STEP1))
  const [step2, setStep2] = useState<boolean>(() => readFlag(userId, orgId, STEP2))
  const [step3, setStep3] = useState<boolean>(() => readFlag(userId, orgId, STEP3))

  // Reload from localStorage when user/org changes — picks up the
  // right state when the analyst switches between pilot clients.
  useEffect(() => {
    setDismissed(readFlag(userId, orgId, DISMISS))
    setStep1(readFlag(userId, orgId, STEP1))
    setStep2(readFlag(userId, orgId, STEP2))
    setStep3(readFlag(userId, orgId, STEP3))
  }, [userId, orgId])

  const markStep = useCallback((suffix: string, setter: (v: boolean) => void) => {
    writeFlag(userId, orgId, suffix)
    setter(true)
  }, [userId, orgId])

  // Listen for the three step events. Each only fires when this
  // banner instance is alive — events dispatched while the user
  // isn't on the lab page just no-op (the matching localStorage
  // flag stays false), which is fine because the banner's whole
  // job is on-page coaching.
  useEffect(() => {
    // Defer the setState via queueMicrotask. Window events dispatch
    // synchronously, so a dispatch that happens during a parent
    // component's render (e.g., HoldingsSimulationTable kicks an
    // event from a state-update callback) would otherwise call our
    // setState during their render and trip React's "Cannot update
    // a component while rendering a different component" warning.
    // queueMicrotask runs after the current render flushes.
    const defer = (fn: () => void) => () => queueMicrotask(fn)
    const onStep1 = defer(() => markStep(STEP1, setStep1))
    const onStep2 = defer(() => markStep(STEP2, setStep2))
    const onStep3 = defer(() => markStep(STEP3, setStep3))
    window.addEventListener('pilot-tradelab:rec-reviewed', onStep1)
    window.addEventListener('pilot-tradelab:rec-sized', onStep2)
    window.addEventListener('pilot-tradelab:executed', onStep3)
    return () => {
      window.removeEventListener('pilot-tradelab:rec-reviewed', onStep1)
      window.removeEventListener('pilot-tradelab:rec-sized', onStep2)
      window.removeEventListener('pilot-tradelab:executed', onStep3)
    }
  }, [markStep])

  // Auto-dismiss when all three actions are done.
  useEffect(() => {
    if (!dismissed && step1 && step2 && step3) {
      writeFlag(userId, orgId, DISMISS)
      setDismissed(true)
    }
  }, [dismissed, step1, step2, step3, userId, orgId])

  if (dismissed) return null

  const dismiss = () => {
    writeFlag(userId, orgId, DISMISS)
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
            title="Review and add the recommendation"
            hint="Check the box on the recommendation card on the left to import it into the holdings table."
            done={step1}
          />
          <ArrowRight className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <Step
            n={2}
            title="Adjust sizing and select the trade"
            hint="Tweak Sim Wt if needed, then check the box on the trade row in the holdings table."
            done={step2}
          />
          <ArrowRight className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <Step
            n={3}
            title="Execute"
            hint="Click Execute Trade to commit it to the Trade Book."
            done={step3}
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

function Step({ n, title, hint, done }: { n: number; title: string; hint: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span
        className={clsx(
          "shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums shadow-sm",
          done ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
        )}
      >
        {done ? <Check className="h-3 w-3" /> : n}
      </span>
      <div className="min-w-0">
        <div
          className={clsx(
            "text-[12px] font-semibold leading-tight whitespace-nowrap",
            done ? "text-emerald-700 dark:text-emerald-300 line-through opacity-70" : "text-gray-900 dark:text-white"
          )}
        >
          {title}
        </div>
        <div
          className={clsx(
            "text-[11px] leading-snug whitespace-nowrap",
            done ? "text-emerald-600/60 dark:text-emerald-400/60" : "text-gray-600 dark:text-gray-400"
          )}
        >
          {hint}
        </div>
      </div>
    </div>
  )
}
