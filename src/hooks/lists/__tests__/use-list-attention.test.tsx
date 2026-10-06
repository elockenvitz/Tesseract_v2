/**
 * Per-list attention counts.
 *
 * The counts are the whole reason Lists home exists — they answer "which
 * collection deserves my attention" — so a wrong one sends the reader to the
 * wrong list and is invisible while doing it. Pinned here because the fold is
 * cheap to get subtly wrong: the inputs are org-wide and the output is
 * per-list, so a missing filter silently reports the whole organisation's
 * backlog on every card.
 *
 * `stateOf` is deliberately NOT mocked. The point of these counts is that they
 * agree with the research lifecycle the rest of the product reads, so the real
 * classifier runs and the fixtures are shaped to drive it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const hooks = vi.hoisted(() => ({
  subjects: [] as any[],
  ideas: [] as any[],
}))

vi.mock('../../useDesktopResearch', () => ({
  useResearchScan: () => ({ subjects: hooks.subjects, isLoading: false, error: null }),
}))
vi.mock('../../useDesktopIdeas', () => ({
  useIdeaScan: () => ({ ideas: hooks.ideas, isLoading: false, error: null }),
}))

import { useListAttention } from '../useListAttention'

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

/**
 * A subject the real `stateOf` will classify as asked.
 *
 * `evidence-since-review` needs a written thesis plus unreviewed notes;
 * `stale` needs a thesis old enough to trip the clock with nothing new;
 * `no-thesis` needs evidence but no thesis.
 */
const subject = (assetId: string, kind: 'new' | 'stale' | 'nocase' | 'current') => {
  const common = {
    assetId, symbol: assetId.toUpperCase(), companyName: null,
    sectionCount: 1, coreSectionCount: 1, coreSections: ['thesis'],
    evidenceCount: 2, newSinceReview: 0, lastReviewedAt: null,
    daysSinceReview: 0, thesisUpdatedAt: daysAgo(2),
  }
  switch (kind) {
    case 'new': return { ...common, newSinceReview: 3 }
    case 'stale': return { ...common, thesisUpdatedAt: daysAgo(400), daysSinceReview: 400 }
    case 'nocase': return { ...common, thesisUpdatedAt: null }
    case 'current': return common
  }
}

beforeEach(() => {
  hooks.subjects = []
  hooks.ideas = []
})

const attentionFor = (lists: Array<{ id: string; assetIds: string[] }>) =>
  renderHook(() => useListAttention(lists)).result.current.attentionFor

describe('counts cover only the names on that list', () => {
  beforeEach(() => {
    hooks.subjects = [
      subject('a', 'new'), subject('b', 'new'),
      subject('c', 'stale'), subject('d', 'nocase'), subject('e', 'current'),
    ]
  })

  it('counts what is on the list and nothing else', () => {
    // `useResearchScan` is ORG-WIDE. A missing membership filter would report
    // the whole organisation's backlog on every card.
    const f = attentionFor([
      { id: 'l1', assetIds: ['a', 'c'] },
      { id: 'l2', assetIds: ['e'] },
    ])
    expect(f('l1')).toMatchObject({ newResearch: 1, reviewDue: 1, needsAttention: 2 })
    expect(f('l2')).toMatchObject({ newResearch: 0, reviewDue: 0, needsAttention: 0 })
  })

  it('sums the unreviewed notes, not just the names', () => {
    const f = attentionFor([{ id: 'l1', assetIds: ['a', 'b'] }])
    // Two names, three notes each.
    expect(f('l1')).toMatchObject({ newResearch: 2, newResearchNotes: 6 })
  })

  it('reports an unknown list as knowing nothing rather than throwing', () => {
    const f = attentionFor([{ id: 'l1', assetIds: ['a'] }])
    expect(f('nope')).toMatchObject({ newResearch: 0, needsAttention: 0 })
    expect(f(null)).toMatchObject({ needsAttention: 0 })
    expect(f(undefined)).toMatchObject({ needsAttention: 0 })
  })

  it('ignores a name with no research subject at all', () => {
    const f = attentionFor([{ id: 'l1', assetIds: ['a', 'never-seen'] }])
    expect(f('l1').newResearch).toBe(1)
  })

  it('never counts a name twice', () => {
    const f = attentionFor([{ id: 'l1', assetIds: ['a', 'a'] }])
    expect(f('l1').newResearch).toBe(1)
  })

  it('survives a list with no members', () => {
    const f = attentionFor([{ id: 'l1', assetIds: [] }])
    expect(f('l1')).toMatchObject({ needsAttention: 0, activeIdeas: 0 })
  })
})

describe('urgency is narrower than activity', () => {
  it('leaves an unwritten case and a live idea out of needsAttention', () => {
    /*
     * A gap in coverage is not something that changed today, and an idea
     * already in hand is work in progress. Folding either into one urgency
     * number makes every list equally loud, which is the failure this is
     * meant to fix.
     */
    hooks.subjects = [subject('d', 'nocase')]
    hooks.ideas = [{ assetId: 'd' }]
    const f = attentionFor([{ id: 'l1', assetIds: ['d'] }])
    expect(f('l1')).toMatchObject({ noCase: 1, activeIdeas: 1, needsAttention: 0 })
  })

  it('counts a name with a live idea once, however many ideas it carries', () => {
    hooks.ideas = [{ assetId: 'a' }, { assetId: 'a' }, { assetId: 'b' }]
    const f = attentionFor([{ id: 'l1', assetIds: ['a', 'b'] }])
    expect(f('l1').activeIdeas).toBe(2)
  })

  it('counts an idea on a name with no research subject', () => {
    // Ideas and research are independent reads; a name can carry an idea and
    // no written case at all.
    hooks.ideas = [{ assetId: 'z' }]
    const f = attentionFor([{ id: 'l1', assetIds: ['z'] }])
    expect(f('l1').activeIdeas).toBe(1)
  })

  it('skips an idea row with no asset id', () => {
    hooks.ideas = [{ assetId: null }, { assetId: 'a' }]
    const f = attentionFor([{ id: 'l1', assetIds: ['a'] }])
    expect(f('l1').activeIdeas).toBe(1)
  })
})

describe('needsAttention is the sum it claims to be', () => {
  it('adds unanswered research to overdue reviews', () => {
    hooks.subjects = [subject('a', 'new'), subject('c', 'stale'), subject('d', 'nocase')]
    const f = attentionFor([{ id: 'l1', assetIds: ['a', 'c', 'd'] }])
    const at = f('l1')
    expect(at.needsAttention).toBe(at.newResearch + at.reviewDue)
    expect(at.needsAttention).toBe(2)
  })
})
