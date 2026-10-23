/**
 * What a stage may say about itself before a requirement is open.
 *
 * ── The two failure modes this guards ───────────────────────────────────
 *
 * 1. CLAIMING MORE THAN THE SCHEMA KNOWS. The database stores completion,
 *    notes, attachments, an assignee, a due date and commentary rows.
 *    Nothing stores "in progress", "blocked" or "awaiting input", so no
 *    derivation here may produce them, and a stage with no configured
 *    description must not acquire a composed objective.
 *
 * 2. SENDING THE READER TO THE WRONG ROW. "Resume" that lands on the first
 *    requirement, when the analyst wrote half a finding on the fourth
 *    yesterday, is worse than no recommendation: it is a recommendation
 *    that is confidently wrong and costs a click to discover.
 *
 * The resume cases are therefore ordered tests, not presence tests — each
 * asserts that a STRONGER signal beats a weaker one that is also present.
 */
import { describe, it, expect } from 'vitest'
import {
  presentRequirement, chooseResume, stageObjective, tallyStage,
  synthesisNote, hasWorkProduct, type RequirementFacts,
} from '../stage-overview'

const req = (over: Partial<RequirementFacts> & { id: string }): RequirementFacts => ({
  text: `Requirement ${over.id}`,
  ...over,
})

describe('a requirement says what the data says, and no more', () => {
  it('reports completion with its actor and date', () => {
    const v = presentRequirement(req({
      id: 'a', status: 'completed', completed: true,
      completedAt: '2026-10-02T12:00:00Z', completedByName: 'Eric L',
    }))
    expect(v.state).toBe('complete')
    expect(v.label).toBe('Complete')
    expect(v.detail).toBe('Eric L · Oct 2')
  })

  it('reports not-applicable separately from complete', () => {
    const v = presentRequirement(req({ id: 'a', status: 'na' }))
    expect(v.state).toBe('not-applicable')
    expect(v.label).toBe('Not applicable')
  })

  /** THE defect: commentary lives elsewhere, so analysis looked untouched. */
  it('does not call a requirement with commentary untouched', () => {
    const v = presentRequirement(req({ id: 'a', status: 'unchecked', hasCommentary: true }))
    expect(v.state).toBe('documented')
    expect(v.label).toBe('Documented')
  })

  it('counts notes and attachments as a work product too', () => {
    expect(presentRequirement(req({ id: 'a', hasNotes: true })).state).toBe('documented')
    expect(presentRequirement(req({ id: 'b', hasAttachments: true })).state).toBe('documented')
    expect(hasWorkProduct(req({ id: 'c' }))).toBe(false)
    expect(hasWorkProduct(req({ id: 'd', hasNotes: '   ' as unknown as boolean }))).toBe(true)
  })

  it('names the owner when there is one and no work yet', () => {
    const v = presentRequirement(req({ id: 'a', assigneeName: 'Pat P', dueDate: '2026-10-28' }))
    expect(v.state).toBe('assigned')
    expect(v.label).toBe('Assigned · Pat P')
    expect(v.detail).toBe('due Oct 28')
  })

  it('says not started rather than inventing a status', () => {
    const v = presentRequirement(req({ id: 'a' }))
    expect(v.state).toBe('not-started')
    expect(v.detail).toBeNull()
  })

  it('never produces a state the schema cannot substantiate', () => {
    const states = [
      presentRequirement(req({ id: '1' })),
      presentRequirement(req({ id: '2', hasCommentary: true })),
      presentRequirement(req({ id: '3', assigneeName: 'P' })),
      presentRequirement(req({ id: '4', status: 'completed', completed: true })),
      presentRequirement(req({ id: '5', status: 'na' })),
    ].map(v => v.state)
    expect(new Set(states)).toEqual(
      new Set(['not-started', 'documented', 'assigned', 'complete', 'not-applicable']),
    )
    for (const v of states) expect(['in-progress', 'blocked', 'awaiting']).not.toContain(v)
  })
})

