/**
 * The feed's filter and position contract.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * Filtering ran inside the ranking memo, ahead of `rankFeed`/`composeFeed`,
 * with the filter state in that memo's dependency list. A pill tap therefore
 * re-ranked a different candidate pool and produced a different feed — not the
 * same feed with rows hidden. The tile the pill was tapped ON moved or
 * vanished, and clearing the filter could not restore an order that nothing
 * had kept.
 *
 * These pin the model that replaces it: one base order, filters as derived
 * views over it, position by stable entry key.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  anchorKeyAt, clearFeedContinuity, deriveFeedView, emptyContinuity, feedScopeKey,
  indexOfKey, nearestRememberedKey, readFeedContinuity, resolveAnchorIndex,
  writeFeedContinuity,
} from '../feed-continuity'
import { familyOf } from '../feed-categories'

const SCOPE = feedScopeKey({ userId: 'u1', orgId: 'o1' })!

/**
 * Entries shaped the way the feed's own producers shape them, so `familyOf`
 * is exercised rather than a stand-in for it.
 *
 * `scenario_gap` twice, once with a capital stamp and once without, because
 * those are the two tiles that share a `SignalType` and wear different pills —
 * the exact pair a type-level filter cannot separate.
 */
const casePrice = { kind: 'scenario', card: { type: 'scenario_gap', id: 'c1' } }
const casePrice2 = { kind: 'scenario', card: { type: 'scenario_gap', id: 'c2' } }
const frameworkBreak = {
  kind: 'scenario',
  card: { type: 'scenario_gap', id: 'c3' },
  capital: { issueType: 'framework_break' },
}
const crowding = { kind: 'lens', card: { type: 'crowding', id: 'l1' } }
const noThesis = { kind: 'insight', insight: { id: 'i1', issue: { framing: 'no_case' } } }
const newEvidence = { kind: 'insight', insight: { id: 'i2', issue: { framing: 'new_evidence' } } }

const BASE = [casePrice, crowding, noThesis, frameworkBreak, newEvidence, casePrice2]
const family = (e: any) => familyOf(e)

beforeEach(() => clearFeedContinuity())

describe('a pill filters to exactly its own tile type', () => {
  it('Case vs Price returns only Case vs Price', () => {
    const view = deriveFeedView(BASE, family, family(casePrice))
    expect(view).toEqual([casePrice, casePrice2])
    // And specifically NOT the held framework break, which is the same
    // SignalType wearing a different pill.
    expect(view).not.toContain(frameworkBreak)
  })

  it('another tile type returns only that exact type', () => {
    expect(deriveFeedView(BASE, family, family(crowding))).toEqual([crowding])
    expect(deriveFeedView(BASE, family, family(noThesis))).toEqual([noThesis])
    // Two Research framings are two families, not one Research bucket.
    expect(deriveFeedView(BASE, family, family(newEvidence))).toEqual([newEvidence])
  })

  it('keeps the base order inside the view', () => {
    const view = deriveFeedView(BASE, family, family(casePrice))
    expect(BASE.indexOf(view[0])).toBeLessThan(BASE.indexOf(view[1]))
  })

  it('returns the whole base when nothing is filtered', () => {
    expect(deriveFeedView(BASE, family, null)).toEqual(BASE)
  })
})

describe('filtering never reranks', () => {
  it('does not consult a ranker to build a view', () => {
    // The view is a filter over an order that already exists. If anything here
    // needed to rank, the base could not be the thing being restored later.
    const rank = vi.fn((items: any[]) => [...items].reverse())
    const view = deriveFeedView(BASE, family, family(casePrice))
    expect(rank).not.toHaveBeenCalled()
    expect(view).toEqual([casePrice, casePrice2])
  })

  it('leaves the base array untouched, so clearing is a restoration', () => {
    const before = [...BASE]
    deriveFeedView(BASE, family, family(crowding))
    deriveFeedView(BASE, family, family(noThesis))
    deriveFeedView(BASE, family, null)
    expect(BASE).toEqual(before)
  })
})

