import { CheckCircle2 } from 'lucide-react'
import { usePilotMission } from '../../hooks/usePilotMission'
import { isDesktopOnly } from '../../lib/mobile/mobile-surfaces'

/**
 * The pilot mission on a phone: the count, the next step, one control.
 *
 * ── Same truth, less of it ────────────────────────────────────────────────
 *
 * `usePilotMission` and `missionState` are the desktop model unchanged. There
 * is deliberately no second state machine here: a phone that decided
 * completion for itself would be a phone that eventually disagrees with the
 * laptop about what the reader has done, and the whole point of moving these
 * marks server-side was that progress follows the person.
 *
 * What differs is how much is drawn. Five rows, five hints and five states in
 * a strip above a snap feed is a checklist competing with the feed; the count
 * plus the one thing to do next is the same information at phone scale.
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

  if (mission.isLoading || mission.complete) return null
  const step = mission.steps.find(s => s.id === mission.currentStepId)
  if (!step) return null

  /* Trade Lab is desktop-only; the registry is the single source for that. */
  const desktopOnly = step.id === 'simulation_completed' && isDesktopOnly('trade-lab')

  const act = () => {
    const ideaId = mission.tutorialIdeaId
    if (step.id === 'idea_created') {
      try {
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', { detail: { captureType: 'trade_idea' } }))
      } catch { /* ignore */ }
      return
    }
    if (step.id === 'outcome_reviewed') {
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

  return (
    /*
     * Two lines and a control, not a card.
     *
     * The first version stacked a header, a label, a hint and a full-width
     * button, which took a third of a phone screen to say one thing. The
     * count and the step share a line, the control sits beside them, and the
     * hint is gone — the step label already says what it is, and the reader
     * has one move to make.
     */
    <div className="flex items-center gap-2.5 rounded-xl border border-indigo-200/60 bg-indigo-50/70 px-3 py-2 dark:border-indigo-800/40 dark:bg-indigo-950/25">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-300">
          Step {mission.completedCount + 1} of {mission.total}
        </p>
        <p className="truncate text-[13px] font-medium leading-tight text-gray-900 dark:text-gray-100">
          {/* Named honestly rather than hidden: the step is real, it is next,
              and it happens somewhere this device cannot go. */}
          {desktopOnly ? 'Continue on desktop' : step.label}
        </p>
      </div>
      {!desktopOnly && (
        <button
          type="button"
          onClick={act}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white active:bg-indigo-700"
        >
          {step.cta}
        </button>
      )}
    </div>
  )
}
