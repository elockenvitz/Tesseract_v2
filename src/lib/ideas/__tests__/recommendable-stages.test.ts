/**
 * Recommendation eligibility has to survive three stage vocabularies.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `RecommendationQuickModal` asked PostgREST for
 * `.in('stage', ['idea','simulating','deciding'])`. Those are gen-1 labels.
 * `/ops/clients` seeds a newly provisioned org into the gen-2 vocabulary
 * (`aware`, `investigate`, `deep_research`, `thesis_forming`,
 * `ready_for_decision`), so the dashboard "Recommend" action read
 * "No active trade ideas" with six ideas sitting in the pipeline. Every
 * pilot org a customer is given started life unable to submit a
 * recommendation.
 *
 * It survived because the `Tesseract` dev org has gen-1 rows, which the old
 * filter does match. A test that only exercises gen-1 is the same blind spot
 * in test form, which is why each generation gets its own case below.
 *
 * `simulating` is deliberately asserted too: it is in the enum, the old
 * filter named it, and it has ZERO rows in production. A filter can name a
 * label that no row has ever carried and look perfectly reasonable in review.
 */
import { describe, it, expect } from 'vitest'
import {
  rawStageValuesFor,
  RECOMMENDABLE_STAGES,
  TERMINAL_IDEA_STATUSES,
  LEGACY_STAGE_MAP,
  IDEA_STAGES,
  toIdeaStage,
  isAwaitingDesk,
  type IdeaStage,
} from '../stage-model'

/** The filter the picker actually sends. */
const FILTER = rawStageValuesFor(RECOMMENDABLE_STAGES)

/** The filter as it was before this fix, kept to prove the tests bite. */
const OLD_FILTER = ['idea', 'simulating', 'deciding']

/**
 * Every stage label observed in production on 2026-11-19, with its row count,
 * grouped by the vocabulary generation that introduced it.
 */
const PRODUCTION_STAGES = {
  gen1: [
    { stage: 'idea', rows: 11 },
    { stage: 'deciding', rows: 22 },
    { stage: 'simulating', rows: 0 },
  ],
  gen2: [
    { stage: 'aware', rows: 23 },
    { stage: 'investigate', rows: 25 },
    { stage: 'deep_research', rows: 20 },
    { stage: 'thesis_forming', rows: 22 },
    { stage: 'ready_for_decision', rows: 58 },
  ],
  gen3: [
    { stage: 'exploring', rows: 2 },
    { stage: 'researching', rows: 2 },
    { stage: 'developing', rows: 2 },
    { stage: 'ready_to_recommend', rows: 11 },
  ],
} as const

describe('the recommendation stage filter covers every vocabulary', () => {
  it('accepts every gen-1 stage', () => {
    for (const { stage } of PRODUCTION_STAGES.gen1) {
      expect(FILTER, `gen-1 ${stage}`).toContain(stage)
    }
  })

  it('accepts every gen-2 stage, which is what a new pilot org is seeded with', () => {
    for (const { stage } of PRODUCTION_STAGES.gen2) {
      expect(FILTER, `gen-2 ${stage}`).toContain(stage)
    }
  })

  it('accepts every gen-3 stage', () => {
    for (const { stage } of PRODUCTION_STAGES.gen3) {
      expect(FILTER, `gen-3 ${stage}`).toContain(stage)
    }
  })

  it('accepts ready_for_decision and ready_to_recommend — the two that mean the desk is waiting', () => {
    expect(FILTER).toContain('ready_for_decision')
    expect(FILTER).toContain('ready_to_recommend')
    /* Both normalize to the same canonical stage; that is the whole point. */
    expect(toIdeaStage('ready_for_decision')).toBe('ready_to_recommend')
    expect(isAwaitingDesk('ready_for_decision')).toBe(true)
  })

  it('leaves no production stage unmatched', () => {
    const all = [
      ...PRODUCTION_STAGES.gen1,
      ...PRODUCTION_STAGES.gen2,
      ...PRODUCTION_STAGES.gen3,
    ]
    const missed = all.filter(s => !FILTER.includes(s.stage))
    expect(missed, `unmatched: ${missed.map(m => m.stage).join(', ')}`).toEqual([])
  })

  it('is derived from the map, so every legacy label is covered automatically', () => {
    /* Not an enumeration in the test either — if someone adds a label to
       LEGACY_STAGE_MAP, this passes without being edited, and a filter that
       hardcoded its list would not. */
    for (const legacy of Object.keys(LEGACY_STAGE_MAP)) {
      expect(FILTER, `legacy ${legacy}`).toContain(legacy)
    }
    for (const canonical of IDEA_STAGES) {
      expect(FILTER, `canonical ${canonical}`).toContain(canonical)
    }
  })
})

