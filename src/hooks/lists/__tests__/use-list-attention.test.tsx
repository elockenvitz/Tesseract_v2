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
  it('adds a decision owed to unanswered research and overdue reviews', () => {
    hooks.subjects = [subject('a', 'new'), subject('c', 'stale'), subject('d', 'nocase')]
    const f = attentionFor([{ id: 'l1', assetIds: ['a', 'c', 'd'] }])
    const at = f('l1')
    expect(at.needsAttention).toBe(at.awaitingDecision + at.newResearch + at.reviewDue)
    expect(at.needsAttention).toBe(2)
  })
})

/**
 * The securities behind the counts, and where each one goes.
 *
 * Lists home states attention as NAMED securities now, and each is a door into
 * that security's inspector. Both halves fail silently: a wrong `entryColumnId`
 * opens the list on Overview, which looks exactly like a working feature, and a
 * missing item simply means a universe under-reports what is waiting in it.
 */
describe('attention names the securities, not just the counts', () => {
  it('carries the security, the reason and where it goes', () => {
    hooks.subjects = [subject('a', 'new'), subject('c', 'stale')]
    hooks.ideas = [{
      id: 'i1', assetId: 'b', symbol: 'TGT', companyName: 'Target Corporation',
      direction: 'buy', stage: 'ready_to_recommend',
      portfolioName: 'Vision Fund 10K', createdAt: daysAgo(4),
    }]
    const items = attentionFor([{ id: 'l1', assetIds: ['a', 'b', 'c'] }])('l1').items

    const decision = items.find(i => i.symbol === 'TGT')!
    expect(decision.tier).toBe('decision')
    expect(decision.reason).toBe('BUY · Recommendation ready')
    expect(decision.meta).toBe('Vision Fund 10K · 4d')
    // A decision is reviewed in Work; `MODE_FOR_COLUMN` maps this column there.
    expect(decision.entryColumnId).toBe('list_work')

    const research = items.find(i => i.symbol === 'A')!
    expect(research.tier).toBe('research')
    expect(research.reason).toBe('3 new research')
    // Research and an overdue review are both reviewed AGAINST the case.
    expect(research.entryColumnId).toBe('list_view')

    const review = items.find(i => i.symbol === 'C')!
    expect(review.tier).toBe('review')
    expect(review.reason).toBe('Review due')
    expect(review.entryColumnId).toBe('list_view')
  })

  it('ranks a decision above research above a review clock', () => {
    hooks.subjects = [subject('a', 'stale'), subject('b', 'new')]
    hooks.ideas = [{
      id: 'i1', assetId: 'c', symbol: 'TGT', companyName: null,
      direction: 'buy', stage: 'ready_to_recommend', portfolioName: null, createdAt: daysAgo(1),
    }]
    const items = attentionFor([{ id: 'l1', assetIds: ['a', 'b', 'c'] }])('l1').items
    expect(items.map(i => i.tier)).toEqual(['decision', 'research', 'review'])
  })

  it('never lists one security twice — a decision claims the name', () => {
    /*
     * A security awaiting a decision may ALSO have unreviewed research. Listing
     * both would say the universe has more outstanding than it does, and the
     * decision is the thing to act on.
     */
    hooks.subjects = [subject('a', 'new')]
    hooks.ideas = [{
      id: 'i1', assetId: 'a', symbol: 'A', companyName: null,
      direction: 'buy', stage: 'ready_to_recommend', portfolioName: null, createdAt: daysAgo(1),
    }]
    const at = attentionFor([{ id: 'l1', assetIds: ['a'] }])('l1')
    expect(at.items).toHaveLength(1)
    expect(at.items[0].tier).toBe('decision')
    expect(at.needsAttention).toBe(1)
  })

  it('counts items and needsAttention consistently', () => {
    hooks.subjects = [subject('a', 'new'), subject('b', 'stale'), subject('d', 'nocase')]
    hooks.ideas = [{
      id: 'i1', assetId: 'c', symbol: 'C', companyName: null,
      direction: 'sell', stage: 'ready_to_recommend', portfolioName: null, createdAt: daysAgo(2),
    }]
    const at = attentionFor([{ id: 'l1', assetIds: ['a', 'b', 'c', 'd'] }])('l1')
    // `no-thesis` is a coverage gap, counted but never given an attention row.
    expect(at.noCase).toBe(1)
    expect(at.items).toHaveLength(at.needsAttention)
    expect(at.items).toHaveLength(3)
  })

  it('says nothing rather than inventing a reason it cannot support', () => {
    hooks.subjects = [subject('a', 'current')]
    const at = attentionFor([{ id: 'l1', assetIds: ['a'] }])('l1')
    expect(at.items).toEqual([])
    expect(at.needsAttention).toBe(0)
  })
})
