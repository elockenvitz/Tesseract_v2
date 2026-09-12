/**
 * The five-step mission, and the identity that holds it together.
 *
 * The claims worth pinning: each step is about the SAME idea, a step that
 * leaves an artifact is never a click, and an idea that disappears sends the
 * pilot back to the start rather than leaving them stuck.
 */

import { describe, it, expect } from 'vitest'
import {
  MISSION_STEP_IDS, isPipelineAdvanced, missionState, tutorialIdeaKey,
  tutorialOutcomeReviewedKey, type MissionFacts,
} from '../mission'

const facts = (over: Partial<MissionFacts> = {}): MissionFacts => ({
  tutorialIdeaId: null,
  ideaExists: false,
  ideaStage: null,
  hasSimulationTrade: false,
  hasDecision: false,
  outcomeReviewedAt: null,
  ...over,
})

/** An idea that exists, at whatever stage. */
const withIdea = (over: Partial<MissionFacts> = {}) =>
  facts({ tutorialIdeaId: 'tq-1', ideaExists: true, ideaStage: 'idea', ...over })

const doneIds = (f: MissionFacts) => missionState(f).steps.filter(s => s.done).map(s => s.id)

describe('the mission', () => {
  it('is five steps in the order of one decision', () => {
    expect(MISSION_STEP_IDS).toEqual([
      'idea_created', 'pipeline_advanced', 'simulation_completed',
      'decision_submitted', 'outcome_reviewed',
    ])
  })

  it('starts a new pilot at nothing, pointing at step one', () => {
    const m = missionState(facts())
    expect(m.completedCount).toBe(0)
    expect(m.total).toBe(5)
    expect(m.currentStepId).toBe('idea_created')
    expect(m.steps[0].available).toBe(true)
  })

  it('shows later steps as a journey, not as errors', () => {
    const m = missionState(facts())
    expect(m.steps[2].available).toBe(false)
    expect(m.steps[2].blockedBy).toBe('Advance your idea in Pipeline first.')
    // Every step is still listed, so the shape of the journey is legible.
    expect(m.steps).toHaveLength(5)
  })
})

describe('step 1 — the tutorial idea', () => {
  it('completes when the stored id points at a row that exists', () => {
    expect(doneIds(withIdea())).toEqual(['idea_created'])
    expect(missionState(withIdea()).tutorialIdeaId).toBe('tq-1')
  })

  /**
   * The recovery rule. Every later step reads against this idea, so a stored
   * id with no row behind it must return the pilot to step one rather than
   * leave four steps that cannot be evaluated.
   */
  it('returns to step one when the stored idea is gone', () => {
    const m = missionState(facts({
      tutorialIdeaId: 'tq-gone', ideaExists: false,
      ideaStage: 'deep_research', hasSimulationTrade: true, hasDecision: true,
      outcomeReviewedAt: '2026-09-01T00:00:00Z',
    }))
    expect(m.completedCount).toBe(0)
    expect(m.currentStepId).toBe('idea_created')
    expect(m.tutorialIdeaId).toBeNull()
  })

  it('credits nothing at all without an id', () => {
    expect(doneIds(facts({ ideaStage: 'thesis_forming', hasDecision: true }))).toEqual([])
  })
})

describe('step 2 — pipeline', () => {
  /** Every idea is BORN at `idea`, which resolves to `aware`. Moving is the lesson. */
  it('does not count the stage every idea starts at', () => {
    expect(isPipelineAdvanced('idea')).toBe(false)
    expect(isPipelineAdvanced('aware')).toBe(false)
    expect(doneIds(withIdea({ ideaStage: 'idea' }))).toEqual(['idea_created'])
  })

  it.each(['investigate', 'deep_research', 'thesis_forming', 'ready_for_decision'])(
    'counts %s',
    stage => expect(isPipelineAdvanced(stage)).toBe(true),
  )

  /** The legacy vocabulary is what creation writes, so it has to resolve too. */
  it.each([
    ['working_on', true], ['discussing', true], ['modeling', true],
    ['simulating', true], ['deciding', true],
  ] as const)('resolves the legacy stage %s to %s', (stage, expected) => {
    expect(isPipelineAdvanced(stage)).toBe(expected)
  })

  it('is false for an unknown stage rather than guessing', () => {
    expect(isPipelineAdvanced('something_else')).toBe(false)
    expect(isPipelineAdvanced(null)).toBe(false)
  })
})

describe('steps 3 to 5', () => {
  it('takes simulation from a persisted simulated trade, not a link', () => {
    const m = missionState(withIdea({ ideaStage: 'deep_research', hasSimulationTrade: true }))
    expect(m.steps[2].done).toBe(true)
    expect(m.completedCount).toBe(3)
  })

  it('takes the decision from a real decision artifact', () => {
    const m = missionState(withIdea({ ideaStage: 'ready_for_decision', hasDecision: true }))
    expect(m.steps[3].done).toBe(true)
  })

  /** The only step that is a mark, because reading writes nothing. */
  it('takes the review from the server-backed mark', () => {
    const m = missionState(withIdea({ outcomeReviewedAt: '2026-09-01T00:00:00Z' }))
    expect(m.steps[4].done).toBe(true)
  })

  it('completes the mission only when all five are done', () => {
    const m = missionState(withIdea({
      ideaStage: 'ready_for_decision', hasSimulationTrade: true,
      hasDecision: true, outcomeReviewedAt: '2026-09-01T00:00:00Z',
    }))
    expect(m.complete).toBe(true)
    expect(m.currentStepId).toBeNull()
  })

  /** Steps are independent facts: a gap does not block a later truth. */
  it('reports a later truth even when an earlier step is outstanding', () => {
    const m = missionState(withIdea({ ideaStage: 'idea', hasDecision: true }))
    expect(m.steps[1].done).toBe(false)
    expect(m.steps[3].done).toBe(true)
    expect(m.currentStepId).toBe('pipeline_advanced')
  })
})

describe('storage keys', () => {
  it('are per organisation, like every other pilot key', () => {
    expect(tutorialIdeaKey('org-1')).toBe('tutorial_idea_id_org-1')
    expect(tutorialOutcomeReviewedKey('org-1')).toBe('tutorial_outcome_reviewed_at_org-1')
    expect(tutorialIdeaKey(null)).toBe('tutorial_idea_id_no-org')
  })
})