describe('the old filter is what failed', () => {
  /*
   * Non-vacuity. If these pass, the tests above are asserting something the
   * broken filter could not satisfy.
   */
  it('misses every gen-2 stage, including all 58 ready_for_decision rows', () => {
    for (const { stage } of PRODUCTION_STAGES.gen2) {
      expect(OLD_FILTER, `gen-2 ${stage} should NOT be matched`).not.toContain(stage)
    }
  })

  it('misses every gen-3 stage', () => {
    for (const { stage } of PRODUCTION_STAGES.gen3) {
      expect(OLD_FILTER, `gen-3 ${stage} should NOT be matched`).not.toContain(stage)
    }
  })

  it('matches nothing at all in a freshly provisioned pilot org', () => {
    /* The six ideas in QA Lifecycle Validation (558affe5), as seeded: five
       from the provisioning template plus the CRWD idea captured through the
       UI. Not one is visible to the old filter. */
    const freshOrgStages = [
      'aware',
      'investigate',
      'deep_research',
      'thesis_forming',
      'ready_for_decision',
      'researching',
    ]
    const visibleOld = freshOrgStages.filter(s => OLD_FILTER.includes(s))
    expect(visibleOld).toEqual([])

    const visibleNew = freshOrgStages.filter(s => FILTER.includes(s))
    expect(visibleNew).toHaveLength(freshOrgStages.length)
  })

  it('names a stage no row has ever carried', () => {
    const simulating = PRODUCTION_STAGES.gen1.find(s => s.stage === 'simulating')!
    expect(simulating.rows).toBe(0)
    expect(OLD_FILTER).toContain('simulating')
  })
})

describe('not every idea is recommendable', () => {
  it('excludes concluded ideas by status rather than by stage', () => {
    /* These statuses coexist with live-looking stages in production —
       status='executed' appears across several stages — so a stage filter
       cannot do this job and the old query had no status condition at all. */
    for (const terminal of ['executed', 'approved', 'rejected', 'cancelled', 'archived']) {
      expect(TERMINAL_IDEA_STATUSES).toContain(terminal)
    }
  })

  it('does not treat a terminal status as a stage', () => {
    /* Guard against someone "fixing" this by bolting statuses into the stage
       list, which would reintroduce a competing vocabulary. */
    for (const terminal of TERMINAL_IDEA_STATUSES) {
      expect(FILTER, `${terminal} is a status, not a stage`).not.toContain(terminal)
    }
  })

  it('still asks for a stage filter at all', () => {
    /* Dropping `.in('stage', ...)` would also make the picker non-empty and
       would be wrong. The filter must stay bounded to known stages. */
    expect(FILTER.length).toBeGreaterThan(0)
    expect(FILTER).not.toContain('')
    const known = new Set<string>([...IDEA_STAGES, ...Object.keys(LEGACY_STAGE_MAP)])
    for (const s of FILTER) expect(known.has(s)).toBe(true)
  })
})

describe('rawStageValuesFor is selective', () => {
  it('returns only the spellings of the stages asked for', () => {
    const justFinal = rawStageValuesFor(['ready_to_recommend'])
    expect(justFinal).toContain('ready_to_recommend')
    expect(justFinal).toContain('ready_for_decision')
    expect(justFinal).toContain('deciding')
    /* Nothing from earlier in the pipeline. */
    expect(justFinal).not.toContain('exploring')
    expect(justFinal).not.toContain('aware')
    expect(justFinal).not.toContain('idea')
  })

  it('returns nothing for an empty request', () => {
    expect(rawStageValuesFor([])).toEqual([])
  })

  it('agrees with toIdeaStage for every value it returns', () => {
    for (const stage of IDEA_STAGES) {
      for (const raw of rawStageValuesFor([stage])) {
        expect(toIdeaStage(raw), `${raw} should normalize to ${stage}`).toBe(stage)
      }
    }
  })

  it('never returns a duplicate', () => {
    const all = rawStageValuesFor(IDEA_STAGES as readonly IdeaStage[])
    expect(new Set(all).size).toBe(all.length)
  })
})
