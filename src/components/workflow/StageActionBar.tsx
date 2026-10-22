/**
 * The line between a stage's heading and its requirements.
 *
 * ── What it replaces ────────────────────────────────────────────────────
 *
 * Three facts used to live at the very bottom of the Process surface — "Stage
 * 1 of 4", "0 of 5 items completed" and the advance button — 783px below the
 * checklist they describe, in a 605px viewport. You could see the work or you
 * could see what to do about it, never both. Two of those three were already
 * on screen anyway: the stage rail numbers and highlights the stages, and the
 * rail chip carries the count.
 *
 * So this is not a new panel and not a toolbar. It is the one line that was
 * missing from where the work happens, and the footer gave up its copies.
 *
 * ── Advancing is not completing a requirement ───────────────────────────
 *
 * The button names its DESTINATION ("Advance to Earnings Print"), never
 * "Complete" — the workflow-level "Mark Complete" control sits a few hundred
 * pixels above and the two were previously told apart only by position.
 *
 * When requirements are outstanding the first click asks rather than acts.
 * That is not a new gate: this framework has always permitted advancing with
 * work open, and it still does. The confirmation makes an existing permission
 * visible instead of letting one click quietly skip four requirements.
 */
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, Check } from 'lucide-react'
import {
  stageAdvanceState,
  stageProgressSentence,
  type StageAdvanceInput,
} from '../../lib/asset-work/stage-advance'

export interface StageActionBarProps extends StageAdvanceInput {
  /** Runs the EXISTING advance handler. This component owns no workflow state. */
  onAdvance: () => void
  isAdvancing?: boolean
  className?: string
}

export function StageActionBar({
  onAdvance, isAdvancing = false, className, ...input
}: StageActionBarProps) {
  const state = stageAdvanceState(input)
  const [confirming, setConfirming] = useState(false)

  /*
   * Drop a pending confirmation when the stage changes or the last
   * requirement closes. Otherwise a reader who opened the prompt, went and
   * finished the work, and came back would still be looking at a question
   * about requirements that are no longer open.
   */
  useEffect(() => {
    setConfirming(false)
  }, [input.viewingStageId, input.currentStageId, state.kind])

  const progress = stageProgressSentence(input.done, input.total)

  return (
    <div
      data-testid="stage-action-bar"
      className={clsx(
        'mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 pb-2 dark:border-gray-800',
        className
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          data-testid="stage-progress"
          className="text-[12px] font-semibold text-gray-700 dark:text-gray-200"
        >
          {progress}
        </span>
        {state.kind === 'outstanding' && (
          <span className="text-[11px] text-gray-400" data-testid="stage-outstanding">
            {state.outstanding} open
          </span>
        )}
        {state.kind === 'ready' && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" aria-hidden="true" /> all done
          </span>
        )}
      </div>

      {state.kind !== 'hidden' && (
        confirming ? (
          <div className="flex items-center gap-2" data-testid="stage-advance-confirm">
            <span className="text-[11px] text-amber-700 dark:text-amber-400">
              {state.confirmPrompt}
            </span>
            <button
              type="button"
              data-testid="stage-advance-confirm-yes"
              disabled={isAdvancing}
              onClick={() => { setConfirming(false); onAdvance() }}
              className="rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {state.label}
            </button>
            <button
              type="button"
              data-testid="stage-advance-cancel"
              onClick={() => setConfirming(false)}
              className="rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="stage-advance"
            disabled={isAdvancing}
            onClick={() => {
              if (state.kind === 'outstanding') setConfirming(true)
              else onAdvance()
            }}
            className={clsx(
              'inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50',
              state.kind === 'ready'
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
            )}
          >
            {state.label}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        )
      )}
    </div>
  )
}
