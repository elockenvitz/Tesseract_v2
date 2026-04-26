/**
 * PilotGraduationModal — global graduation modal mounted at the
 * Dashboard level so it persists across tab navigation.
 *
 * Why global: the original modal lived inside the Outcomes page's
 * PilotOutcomesGetStarted. When the user clicked the step-3 CTA
 * ("Update research on this asset"), the navigation event fired and
 * the asset tab opened — but Outcomes unmounted before the modal
 * could even render, so the user landed on the asset page with no
 * graduation message at all.
 *
 * Mounting this at the Dashboard level (above TabManager) keeps the
 * modal alive regardless of which tab the user lands on.
 *
 * Trigger: PilotOutcomesGetStarted writes a `pending_graduation_modal`
 * localStorage flag the moment all 3 step events have fired. This
 * component reads that flag on mount + listens for a
 * `pilot-graduation:trigger` window event and shows the modal.
 * Dismiss writes a `graduation_dismissed` flag so the modal only
 * pops once per (user, org).
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Trophy, LayoutDashboard, Grid3x3 } from 'lucide-react'

interface PilotGraduationModalProps {
  userId: string | undefined
  orgId?: string | null
  onOpenDashboard?: () => void
  onOpenAppLauncher?: () => void
}

const PENDING = 'pending_graduation_modal'
const DISMISS = 'graduation_dismissed'

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_outcomes_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string, orgId: string | null | undefined, suffix: string): boolean {
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}
function clearFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.removeItem(flagKey(userId, orgId, suffix)) } catch { /* ignore */ }
}

export function PilotGraduationModal({
  userId,
  orgId,
  onOpenDashboard,
  onOpenAppLauncher,
}: PilotGraduationModalProps) {
  const recompute = useCallback(() => {
    if (!userId) return false
    if (readFlag(userId, orgId, DISMISS)) return false
    return readFlag(userId, orgId, PENDING)
  }, [userId, orgId])

  const [open, setOpen] = useState<boolean>(() => recompute())

  // Re-read on user/org change (analyst switching pilot clients).
  useEffect(() => {
    setOpen(recompute())
  }, [recompute])

  // Listen for the trigger event so PilotOutcomesGetStarted (or any
  // other surface) can pop the modal without prop wiring.
  useEffect(() => {
    const handler = () => setOpen(recompute())
    window.addEventListener('pilot-graduation:trigger', handler)
    return () => window.removeEventListener('pilot-graduation:trigger', handler)
  }, [recompute])

  if (!userId || !open) return null

  const dismiss = () => {
    if (userId) {
      writeFlag(userId, orgId, DISMISS)
      // Clear the pending flag so it doesn't re-trigger on the next
      // page load if the user dismisses without graduating again.
      clearFlag(userId, orgId, PENDING)
    }
    setOpen(false)
  }

  return (
    // Backdrop is intentionally NOT clickable — the graduation moment
    // is a celebration the user should see and acknowledge, not
    // something to be missed by accident. They must pick one of the
    // three explicit options below.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative max-w-md w-full bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-emerald-200 dark:border-emerald-800/60 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-teal-400 to-primary-400" />
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 flex items-center justify-center shadow-inner">
              <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-300">
                You've graduated
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                The full app is unlocked
              </h2>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
            You've finished the pilot loop — capture, decide, execute, reflect.
            Tesseract's research workspace, themes, lists, and process tools are
            all open to you now. Where do you want to go next?
          </p>

          <div className="space-y-2 mb-3">
            <button
              type="button"
              onClick={() => { onOpenDashboard?.(); dismiss() }}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4" />
                <div>
                  <div className="text-sm font-semibold">Open the Dashboard</div>
                  <div className="text-[11px] opacity-90">
                    See attention items, recent decisions, and what's queued up next.
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => { onOpenAppLauncher?.(); dismiss() }}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/40 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Grid3x3 className="w-4 h-4" />
                <div>
                  <div className="text-sm font-semibold">Browse the App Launcher</div>
                  <div className="text-[11px] opacity-90">
                    Top-left grid icon — every surface in Tesseract is one click away.
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="w-full text-center text-[12px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-2 border-t border-gray-100 dark:border-gray-800 transition-colors"
          >
            Keep exploring on this page
          </button>
        </div>
      </div>
    </div>
  )
}
