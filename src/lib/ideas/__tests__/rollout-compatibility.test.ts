/**
 * Rollout compatibility: the application against a MIXED database.
 *
 * Between the expand migration and the contract migration, production holds
 * both vocabularies at once — legacy rows written by the still-running old
 * build, canonical rows written by this one. This build has to read that
 * table correctly for as long as the window lasts.
 *
 * What is pinned here is the property that makes the window survivable: every
 * value the database can return during rollout normalises to exactly one of
 * four canonical stages, and nothing downstream ever sees a legacy label.
 */
import { describe, it, expect } from 'vitest'
import {
  IDEA_STAGES,
  LEGACY_STAGE_MAP,
  isIdeaStage,
  toIdeaStage,
  stageIndex,
  stageLabel,
  maturityForStage,
  missingForStage,
  isForwardMove,
} from '../stage-model'

/**
 * Every label the `trade_stage` enum carries during the rollout window.
 *
 * Eleven legacy + four canonical = fifteen, asserted by the expand migration
 * itself (`05_expand.sql`, assertion 1a). These are the exact strings the
 * database can hand back before the contract migration runs.
 */
const EVERY_DB_VALUE = [
  'aware', 'investigate', 'deep_research', 'thesis_forming', 'ready_for_decision',
  'idea', 'discussing', 'working_on', 'modeling', 'simulating', 'deciding',
  'exploring', 'researching', 'developing', 'ready_to_recommend',
] as const

describe('the normalization boundary absorbs everything the DB can return', () => {
  it('covers all fifteen enum labels', () => {
    // If the enum gains a label and this list does not, the next assertion
    // still passes vacuously — so the count is checked against the two
    // sources it is built from.
    expect(EVERY_DB_VALUE).toHaveLength(15)
    expect(new Set(EVERY_DB_VALUE).size).toBe(15)
    expect(Object.keys(LEGACY_STAGE_MAP)).toHaveLength(11)
    expect([...Object.keys(LEGACY_STAGE_MAP), ...IDEA_STAGES].sort())
      .toEqual([...EVERY_DB_VALUE].sort())
  })

  it('maps every one to exactly one canonical stage', () => {
    for (const raw of EVERY_DB_VALUE) {
      const normalised = toIdeaStage(raw)
      expect(IDEA_STAGES as readonly string[]).toContain(normalised)
      // Deterministic: the same input always gives the same answer.
      expect(toIdeaStage(raw)).toBe(normalised)
    }
  })

  it('leaves no legacy value able to reach product logic', () => {
    for (const raw of EVERY_DB_VALUE) {
      expect(isIdeaStage(toIdeaStage(raw))).toBe(true)
    }
    // And the legacy labels themselves are NOT stages, so a value that
    // skipped the boundary would fail a type guard rather than flow onward.
    for (const legacy of Object.keys(LEGACY_STAGE_MAP)) {
      expect(isIdeaStage(legacy)).toBe(false)
    }
  })

  it('gives every DB value a real position, label and maturity', () => {
    // The failure mode this guards is silent: a value that falls through
    // ranks 0 and renders as the first column, which looks like data rather
    // than like a bug.
    for (const raw of EVERY_DB_VALUE) {
      const s = toIdeaStage(raw)
      expect(stageIndex(s)).toBeGreaterThanOrEqual(0)
      expect(stageLabel(s)).not.toBe(s)          // a real label, not the raw value
      expect(maturityForStage(raw)).toBeTruthy()
    }
  })
})

describe('a mixed population behaves as one population', () => {
  // The exact shape the contract migration meets: legacy rows beside
  // canonical ones, including the two that mean the same thing.
  const rows = [
    { id: 'legacy-a', stage: 'aware' },
    { id: 'new-a', stage: 'exploring' },
    { id: 'legacy-b', stage: 'investigate' },
    { id: 'new-b', stage: 'researching' },
    { id: 'legacy-c', stage: 'thesis_forming' },
    { id: 'new-c', stage: 'developing' },
    { id: 'legacy-d', stage: 'ready_for_decision' },
    { id: 'legacy-e', stage: 'deciding' },
    { id: 'new-d', stage: 'ready_to_recommend' },
  ]

  const grouped = () => {
    const g = Object.fromEntries(IDEA_STAGES.map((s) => [s, [] as string[]])) as Record<string, string[]>
    for (const r of rows) g[toIdeaStage(r.stage)].push(r.id)
    return g
  }

  it('puts equivalent legacy and canonical rows in the same column', () => {
    const g = grouped()
    expect(g.exploring).toEqual(['legacy-a', 'new-a'])
    expect(g.researching).toEqual(['legacy-b', 'new-b'])
    expect(g.developing).toEqual(['legacy-c', 'new-c'])
    // Both retired end-stage labels land beside the canonical one.
    expect(g.ready_to_recommend).toEqual(['legacy-d', 'legacy-e', 'new-d'])
  })

  it('loses no row to an unrecognised stage', () => {
    const g = grouped()
    expect(Object.values(g).flat()).toHaveLength(rows.length)
  })

  it('compares a legacy row against a canonical row correctly', () => {
    // `trade_idea_portfolios.stage` and the idea's own stage share an enum and
    // are compared against each other in SimulationPage. During the window one
    // can be legacy and the other canonical.
    expect(isForwardMove(toIdeaStage('aware'), toIdeaStage('developing'))).toBe(true)
    expect(isForwardMove(toIdeaStage('deciding'), toIdeaStage('exploring'))).toBe(false)
    expect(stageIndex(toIdeaStage('ready_for_decision')))
      .toBe(stageIndex(toIdeaStage('ready_to_recommend')))
  })

  it('applies the gate identically whichever vocabulary the row uses', () => {
    const bare = { rationale: null, thesis_text: null }
    // The gate is on the END of the pipeline, however that row happens to
    // spell it.
    expect(missingForStage(bare, toIdeaStage('ready_for_decision'))).toHaveLength(2)
    expect(missingForStage(bare, toIdeaStage('deciding'))).toHaveLength(2)
    expect(missingForStage(bare, toIdeaStage('ready_to_recommend'))).toHaveLength(2)
    expect(missingForStage(bare, toIdeaStage('thesis_forming'))).toEqual([])
  })
})

describe('what this build writes', () => {
  it('only ever writes canonical stages', () => {
    // The write side of the contract: `IDEA_STAGES` is what every writer in
    // the application sources its target stage from, and it contains no
    // legacy label. If this ever fails, the contract migration would be
    // rewriting rows a live deploy is still creating.
    for (const s of IDEA_STAGES) {
      expect(Object.keys(LEGACY_STAGE_MAP)).not.toContain(s)
    }
    expect(IDEA_STAGES).toEqual(['exploring', 'researching', 'developing', 'ready_to_recommend'])
  })
})
