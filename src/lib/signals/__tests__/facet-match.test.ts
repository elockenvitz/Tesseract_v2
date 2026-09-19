/**
 * The Curate boolean, pinned.
 *
 * Two shells will consume this rule, and the two properties below are the ones
 * a second implementation gets wrong: OR within a facet, AND across facets, and
 * the fact that an item with no symbol FAILS an asset facet rather than
 * passing it.
 */

import { describe, it, expect } from 'vitest'
import { matchesFeedFacets, assetFacetsActive } from '../facet-match'
import { EMPTY_FILTER, type FeedFilter } from '../../../hooks/mobile/useFeedFacets'

const filter = (over: Partial<FeedFilter> = {}): FeedFilter => ({ ...EMPTY_FILTER, ...over })

const AAPL = { category: 'Ideas', signalTypes: ['trade_idea'], symbol: 'AAPL', sector: 'Technology', country: 'US', exchange: 'NASDAQ' }
const BASF = { category: 'Research', signalTypes: ['no_thesis'], symbol: 'BAS', sector: 'Industrials', country: 'DE', exchange: 'XETR' }
/** A thought about nothing in particular. Common, and the tricky case. */
const NOTE = { category: 'Ideas', signalTypes: ['quick_thought'], symbol: null }

describe('matchesFeedFacets', () => {
  it('passes everything when nothing is selected', () => {
    for (const f of [AAPL, BASF, NOTE]) expect(matchesFeedFacets(f, EMPTY_FILTER)).toBe(true)
  })

  /** Within a facet: OR. Picking a second sector shows MORE, not fewer. */
  it('widens within one facet', () => {
    expect(matchesFeedFacets(BASF, filter({ sectors: ['Technology'] }))).toBe(false)
    expect(matchesFeedFacets(BASF, filter({ sectors: ['Technology', 'Industrials'] }))).toBe(true)
    expect(matchesFeedFacets(AAPL, filter({ sectors: ['Technology', 'Industrials'] }))).toBe(true)
  })

  /** Across facets: AND. Adding a country narrows what the sector allowed. */
  it('narrows across facets', () => {
    const sectorOnly = filter({ sectors: ['Technology', 'Industrials'] })
    expect(matchesFeedFacets(AAPL, sectorOnly)).toBe(true)
    const andGermany = filter({ sectors: ['Technology', 'Industrials'], countries: ['DE'] })
    expect(matchesFeedFacets(AAPL, andGermany)).toBe(false)
    expect(matchesFeedFacets(BASF, andGermany)).toBe(true)
  })

  /**
   * The rule that is easy to invert. A symbol-less item does not match an
   * asset facet — the question does not apply to it — and treating absence as
   * a pass would flood a sector filter with unrelated tiles.
   */
  it('excludes a symbol-less item once any asset facet is set', () => {
    expect(matchesFeedFacets(NOTE, EMPTY_FILTER)).toBe(true)
    expect(matchesFeedFacets(NOTE, filter({ kinds: ['Ideas'] }))).toBe(true)
    expect(matchesFeedFacets(NOTE, filter({ sectors: ['Technology'] }))).toBe(false)
    expect(matchesFeedFacets(NOTE, filter({ symbols: ['AAPL'] }))).toBe(false)
  })

  it('filters by category and by pill, and composes the two', () => {
    expect(matchesFeedFacets(BASF, filter({ kinds: ['Research'] }))).toBe(true)
    expect(matchesFeedFacets(BASF, filter({ kinds: ['Ideas'] }))).toBe(false)
    // Research + No thesis is narrower than either alone.
    expect(matchesFeedFacets(BASF, filter({ kinds: ['Research'], signalTypes: ['no_thesis'] }))).toBe(true)
    expect(matchesFeedFacets(BASF, filter({ kinds: ['Research'], signalTypes: ['target_expired'] }))).toBe(false)
  })

  /** An item can answer to several pills; matching any one of them is a hit. */
  it('matches when any of the item\'s own types is selected', () => {
    const multi = { ...AAPL, signalTypes: ['trade_idea', 'unreviewed_move'] }
    expect(matchesFeedFacets(multi, filter({ signalTypes: ['unreviewed_move'] }))).toBe(true)
    expect(matchesFeedFacets(multi, filter({ signalTypes: ['no_thesis'] }))).toBe(false)
  })

  it('knows when a symbol property is being asked about', () => {
    expect(assetFacetsActive(EMPTY_FILTER)).toBe(false)
    expect(assetFacetsActive(filter({ kinds: ['Ideas'] }))).toBe(false)
    for (const k of ['sectors', 'countries', 'exchanges', 'symbols'] as const) {
      expect(assetFacetsActive(filter({ [k]: ['x'] })), k).toBe(true)
    }
  })
})
