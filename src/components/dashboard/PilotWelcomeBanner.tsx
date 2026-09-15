/**
 * Getting Started — one trade idea through the Tesseract decision loop.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Twelve rows: launcher, feed, asset, rating, note, theme, thought, prompt,
 * list, feedback, referral. A feature inventory. Four of them ticked on
 * opening a tab, two of those only on the browser you happened to use, and the
 * module retired itself on a seven-flag rule that ignored four of the boxes it
 * was still displaying. Nothing in it said what the product is FOR, because no
 * two rows were about the same thing.
 *
 * Five steps now, and they are one decision: capture an idea, develop the
 * reasoning, test it, record the decision, then look at what happened.
 *
 * ── Where the truth is ────────────────────────────────────────────────────
 *
 * Not here. `usePilotMission` reads it and `missionState` decides it; this file
 * only draws. That separation is the point — the previous generation had the
 * checklist deciding completion for itself, which is how it ended up
 * disagreeing with the rule that dismissed it.
 *
 * ── Why future steps are shown ────────────────────────────────────────────
 *
 * So the journey is legible from the first minute. A step whose prerequisite
 * is unmet is not a control and says plainly what comes first. That is a
 * reason, not an error, and it is deliberately not styled as one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useOrganization } from '../../contexts/OrganizationContext'
import { usePilotMission, logMissionStep } from '../../hooks/usePilotMission'
import type { MissionStepId } from '../../lib/pilot/mission'
import { PilotMissionSkeleton } from '../pilot/PilotHomeSkeletons'

interface PilotWelcomeBannerProps {
  onNavigate: (result: any) => void
}

export function PilotWelcomeBanner({ onNavigate }: PilotWelcomeBannerProps) {
  const { currentOrgId } = useOrganization()
  const mission = usePilotMission()

  /*
   * Collapse is a per-device preference and stays local. Completion is not,
   * and does not — that distinction is the whole lesson of the version this
   * replaces, where a browser-local flag was the only record a step was done.
   */
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(`pilot-mission-expanded-${currentOrgId}`) !== 'false' } catch { return true }
  })
  const toggleExpanded = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      try { localStorage.setItem(`pilot-mission-expanded-${currentOrgId}`, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [currentOrgId])

  /*
   * There is no dismiss.
   *
   * It was offered once the mission completed, which sounds harmless and is
   * the wrong shape: this module is how a pilot advances, so a control that
   * removes it is a control that removes the way forward. Collapse is the
   * affordance for "not now", and it is per device and reversible.
   */

  /*
   * One telemetry row per step, on the first transition only.
   *
   * Tracked against what has already been reported in this session rather than
   * against the previous render, so a refresh does not re-log four steps that
   * were finished last week.
   */
  const reported = useRef<Set<string>>(new Set())
  const shown = useRef(false)
  useEffect(() => {
    if (mission.isLoading) return
    if (!shown.current) {
      shown.current = true
      logMissionStep('shown', currentOrgId)
    }
    for (const step of mission.steps) {
      if (!step.done || reported.current.has(step.id)) continue
      reported.current.add(step.id)
      logMissionStep(step.id, currentOrgId)
    }
    if (mission.complete && !reported.current.has('graduated')) {
      reported.current.add('graduated')
      logMissionStep('graduated', currentOrgId)
    }
  }, [mission.isLoading, mission.steps, mission.complete, currentOrgId])

  const act = useCallback((id: MissionStepId) => {
    const ideaId = mission.tutorialIdeaId
    switch (id) {
      case 'idea_created':
        /* The canonical capture flow, pre-focused on a trade idea. Its success
           is what adopts the new row as the tutorial idea — see the listener
           in `usePilotMission`. */
        try {
          window.dispatchEvent(new CustomEvent('openThoughtsCapture', { detail: { captureType: 'trade_idea' } }))
        } catch { /* ignore */ }
        return
      case 'pipeline_advanced':
        onNavigate({ id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue', data: { focusIdeaId: ideaId } })
        return
      case 'simulation_completed':
        // The idea travels with the request, so the reader is never asked to
        // remember which one they were working on.
        onNavigate({ id: 'trade-lab', title: 'Trade Lab', type: 'trade-lab', data: { tradeQueueItemId: ideaId } })
        return
      case 'decision_submitted':
        // Stage 4 is Trade Book. (This opened the Idea Pipeline, from when the
        // decision was made there.)
        onNavigate({ id: 'trade-book', title: 'Trade Book', type: 'trade-book', data: null })
        return
      case 'outcome_reviewed':
        /*
         * Navigate only. Pressing a button is not reviewing an outcome, and
         * marking here would complete the step — and graduate the pilot — for
         * somebody who clicked and landed on an error. Outcomes marks it once
         * it has actually resolved this decision; if it cannot, the step
         * stays open, which is the honest result.
         */
        // The Outcomes page, not a decision on it: the stage's own steps start
        // with opening the decision there. (This carried the decision to
        // review, which Outcomes opens as its full-screen detail.)
        onNavigate({ id: 'outcomes', title: 'Outcomes', type: 'outcomes', data: null })
        return
    }
  }, [mission, onNavigate])

  /*
   * Held, not hidden.
   *
   * This returned null, and the coverage banner underneath it therefore
   * rendered at the top of the page and was pushed down a beat later when
   * the mission arrived. Nothing was slow; the page just moved.
   */
  if (mission.isLoading) return <PilotMissionSkeleton />

  const { completedCount, total, currentStepId, complete } = mission

  return (
    <div className="relative rounded-xl border border-indigo-200/60 bg-gradient-to-r from-indigo-50 to-blue-50 dark:border-indigo-800/40 dark:from-indigo-950/30 dark:to-blue-950/20">
      <div className="flex items-start justify-between gap-3 px-4 py-2.5">
        <button onClick={toggleExpanded} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          {expanded
            ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
            : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight text-gray-900 dark:text-gray-100">
              Getting Started
            </h3>
            <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
              Take one trade idea through the Tesseract decision loop.{' '}
              {complete ? 'All done.' : `${completedCount} of ${total} complete.`}
            </p>
          </div>
        </button>
      </div>

      {expanded && (
        <ol className="space-y-1 px-3 pb-3">
          {mission.steps.map((step, i) => {
            const current = step.id === currentStepId
            return (
              <li
                key={step.id}
                className={clsx(
                  'flex items-start gap-2.5 rounded-lg px-2.5 py-2',
                  current && 'bg-white/80 ring-1 ring-indigo-200 dark:bg-gray-900/50 dark:ring-indigo-800/60',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {step.done
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : (
                      <span className={clsx(
                        'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold',
                        current
                          ? 'bg-indigo-500 text-white'
                          : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                      )}>{i + 1}</span>
                    )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={clsx(
                    'text-[13px] font-medium leading-tight',
                    step.done
                      ? 'text-gray-500 dark:text-gray-500'
                      : step.available ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500',
                  )}>
                    {step.label}
                  </p>
                  {/* The reason a step is not yet available takes the place of
                      its hint — quiet, and never styled as a failure. */}
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                    {step.available ? step.hint : step.blockedBy}
                  </p>
                </div>
                {/* One control, on the step that is actually next. A finished
                    step keeps a quiet way back to what it taught. */}
                {current && (
                  <button
                    onClick={() => act(step.id)}
                    className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-indigo-700"
                  >
                    {step.cta}
                  </button>
                )}
                {step.done && !current && (
                  <button
                    onClick={() => act(step.id)}
                    className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-gray-500 hover:bg-white/60 dark:hover:bg-gray-800"
                  >
                    Revisit
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
