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
 * Trigger: graduation itself. `hasGraduated` is the durable, per-org,
 * server-backed answer to whether the pilot finished the loop, and it
 * is the same value that widens access and retires Pilot Home — so the
 * celebration and the thing it celebrates can no longer disagree.
 *
 * It used to open on a `pending_graduation_modal` localStorage flag
 * that PilotOutcomesGetStarted wrote the moment its three LOCAL step
 * flags were set, without ever consulting graduation. That flag is
 * written before the durable `graduated` write is reflected, so the
 * modal could announce "the full app is unlocked" to a reader whose
 * every tab was still gated and whose "Open the Dashboard" button
 * dropped them back on the pilot mission home. It was also per-browser,
 * so clearing site data re-congratulated someone who graduated weeks
 * ago and a second device congratulated nobody at all.
 *
 * Acknowledgement is durable too — `graduation_celebrated` in
 * pilot_progress — for the same reasons. The legacy localStorage
 * dismissal is still READ once, so a pilot who already saw this does
 * not see it again, and acknowledging migrates them forward.
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Trophy, LayoutDashboard, Grid3x3 } from 'lucide-react'
import { usePilotProgress } from '../../hooks/usePilotProgress'

interface PilotGraduationModalProps {
  userId: string | undefined
  orgId?: string | null
  onOpenDashboard?: () => void
  onOpenAppLauncher?: () => void
}

/** The pre-durable dismissal. Read so an already-congratulated pilot is not
 *  congratulated again; written alongside the durable one so a browser that
 *  has not yet synced still behaves. Never consulted about graduation. */
const LEGACY_DISMISS = 'graduation_dismissed'

function legacyKey(userId: string, orgId: string | null | undefined) {
  return `pilot_outcomes_intro_${LEGACY_DISMISS}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readLegacyDismiss(userId: string, orgId: string | null | undefined): boolean {
  try { return localStorage.getItem(legacyKey(userId, orgId)) === '1' } catch { return false }
}
function writeLegacyDismiss(userId: string, orgId: string | null | undefined) {
  try { localStorage.setItem(legacyKey(userId, orgId), '1') } catch { /* ignore */ }
}

export function PilotGraduationModal({
  userId,
  orgId,
  onOpenDashboard,
  onOpenAppLauncher,
}: PilotGraduationModalProps) {
  const { hasGraduated, hasCelebratedGraduation, mark } = usePilotProgress()

  // Acknowledged in this browser before the durable flag existed. Snapshot it
  // per (user, org) rather than reading on every render, so dismissing does not
  // depend on a storage read landing before the next paint.
  const seenLegacy = useCallback(
    () => (userId ? readLegacyDismiss(userId, orgId) : false),
    [userId, orgId],
  )
  const [acknowledged, setAcknowledged] = useState<boolean>(seenLegacy)
  useEffect(() => { setAcknowledged(seenLegacy()) }, [seenLegacy])

  /*
   * Graduation is the trigger, and it is durable. `hasGraduated` flips in the
   * cache the moment the mark is made and rolls back if the write fails, so
   * there is no frame where this claims the app is open while the gate that
   * opens it disagrees.
   */
  const open = !!userId && hasGraduated && !hasCelebratedGraduation && !acknowledged

  if (!open) return null

  const dismiss = () => {
    // Optimistic locally so the modal closes on the click, durable so it stays
    // closed on the next device.
    setAcknowledged(true)
    if (userId) writeLegacyDismiss(userId, orgId)
    mark('graduation_celebrated')
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
