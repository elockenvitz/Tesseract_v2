/**
 * Nothing the reader has passed may move. Everything below it may.
 *
 * ── The promise, and how wide it used to be ───────────────────────────────
 *
 * `feed-continuity` exists so the feed does not shift under someone working
 * down it. It kept that promise by remembering the ENTIRE composed order and
 * holding all of it in place, which is correct and is much wider than the
 * promise needs.
 *
 * The cost is invisible until the feed is endless. `reconcileToRemembered` puts
 * anything it does not know AFTER everything it does, so once the whole order
 * is frozen, material arriving later can only be appended. A page of posts
 * fetched at the bottom of a long scroll lands behind every tile in the feed
 * rather than interleaving into the stretch the reader is about to reach —
 * which is precisely where variety has run thinnest and where new material is
 * worth most.
 *
 * The narrower promise is the true one: what has been PASSED holds still, and
 * what has never been seen is composed. These tests pin the boundary.
 */

import { describe, expect, it } from 'vitest'

import {
  clearFeedContinuity, deepestRead, reconcileToRemembered,
  readFeedContinuity, rememberBaseOrder, writeFeedContinuity,
} from '../feed-continuity'

const SCOPE = 'reader:org'
const pair = (keys: string[]) => keys.map(key => ({ key, item: key }))

describe('the high-water mark only rises', () => {
  it('takes the deeper of the two', () => {
    expect(deepestRead(5, 9)).toBe(9)
    expect(deepestRead(9, 5)).toBe(9)
    expect(deepestRead(null, 4)).toBe(4)
    expect(deepestRead(undefined, 0)).toBe(0)
  })

  it('ignores a negative or unusable depth', () => {
    expect(deepestRead(6, -3)).toBe(6)
    expect(deepestRead(6, Number.NaN)).toBe(6)
  })

  /**
   * A reader who scrolls back up still has tiles below them on screen.
   * Recording the live position would let those recompose while visible.
   */
  it('does not fall back when the reader scrolls up', () => {
    clearFeedContinuity(SCOPE)
    writeFeedContinuity(SCOPE, { readDepth: 20 })
    writeFeedContinuity(SCOPE, { readDepth: 3 })
    expect(readFeedContinuity(SCOPE).readDepth).toBe(20)
  })

  it('starts at zero', () => {
    clearFeedContinuity(SCOPE)
    expect(readFeedContinuity(SCOPE).readDepth).toBe(0)
  })
})

describe('the frozen prefix holds and the tail composes', () => {
  const composed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

  /** What the reader has passed keeps the place it had. */
  it('holds the prefix in its remembered order', () => {
    const frozen = rememberBaseOrder(null, composed.slice(0, 4))
    // A later pass composes the same cards differently.
    const recomposed = ['h', 'c', 'a', 'g', 'd', 'b', 'f', 'e']
    const out = reconcileToRemembered(pair(recomposed), frozen).map(p => p.item)
    expect(out.slice(0, 4)).toEqual(['a', 'b', 'c', 'd'])
  })

  /**
   * And below it the composer governs. This is the half that used to be
   * impossible: 'h' and 'g' come back in the order the new composition chose,
   * not in the order the first pass happened to put them.
   */
  it('lets the tail take the new composition', () => {
    const frozen = rememberBaseOrder(null, composed.slice(0, 4))
    const recomposed = ['h', 'c', 'a', 'g', 'd', 'b', 'f', 'e']
    const out = reconcileToRemembered(pair(recomposed), frozen).map(p => p.item)
    expect(out.slice(4)).toEqual(['h', 'g', 'f', 'e'])
  })

  /**
   * The case the change exists for: material that did not exist when the
   * prefix was frozen interleaves into the tail instead of landing at the end.
   */
  it('interleaves newly arrived material into the tail', () => {
    const frozen = rememberBaseOrder(null, composed.slice(0, 4))
    // A later page arrives and the composer places it among the unseen tail.
    const withNew = ['a', 'b', 'c', 'd', 'e', 'new-1', 'f', 'new-2', 'g', 'h']
    const out = reconcileToRemembered(pair(withNew), frozen).map(p => p.item)
    expect(out.slice(0, 4)).toEqual(['a', 'b', 'c', 'd'])
    expect(out.indexOf('new-1')).toBeLessThan(out.indexOf('g'))
    expect(out.indexOf('new-2')).toBeLessThan(out.indexOf('h'))
  })

  /** Freezing everything is the old behaviour, and still available. */
  it('appends rather than interleaves when the whole order is frozen', () => {
    const frozen = rememberBaseOrder(null, composed)
    const withNew = ['a', 'b', 'c', 'd', 'e', 'new-1', 'f', 'new-2', 'g', 'h']
    const out = reconcileToRemembered(pair(withNew), frozen).map(p => p.item)
    expect(out.slice(0, 8)).toEqual(composed)
    expect(out.slice(8)).toEqual(['new-1', 'new-2'])
  })

  /** Nothing is dropped at either setting. */
  it('keeps every card', () => {
    const frozen = rememberBaseOrder(null, composed.slice(0, 4))
    const withNew = [...composed, 'new-1']
    const out = reconcileToRemembered(pair(withNew), frozen).map(p => p.item)
    expect(new Set(out)).toEqual(new Set(withNew))
    expect(out).toHaveLength(withNew.length)
  })
})

describe('the prefix grows with the reader', () => {
  /**
   * Append-only still holds, so the pair stays a fixed point: reconciling and
   * then remembering produces the same list again and the two cannot chase
   * each other across renders.
   */
  it('extends as the reader goes deeper, and never rewrites', () => {
    const composed = ['a', 'b', 'c', 'd', 'e', 'f']
    const shallow = rememberBaseOrder(null, composed.slice(0, 2))
    const deeper = rememberBaseOrder(shallow, composed.slice(0, 5))
    expect(deeper).toEqual(['a', 'b', 'c', 'd', 'e'])

    const out = reconcileToRemembered(pair(composed), deeper).map(p => p.item)
    expect(rememberBaseOrder(deeper, out.slice(0, 5))).toEqual(deeper)
  })
})
