import { Check } from 'lucide-react'
import { clsx } from 'clsx'
import { usePilotMission } from '../../hooks/usePilotMission'
import { isDesktopOnly } from '../../lib/mobile/mobile-surfaces'
import { PilotMissionStripSkeleton } from '../pilot/PilotHomeSkeletons'
import type { MissionStep, MissionStepId } from '../../lib/pilot/mission'

/**
 * The pilot mission on a phone: all five steps, one of them open.
 *
 * ── Why all five ─────────────────────────────────────────────────────────
 *
 * It showed the current step alone, on the argument that a reader has one
 * move to make. True, and it left them unable to see what they were being
 * taught. Five steps is not a checklist of chores; it is the shape of one
 * decision — capture, develop, test, decide, review — and a reader on step
 * one who cannot see step five does not know what the product is for. The
 * home also looked empty, which is its own kind of answer about how much
 * there is here.
 *
 * ── Why it is not five cards ─────────────────────────────────────────────
 *
 * Because four of them are not being acted on. A finished step and a step
 * that is not reachable yet each need one line: a mark and a name. The
 * current one gets the hint and the control, which is the only place either
 * is any use. So the roadmap is legible in about the height the single strip
 * plus a gap used to take, rather than five times it.
 *
 * ── Same truth, less of it ────────────────────────────────────────────────
 *
 * `usePilotMission` and `missionState` are the desktop model unchanged. There
 * is deliberately no second state machine here, and no expansion state
 * either: the open step is the current one, which the mission already knows.
 * A phone that decided completion for itself would be a phone that eventually
 * disagrees with the laptop about what the reader has done.
 *
 * ── The desktop handoff ───────────────────────────────────────────────────
 *
 * Trade Lab has no phone treatment — the mobile registry says so — and the
 * honest answer is to say that rather than route into a surface that does not
 * work or fake the step complete. Every other step's destination is reachable
 * here.
 */
export function PilotMissionStrip({ onNavigate }: { onNavigate?: (result: any) => void }) {
  const mission = usePilotMission()

  // Held while loading so the banner below does not start at the top of
  // the screen and get pushed down. Gone for good once complete.
  if (mission.isLoading) return <PilotMissionStripSkeleton />
  if (mission.complete) return null

  const act = (id: MissionStepId) => {
    const ideaId = mission.tutorialIdeaId
    if (id === 'idea_created') {
      try {
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', { detail: { captureType: 'trade_idea' } }))
      } catch { /* ignore */ }
      return
    }
    if (id === 'outcome_reviewed') {
      // Navigate only — Outcomes marks the step once it has resolved the
      // decision. See the same note on the desktop module.
      onNavigate?.({ id: 'outcomes', title: 'Outcomes', type: 'outcomes', data: { tradeQueueItemId: ideaId } })
      return
    }
    onNavigate?.({
      id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue',
      data: { focusIdeaId: ideaId },
    })
  }

  /* Trade Lab is desktop-only; the registry is the single source for that. */
  const strandedOnPhone = (step: MissionStep) =>
    step.id === 'simulation_completed' && isDesktopOnly('trade-lab')

  return (
    <div
      data-slot="pilot-mission-roadmap"
      className="rounded-xl border border-indigo-200/60 bg-indigo-50/70 px-2.5 py-2 dark:border-indigo-800/40 dark:bg-indigo-950/25"
    >
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-300">
        Getting started &middot; step {mission.completedCount + 1} of {mission.total}
      </p>

      {/* Tight rhythm on purpose. Five rows with card spacing between them is
          the onboarding wall this exists instead of. */}
      <ol className="mt-1 space-y-0.5">
        {mission.steps.map((step, i) => {
          const current = step.id === mission.currentStepId
          const stranded = current && strandedOnPhone(step)

          if (current) {
            return (
              <li key={step.id}>
                <div
                  data-slot="pilot-mission-step"
                  data-state="current"
                  className="rounded-lg bg-white/90 px-2.5 py-2 ring-1 ring-indigo-200 dark:bg-gray-900/60 dark:ring-indigo-800/60"
                >
                  <div className="flex items-start gap-2.5">
                    <Pip>{i + 1}</Pip>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                        {step.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
                        {/* Named honestly rather than hidden: the step is
                            real, it is next, and it happens somewhere this
                            device cannot go. */}
                        {stranded ? 'This step needs a desktop. Continue there.' : step.hint}
                      </p>
                    </div>
                  </div>
                  {!stranded && (
                    <button
                      type="button"
                      data-slot="pilot-mission-cta"
                      onClick={() => act(step.id)}
                      className="mt-2 h-9 w-full rounded-lg bg-indigo-600 text-[13px] font-semibold text-white active:bg-indigo-700"
                    >
                      {step.cta}
                    </button>
                  )}
                </div>
              </li>
            )
          }

          /*
           * Everything else is a mark and a name.
           *
           * A completed step stays reachable, because revisiting what a step
           * taught is the one thing a reader might want from it. A step whose
           * prerequisite is unmet is not a control at all — `available` is the
           * mission's own word for that, so nothing here decides it.
           */
          const reachable = step.available
          const Row = reachable ? 'button' : 'div'
          return (
            <li key={step.id}>
              <Row
                {...(reachable ? { type: 'button' as const, onClick: () => act(step.id) } : {})}
                data-slot="pilot-mission-step"
                data-state={step.done ? 'done' : 'future'}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left',
                  reachable && 'active:bg-white/60 dark:active:bg-gray-900/40',
                )}
              >
                {step.done
                  ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                  )
                  : <Pip muted>{i + 1}</Pip>}
                <span
                  className={clsx(
                    'min-w-0 flex-1 truncate text-[12px] leading-tight',
                    step.done
                      ? 'text-gray-500 dark:text-gray-500'
                      : 'text-gray-400 dark:text-gray-500',
                  )}
                >
                  {step.label}
                </span>
              </Row>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The step number, in the one size every row shares. */
function Pip({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={clsx(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold tabular-nums',
        muted
          ? 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          : 'bg-indigo-600 text-white',
      )}
    >
      {children}
    </span>
  )
}
