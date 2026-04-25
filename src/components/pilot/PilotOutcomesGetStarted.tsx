/**
 * PilotOutcomesGetStarted — Get Started banner shown at the top of
 * Outcomes for a pilot user the first time they land here.
 *
 * Reaching Outcomes is the graduation moment — pilot gating drops
 * away and the rest of Tesseract becomes available. This banner
 * acknowledges the milestone and points the user at the next loop:
 *
 *   1. Inspect the result — click your committed decision in the
 *      table to see Outcomes's analysis (price move, performance,
 *      thesis scoring) in the right pane.
 *   2. Review the next-step actions — under "How it's performing"
 *      Outcomes surfaces CTAs like "open a counter-trade" or
 *      "update research". These are how the loop continues.
 *   3. Start the next research thread — open an asset page to
 *      kick off the next idea.
 *
 * State is keyed per user+org so each new pilot client starts fresh.
 * Window events the banner listens for:
 *   - 'pilot-outcomes:result-inspected'   (Step 1)
 *   - 'pilot-outcomes:next-action-viewed' (Step 2)
 *   - 'pilot-outcomes:research-started'   (Step 3)
 */

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, X, ArrowRight, Check, Trophy } from 'lucide-react'
import { clsx } from 'clsx'

interface PilotOutcomesGetStartedProps {
  userId: string | undefined
  orgId?: string | null
  /** Click handler for the final "Begin research on an asset" CTA.
   *  Parent wires this to navigation (typically opens the asset page
   *  for the most-recently-committed decision). */
  onStartResearch: () => void
}

const DISMISS = 'dismissed'
const STEP1 = 'inspected'
const STEP2 = 'next_action'
const STEP3 = 'research'

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_outcomes_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}

export function PilotOutcomesGetStarted({ userId, orgId, onStartResearch }: PilotOutcomesGetStartedProps) {
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
    // listener bodies.
    const defer = (fn: () => void) => () => queueMicrotask(fn)
    const onStep1 = defer(() => markStep(STEP1, setStep1))
    const onStep2 = defer(() => markStep(STEP2, setStep2))
    const onStep3 = defer(() => markStep(STEP3, setStep3))
    window.addEventListener('pilot-outcomes:result-inspected', onStep1)
    window.addEventListener('pilot-outcomes:next-action-viewed', onStep2)
    window.addEventListener('pilot-outcomes:research-started', onStep3)
    return () => {
      window.removeEventListener('pilot-outcomes:result-inspected', onStep1)
      window.removeEventListener('pilot-outcomes:next-action-viewed', onStep2)
      window.removeEventListener('pilot-outcomes:research-started', onStep3)
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

  const handleStartResearch = () => {
    markStep(STEP3, setStep3)
    try { window.dispatchEvent(new CustomEvent('pilot-outcomes:research-started')) } catch { /* ignore */ }
    onStartResearch()
  }

  return (
    <div className="mx-5 mt-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-gradient-to-r from-emerald-50 via-teal-50 to-primary-50 dark:from-emerald-950/40 dark:via-teal-950/20 dark:to-primary-950/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center flex-shrink-0">
          <Trophy className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              <Sparkles className="w-2.5 h-2.5" />
              You've reached Outcomes — full Tesseract unlocked
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            One more pass and you've closed the loop
          </p>
          <ol className="space-y-1.5">
            <Step
              n={1}
              title="Inspect the result"
              hint="Click your decision in the table to see how Outcomes scored the thesis."
              done={step1}
            />
            <Step
              n={2}
              title="Review the next-step actions"
              hint={`Look under "How it's performing" in the right pane for follow-on options.`}
              done={step2}
            />
            <Step
              n={3}
              title="Start your next research thread"
              hint="Open an asset page and begin the next idea — the loop runs continuously."
              done={step3}
            />
          </ol>
        </div>

        <div className="flex flex-col items-stretch gap-1.5 flex-shrink-0">
          <button
            onClick={handleStartResearch}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Start research
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={dismiss}
            className="self-end p-1 rounded-md hover:bg-white/60 dark:hover:bg-gray-800/60 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, hint, done }: { n: number; title: string; hint: string; done: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={clsx(
          "shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums shadow-sm mt-px",
          done ? "bg-emerald-500 text-white" : "bg-emerald-600 text-white",
        )}
      >
        {done ? <Check className="h-3 w-3" /> : n}
      </span>
      <div className="min-w-0">
        <div
          className={clsx(
            "text-[11px] font-semibold leading-tight",
            done ? "text-emerald-700 dark:text-emerald-300 line-through opacity-70" : "text-gray-900 dark:text-white",
          )}
        >
          {title}
        </div>
        <div
          className={clsx(
            "text-[10px] leading-snug",
            done ? "text-emerald-600/60 dark:text-emerald-400/60" : "text-gray-600 dark:text-gray-400",
          )}
        >
          {hint}
        </div>
      </div>
    </li>
  )
}
