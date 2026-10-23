/**
 * What this module is allowed to claim about an earlier cycle.
 *
 * The risk being tested is not a crash — it is a FALSE PAIRING: showing
 * last quarter's conclusion under this quarter's requirement when the two
 * are not the same step. That misattributes an analyst's judgment, and it
 * does so invisibly, because a plausible-looking quote is exactly what the
 * reader expects to see. So most of these tests assert a REFUSAL.
 */

import { describe, it, expect } from 'vitest'
import {
  matchPriorWork, normalizeLabel, carriesWork,
  type PriorWorkRow, type PriorRunRef,
} from '../prior-work'

const run = (id: string, at: string): PriorRunRef => ({
  workflowId: id, label: `run-${id}`, at,
})

const MAR = run('mar', '2026-03-27T00:00:00Z')
const FEB = run('feb', '2026-02-27T00:00:00Z')

const row = (over: Partial<PriorWorkRow> & { itemId: string }): PriorWorkRow => ({
  run: MAR,
  requirementText: 'Check YTD performance',
  finding: 'the ytd performance is great',
  authorName: 'Eric Lockenvitz',
  writtenAt: '2026-03-27T12:00:00Z',
  notes: null,
  completed: true,
  ...over,
})

describe('normalizeLabel', () => {
  it('folds case and collapses whitespace', () => {
    expect(normalizeLabel('  Check   YTD\nperformance ')).toBe('check ytd performance')
  })

  it('treats null and blank as empty', () => {
    expect(normalizeLabel(null)).toBe('')
    expect(normalizeLabel('   ')).toBe('')
  })

  it('does NOT strip punctuation or stem words', () => {
    /*
     * The deliberate limit. "Review Our Model" and "Review our models"
     * are different instructions, and "Where is the sell side?" without
     * its question mark is a different string on purpose: a looser rule
     * would pair steps that a Process author wrote as distinct.
     */
    expect(normalizeLabel('Review our models')).not.toBe(normalizeLabel('Review our model'))
    expect(normalizeLabel('Where is the sell side?')).not.toBe(normalizeLabel('Where is the sell side'))
  })
})

describe('carriesWork', () => {
  it('is true for a written finding or working notes', () => {
    expect(carriesWork({ finding: 'something', notes: null })).toBe(true)
    expect(carriesWork({ finding: null, notes: 'something' })).toBe(true)
  })

  it('is false for absent or whitespace-only text', () => {
    expect(carriesWork({ finding: null, notes: null })).toBe(false)
    expect(carriesWork({ finding: '   ', notes: '\n' })).toBe(false)
  })
})

describe('matchPriorWork', () => {
  it('pairs an identical label and returns the finding verbatim', () => {
    const r = matchPriorWork('Check YTD performance', [row({ itemId: 'a' })])
    expect(r.outcome).toBe('matched')
    expect(r.match?.finding).toBe('the ytd performance is great')
    expect(r.match?.authorName).toBe('Eric Lockenvitz')
  })

  it('pairs across case and whitespace differences', () => {
    const r = matchPriorWork('check ytd   performance', [row({ itemId: 'a' })])
    expect(r.outcome).toBe('matched')
  })

  it('refuses a near miss rather than guessing', () => {
    const r = matchPriorWork('Check YTD performance vs peers', [row({ itemId: 'a' })])
    expect(r.outcome).toBe('none')
    expect(r.match).toBeNull()
    /* The run is still offered, because work WAS done in it. */
    expect(r.runsToReview.map(x => x.workflowId)).toEqual(['mar'])
  })

  it('ignores rows that carry no work at all', () => {
    const r = matchPriorWork('Check YTD performance', [
      row({ itemId: 'a', finding: null, notes: null }),
    ])
    expect(r.outcome).toBe('none')
    expect(r.runsToReview).toEqual([])
  })

  it('prefers the newest run when several cycles answered the same step', () => {
    const r = matchPriorWork('Check YTD performance', [
      row({ itemId: 'old', run: FEB, finding: 'february view' }),
      row({ itemId: 'new', run: MAR, finding: 'march view' }),
    ])
    expect(r.match?.finding).toBe('march view')
    /* February stays reachable for a reader following the trend. */
    expect(r.runsToReview.map(x => x.workflowId)).toEqual(['feb'])
  })

  it('refuses to pair when one run has two requirements of the same name', () => {
    /*
     * Nothing in a label says which of two identically named steps this
     * quarter's continues. Picking either would be a coin flip presented
     * as provenance, so the RUN is offered and no quote is shown.
     */
    const r = matchPriorWork('Check YTD performance', [
      row({ itemId: 'a', finding: 'first one' }),
      row({ itemId: 'b', finding: 'second one' }),
    ])
    expect(r.outcome).toBe('ambiguous')
    expect(r.match).toBeNull()
    expect(r.runsToReview.map(x => x.workflowId)).toEqual(['mar'])
  })

  it('still pairs when the duplicate labels are in DIFFERENT runs', () => {
    /* Two cycles each answering the step once is the normal case, not an
       ambiguity — only a collision WITHIN the newest run is unresolvable. */
    const r = matchPriorWork('Check YTD performance', [
      row({ itemId: 'a', run: MAR, finding: 'march view' }),
      row({ itemId: 'b', run: FEB, finding: 'february view' }),
    ])
    expect(r.outcome).toBe('matched')
    expect(r.match?.finding).toBe('march view')
  })

  it('reports none, with nothing to review, when no earlier cycle has work', () => {
    const r = matchPriorWork('Check YTD performance', [])
    expect(r.outcome).toBe('none')
    expect(r.runsToReview).toEqual([])
  })

  it('refuses to match on an empty requirement label', () => {
    /* An untouched template row has `item_text = null`. Normalising both
       sides to '' would otherwise pair every blank row with every other. */
    const r = matchPriorWork(null, [row({ itemId: 'a', requirementText: '' })])
    expect(r.outcome).toBe('none')
    expect(r.match).toBeNull()
  })

  it('does not pair a blank prior label with a real requirement', () => {
    const r = matchPriorWork('Check YTD performance', [
      row({ itemId: 'a', requirementText: null as unknown as string }),
    ])
    expect(r.outcome).toBe('none')
  })

  it('carries a matched row whose work is notes rather than a finding', () => {
    const r = matchPriorWork('Call the IR line', [
      row({ itemId: 'a', requirementText: 'Call the IR line', finding: null, notes: 'left a message' }),
    ])
    expect(r.outcome).toBe('matched')
    expect(r.match?.notes).toBe('left a message')
    expect(r.match?.finding).toBeNull()
  })

  it('orders the runs it offers newest first', () => {
    const r = matchPriorWork('Something else entirely', [
      row({ itemId: 'a', run: FEB }),
      row({ itemId: 'b', run: MAR }),
    ])
    expect(r.runsToReview.map(x => x.workflowId)).toEqual(['mar', 'feb'])
  })
})
