/**
 * The feed has no bottom, and the second pass is not the first pass again.
 *
 * ── The requirement ───────────────────────────────────────────────────────
 *
 * A reader who keeps swiping keeps getting tiles. When the unique content is
 * gone the tiles repeat rather than the scroll stopping — and "the order could
 * and should be different if duplicates are showing", because a replay reads
 * as a loop rather than as the feed continuing.
 *
 * ── What this module does and does not promise ────────────────────────────
 *
 * It rotates the RANKED list before each round is composed. That is the whole
 * mechanism, and the composer does the rest: a different card leads, so a
 * different family is spaced against, so different substitutions win.
 *
 * A rotation and not a shuffle, deliberately. Every card appears exactly once
 * per round, and the ranking still means something inside a round because the
 * relative order after the cut is untouched.
 */

import { describe, expect, it } from 'vitest'

import { rotateForRound, roundOffset } from '../feed-rounds'

const list = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('the first pass is the honest one', () => {
  /**
   * Round 0 is the ranked order untouched, which is what keeps every promise
   * about the opening intact: the most important card leads, and nothing about
   * repetition can reach it.
   */
  it('leaves round zero exactly as ranked', () => {
    expect(rotateForRound(list(30), 0)).toEqual(list(30))
    expect(roundOffset(0, 30)).toBe(0)
  })

  it('treats a negative round as round zero', () => {
    expect(rotateForRound(list(30), -1)).toEqual(list(30))
  })
})

describe('every round holds the whole pool', () => {
  it('loses nothing and duplicates nothing', () => {
    for (let round = 0; round < 8; round++) {
      const out = rotateForRound(list(37), round)
      expect(out).toHaveLength(37)
      expect(new Set(out).size).toBe(37)
    }
  })

  /** The ranking still means something inside a round. */
  it('keeps the relative order after the cut', () => {
    const out = rotateForRound(list(20), 3)
    const at = out[0]
    // Everything from the cut to the end, then everything before it.
    expect(out).toEqual([...list(20).slice(at), ...list(20).slice(0, at)])
  })
})

describe('rounds do not repeat each other', () => {
  it('starts consecutive rounds in different places', () => {
    const offsets = [1, 2, 3, 4, 5, 6, 7, 8].map(r => roundOffset(r, 50))
    expect(new Set(offsets).size).toBe(offsets.length)
  })

  /**
   * The reason the offset steps by the golden ratio rather than by the round
   * number: `round * k` lands on a repeating set as soon as the round count
   * and the pool size share a factor, and a pool size is arbitrary.
   */
  it('does not settle into a short period on an awkward pool size', () => {
    for (const size of [10, 12, 16, 20, 24, 36, 60, 100]) {
      const offsets = Array.from({ length: 6 }, (_, i) => roundOffset(i + 1, size))
      expect(new Set(offsets).size, `size ${size}`).toBeGreaterThanOrEqual(5)
    }
  })

  it('spreads consecutive rounds far apart rather than by one', () => {
    const size = 100
    for (let round = 1; round < 6; round++) {
      const gap = Math.abs(roundOffset(round + 1, size) - roundOffset(round, size))
      expect(gap).toBeGreaterThan(size / 10)
    }
  })
})

describe('the pass is still pure', () => {
  it('is deterministic', () => {
    expect(rotateForRound(list(41), 5)).toEqual(rotateForRound(list(41), 5))
  })

  it('does not mutate its input', () => {
    const input = list(20)
    rotateForRound(input, 4)
    expect(input).toEqual(list(20))
  })

  it('survives a degenerate pool', () => {
    expect(rotateForRound([], 3)).toEqual([])
    expect(rotateForRound([1], 3)).toEqual([1])
    expect(roundOffset(3, 0)).toBe(0)
  })
})
