/**
 * PilotPostGradGetStarted — top-of-dashboard onboarding strip surfaced
 * ONLY after the user has completed the pilot loop (Pipeline → Trade Lab
 * → Trade Book → Outcomes, i.e. `pilot_progress.graduated_at_<orgId>`
 * is set).
 *
 * Walks the user through three "now what" affordances the rest of
 * Tesseract is built around:
 *   1. Select the app launcher (top-left) to see what else is here
 *   2. Provide feedback so we can keep improving
 *   3. Recommend another user / invite a teammate
 *
 * Each step ticks off when the user OPENS the corresponding UI — a
 * lighter completion bar than the earlier banners (which gate on real
 * actions like executing a trade). State is persisted server-side via
 * usePilotProgress, keyed per (user, org). Banner has no dismiss
 * control: it auto-retires when all three are done.
 *
 * Window events the banner listens for:
 *   - 'pilot-postgrad:app-launcher-opened'
 *   - 'pilot-postgrad:feedback-opened'
 *   - 'pilot-postgrad:recommend-opened'
 *
 * Dispatch these from wherever the corresponding UI mounts/opens —
 * keeps wiring loose so any future trigger paths can also tick a step.
 */

import { useEffect } from 'react'
import { Sparkles, ArrowRight, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { usePilotProgress } from '../../hooks/usePilotProgress'

export function PilotPostGradGetStarted() {
  const {
    hasGraduated,
    hasCompletedPostGradAppLauncher,
    hasCompletedPostGradFeedback,
    hasCompletedPostGradRecommend,
    mark,
  } = usePilotProgress()

  // Listen for the open events; each handler short-circuits inside
  // usePilotProgress.markStage when the stage is already set, so
  // repeat-opens don't repeatedly hit the DB or refire telemetry.
  useEffect(() => {
    const onLauncher = () => mark('post_grad_step_app_launcher')
    const onFeedback = () => mark('post_grad_step_feedback')
    const onRecommend = () => mark('post_grad_step_recommend')
    window.addEventListener('pilot-postgrad:app-launcher-opened', onLauncher)
    window.addEventListener('pilot-postgrad:feedback-opened', onFeedback)
    window.addEventListener('pilot-postgrad:recommend-opened', onRecommend)
    return () => {
      window.removeEventListener('pilot-postgrad:app-launcher-opened', onLauncher)
      window.removeEventListener('pilot-postgrad:feedback-opened', onFeedback)
      window.removeEventListener('pilot-postgrad:recommend-opened', onRecommend)
    }
  }, [mark])

  // Show only after graduation, and hide once all three steps are done.
  if (!hasGraduated) return null
  if (
    hasCompletedPostGradAppLauncher &&
    hasCompletedPostGradFeedback &&
    hasCompletedPostGradRecommend
  ) return null

  return (
    <div className="flex-shrink-0 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-gradient-to-r from-amber-50 via-amber-50/90 to-amber-100/30 dark:from-amber-900/25 dark:via-amber-900/15 dark:to-gray-900/40">
      <div className="px-4 py-3 flex items-start gap-4">
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-semibold shrink-0 mt-0.5">
          <Sparkles className="h-4 w-4" />
          <span className="text-[12px] uppercase tracking-wider">Next steps</span>
        </div>
        <div className="flex flex-col md:flex-row md:items-start gap-y-2 md:gap-x-4 text-gray-700 dark:text-gray-300 min-w-0">
          <Step
            n={1}
            title="Open the app launcher"
            hint="Click the launcher in the top-left to see everything else Tesseract can do."
            done={hasCompletedPostGradAppLauncher}
          />
          <ArrowRight className="hidden md:block h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <Step
            n={2}
            title="Provide feedback"
            hint="Tell us what's working and what's not — it shapes the next release."
            done={hasCompletedPostGradFeedback}
          />
          <ArrowRight className="hidden md:block h-3.5 w-3.5 text-amber-400 dark:text-amber-500 shrink-0 mt-[3px]" />
          <Step
            n={3}
            title="Recommend a teammate"
            hint="Invite another investor or analyst who'd get value from Tesseract."
            done={hasCompletedPostGradRecommend}
          />
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, hint, done }: { n: number; title: string; hint: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span
        className={clsx(
          'shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums shadow-sm',
          done ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white',
        )}
      >
        {done ? <Check className="h-3 w-3" /> : n}
      </span>
      <div className="min-w-0">
        <div className={clsx('text-[12px] font-semibold leading-tight', done && 'line-through text-gray-500 dark:text-gray-400')}>
          {title}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
          {hint}
        </div>
      </div>
    </div>
  )
}