describe('position is an identity, not an index', () => {
  const keys = ['a', 'b', 'c']

  it('finds a remembered key wherever it now sits', () => {
    expect(indexOfKey(keys, 'c')).toBe(2)
    expect(indexOfKey(['c', 'a'], 'c')).toBe(0)
  })

  it('falls back to the top when the view does not contain it', () => {
    // Not to a neighbour: the reader asked for something this tile is not part
    // of, and landing them at an unrelated card would be a silent wrong answer.
    expect(resolveAnchorIndex(keys, 'zzz')).toBe(0)
    expect(resolveAnchorIndex(keys, null)).toBe(0)
  })

  it('reads the anchored tile from measured slot offsets', () => {
    const offsets = [{ key: 'a', top: 0 }, { key: 'b', top: 600 }, { key: 'c', top: 1200 }]
    expect(anchorKeyAt(offsets, 0)).toBe('a')
    expect(anchorKeyAt(offsets, 600)).toBe('b')
    // A snapped scroller settles a fraction short of what it snapped to.
    expect(anchorKeyAt(offsets, 599.6)).toBe('b')
    expect(anchorKeyAt(offsets, 1300)).toBe('c')
  })

  it('reports the top of the feed above the first slot', () => {
    expect(anchorKeyAt([{ key: 'a', top: 40 }], 0)).toBe('a')
    expect(anchorKeyAt([], 0)).toBeNull()
  })
})

describe('the tapped tile stays anchored, and clearing comes back to it', () => {
  it('remembers the tapped tile in both the view and the base', () => {
    // Tapping the pill on tile `c1` is one gesture meaning two things: filter
    // to this type, and stay here.
    writeFeedContinuity(SCOPE, { family: 'scenario_gap', position: { baseKey: 'c1', viewKey: 'c1' } })
    const held = readFeedContinuity(SCOPE)
    expect(held.family).toBe('scenario_gap')
    expect(held.position.viewKey).toBe('c1')
  })

  it('restores the original tile when the filter is cleared', () => {
    writeFeedContinuity(SCOPE, { family: 'scenario_gap', position: { baseKey: 'c1', viewKey: 'c1' } })
    // Move within the filtered feed, then clear.
    writeFeedContinuity(SCOPE, { position: { viewKey: 'c2' } })
    writeFeedContinuity(SCOPE, { family: null, position: { viewKey: null } })

    const held = readFeedContinuity(SCOPE)
    expect(held.family).toBeNull()
    // Back to where they were before they filtered — not to where `c2` sits in
    // the full list.
    expect(held.position.baseKey).toBe('c1')
  })

  it('restores the original order by holding the base, not by recomputing', () => {
    const view = deriveFeedView(BASE, family, 'crowding')
    expect(view).toEqual([crowding])
    expect(deriveFeedView(BASE, family, null)).toEqual(BASE)
  })
})

describe('navigating away and back', () => {
  it('preserves the filter, the tile within it, and the base position', () => {
    writeFeedContinuity(SCOPE, { family: 'crowding', position: { baseKey: 'c1', viewKey: 'l1' } })

    // An in-app navigation unmounts the dashboard; the module outlives it.
    const afterReturn = readFeedContinuity(SCOPE)
    expect(afterReturn.family).toBe('crowding')
    expect(afterReturn.position.viewKey).toBe('l1')
    expect(afterReturn.position.baseKey).toBe('c1')
  })

  it('preserves a position the reader moved to inside the filter', () => {
    writeFeedContinuity(SCOPE, { family: 'scenario_gap', position: { baseKey: 'c1', viewKey: 'c1' } })
    // Scrolling inside the filtered feed moves the view anchor and must not
    // move the base one, or clearing would land somewhere the reader never was.
    writeFeedContinuity(SCOPE, { position: { viewKey: 'c2' } })

    const afterReturn = readFeedContinuity(SCOPE)
    expect(afterReturn.position.viewKey).toBe('c2')
    expect(afterReturn.position.baseKey).toBe('c1')
  })

  it('keeps one reader out of the place another left', () => {
    writeFeedContinuity(SCOPE, { family: 'crowding', position: { viewKey: 'l1' } })
    const other = feedScopeKey({ userId: 'u2', orgId: 'o1' })!
    expect(readFeedContinuity(other)).toEqual(emptyContinuity())
  })

  it('refuses to remember anything before the reader is identified', () => {
    expect(feedScopeKey({ userId: 'u1', orgId: null })).toBeNull()
    writeFeedContinuity(null, { family: 'crowding' })
    expect(readFeedContinuity(null)).toEqual(emptyContinuity())
  })
})

