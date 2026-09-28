/**
 * The canonical stage model.
 *
 * What is pinned here is deliberately narrow: the vocabulary, the order, the
 * one gate, and the legacy mapping. Those four things had nine, three and two
 * competing implementations respectively before this module existed, so the
 * tests that matter most are the ones asserting there is now exactly one of
 * each and that it agrees with the database migration.
 */
import { describe, it, expect } from 'vitest'
import {
  IDEA_STAGES,
  IDEA_STAGE_CONFIG,
  LEGACY_STAGE_MAP,
  FINAL_STAGE,
  isIdeaStage,
  stageLabel,
  stageIndex,
  isForwardMove,
  nextStage,
  previousStage,
  missingForStage,
  canMoveToStage,
  toIdeaStage,
  maturityForStage,
  isAwaitingDesk,
} from '../stage-model'

describe('the four canonical stages', () => {
  it('is exactly four, in pipeline order', () => {
    expect(IDEA_STAGES).toEqual([
      'exploring', 'researching', 'developing', 'ready_to_recommend',
    ])
  })

  it('ends at ready_to_recommend', () => {
    expect(FINAL_STAGE).toBe('ready_to_recommend')
    expect(IDEA_STAGES[IDEA_STAGES.length - 1]).toBe(FINAL_STAGE)
    expect(nextStage(FINAL_STAGE)).toBeNull()
  })

  it('has no decision-workflow state among the stages', () => {
    // The whole point of the collapse. `deciding`, `pending`, `in_review` and
    // friends describe what is happening to a RECOMMENDATION; they are
    // decision_requests statuses, not idea maturity.
    for (const forbidden of ['deciding', 'pending', 'under_review', 'needs_discussion', 'decided']) {
      expect(IDEA_STAGES as readonly string[]).not.toContain(forbidden)
    }
  })

  it('renders the specified user-facing labels', () => {
    expect(IDEA_STAGES.map(stageLabel)).toEqual([
      'Exploring', 'Researching', 'Developing', 'Ready to Recommend',
    ])
  })

  it('gives every stage the question that defines it', () => {
    // Not decoration: the question is what makes two analysts place the same
    // idea in the same stage.
    for (const s of IDEA_STAGES) {
      expect(IDEA_STAGE_CONFIG[s].question.trim()).not.toBe('')
      expect(IDEA_STAGE_CONFIG[s].question).toMatch(/\?$/)
    }
  })

  it('narrows correctly', () => {
    expect(isIdeaStage('developing')).toBe(true)
    expect(isIdeaStage('deciding')).toBe(false)
    expect(isIdeaStage('aware')).toBe(false)
    expect(isIdeaStage(null)).toBe(false)
    expect(isIdeaStage(42)).toBe(false)
  })
})

describe('ordering', () => {
  it('positions stages by their place in the pipeline', () => {
    expect(stageIndex('exploring')).toBe(0)
    expect(stageIndex('ready_to_recommend')).toBe(3)
  })

  it('returns -1 for anything unrecognised, never 0', () => {
    // A -1 keeps an unknown value from reading as "at least as far along as
    // exploring", which would let it pass a forward-move check.
    expect(stageIndex('deciding')).toBe(-1)
    expect(stageIndex('')).toBe(-1)
  })

  it('identifies forward moves', () => {
    expect(isForwardMove('exploring', 'researching')).toBe(true)
    expect(isForwardMove('exploring', 'ready_to_recommend')).toBe(true)
    expect(isForwardMove('developing', 'researching')).toBe(false)
    expect(isForwardMove('developing', 'developing')).toBe(false)
  })

  it('treats a move involving an unknown stage as not forward', () => {
    expect(isForwardMove('deciding', 'ready_to_recommend')).toBe(false)
    expect(isForwardMove('exploring', 'deciding')).toBe(false)
  })

  it('walks the pipeline in both directions', () => {
    expect(nextStage('exploring')).toBe('researching')
    expect(nextStage('researching')).toBe('developing')
    expect(nextStage('developing')).toBe('ready_to_recommend')
    expect(previousStage('exploring')).toBeNull()
    expect(previousStage('ready_to_recommend')).toBe('developing')
  })
})

