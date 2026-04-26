/**
 * PilotWorkspaceCustomizationCard
 *
 * Shown on the dashboard AFTER pilot graduation. Replaces the
 * "Get Started" pilot checklist (which dismisses on completion) with
 * an OPTIONAL personalization prompt.
 *
 * Design principle: before value is proven, setup is friction; after
 * value is proven, setup becomes personalization. So this card never
 * blocks; it offers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, X, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { SetupWizard } from '../onboarding/SetupWizard'

interface PilotWorkspaceCustomizationCardProps {
  /** Hide the card if true (e.g. user already finished the wizard via another entry point). */
  forceHide?: boolean
}

interface ChecklistItem {
  id: string
  label: string
  hint: string
  done: boolean
}

const DISMISS_KEY = (userId: string, orgId: string | null) =>
  `pilot-workspace-customization-dismissed-${userId}-${orgId || 'no-org'}`

/** Per-(user, org) localStorage key for tracking which wizard steps
 *  the user has completed FOR THIS ORG. The underlying
 *  `user_onboarding_status.steps_completed` is per-user globally —
 *  reusing it would pre-tick every step on a freshly-graduated org
 *  whenever the user had previously completed the wizard elsewhere. */
const STEP_KEY = (userId: string, orgId: string | null, stepId: string) =>
  `pilot-workspace-customization-step-${stepId}-${userId}-${orgId || 'no-org'}`

export function PilotWorkspaceCustomizationCard({ forceHide }: PilotWorkspaceCustomizationCardProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const [showWizard, setShowWizard] = useState(false)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!user?.id) return false
    try { return localStorage.getItem(DISMISS_KEY(user.id, currentOrgId)) === '1' } catch { return false }
  })

  // Per-(user, org) completion is tracked in localStorage. The
  // SetupWizard fires a `setup-wizard:step-completed` window event
  // when a step is committed; we stamp the per-org flag in response
  // so this card stays in sync without depending on the underlying
  // (per-user-global) onboarding status row.
  const stepIds = ['profile', 'role-specific', 'integrations', 'teams'] as const
  type StepId = typeof stepIds[number]
  const readDoneSet = useCallback((): Set<StepId> => {
    if (!user?.id) return new Set()
    const set = new Set<StepId>()
    for (const id of stepIds) {
      try {
        if (localStorage.getItem(STEP_KEY(user.id, currentOrgId, id)) === '1') set.add(id)
      } catch { /* ignore */ }
    }
    return set
  }, [user?.id, currentOrgId])

  const [completedSet, setCompletedSet] = useState<Set<StepId>>(() => readDoneSet())

  // Re-hydrate when the (user, org) identity changes.
  useEffect(() => {
    setCompletedSet(readDoneSet())
  }, [readDoneSet])

  // Listen for wizard step-complete events so the checklist ticks
  // live without requiring a page refresh.
  useEffect(() => {
    if (!user?.id) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const stepId = detail.stepId as StepId | undefined
      if (!stepId || !stepIds.includes(stepId as StepId)) return
      try { localStorage.setItem(STEP_KEY(user.id, currentOrgId, stepId), '1') } catch { /* ignore */ }
      setCompletedSet(prev => {
        if (prev.has(stepId)) return prev
        const next = new Set(prev)
        next.add(stepId)
        return next
      })
    }
    window.addEventListener('setup-wizard:step-completed', handler as EventListener)
    return () => window.removeEventListener('setup-wizard:step-completed', handler as EventListener)
  }, [user?.id, currentOrgId])

  const items: ChecklistItem[] = useMemo(() => [
    { id: 'profile',       label: 'Confirm your profile',         hint: '30 sec',    done: completedSet.has('profile') },
    { id: 'role-specific', label: 'Define your focus / coverage', hint: '1 min',     done: completedSet.has('role-specific') },
    { id: 'integrations',  label: 'Connect your data sources',    hint: 'optional',  done: completedSet.has('integrations') },
    { id: 'teams',         label: 'Invite teammates / set access', hint: 'admin',    done: completedSet.has('teams') },
  ], [completedSet])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    if (user?.id) {
      try { localStorage.setItem(DISMISS_KEY(user.id, currentOrgId), '1') } catch { /* ignore */ }
    }
  }, [user?.id, currentOrgId])

  const handleWizardClose = useCallback(() => {
    setShowWizard(false)
  }, [])

  // Hide if any of: parent says hide, user dismissed FOR THIS ORG,
  // or auth/org not yet loaded.
  // Note: we deliberately do NOT gate on
  // `onboardingStatus.wizard_completed` — that flag is per-user
  // globally, but each new workspace (e.g. a graduated pilot org)
  // is a fresh personalization moment. Dismissal is per-(user, org)
  // via localStorage so each org tracks independently.
  if (forceHide) return null
  if (dismissed) return null
  if (!user?.id) return null

  return (
    <>
      <div className="relative bg-gradient-to-r from-emerald-50 via-teal-50 to-primary-50 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-primary-950/30 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40">
        <div className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                  Make this your workspace
                </h3>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                  You've seen how Tesseract works. Customize it to match how you actually invest.
                </p>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded shrink-0"
              title="Skip for now"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Checklist — 2-column grid like the Get Started cards. */}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => setShowWizard(true)}
                className={clsx(
                  'group flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all',
                  item.done
                    ? 'bg-white/40 border-emerald-200/70 dark:bg-gray-800/30 dark:border-emerald-800/40'
                    : 'bg-white/80 border-emerald-200/60 hover:bg-white hover:border-emerald-300 hover:shadow-sm dark:bg-gray-800/60 dark:border-emerald-800/40',
                )}
              >
                <span className={clsx(
                  'shrink-0 w-4 h-4 rounded-full flex items-center justify-center',
                  item.done
                    ? 'bg-emerald-500 text-white'
                    : 'border border-emerald-300 text-emerald-500',
                )}>
                  {item.done ? <Check className="w-3 h-3" /> : null}
                </span>
                <span className={clsx(
                  'text-[12px] font-medium leading-tight flex-1 truncate',
                  item.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200',
                )}>
                  {item.label}
                </span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{item.hint}</span>
              </button>
            ))}
          </div>

          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              onClick={handleDismiss}
              className="px-2.5 py-1 text-[12px] font-medium text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              Skip for now
            </button>
            <button
              onClick={() => setShowWizard(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors"
            >
              Customize workspace
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {showWizard && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center">
          <div className="w-full max-w-3xl h-[90vh] overflow-hidden bg-white dark:bg-gray-800 rounded-2xl shadow-2xl">
            <SetupWizard
              mode="workspace_customization"
              onComplete={handleWizardClose}
              onSkip={handleWizardClose}
              isModal
            />
          </div>
        </div>
      )}
    </>
  )
}
