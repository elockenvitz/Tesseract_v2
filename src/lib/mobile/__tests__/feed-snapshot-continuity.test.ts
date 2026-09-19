/**
 * The base feed order survives a remount, not just the reader's tile.
 *
 * ── The defect this pins, and why it was invisible ────────────────────────
 *
 * `feed-continuity` remembered the FILTER and the anchored TILE, and that was
 * only half a promise. The order those anchors point into lives in a `useMemo`,
 * and a memo is component state: opening an asset unmounts the dashboard, so
 * coming back recomputes the order from whatever the inputs say then.
 *
 * Several of those inputs are written by the visit being resumed. The sharpest
 * is `rotateBySeen`, exercised for real below: the feed calls `markSeen` on its
 * top ten 1.5 seconds after mount, and the next mount loads that map and
 * demotes exactly those ten behind every unseen item. No data changes anywhere
 * and the feed still comes back reordered, on the first return.
 *
 * So the reader was put back on the right card in a different feed. These pin
 * the snapshot that fixes it.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  clearFeedContinuity, feedScopeKey, readFeedContinuity, reconcileToRemembered,
  rememberBaseOrder, writeFeedContinuity,
} from '../feed-continuity'
import { loadSeen, markSeen, rotateBySeen } from '../feed-rotation'

const SCOPE = feedScopeKey({ userId: 'u1', orgId: 'o1' })!
const USER = 'u1'

const items = (...ids: string[]) => ids.map(id => ({ id }))
const ids = <T extends { id: string }>(xs: T[]) => xs.map(x => x.id)
const paired = (...keys: string[]) => keys.map(key => ({ key, item: key }))

beforeEach(() => {
  clearFeedContinuity()
  localStorage.clear()
})

describe('the recompute a remount actually performs', () => {
  it('reorders the feed on the first return, with no data change', () => {
    /**
     * Not a stand-in: `rotateBySeen` and `markSeen` are the real functions the
     * dashboard calls, and `visibleItems` — their output — is a dependency of
     * the memo that ranks. This is the whole mechanism, end to end.
     */
    const candidates = items('a', 'b', 'c', 'd')

    // First mount: nothing seen, so the relevance order stands.
    const firstMount = rotateBySeen(candidates, loadSeen(USER))
    expect(ids(firstMount)).toEqual(['a', 'b', 'c', 'd'])

    // 1.5s later the feed records what it showed.
    markSeen(USER, ['a', 'b'])

    // Open an asset, come back. The component remounts and re-snapshots.
    const secondMount = rotateBySeen(candidates, loadSeen(USER))

    // The same four cards, in a different order. This is the failure.
    expect(ids(secondMount)).toEqual(['c', 'd', 'a', 'b'])
    expect(ids(secondMount)).not.toEqual(ids(firstMount))
  })
})

