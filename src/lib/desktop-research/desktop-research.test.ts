/**
 * Focused tests for the Desktop Research domain layer.
 *
 * Scope: the review anchor, the state machine that decides why a subject
 * matters, ranking, the anchored price window's honesty rule, and
 * EngagementTarget construction. Pure — no React, no network.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  stateOf, whyItMatters, familyFor, primaryActionFor, issueFor, seedPromptFor,
  targetFor, tierOf, scoreOf, compareSubjects, STATE_LABEL, CORE_SECTIONS,
  openResearch, subscribeToOpenResearch, researchTabFor,
  type ResearchSubject,
} from './index'
import { anchoredWindow } from '../../components/research-v2/ResearchVisual'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const subject = (over: Partial<ResearchSubject> = {}): ResearchSubject => ({
  assetId: 'a-amzn', symbol: 'AMZN', companyName: 'Amazon.com',
  thesisUpdatedAt: daysAgo(30), daysSinceReview: 30,
  sectionCount: 3, coreSectionCount: 3, evidenceCount: 4,
  newestEvidenceAt: daysAgo(40), newSinceReview: 0,
  ...over,
})

describe('state — why a subject needs attention', () => {
  it('leads with evidence that arrived after the case was written', () => {
    expect(stateOf(subject({ newSinceReview: 2 }))).toBe('evidence-since-review')
  })

  it('only calls it a missing case when evidence exists to write one from', () => {
    expect(stateOf(subject({ thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 5 })))
      .toBe('no-thesis')
    expect(stateOf(subject({ thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 0 })))
      .toBe('thin')
  })

  it('does not call a name stale while new evidence is outstanding', () => {
    // Age is the weaker reason; the outstanding work is the headline.
    expect(stateOf(subject({ daysSinceReview: 400, newSinceReview: 1 }))).toBe('evidence-since-review')
  })

  it('uses ninety days as the review horizon', () => {
    expect(stateOf(subject({ daysSinceReview: 89 }))).toBe('current')
    expect(stateOf(subject({ daysSinceReview: 90 }))).toBe('stale')
  })

  it('marks a recently written case with no evidence behind it as thin', () => {
    expect(stateOf(subject({ daysSinceReview: 10, evidenceCount: 0 }))).toBe('thin')
  })
})

describe('why-it-matters is an investment reason, never a bare age', () => {
  it('names the count of new items, not the number of days', () => {
    const text = whyItMatters(subject({ newSinceReview: 3 }))
    expect(text).toContain('3 research items')
    expect(text).toContain('after the case was last written')
  })

  it('singularises', () => {
    expect(whyItMatters(subject({ newSinceReview: 1 }))).toContain('1 research item arrived')
  })

  it('only mentions a price move when one was actually measured', () => {
    const s = subject({ newSinceReview: 2 })
    expect(whyItMatters(s)).not.toMatch(/moved/)
    expect(whyItMatters(s, -12.4)).toContain('moved -12.4%')
  })

  it('gives every state a sentence, a label, a verb and a seed', () => {
    const all = [
      subject({ newSinceReview: 1 }),
      subject({ thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 2 }),
      subject({ daysSinceReview: 200 }),
      subject({ evidenceCount: 0 }),
      subject(),
    ]
    for (const s of all) {
      expect(whyItMatters(s).length).toBeGreaterThan(20)
      expect(STATE_LABEL[stateOf(s)]).toBeTruthy()
      expect(primaryActionFor(s)).toBeTruthy()
      expect(issueFor(s)).toBeTruthy()
      expect(seedPromptFor(s).length).toBeGreaterThan(30)
    }
  })
})

describe('the verb is specific to what the subject needs', () => {
  it.each([
    [subject({ newSinceReview: 1 }), 'Review new evidence'],
    [subject({ thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 3 }), 'Write the case'],
    [subject({ daysSinceReview: 200 }), 'Review thesis'],
    [subject({ evidenceCount: 0 }), 'Add evidence'],
    [subject(), 'Read the case'],
  ])('%#', (s, verb) => expect(primaryActionFor(s as ResearchSubject)).toBe(verb))
})

describe('visual family degrades rather than fabricating', () => {
  it('needs both an anchor and history that reaches it to claim since-review', () => {
    const s = subject({ newSinceReview: 2 })
    expect(familyFor(s, { hasAnchoredHistory: true })).toBe('since-review')
    expect(familyFor(s, { hasAnchoredHistory: false })).toBe('arrival')
  })

  it('never claims since-review without an anchor, however much history exists', () => {
    const s = subject({ thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 3 })
    expect(familyFor(s, { hasAnchoredHistory: true })).toBe('coverage')
  })

  it('falls through to typography rather than drawing a chart of one number', () => {
    expect(familyFor(subject({ evidenceCount: 0 }))).toBe('typographic')
  })
})

describe('the anchored price window tells the truth about its own span', () => {
  const series = (n: number, from: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.now() - (from - i) * DAY).toISOString().slice(0, 10),
      close: 100 + i,
    }))

  it('slices at the anchor and says so when the data reaches it', () => {
    const w = anchoredWindow(series(120, 120), daysAgo(30))!
    expect(w.reachesAnchor).toBe(true)
    // ~30 of the 120 points survive the slice.
    expect(w.series.length).toBeLessThan(40)
    expect(w.days).toBeLessThanOrEqual(31)
  })

  it('refuses to claim since-review when history starts after the review', () => {
    // Case written 300 days ago; only 60 days of prices exist.
    const w = anchoredWindow(series(60, 60), daysAgo(300))!
    expect(w.reachesAnchor).toBe(false)
    expect(w.series.length).toBe(60)
  })

  it('refuses when there is no anchor at all', () => {
    expect(anchoredWindow(series(60, 60), null)!.reachesAnchor).toBe(false)
  })

  it('returns nothing rather than a flat line from one point', () => {
    expect(anchoredWindow([{ date: '2026-01-01', close: 100 }], daysAgo(30))).toBeNull()
    expect(anchoredWindow(undefined, daysAgo(30))).toBeNull()
  })

  it('computes the move over the sliced window, not the whole series', () => {
    const w = anchoredWindow(series(120, 120), daysAgo(30))!
    const full = anchoredWindow(series(120, 120), null)!
    expect(Math.abs(w.changePct - full.changePct)).toBeGreaterThan(1)
  })
})

describe('ranking is tier-first', () => {
  it('orders the reasons by what an investor acts on first', () => {
    expect(tierOf(subject({ newSinceReview: 1 }))).toBe(0)
    expect(tierOf(subject({ thesisUpdatedAt: null, daysSinceReview: null, evidenceCount: 2 }))).toBe(1)
    expect(tierOf(subject({ daysSinceReview: 200 }))).toBe(2)
    expect(tierOf(subject())).toBe(3)
  })

  it('never lets a big position outrank a lower tier', () => {
    const heavyStale = subject({ assetId: 'a1', daysSinceReview: 300, weightPct: 12 })
    const tinyNew = subject({ assetId: 'a2', newSinceReview: 1, weightPct: 0.2 })
    expect([heavyStale, tinyNew].sort(compareSubjects)[0].assetId).toBe('a2')
  })

  it('uses weight to order within a tier', () => {
    const big = subject({ assetId: 'a1', newSinceReview: 1, weightPct: 11 })
    const small = subject({ assetId: 'a2', newSinceReview: 1, weightPct: 0.1 })
    expect(scoreOf(big)).toBeGreaterThan(scoreOf(small))
    expect([small, big].sort(compareSubjects)[0].assetId).toBe('a1')
  })

  it('is a total order — equal subjects never swap between renders', () => {
    const a = subject({ assetId: 'a-aaa' }), b = subject({ assetId: 'a-bbb' })
    expect(compareSubjects(a, b)).toBeLessThan(0)
    expect(compareSubjects(b, a)).toBeGreaterThan(0)
    expect(compareSubjects(a, a)).toBe(0)
  })
})

describe('the engagement target binds object and issue', () => {
  it('targets the asset, which Discuss already supports', () => {
    const t = targetFor(subject({ newSinceReview: 2 }))!
    expect(t.objectType).toBe('asset')
    expect(t.objectId).toBe('a-amzn')
    expect(t.origin?.surface).toBe('research')
  })

  it('carries the issue, not just the object', () => {
    const t = targetFor(subject({ newSinceReview: 2 }))!
    expect(t.issue?.title).toBe(STATE_LABEL['evidence-since-review'])
    expect(t.issue?.reason).toBe('research:evidence-since-review')
    expect(t.issue?.detail).toContain('2 research items')
  })

  it('only builds chips from values that exist', () => {
    const t = targetFor(subject({ evidenceCount: 0, newSinceReview: 0, weightPct: undefined }))!
    const labels = (t.contextChips ?? []).map(c => c.label)
    expect(labels).not.toContain('Research')
    expect(labels).not.toContain('New since review')
    expect(labels).not.toContain('Weight')
    expect(labels).toContain('Last review')
  })

  it('seeds AI with the actual problem, not a generic prompt', () => {
    expect(seedPromptFor(subject({ newSinceReview: 3, symbol: 'NVDA' })))
      .toContain('3 research items arrived on NVDA')
  })
})

describe('arrival is typed, and reuses one tab', () => {
  const listeners: (() => void)[] = []
  // Without this the window listeners accumulate and one dispatch is counted
  // by every earlier test's handler.
  afterEach(() => { listeners.splice(0).forEach(off => off()) })

  it('delivers the reason the user was sent', () => {
    const seen: any[] = []
    listeners.push(subscribeToOpenResearch(r => seen.push(r)))
    expect(openResearch({ assetId: 'a-1', focus: 'evidence', issue: 'New evidence since review' })).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ assetId: 'a-1', focus: 'evidence' })
  })

  it('ignores a request with no subject', () => {
    const seen: any[] = []
    listeners.push(subscribeToOpenResearch(r => seen.push(r)))
    expect(openResearch({ assetId: '' })).toBe(false)
    expect(seen).toHaveLength(0)
  })

  it('unsubscribes cleanly', () => {
    const seen: any[] = []
    const off = subscribeToOpenResearch(r => seen.push(r))
    off()
    openResearch({ assetId: 'a-1' })
    expect(seen).toHaveLength(0)
  })

  it('uses a fixed tab id so arriving twice re-selects instead of duplicating', () => {
    const a = researchTabFor({ assetId: 'a-1' })
    const b = researchTabFor({ assetId: 'a-2', focus: 'thesis' })
    expect(a.id).toBe(b.id)
    expect(b.data.selectedAssetId).toBe('a-2')
    expect(b.data.focus).toBe('thesis')
  })
})

/**
 * The review anchor is the whole product, so it gets tests of its own rather
 * than being implied by the state machine's.
 */
