/**
 * PilotTradeBookGetStarted — multi-step Get Started banner shown at the
 * top of the Trade Book once a pilot user has at least one committed
 * trade visible. Same horizontal step-pill style as the Trade Lab and
 * Idea Pipeline Get Started banners — amber gradient strip, three
 * numbered pills with title+hint, arrows between, X to dismiss.
 *
 * Steps:
 *   1. Review the recorded decision — click a trade row to expand it
 *   2. Capture rationale — write a why-now note on that trade
 *   3. Open Outcomes — graduation event (flips
 *      `pilot_progress.graduated_at_<orgId>` and retires pilot gating
 *      for the rest of the org session)
 *
 * Window events listened for:
 *   - 'pilot-tradebook:trade-reviewed'  (Step 1)
 *   - 'pilot-tradebook:rationale-added' (Step 2)
 *   - 'pilot-tradebook:opened-outcomes' (Step 3)
 *
 * State is keyed per user+org so each new pilot client starts fresh.
 */

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, X, ArrowRight, Check } from 'lucide-react'
import { clsx } from 'clsx'

interface PilotTradeBookGetStartedProps {
  userId: string | undefined
  orgId?: string | null
  onOpenOutcomes: () => void
}

const DISMISS = 'dismissed'
const STEP1 = 'reviewed'
const STEP2 = 'rationale'
const STEP3 = 'outcomes'

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_tradebook_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}

export function PilotTradeBookGetStarted({ userId, orgId, onOpenOutcomes }: PilotTradeBookGetStartedProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => userId ? readFlag(userId, orgId, DISMISS) : false)
  const [step1, setStep1] = useState<boolean>(() => userId ? readFlag(userId, orgId, STEP1) : false)
  const [step2, setStep2] = useState<boolean>(() => userId ? readFlag(userId, orgId, STEP2) : false)
  const [step3, setStep3] = useState<boolean>(() => userId ? readFlag(userId, orgId, STEP3) : false)

  useEffect(() => {
    if (!userId) return
    setDismissed(readFlag(userId, orgId, DISMISS))
    setStep1(readFlag(userId, orgId, STEP1))
    setStep2(readFlag(userId, orgId, STEP2))
    setStep3(readFlag(userId, orgId, STEP3))
  }, [userId, orgId])

  const markStep = useCallback((suffix: string, setter: (v: boolean) => void) => {
    if (userId) writeFlag(userId, orgId, suffix)
    setter(true)
  }, [userId, orgId])

  useEffect(() => {
    // See PilotTradeLabIntroBanner for why we queueMicrotask the
    // listener bodies — keeps render-time event dispatchers from
    // triggering setState in this banner during another component's
    // render.
    const defer = (fn: () => void) => () => queueMicrotask(fn)
    const onStep1 = defer(() => markStep(STEP1, setStep1))
    const onStep2 = defer(() => markStep(STEP2, setStep2))
    const onStep3 = defer(() => markStep(STEP3, setStep3))
    window.addEventListener('pilot-tradebook:trade-reviewed', onStep1)
    window.addEventListener('pilot-tradebook:rationale-added', onStep2)
    window.addEventListener('pilot-tradebook:opened-outcomes', onStep3)
    return () => {
      window.removeEventListener('pilot-tradebook:trade-reviewed', onStep1)
      window.removeEventListener('pilot-tradebook:rationale-added', onStep2)
      window.removeEventListener('pilot-tradebook:opened-outcomes', onStep3)
    }
  }, [markStep])

  // Auto-dismiss when all three are done.
  useEffect(() => {
    if (!dismissed && step1 && step2 && step3 && userId) {
      writeFlag(userId, orgId, DISMISS)
      setDismissed(true)
    }
  }, [dismissed, step1, step2, step3, userId, orgId])

  if (dismissed) return null

  const dismiss = () => {
    if (userId) writeFlag(userId, orgId, DISMISS)
    setDismissed(true)
  }

  const handleOpenOutcomes = () => {
    markStep(STEP3, setStep3)
    try { window.dispatchEvent(new CustomEvent('pilot-tradebook:opened-outcomes')) } catch { /* ignore */ }
    onOpenOutcomes()
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
            title="Review the recorded decision"
            hint="Click any trade row to expand its full audit (price, sizing, batch context)."
            done={step1}
          />
          <ArrowRight className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <Step
            n={2}
            title="Capture your rationale"
            hint="Add a why-now note on the trade row — Tesseract scores against this later."
            done={step2}
          />
          <ArrowRight className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <button
            type="button"
            onClick={handleOpenOutcomes}
            className="flex items-start gap-2 min-w-0 cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Step
              n={3}
              title="Open Outcomes"
              hint="See how the decision is performing and unlock the rest of Tesseract."
              done={step3}
            />
          </button>
        </div>
        <button
          onClick={dismiss}
          className="ml-auto -my-1 p-1.5 rounded text-amber-500 hover:text-amber-700 hover:bg-amber-100/60 dark:text-amber-400 dark:hover:text-amber-200 dark:hover:bg-amber-900/30 transition-colors shrink-0"
          title="Dismiss"
          aria-label="Dismiss Trade Book intro"
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
      <div className="min-w-0 text-left">
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