describe('the snapshot holds the order across that remount', () => {
  it('restores the exact base order the reader left', () => {
    const first = rememberBaseOrder(null, ['a', 'b', 'c', 'd'])
    writeFeedContinuity(SCOPE, { baseOrder: first })

    // The remount's recompute, reordered exactly as proved above.
    const recomputed = paired('c', 'd', 'a', 'b')
    const restored = reconcileToRemembered(recomputed, readFeedContinuity(SCOPE).baseOrder)

    expect(restored.map(p => p.key)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('is a fixed point, so remembering what it restored changes nothing', () => {
    // Otherwise the reconcile and the write would chase each other on every
    // render, which is the shape of a feed that never settles.
    const remembered = rememberBaseOrder(null, ['a', 'b', 'c'])
    const restored = reconcileToRemembered(paired('c', 'a', 'b'), remembered)
    const again = rememberBaseOrder(remembered, restored.map(p => p.key))
    expect(again).toEqual(remembered)
    expect(reconcileToRemembered(restored, again).map(p => p.key)).toEqual(['a', 'b', 'c'])
  })

  it('holds the order through a background refetch mid-visit', () => {
    // A write's `invalidateQueries` refetches a source and the ranker runs
    // again. Nothing already on screen may move because of it.
    const remembered = rememberBaseOrder(null, ['a', 'b', 'c'])
    const afterRefetch = reconcileToRemembered(paired('b', 'c', 'a'), remembered)
    expect(afterRefetch.map(p => p.key)).toEqual(['a', 'b', 'c'])
  })
})

describe('new findings arrive without moving anything', () => {
  it('appends what the snapshot does not know', () => {
    const remembered = rememberBaseOrder(null, ['a', 'b', 'c'])
    // The ranker would have led with the new card; the snapshot puts it last.
    const withNew = reconcileToRemembered(paired('new', 'a', 'b', 'c'), remembered)
    expect(withNew.map(p => p.key)).toEqual(['a', 'b', 'c', 'new'])
  })

  it('keeps every existing tile in place when several arrive at once', () => {
    const remembered = rememberBaseOrder(null, ['a', 'b', 'c'])
    const withNew = reconcileToRemembered(paired('n1', 'a', 'n2', 'b', 'c'), remembered)
    expect(withNew.map(p => p.key).slice(0, 3)).toEqual(['a', 'b', 'c'])
    // And the new ones keep the ranker's order among themselves.
    expect(withNew.map(p => p.key).slice(3)).toEqual(['n1', 'n2'])
  })

  it('extends the snapshot so the new tile keeps its place next time', () => {
    const remembered = rememberBaseOrder(null, ['a', 'b'])
    const next = rememberBaseOrder(remembered, ['a', 'b', 'new'])
    expect(next).toEqual(['a', 'b', 'new'])
    // Appended, never rewritten: the first two are untouched.
    expect(next.slice(0, 2)).toEqual(remembered)
  })
})

describe('membership still belongs to the ranker', () => {
  it('drops a tile the recompute no longer produces', () => {
    // Suppression after a judgment, or a refetch that removed the row. The
    // snapshot pins ORDER, not existence.
    const remembered = rememberBaseOrder(null, ['a', 'b', 'c'])
    const restored = reconcileToRemembered(paired('a', 'c'), remembered)
    expect(restored.map(p => p.key)).toEqual(['a', 'c'])
  })

  it('returns a tile that comes back to its original place, not to the end', () => {
    // Append-only memory is what makes this true, and it is why a transient
    // disappearance does not permanently demote a card.
    const remembered = rememberBaseOrder(null, ['a', 'b', 'c'])
    reconcileToRemembered(paired('a', 'c'), remembered)
    const back = reconcileToRemembered(paired('a', 'b', 'c'), remembered)
    expect(back.map(p => p.key)).toEqual(['a', 'b', 'c'])
  })

  it('keeps repeated keys together where the snapshot put them', () => {
    // Derived insights are re-presented once per scroll cycle, so a key can
    // legitimately appear more than once. `feedEntryKeys` suffixes repeats,
    // but a bucket is kept rather than assumed to be one entry.
    const remembered = rememberBaseOrder(null, ['a', 'b'])
    const restored = reconcileToRemembered(paired('b', 'a', 'a'), remembered)
    expect(restored.map(p => p.key)).toEqual(['a', 'a', 'b'])
  })
})

describe('a reload, and only a reload, composes a new feed', () => {
  it('takes the ranker order when there is no snapshot', () => {
    // The first visit of a page lifetime is the one time the feed is composed.
    expect(reconcileToRemembered(paired('c', 'a', 'b'), null).map(p => p.key))
      .toEqual(['c', 'a', 'b'])
    expect(reconcileToRemembered(paired('c', 'a'), []).map(p => p.key)).toEqual(['c', 'a'])
  })

  it('forgets the order when the reader asks for a fresh feed', () => {
    // Pull-to-refresh clears the whole record, the base order with it.
    writeFeedContinuity(SCOPE, { baseOrder: ['a', 'b'], family: 'crowding' })
    clearFeedContinuity(SCOPE)
    expect(readFeedContinuity(SCOPE).baseOrder).toBeNull()
  })

  it('keeps the order out of browser storage', () => {
    writeFeedContinuity(SCOPE, { baseOrder: ['a', 'b', 'c'] })
    const stored = [...Object.keys(sessionStorage), ...Object.keys(localStorage)]
      .map(k => sessionStorage.getItem(k) ?? localStorage.getItem(k) ?? '')
    expect(stored.some(v => v.includes('baseOrder'))).toBe(false)
  })
})
