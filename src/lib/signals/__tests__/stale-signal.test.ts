import { describe, expect, it } from 'vitest'

import { judgmentTouches } from '../stale-signal'
import { claimedSubjects, suppressCoveredInsights } from '../feed-dedupe'

/**
 * What is left of this file, and what moved.
 *
 * The trigger rule and the card copy used to live in `stale-signal` and were
 * tested here. Both moved to `lib/research/case-state`, along with their tests,
 * when the review anchor was fixed — the old rule measured from "any research
 * touch", which made evidence arriving look like a review and made the whole
 * question this family exists to answer inexpressible.
 *
 * Imported from `../stale-signal` directly rather than through
 * `useDerivedInsights`, which is how it was reached before. The hook imports
 * `supabase`, so the old import made a test of a pure function depend on an
 * environment it has no business needing.
 */

describe('judgment as engagement', () => {
  const at = new Date('2026-08-01T12:00:00.000Z').toISOString()

  it('a recorded judgment counts as having looked', () => {
    // Without this, tapping "Case holds" on Tuesday earns the same card again
    // on Wednesday — the feed punishing the exact behaviour it asks for.
    expect(judgmentTouches({ 'research_stale:a-1': { at } }))
      .toEqual([{ entityId: 'a-1', at }])
  })

  it('keeps the whole entity id when the type prefix is not the only colon', () => {
    // Splitting on every colon would truncate the id, nothing would ever match,
    // and the engagement rule would fail silently with no test naming it.
    expect(judgmentTouches({ 'target_expired:a:b:c': { at } })[0].entityId).toBe('a:b:c')
  })

  it('drops entries it cannot date rather than dating them now', () => {
    // A malformed row treated as `Date.now()` would mark a case freshly
    // reviewed and suppress a card that should have appeared.
    expect(judgmentTouches({
      'x:a-1': { at: 'not a date' },
      'x:a-2': { at: null },
      'a-3': { at },
      'x:': { at },
    })).toEqual([])
  })

  it('survives an empty or absent store', () => {
    expect(judgmentTouches({})).toEqual([])
    expect(judgmentTouches(undefined as any)).toEqual([])
  })
})

describe('deduplication against stronger signals', () => {
  const entry = (symbol: string, kind = 'stale_research') => ({ insight: { symbol, kind } })

  it('a name a sharper card already owns loses the general one', () => {
    // A reached target or an unbacked scenario names the event and offers the
    // matching action. "The case has not kept up" alongside it is a second tile
    // about the same holding that adds nothing.
    const claimed = claimedSubjects(['NVDA', 'msft'])
    const kept = suppressCoveredInsights([entry('NVDA'), entry('MSFT'), entry('AAPL')], claimed)
    expect(kept.map(e => e.insight.symbol)).toEqual(['AAPL'])
  })

  it('does not suppress a missing-case card', () => {
    // A stale target and a name with no written case at all are different gaps,
    // and the second is not implied by the first.
    const kept = suppressCoveredInsights([entry('NVDA', 'no_thesis')], claimedSubjects(['NVDA']))
    expect(kept).toHaveLength(1)
  })

  it('ignores blank subjects rather than matching everything with them', () => {
    // An empty claim used to become a `""` key. Any insight without a symbol
    // would then have matched it and vanished.
    const claimed = claimedSubjects([null, undefined, '', '  '])
    expect(claimed.size).toBe(0)
    expect(suppressCoveredInsights([{ insight: { symbol: undefined, kind: 'stale_research' } }], claimed))
      .toHaveLength(1)
  })
})