describe('the gate', () => {
  const complete = { rationale: 'Why now', thesis_text: 'The thesis' }
  const empty = { rationale: '', thesis_text: null }

  it('does not gate exploring → researching', () => {
    // "This deserves real research effort" is a judgement, not a checklist.
    expect(missingForStage(empty, 'researching')).toEqual([])
    expect(canMoveToStage(empty, 'researching')).toBe(true)
  })

  it('does not gate researching → developing', () => {
    // Explicitly NOT gated on document counts or completeness percentages —
    // those measure activity, not understanding, and train people to generate
    // artifacts to satisfy the gate.
    expect(missingForStage(empty, 'developing')).toEqual([])
    expect(canMoveToStage(empty, 'developing')).toBe(true)
  })

  it('gates developing → ready_to_recommend on thesis and rationale', () => {
    expect(missingForStage(empty, 'ready_to_recommend'))
      .toEqual(['Why now (rationale)', 'Trade thesis'])
    expect(canMoveToStage(empty, 'ready_to_recommend')).toBe(false)
  })

  it('names only what is actually missing', () => {
    expect(missingForStage({ rationale: 'Why now', thesis_text: null }, 'ready_to_recommend'))
      .toEqual(['Trade thesis'])
    expect(missingForStage({ rationale: null, thesis_text: 'The thesis' }, 'ready_to_recommend'))
      .toEqual(['Why now (rationale)'])
  })

  it('opens once both are present', () => {
    expect(missingForStage(complete, 'ready_to_recommend')).toEqual([])
  })

  it('treats whitespace as absent', () => {
    expect(missingForStage({ rationale: '   ', thesis_text: '\n' }, 'ready_to_recommend'))
      .toHaveLength(2)
  })

  it('does not require a recommendation', () => {
    // The old model gated entry to `deciding` on having an active
    // decision_request. Submitting is now an explicit action rather than a
    // stage transition, so the gate moved to submitRecommendation.
    expect(missingForStage(complete, 'ready_to_recommend')).toEqual([])
  })
})

describe('legacy coercion', () => {
  it('maps every legacy value to a canonical stage', () => {
    for (const [legacy, target] of Object.entries(LEGACY_STAGE_MAP)) {
      expect(IDEA_STAGES as readonly string[]).toContain(target)
      expect(toIdeaStage(legacy)).toBe(target)
    }
  })

  it('agrees with the SQL migration, value for value', () => {
    // If this drifts from supabase/migrations/20260928120000, rows written
    // before the migration and rows written after will disagree about what
    // the same idea means.
    expect(LEGACY_STAGE_MAP).toEqual({
      aware: 'exploring',
      idea: 'exploring',
      investigate: 'researching',
      deep_research: 'developing',
      thesis_forming: 'developing',
      discussing: 'developing',
      working_on: 'developing',
      modeling: 'developing',
      simulating: 'developing',
      ready_for_decision: 'ready_to_recommend',
      deciding: 'ready_to_recommend',
    })
  })

  it('sends investigate to researching, not exploring', () => {
    // Called out on its own because it is the one place the mapping departs
    // from the original specification. `investigate` meant "actively
    // researching fundamentals, catalysts and competitive position", which is
    // evidence-gathering; sending it to `exploring` would demote work already
    // underway and leave `researching` empty on day one.
    expect(toIdeaStage('investigate')).toBe('researching')
  })

  it('sends deciding to the end of the pipeline, not to a stage of its own', () => {
    expect(toIdeaStage('deciding')).toBe('ready_to_recommend')
  })

  it('falls back to exploring rather than throwing', () => {
    // Unknown maturity is honestly represented as the start of the pipeline.
    // Throwing would take down a board full of other people's ideas.
    expect(toIdeaStage('something_nobody_has_seen')).toBe('exploring')
    expect(toIdeaStage(null)).toBe('exploring')
    expect(toIdeaStage(undefined)).toBe('exploring')
    expect(toIdeaStage('')).toBe('exploring')
  })

  it('passes canonical values straight through', () => {
    for (const s of IDEA_STAGES) expect(toIdeaStage(s)).toBe(s)
  })
})

describe('maturity projection', () => {
  it('is one table, so two screens cannot disagree', () => {
    // `desktop-ideas/model` said working_on → thesis_forming and
    // `signals/idea-shape` said working_on → researching. Same idea, two
    // different pills.
    expect(maturityForStage('working_on')).toBe('thesis_forming')
    expect(maturityForStage('developing')).toBe('thesis_forming')
    expect(maturityForStage('exploring')).toBe('researching')
    expect(maturityForStage('researching')).toBe('researching')
    expect(maturityForStage('ready_to_recommend')).toBe('decision_ready')
  })

  it('says an idea is awaiting the desk only at the end of the pipeline', () => {
    expect(isAwaitingDesk('ready_to_recommend')).toBe(true)
    expect(isAwaitingDesk('developing')).toBe(false)
    // A former `deciding` row now reads as awaiting the desk, which is what
    // it was — but that is a claim about maturity, not proof a recommendation
    // was ever submitted. Only a decision_requests row proves that.
    expect(isAwaitingDesk('deciding')).toBe(true)
  })

  it('never reports the retired deciding bucket from a stage', () => {
    const buckets = new Set([...IDEA_STAGES, ...Object.keys(LEGACY_STAGE_MAP)].map(maturityForStage))
    expect(buckets.has('deciding')).toBe(false)
  })
})
