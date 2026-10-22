/**
 * When the stage-advance control appears, and what it says.
 *
 * ── The failure this prevents ───────────────────────────────────────────
 *
 * The control used to live in the stage card's footer, governed by the
 * WORKFLOW's index while the card itself rendered whichever stage the reader
 * had clicked. Those are different things. Browsing stage 3 of a workflow
 * sitting on stage 1 rendered a button that read "Advance Stage →" and, if
 * pressed, moved the workflow from 1 to 2 — a stage the reader was not even
 * looking at. Moving the control next to the checklist made that divergence
 * load-bearing, so it is pinned here.
 *
 * Nothing in this module decides whether advancing is ALLOWED. The framework
 * permits advancing with requirements open; these tests assert that it still
 * does, and that the UI says so rather than silently allowing it.
 */
import { describe, it, expect } from 'vitest'
import { stageAdvanceState, stageProgressSentence } from '../stage-advance'

const STAGES = [
  { id: 's1', label: 'Expectations' },
  { id: 's2', label: 'Earnings Print' },
  { id: 's3', label: 'Trade Decision' },
  { id: 'completed', label: 'Completed' },
]

const base = {
  viewingStageId: 's1',
  currentStageId: 's1',
  stages: STAGES,
  isStarted: true,
  isCompleted: false,
  done: 0,
  total: 5,
}

describe('it is hidden unless this is the stage the workflow is on', () => {
  it('hides on a stage the reader is only looking at', () => {
    // The whole reason the control moved: it is now INSIDE the stage card,
    // so it must answer for that card's stage, not the workflow's index.
    expect(stageAdvanceState({ ...base, viewingStageId: 's3' }).kind).toBe('hidden')
  })

  it('hides before the workflow is started', () => {
    expect(stageAdvanceState({ ...base, isStarted: false }).kind).toBe('hidden')
  })

  it('hides once the workflow is complete', () => {
    expect(stageAdvanceState({ ...base, isCompleted: true }).kind).toBe('hidden')
  })

  it('hides on the last stage, which has nothing after it', () => {
    expect(stageAdvanceState({
      ...base, viewingStageId: 'completed', currentStageId: 'completed',
    }).kind).toBe('hidden')
  })

  it('hides when the current stage is not in the list at all', () => {
    // A stale `current_stage_key` from a template version that dropped the
    // stage. Offering to advance from a stage that no longer exists would
    // index into the wrong neighbour.
    expect(stageAdvanceState({
      ...base, viewingStageId: 'ghost', currentStageId: 'ghost',
    }).kind).toBe('hidden')
  })

  it('hides when either stage id is missing', () => {
    expect(stageAdvanceState({ ...base, currentStageId: null }).kind).toBe('hidden')
    expect(stageAdvanceState({ ...base, viewingStageId: undefined }).kind).toBe('hidden')
  })
})

describe('it names its destination, never "complete"', () => {
  it('names the next stage', () => {
    // "Advance Stage →" sat a few hundred pixels below "Mark Complete",
    // which ends the whole workflow. Position was the only thing telling
    // them apart.
    expect(stageAdvanceState(base).label).toBe('Advance to Earnings Print')
  })

  it('says "Complete process" only when the next stage is the end', () => {
    const s = stageAdvanceState({ ...base, viewingStageId: 's3', currentStageId: 's3', done: 3, total: 3 })
    expect(s.label).toBe('Complete process')
    expect(s.kind).toBe('ready')
  })
})

describe('outstanding requirements are stated, not enforced', () => {
  it('reports every open requirement', () => {
    const s = stageAdvanceState({ ...base, done: 1, total: 5 })
    expect(s.kind).toBe('outstanding')
    expect(s.outstanding).toBe(4)
    expect(s.confirmPrompt).toBe('4 requirements still open. Advance anyway?')
  })

  it('still offers the advance, because the framework permits it', () => {
    // This is the existing product rule. A gate here would be a business
    // rule change wearing a UX change's clothes.
    const s = stageAdvanceState({ ...base, done: 0, total: 5 })
    expect(s.kind).not.toBe('hidden')
    expect(s.label).toBe('Advance to Earnings Print')
  })

  it('uses the singular for one', () => {
    expect(stageAdvanceState({ ...base, done: 4, total: 5 }).confirmPrompt)
      .toBe('1 requirement still open. Advance anyway?')
  })

  it('is ready when everything is done', () => {
    const s = stageAdvanceState({ ...base, done: 5, total: 5 })
    expect(s.kind).toBe('ready')
    expect(s.outstanding).toBe(0)
    expect(s.confirmPrompt).toBeNull()
  })

  it('is ready when a stage has no requirements at all', () => {
    // Not "0 open requirements, advance anyway?" — there is nothing to warn
    // about, and asking would train the reader to click through the prompt.
    const s = stageAdvanceState({ ...base, done: 0, total: 0 })
    expect(s.kind).toBe('ready')
  })

  it('never reports negative outstanding work', () => {
    // `done` counts completed AND n/a items; a count that outran the total
    // would print "-1 requirements still open".
    expect(stageAdvanceState({ ...base, done: 7, total: 5 }).outstanding).toBe(0)
  })
})

describe('the progress sentence', () => {
  it('counts done against the total', () => {
    expect(stageProgressSentence(1, 5)).toBe('1 of 5 done')
  })

  it('does not say "0 of 0 done" for a stage with no requirements', () => {
    expect(stageProgressSentence(0, 0)).toBe('No requirements')
  })
})
