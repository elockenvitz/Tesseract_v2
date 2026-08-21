import { describe, expect, it } from 'vitest'

import { findExploreMatch, matchScore, targetType } from '../explore-match'
import { symbolOfEntry } from '../feed-entry-key'

const entry = (type: string, assetId: string, symbol?: string) => ({
  type, id: `${type}:${assetId}`, symbol: symbol ?? null,
})

describe('a preview opens the object it previewed', () => {
  it('requires the type AND the asset to agree', () => {
    /**
     * The bug this replaces short-circuited on the asset alone. A name usually
     * carries several findings at once — that is the premise of the feed — so
     * tapping "NVDA has no price target" opened whichever NVDA card happened
     * to be earliest in the pool, often the active-risk one. The reader taps
     * one finding and gets a different one about the same company.
     */
    const target = { dedupeKey: 'no_target:a1', assetId: 'a1', symbol: 'NVDA' }
    expect(matchScore(target, entry('active_risk', 'a1', 'NVDA'))).toBe(0)
    expect(matchScore(target, entry('no_target', 'a1', 'NVDA'))).toBeGreaterThan(0)
  })

  it('picks the right card out of several for one name', () => {
    const pool = [
      entry('active_risk', 'a1', 'NVDA'),
      entry('research_stale', 'a1', 'NVDA'),
      entry('no_target', 'a1', 'NVDA'),
    ]
    const found = findExploreMatch(
      { dedupeKey: 'no_target:a1', assetId: 'a1', symbol: 'NVDA' }, pool, e => e,
    )
    expect(found?.type).toBe('no_target')
  })

  it('prefers the entry that matches the asset over one that only matches the type', () => {
    // Both are no-target cards; only one is about the name that was tapped.
    const pool = [entry('no_target', 'other', 'AAPL'), entry('no_target', 'a1', 'NVDA')]
    const found = findExploreMatch(
      { dedupeKey: 'no_target:a1', assetId: 'a1', symbol: 'NVDA' }, pool, e => e,
    )
    expect(found?.id).toContain('a1')
  })

  it('falls back to the symbol when the asset id is not on the entry', () => {
    // News and template entries do not always carry an asset id.
    const pool = [{ type: 'news', id: 'news:x', symbol: 'CAT' }]
    const found = findExploreMatch({ dedupeKey: 'news:cat', symbol: 'CAT' }, pool, e => e)
    expect(found).toBeTruthy()
  })

  it('will not open a card about a different company', () => {
    // Same finding, wrong name — worse than opening nothing.
    const pool = [entry('no_target', 'other', 'AAPL')]
    expect(findExploreMatch(
      { dedupeKey: 'no_target:a1', assetId: 'a1', symbol: 'NVDA' }, pool, e => e,
    )).toBeNull()
  })

  it('matches an unattributed preview on type alone', () => {
    // A workflow item or a macro template names no asset, and matching it on
    // type is then the only thing that can be asked of it.
    const pool = [{ type: 'project_overdue', id: 'p:1', symbol: null }]
    expect(findExploreMatch({ dedupeKey: 'project_overdue:x' }, pool, e => e)).toBeTruthy()
  })

  it('returns null rather than inventing a card', () => {
    /**
     * A real answer: a post, an aggregate, or a template with no ticker has no
     * Level-2 renderer, and the overlay says so. Inventing one would mean a
     * second copy of every builder.
     */
    expect(findExploreMatch({ dedupeKey: 'thought:x' }, [entry('news', 'a1')], e => e)).toBeNull()
  })

  it('is stable — the feed order breaks ties', () => {
    const pool = [entry('no_target', 'a1', 'NVDA'), entry('no_target', 'a1', 'NVDA')]
    const t = { dedupeKey: 'no_target:a1', assetId: 'a1', symbol: 'NVDA' }
    expect(findExploreMatch(t, pool, e => e)).toBe(pool[0])
  })

  it('reads the signal type off the dedupe key', () => {
    expect(targetType({ dedupeKey: 'scenario_gap:a1' })).toBe('scenario_gap')
  })
})

describe('one symbol resolver, shared by the filter and the matcher', () => {
  it('knows where each kind hides its symbol', () => {
    expect(symbolOfEntry({ kind: 'news', news: { primarySymbol: 'CAT' } })).toBe('CAT')
    expect(symbolOfEntry({ kind: 'template', card: { symbol: 'AAPL' } })).toBe('AAPL')
    expect(symbolOfEntry({ kind: 'insight', insight: { symbol: 'NVDA' } })).toBe('NVDA')
    expect(symbolOfEntry({ kind: 'scenario', card: { entity: { ticker: 'MSFT' } } })).toBe('MSFT')
    expect(symbolOfEntry({ kind: 'lens', lens: { target: { symbol: 'ORCL' } } })).toBe('ORCL')
  })

  it('reads an idea from `idea`, not from `item`', () => {
    /**
     * Reading the wrong key returned undefined for every idea in the feed,
     * which made every idea vanish the moment any asset facet was set — with
     * nothing saying why. Two callers now depend on this, so a second copy
     * that got it wrong would break the Explore matcher the same way.
     */
    expect(symbolOfEntry({ kind: 'idea', idea: { asset: { symbol: 'DASH' } } })).toBe('DASH')
  })

  it('answers null for tiles that genuinely have no symbol', () => {
    // Kept when only category filters are set, dropped when an asset facet is.
    expect(symbolOfEntry({ kind: 'attention', attention: {} })).toBeNull()
    expect(symbolOfEntry({ kind: 'news', news: {} })).toBeNull()
  })
})
