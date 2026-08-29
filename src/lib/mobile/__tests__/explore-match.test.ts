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

describe('the declared type beats the dedupe key', () => {
  it('matches a conviction tile, whose key says something else entirely', () => {
    /**
     * `dedupeKey` is `conviction:<asset>`; the ranked card is
     * `conviction_oversized`. Nothing could ever match, so tapping a
     * conviction tile fell through to "this one lives on its own surface".
     * The adapters build those keys from local vocabulary — `conviction`,
     * `post`, `attention`, `economic`, each insight's own kind — and none of
     * them are SignalType values.
     */
    const target = {
      dedupeKey: 'conviction:a1', signalType: 'conviction_oversized',
      assetId: 'a1', symbol: 'NVDA',
    }
    expect(targetType(target)).toBe('conviction_oversized')
    expect(findExploreMatch(target, [entry('conviction_oversized', 'a1', 'NVDA')], e => e)).toBeTruthy()
  })

  it('matches an insight tile', () => {
    const target = { dedupeKey: 'no_thesis:a1', signalType: 'no_research', assetId: 'a1' }
    expect(findExploreMatch(target, [entry('no_research', 'a1')], e => e)).toBeTruthy()
  })

  it('still falls back to the key for anything not yet declaring a type', () => {
    expect(targetType({ dedupeKey: 'news:x' })).toBe('news')
  })

  it('opens nothing for an aggregate, which has no single card', () => {
    // Correct behaviour, not a gap: "5 new ideas" filters Explore rather than
    // opening one object.
    const target = { dedupeKey: 'aggregate:ideas', signalType: null }
    expect(findExploreMatch(target, [entry('trade_idea', 'a1')], e => e)).toBeNull()
  })
})

describe('two posts about one name are two different objects', () => {
  /**
   * ── Why type and asset were not enough ──────────────────────────────────
   *
   * Every DERIVED card is unique per name: an asset has one missing-target
   * finding, one conviction gap, one scenario breach. The matcher was written
   * against that and it holds for all of them.
   *
   * A post is not derived. A desk publishes as many ideas and thoughts about
   * NVDA as it likes, and each carries the same signal type and the same asset,
   * so every one scored 2 and `findExploreMatch` kept the first. Tapping the
   * third idea on a name opened the first — a different colleague's post about
   * the same company, which reads as the app ignoring the tap.
   */
  const entries = [
    { type: 'trade_idea', id: 'idea:trade_idea:post-A', symbol: 'NVDA' },
    { type: 'trade_idea', id: 'idea:trade_idea:post-B', symbol: 'NVDA' },
  ]

  it('opens the post that was tapped, not its sibling', () => {
    const b = findExploreMatch(
      { dedupeKey: 'post:post-B', signalType: 'trade_idea', objectId: 'post-B', assetId: 'nvda', symbol: 'NVDA' },
      entries, e => e)
    expect(b?.id).toBe('idea:trade_idea:post-B')

    const a = findExploreMatch(
      { dedupeKey: 'post:post-A', signalType: 'trade_idea', objectId: 'post-A', assetId: 'nvda', symbol: 'NVDA' },
      entries, e => e)
    expect(a?.id).toBe('idea:trade_idea:post-A')
  })

  it('ranks the row above the asset', () => {
    // Both entries are about the right company; only one is the right post.
    const t = { dedupeKey: 'post:post-B', signalType: 'trade_idea', objectId: 'post-B', assetId: 'nvda', symbol: 'NVDA' }
    expect(matchScore(t, entries[1])).toBeGreaterThan(matchScore(t, entries[0]))
  })

  it('refuses a sibling when the named row is not in the pool at all', () => {
    /**
     * Without this the id would be cosmetic: a preview whose post the feed is
     * not carrying would fall through to the asset clause and open whichever
     * post on that name happened to be first — the original bug, reached by a
     * different route. Null sends the overlay to its honest fallback instead.
     */
    const t = { dedupeKey: 'post:post-Z', signalType: 'trade_idea', objectId: 'post-Z', assetId: 'nvda', symbol: 'NVDA' }
    expect(findExploreMatch(t, entries, e => e)).toBeNull()
  })

  it('leaves derived cards exactly as they were', () => {
    // A finding has no row behind it, so it declares no `objectId` and matches
    // on type and asset the way it always has.
    const found = findExploreMatch(
      { dedupeKey: 'no_target:a1', signalType: 'no_target', assetId: 'a1', symbol: 'AAPL' },
      [{ type: 'no_target', id: 'lens:no_target:a1', symbol: 'AAPL' }], e => e)
    expect(found?.id).toBe('lens:no_target:a1')
  })
})
