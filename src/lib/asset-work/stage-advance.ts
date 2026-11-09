/**
 * What the stage-advance control should say, and whether it should appear.
 *
 * ── Why this is a function and not three ternaries in the JSX ────────────
 *
 * The control appeared under four conditions ANDed inline, carried one of two
 * labels chosen by a nested ternary, and sat 783px below the checklist it
 * acts on. Moving it next to the work meant stating those rules once, and
 * once stated they are worth pinning: a control that advances a workflow
 * stage should never render for a stage the reader is merely LOOKING at.
 *
 * ── It does not count anything ──────────────────────────────────────────
 *
 * `done` and `total` come in. There is exactly one checklist derivation on
 * this page — `stageChecklists`, which the stage rail, the stage card and the
 * Work band all read through — and this deliberately does not become a
 * second one.
 *
 * ── It does not decide whether advancing is ALLOWED ─────────────────────
 *
 * The existing framework lets a stage advance with requirements outstanding.
 * That is the product's rule and this does not change it: `outstanding`
 * describes the state so the UI can say it out loud, and nothing here blocks
 * the action. Turning this into a gate would be a business-rule change.
 */

export type StageAdvanceKind =
  /** Not the current stage, not started, already finished, or nothing after it. */
  | 'hidden'
  /** Every requirement is done (or marked N/A). */
  | 'ready'
  /** Advancing is permitted, but requirements remain. */
  | 'outstanding'

export interface StageAdvanceState {
  kind: StageAdvanceKind
  /** "Advance to Earnings Print" or "Complete process". Empty when hidden. */
  label: string
  /** How many requirements are not done. 0 when ready. */
  outstanding: number
  /** The sentence shown before an outstanding advance is confirmed. */
  confirmPrompt: string | null
}

export interface StageAdvanceInput {
  /** The stage the reader is looking at. */
  viewingStageId: string | null | undefined
  /** The stage the workflow is actually on. */
  currentStageId: string | null | undefined
  /** Stage ids in order, including the trailing 'completed' pseudo-stage. */
  stages: readonly { id: string; label: string }[]
  isStarted: boolean
  isCompleted: boolean
  done: number
  total: number
}

const HIDDEN: StageAdvanceState = {
  kind: 'hidden', label: '', outstanding: 0, confirmPrompt: null,
}

export function stageAdvanceState(input: StageAdvanceInput): StageAdvanceState {
  const { viewingStageId, currentStageId, stages, isStarted, isCompleted, done, total } = input

  if (!isStarted || isCompleted) return HIDDEN
  if (!viewingStageId || !currentStageId) return HIDDEN
  /*
   * Only on the stage the workflow is ON. Browsing stage 3 while the workflow
   * sits on stage 1 must not offer to advance — the old footer button was
   * governed by the workflow's index, so from stage 3 it would have moved the
   * workflow from 1 to 2 while the reader was looking at something else.
   */
  if (viewingStageId !== currentStageId) return HIDDEN

  const index = stages.findIndex(s => s.id === currentStageId)
  if (index < 0 || index >= stages.length - 1) return HIDDEN

  const next = stages[index + 1]
  const label = next.id === 'completed' ? 'Complete process' : `Advance to ${next.label}`

  const outstanding = Math.max(0, total - done)
  if (outstanding === 0) {
    return { kind: 'ready', label, outstanding: 0, confirmPrompt: null }
  }
  return {
    kind: 'outstanding',
    label,
    outstanding,
    confirmPrompt: `${outstanding} requirement${outstanding === 1 ? '' : 's'} still open. Advance anyway?`,
  }
}

/** "1 of 5 done", or "No requirements" when the stage has none. */
export function stageProgressSentence(done: number, total: number): string {
  if (total === 0) return 'No requirements'
  return `${done} of ${total} done`
}
