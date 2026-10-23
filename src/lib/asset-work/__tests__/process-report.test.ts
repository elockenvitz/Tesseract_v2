/**
 * The report's job is to be TRUE before it is readable.
 *
 * Most of these assert a refusal: not summarising, not merging, not
 * promoting a tick into a finding. A report that reads well and overstates
 * what the team established is the failure mode this module exists to
 * prevent, and it is invisible in a screenshot.
 */
import { describe, it, expect } from 'vitest'
import {
  buildProcessReport, reportHeadline,
  type ReportRequirementInput, type ReportStageInput,
} from '../process-report'

const STAGES: ReportStageInput[] = [
  { stageId: 's1', label: 'Expectations', description: 'What do we expect?', sortOrder: 0 },
  { stageId: 's2', label: 'Earnings Print', sortOrder: 1 },
]

const req = (over: Partial<ReportRequirementInput> & { requirementId: string }): ReportRequirementInput => ({
  stageId: 's1', text: 'Read/Summarize News', ...over,
})

describe('buildProcessReport', () => {
  it('files requirements under their stage, in definition order', () => {
    const r = buildProcessReport(STAGES, [
      req({ requirementId: 'b', stageId: 's2', text: 'Review the print' }),
      req({ requirementId: 'a' }),
    ])
    expect(r.stages.map(s => s.label)).toEqual(['Expectations', 'Earnings Print'])
    expect(r.stages[0].requirements.map(x => x.requirementId)).toEqual(['a'])
    expect(r.stages[1].requirements.map(x => x.requirementId)).toEqual(['b'])
  })

  it('carries an assessment verbatim with its author and date', () => {
    const r = buildProcessReport(STAGES, [req({
      requirementId: 'a',
      commentaries: [{ text: 'Services decelerating.', authorName: 'Eric', at: '2026-10-01T00:00:00Z' }],
    })])
    const e = r.stages[0].requirements[0].entries[0]
    expect(e).toMatchObject({
      kind: 'assessment', text: 'Services decelerating.',
      authorName: 'Eric', at: '2026-10-01T00:00:00Z',
    })
  })

  it('does NOT turn a tick into a finding', () => {
    /*
     * The central rule. A completed requirement with nothing written is
     * its own outcome, counted separately, and contributes no entries —
     * so no reader can mistake "done" for "we concluded something".
     */
    const r = buildProcessReport(STAGES, [
      req({ requirementId: 'a', completed: true }),
    ])
    expect(r.stages[0].requirements[0].outcome).toBe('done-undocumented')
    expect(r.stages[0].requirements[0].entries).toEqual([])
    expect(r.documented).toBe(0)
    expect(r.doneUndocumented).toBe(1)
    expect(reportHeadline(r)).toMatch(/marked done without a written finding/)
  })

  it('preserves two contributors rather than merging them', () => {
    /* If they disagree, collapsing them would erase the disagreement; if
       they agree, it would manufacture a consensus statement nobody made. */
    const r = buildProcessReport(STAGES, [req({
      requirementId: 'a',
      commentaries: [
        { text: 'Bullish into the print.', authorName: 'Eric', at: '2026-10-01T00:00:00Z' },
        { text: 'I read it the other way.', authorName: 'Dana', at: '2026-10-02T00:00:00Z' },
      ],
    })])
    const entries = r.stages[0].requirements[0].entries
    expect(entries).toHaveLength(2)
    expect(entries.map(e => e.authorName)).toEqual(['Eric', 'Dana'])
    expect(r.contributors.map(c => c.name).sort()).toEqual(['Dana', 'Eric'])
  })

  it('never attributes a note to whoever ticked the box', () => {
    /*
     * Notes carry no author column. Borrowing `completed_by` would put an
     * operational note in the name of someone who may not have written it.
     */
    const r = buildProcessReport(STAGES, [req({
      requirementId: 'a', notes: 'left a message with IR',
      completed: true, completedByName: 'Someone Else',
    })])
    const note = r.stages[0].requirements[0].entries.find(e => e.kind === 'note')!
    expect(note.text).toBe('left a message with IR')
    expect(note.authorName).toBeNull()
    expect(note.at).toBeNull()
  })

  it('counts notes and attachments as documented work', () => {
    const notes = buildProcessReport(STAGES, [req({ requirementId: 'a', notes: 'found it' })])
    expect(notes.documented).toBe(1)
    const files = buildProcessReport(STAGES, [req({
      requirementId: 'a', attachments: [{ name: '10-Q.pdf', at: '2026-10-01T00:00:00Z' }],
    })])
    expect(files.documented).toBe(1)
    expect(files.stages[0].requirements[0].entries[0].kind).toBe('attachment')
  })

  it('separates not-applicable from outstanding and from done', () => {
    const r = buildProcessReport(STAGES, [
      req({ requirementId: 'a', status: 'na' }),
      req({ requirementId: 'b' }),
    ])
    const by = Object.fromEntries(r.stages[0].requirements.map(x => [x.requirementId, x.outcome]))
    expect(by).toEqual({ a: 'not-applicable', b: 'outstanding' })
    expect(r.outstanding).toBe(1)
  })

  it('keeps work whose stage left the definition instead of dropping it', () => {
    /* A reordered or edited Process must never silently delete somebody's
       written assessment from the record. */
    const r = buildProcessReport(STAGES, [req({
      requirementId: 'orphan', stageId: 'deleted-stage',
      commentaries: [{ text: 'still matters', authorName: 'Eric', at: '2026-01-01T00:00:00Z' }],
    })])
    const last = r.stages[r.stages.length - 1]
    expect(last.label).toBe('Not in the current definition')
    expect(last.requirements[0].requirementId).toBe('orphan')
    expect(r.documented).toBe(1)
  })

  it('treats whitespace-only text as nothing written', () => {
    const r = buildProcessReport(STAGES, [req({
      requirementId: 'a', notes: '   ', commentaries: [{ text: '\n', authorName: 'Eric', at: null }],
    })])
    expect(r.stages[0].requirements[0].entries).toEqual([])
    expect(r.empty).toBe(true)
  })

  it('names an untouched requirement rather than printing an empty heading', () => {
    const r = buildProcessReport(STAGES, [req({ requirementId: 'a', text: null })])
    expect(r.stages[0].requirements[0].text).toBe('Untitled requirement')
  })

  it('reports the real date span, and nothing when there is none', () => {
    const r = buildProcessReport(STAGES, [
      req({ requirementId: 'a', commentaries: [{ text: 'x', authorName: 'E', at: '2026-03-01T00:00:00Z' }] }),
      req({ requirementId: 'b', commentaries: [{ text: 'y', authorName: 'E', at: '2026-01-01T00:00:00Z' }] }),
    ])
    expect(r.firstAt).toBe('2026-01-01T00:00:00Z')
    expect(r.lastAt).toBe('2026-03-01T00:00:00Z')

    const bare = buildProcessReport(STAGES, [req({ requirementId: 'a', notes: 'no date' })])
    expect(bare.firstAt).toBeNull()
  })

  it('gives a compact shell, not a pretence, when the cycle is empty', () => {
    const r = buildProcessReport(STAGES, [req({ requirementId: 'a' }), req({ requirementId: 'b' })])
    expect(r.empty).toBe(true)
    expect(reportHeadline(r)).toBe('No work has been written down in this cycle yet.')
  })

  it('says so when the cycle has no requirements at all', () => {
    const r = buildProcessReport(STAGES, [])
    expect(r.total).toBe(0)
    expect(reportHeadline(r)).toBe('This cycle has no requirements.')
  })

  it('never emits a stage summary or an overall conclusion', () => {
    /* There is no field to put one in, and that is the point: a composed
       conclusion would read as the organization's view. */
    const r = buildProcessReport(STAGES, [req({
      requirementId: 'a', commentaries: [{ text: 'bullish', authorName: 'E', at: null }],
    })])
    expect(r.stages[0]).not.toHaveProperty('summary')
    expect(r.stages[0]).not.toHaveProperty('conclusion')
    expect(r).not.toHaveProperty('conclusion')
    /* The only stage-level prose is the DEFINITION's own objective. */
    expect(r.stages[0].objective).toBe('What do we expect?')
    expect(r.stages[1].objective).toBeNull()
  })
})