describe('the CORE review anchor', () => {
  it('is derived from exactly three sections', () => {
    expect([...CORE_SECTIONS]).toEqual(['thesis', 'where_different', 'risks_to_thesis'])
  })

  it('excludes the peripheral sections from the anchor set', () => {
    for (const peripheral of ['business_model', 'key_catalysts', 'price_target', 'rating']) {
      expect(CORE_SECTIONS as readonly string[]).not.toContain(peripheral)
    }
  })

  it('does not let a peripheral section stand in for a written case', () => {
    // The NVDA shape: business_model on file, no core section, so no anchor.
    const s = subject({
      thesisUpdatedAt: null, daysSinceReview: null,
      sectionCount: 1, coreSectionCount: 0, evidenceCount: 1,
    })
    expect(stateOf(s)).toBe('no-thesis')
    expect(tierOf(s)).toBe(1)
  })

  it('does not let a peripheral update reset the review clock', () => {
    // Same asset before and after a business_model edit: sectionCount rises,
    // the anchor does not move, and the name stays stale.
    const before = subject({ daysSinceReview: 300, sectionCount: 3, coreSectionCount: 3 })
    const afterPeripheralEdit = { ...before, sectionCount: 4 }
    expect(afterPeripheralEdit.thesisUpdatedAt).toBe(before.thesisUpdatedAt)
    expect(afterPeripheralEdit.daysSinceReview).toBe(300)
    expect(stateOf(afterPeripheralEdit)).toBe('stale')
    expect(primaryActionFor(afterPeripheralEdit)).toBe('Review thesis')
  })

  it('does move when a core section is saved', () => {
    const stale = subject({ daysSinceReview: 300 })
    const reviewed = { ...stale, thesisUpdatedAt: daysAgo(0), daysSinceReview: 0 }
    expect(stateOf(stale)).toBe('stale')
    expect(stateOf(reviewed)).toBe('current')
  })
})

describe('the missing-case sentence never claims there is no research', () => {
  it('names the evidence and the supporting sections that do exist', () => {
    const text = whyItMatters(subject({
      symbol: 'NVDA', thesisUpdatedAt: null, daysSinceReview: null,
      sectionCount: 2, coreSectionCount: 0, evidenceCount: 3,
    }))
    expect(text).toContain('3 research items')
    expect(text).toContain('2 supporting sections')
    expect(text).toContain('core thesis has not been written')
    expect(text).not.toMatch(/no research|nothing on record/i)
  })

  it('labels the state as a missing core thesis, not missing research', () => {
    expect(STATE_LABEL['no-thesis']).toBe('Core thesis not written')
    expect(STATE_LABEL['no-thesis']).not.toMatch(/no research/i)
  })

  it('still reads correctly when only evidence exists', () => {
    const text = whyItMatters(subject({
      symbol: 'V', thesisUpdatedAt: null, daysSinceReview: null,
      sectionCount: 0, coreSectionCount: 0, evidenceCount: 1,
    }))
    expect(text).toContain('1 research item')
    expect(text).not.toContain('supporting section')
  })
})