describe('resume goes to the strongest evidence of work in flight', () => {
  /** THE regression: the first open row is the weakest possible answer. */
  it('prefers a documented requirement over an earlier untouched one', () => {
    const r = chooseResume([
      req({ id: 'first', text: 'Read/Summarize News' }),
      req({ id: 'fourth', text: 'Where is the Sell Side?', hasCommentary: true }),
    ])
    expect(r?.id).toBe('fourth')
    expect(r?.verb).toBe('Resume')
    expect(r?.reason).toMatch(/already carries a finding/)
  })

  it('prefers mine over an earlier unassigned one, when none is documented', () => {
    const r = chooseResume([
      req({ id: 'first' }),
      req({ id: 'mine', assigneeId: 'u1', assigneeName: 'Me' }),
    ], 'u1')
    expect(r?.id).toBe('mine')
    expect(r?.reason).toBe('it is assigned to you')
  })

  it('prefers the soonest due date over list order', () => {
    const r = chooseResume([
      req({ id: 'later', dueDate: '2026-11-30' }),
      req({ id: 'sooner', dueDate: '2026-10-28' }),
    ])
    expect(r?.id).toBe('sooner')
    expect(r?.reason).toMatch(/due first, on Oct 28/)
  })

  it('falls back to the first open requirement, and says that is why', () => {
    const r = chooseResume([req({ id: 'a' }), req({ id: 'b' })])
    expect(r?.id).toBe('a')
    expect(r?.verb).toBe('Start')
    expect(r?.reason).toBe('it is the first requirement still open')
  })

  it('never offers a satisfied requirement', () => {
    const r = chooseResume([
      req({ id: 'done', status: 'completed', completed: true, hasCommentary: true }),
      req({ id: 'skipped', status: 'na' }),
      req({ id: 'open' }),
    ])
    expect(r?.id).toBe('open')
  })

  it('offers nothing when the stage is finished', () => {
    expect(chooseResume([
      req({ id: 'a', status: 'completed', completed: true }),
      req({ id: 'b', status: 'na' }),
    ])).toBeNull()
  })

  it('offers nothing for a stage with no requirements', () => {
    expect(chooseResume([])).toBeNull()
  })
})

describe('the objective is the Process definition, or an admitted absence', () => {
  it('uses the configured description verbatim', () => {
    const o = stageObjective({ label: 'Expectations', description: 'What are our expectations for the print?' })
    expect(o).toEqual({ text: 'What are our expectations for the print?', source: 'definition' })
  })

  it('falls back to the stage label and marks it as a fallback', () => {
    expect(stageObjective({ label: 'Catalyst Check' })).toEqual({ text: 'Catalyst Check', source: 'fallback' })
    expect(stageObjective({ label: 'Catalyst Check', description: '  ' }).source).toBe('fallback')
  })

  it('never composes a question of its own', () => {
    const o = stageObjective({ label: 'Trade Decision' })
    expect(o.text).toBe('Trade Decision')
    expect(o.text).not.toMatch(/\?/)
  })
})

describe('the tally and the synthesis note', () => {
  const stage = [
    req({ id: '1', status: 'completed', completed: true }),
    req({ id: '2', hasCommentary: true }),
    req({ id: '3' }),
  ]

  it('counts satisfied, documented and open', () => {
    expect(tallyStage(stage)).toEqual({
      total: 3, complete: 1, documented: 1, open: 2, finished: false,
    })
  })

  it('counts a not-applicable requirement as satisfied, as the rail does', () => {
    expect(tallyStage([req({ id: '1', status: 'na' })]).finished).toBe(true)
  })

  it('states that a stage conclusion has nowhere to live', () => {
    /* The honest half: no column, no table, so the note must not imply a
       synthesis field exists somewhere off screen. */
    expect(synthesisNote(tallyStage(stage))).toMatch(/not stored separately/)
    expect(synthesisNote(tallyStage(stage))).toMatch(/1 of 2 open carries a written finding/)
  })

  it('says which requirements it is counting, in both branches', () => {
    /*
     * "None carries a written finding" read as a claim about the whole
     * stage when a COMPLETED requirement's finding was on screen directly
     * above it — seen on AMT's 27 Mar review. Both branches name the open
     * set they are counting.
     */
    const note = synthesisNote(tallyStage([req({ id: '1' }), req({ id: '2' })]))
    expect(note).toMatch(/None of the 2 open requirements carries a written finding yet/)
    const one = synthesisNote(tallyStage([
      req({ id: '1', status: 'completed', completed: true, hasCommentary: true }),
      req({ id: '2' }),
    ]))
    expect(one).toMatch(/None of the 1 open requirement carries a written finding yet/)
  })

  it('changes what it says once the stage is finished', () => {
    const note = synthesisNote(tallyStage([req({ id: '1', status: 'completed', completed: true })]))
    expect(note).toMatch(/Every requirement is satisfied/)
    expect(note).toMatch(/no separate conclusion of its own/)
  })

  it('says so for a stage with no requirements', () => {
    expect(synthesisNote(tallyStage([]))).toBe('This stage has no requirements yet.')
  })
})
