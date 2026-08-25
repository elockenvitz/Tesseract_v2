import { describe, it, expect } from 'vitest'

import { categoryOf, signalTypeOf } from '../feed-categories'
import { EMPTY_FILTER, filterCount, type FeedFilter } from '../../../hooks/mobile/useFeedFacets'

/**
 * Filtering by the word on the card's own pill.
 *
 * A category is five buckets over thirty card types, so "Research" answers
 * "no thesis", "unreviewed change" and "target expired" together — and the pill
 * is what the reader recognises and what they mean by "show me the no-thesis
 * ones". Nothing filtered on it.
 */

const entry = (kind: string, type?: string) =>
  ({ kind, card: type ? { type } : null })

/** The predicate the feed applies, in the same order. */
const matches = (f: FeedFilter, e: ReturnType<typeof entry>) => {
  if (f.kinds.length) {
    const c = categoryOf(e)
    if (!c || !f.kinds.includes(c)) return false
  }
  if (f.signalTypes.length) {
    const t = signalTypeOf(e)
    if (!t || !f.signalTypes.includes(t)) return false
  }
  return true
}

describe('the pill is read from the declared type only', () => {
  it('names the card type', () => {
    expect(signalTypeOf(entry('signal', 'no_research'))).toBe('no_research')
    expect(signalTypeOf(entry('lens', 'conviction_oversized'))).toBe('conviction_oversized')
  })

  it('refuses to guess from the entry kind', () => {
    // `categoryOf` may fall back to the kind because every member of a kind
    // shares a category. That does not carry here: a `lens` entry may be a
    // crowding card or an oversized one, and guessing would put a card under a
    // pill it does not wear.
    expect(signalTypeOf(entry('lens'))).toBeNull()
    expect(categoryOf(entry('lens'))).toBe('decisions')
  })

  it('rejects a type the registry does not know', () => {
    expect(signalTypeOf(entry('signal', 'invented_kind'))).toBeNull()
  })
})

describe('the pill filter narrows within a category', () => {
  const noThesis = entry('signal', 'no_research')
  const staleWork = entry('signal', 'research_stale')

  it('keeps only the chosen pill', () => {
    const f = { ...EMPTY_FILTER, signalTypes: ['no_research'] }
    expect(matches(f, noThesis)).toBe(true)
    expect(matches(f, staleWork)).toBe(false)
  })

  it('composes with the category rather than replacing it', () => {
    // Research + No thesis is a narrower question than either alone, which is
    // why the two are separate lists.
    const both = { ...EMPTY_FILTER, kinds: ['research'], signalTypes: ['no_research'] }
    expect(matches(both, noThesis)).toBe(true)

    const wrongCategory = { ...EMPTY_FILTER, kinds: ['news'], signalTypes: ['no_research'] }
    expect(matches(wrongCategory, noThesis)).toBe(false)
  })

  it('takes several pills at once', () => {
    const f = { ...EMPTY_FILTER, signalTypes: ['no_research', 'research_stale'] }
    expect(matches(f, noThesis)).toBe(true)
    expect(matches(f, staleWork)).toBe(true)
  })

  it('excludes an entry with no pill rather than assuming it qualifies', () => {
    // Same rule the asset facets use: a tile that cannot satisfy the filter is
    // excluded, not waved through.
    const f = { ...EMPTY_FILTER, signalTypes: ['no_research'] }
    expect(matches(f, entry('lens'))).toBe(false)
  })

  it('changes nothing when unset', () => {
    expect(matches(EMPTY_FILTER, entry('lens'))).toBe(true)
    expect(matches(EMPTY_FILTER, noThesis)).toBe(true)
  })
})

describe('it counts as an active filter', () => {
  it('is included in the badge count', () => {
    // Otherwise the header would say "no filters" over a narrowed feed.
    expect(filterCount(EMPTY_FILTER)).toBe(0)
    expect(filterCount({ ...EMPTY_FILTER, signalTypes: ['no_research'] })).toBe(1)
    expect(filterCount({
      ...EMPTY_FILTER, kinds: ['research'], signalTypes: ['no_research', 'target_expired'],
    })).toBe(3)
  })

  it('starts empty', () => {
    expect(EMPTY_FILTER.signalTypes).toEqual([])
  })
})

describe('the pill list covers lens and scenario cards too', () => {
  /**
   * The reported miss: Oversized, Target reached, Target expired and Case vs
   * price were absent from the Signal filter.
   *
   * Those entries build their card at RENDER time, so the entry itself has no
   * `.card` and `signalTypeOf` returned null for exactly them. The feed already
   * names every entry's type in one place — the ranker's input — and that is
   * what the filter reads now.
   */
  const rankType = (e: { kind: string; type?: string }) => e.type ?? null

  it('resolves a lens entry that carries no built card', () => {
    const lens = { kind: 'lens', type: 'conviction_oversized' }
    expect(signalTypeOf(lens as any)).toBeNull()
    expect(rankType(lens)).toBe('conviction_oversized')
  })

  it('offers every pill the pool contains, not just the rendered page', () => {
    // Deriving the options from what is on screen meant choosing one pill
    // removed every other option, and pills deeper than the current page never
    // appeared at all.
    const pool = [
      { kind: 'lens', type: 'conviction_oversized' },
      { kind: 'lens', type: 'target_hit' },
      { kind: 'lens', type: 'target_expired' },
      { kind: 'scenario', type: 'scenario_gap' },
      { kind: 'signal', type: 'no_research' },
    ]
    const present = new Set(pool.map(rankType).filter(Boolean))
    for (const t of ['conviction_oversized', 'target_hit', 'target_expired', 'scenario_gap']) {
      expect(present.has(t)).toBe(true)
    }
  })
})