describe('only a reload starts a fresh feed session', () => {
  it('starts empty when the module is evaluated again', async () => {
    writeFeedContinuity(SCOPE, { family: 'crowding', position: { viewKey: 'l1' } })
    expect(readFeedContinuity(SCOPE).family).toBe('crowding')

    // A reload re-evaluates the bundle, which is the whole reason this lives in
    // a module rather than in sessionStorage: there is no expiry to check and
    // no key to clean up, the state simply is not there any more.
    vi.resetModules()
    const reloaded = await import('../feed-continuity')
    expect(reloaded.readFeedContinuity(SCOPE)).toEqual(reloaded.emptyContinuity())
  })

  it('writes nothing to storage', () => {
    writeFeedContinuity(SCOPE, { family: 'crowding', position: { viewKey: 'l1' } })
    const keys = [...Object.keys(sessionStorage), ...Object.keys(localStorage)]
    expect(keys.filter(k => k.includes('continuity'))).toEqual([])
  })
})


/**
 * A tile that went missing is not a reason to start the feed again.
 *
 * Manual QA: leave Ideas, come back, and the feed is at the beginning. The
 * position had been remembered correctly; what was missing was an answer for
 * the case where the remembered tile is not on screen yet, or not there at all.
 */
describe('the nearest remembered tile, when the exact one is gone', () => {
  const ORDER = ['a', 'b', 'c', 'd', 'e', 'f']

  it('uses the tile itself whenever it is still there', () => {
    expect(nearestRememberedKey(ORDER, ORDER, 'd')).toBe('d')
  })

  /**
   * Backwards first, and the direction is a product decision.
   *
   * The reader was moving down the feed, so the tile above the gap is one they
   * have already passed. Landing there shows them what replaced the missing
   * card; landing below it would skip whatever took its place.
   */
  it('lands on the tile above the gap rather than the one below', () => {
    expect(nearestRememberedKey(ORDER, ['a', 'b', 'c', 'e', 'f'], 'd')).toBe('c')
  })

  /**
   * Nearest wins; the backwards preference only settles a tie.
   *
   * From `d` with only `a` and `f` left, `f` is two away and `a` is three, so
   * the reader lands on `f`. Preferring backwards at any distance would send
   * them further from where they were, which is the thing being avoided.
   */
  it('takes the nearest survivor, whichever side it is on', () => {
    expect(nearestRememberedKey(ORDER, ['a', 'f'], 'd')).toBe('f')
    expect(nearestRememberedKey(ORDER, ['b', 'e'], 'd')).toBe('e')
  })

  it('goes forward when there is nothing behind', () => {
    expect(nearestRememberedKey(ORDER, ['b', 'c'], 'a')).toBe('b')
  })

  /**
   * Null, not the top.
   *
   * The caller reads null as "there is no position to restore" and leaves the
   * feed where it is, which is what a reader arriving fresh should see anyway.
   * Returning the first key instead would assert a position nobody remembered.
   */
  it('answers null when nothing from the remembered order survives', () => {
    expect(nearestRememberedKey(ORDER, ['x', 'y'], 'd')).toBeNull()
    expect(nearestRememberedKey(null, ['a'], 'd')).toBeNull()
    expect(nearestRememberedKey(ORDER, ORDER, null)).toBeNull()
  })

  /** A key the remembered order never held cannot be placed within it. */
  it('answers null for a tile that was never in the remembered order', () => {
    expect(nearestRememberedKey(ORDER, ['a', 'b'], 'zz')).toBeNull()
  })

  /**
   * The unfiltered contract, end to end on the model.
   *
   * Leave with a position, come back to a feed missing that one tile, and the
   * reader is put beside where they were rather than at the beginning.
   */
  it('keeps a five-screen scroll after a source refetched one card away', () => {
    writeFeedContinuity(SCOPE, { position: { baseKey: 'd', viewKey: 'd' }, baseOrder: ORDER })
    const remembered = readFeedContinuity(SCOPE)
    const now = ORDER.filter(k => k !== 'd')
    expect(nearestRememberedKey(remembered.baseOrder, now, remembered.position.baseKey))
      .toBe('c')
    expect(resolveAnchorIndex(now, remembered.position.baseKey)).toBe(0)
  })
})
