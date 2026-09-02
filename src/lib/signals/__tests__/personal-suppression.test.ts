/**
 * The personal-suppression seam.
 *
 * These pin the boundary conditions the three stores used to answer
 * differently, and the product rule underneath them: a personal disposition
 * hides an object from ONE reader and does nothing else to it.
 */
import { describe, it, expect } from 'vitest'
import {
  deferUntil,
  isPersonallySuppressed,
  toEpoch,
} from '../personal-suppression'

const NOW = Date.parse('2026-09-02T12:00:00Z')

describe('a reader with no disposition sees everything', () => {
  it('treats a missing record as no answer', () => {
    expect(isPersonallySuppressed(null, NOW)).toBe(false)
    expect(isPersonallySuppressed(undefined, NOW)).toBe(false)
    expect(isPersonallySuppressed({}, NOW)).toBe(false)
  })

  it('reads null and undefined the same way, because the stores disagree', () => {
    expect(isPersonallySuppressed({ dismissedAt: null, snoozedUntil: null }, NOW)).toBe(false)
    expect(isPersonallySuppressed({ dismissedAt: undefined }, NOW)).toBe(false)
  })
})

describe('dismissal is permanent', () => {
  it('hides the object regardless of any deferral', () => {
    expect(isPersonallySuppressed({ dismissedAt: NOW - 1 }, NOW)).toBe(true)
    expect(isPersonallySuppressed(
      { dismissedAt: '2026-01-01T00:00:00Z', snoozedUntil: NOW - 10_000 },
      NOW,
    )).toBe(true)
  })
})

describe('a deferral is live only while it has not run out', () => {
  it('suppresses while the deadline is ahead', () => {
    expect(isPersonallySuppressed({ snoozedUntil: NOW + 1 }, NOW)).toBe(true)
  })

  /**
   * Strictly before, not "at or before". A snooze that expires exactly now is
   * over: the reader asked for the card back at that moment, and holding it for
   * one more read loses it silently.
   */
  it('releases the object at the instant the deferral expires', () => {
    expect(isPersonallySuppressed({ snoozedUntil: NOW }, NOW)).toBe(false)
    expect(isPersonallySuppressed({ snoozedUntil: NOW - 1 }, NOW)).toBe(false)
  })

  it('accepts ISO strings, epoch numbers and Dates identically', () => {
    const iso = new Date(NOW + 3_600_000).toISOString()
    expect(isPersonallySuppressed({ snoozedUntil: iso }, NOW)).toBe(true)
    expect(isPersonallySuppressed({ snoozedUntil: NOW + 3_600_000 }, NOW)).toBe(true)
    expect(isPersonallySuppressed({ snoozedUntil: new Date(NOW + 3_600_000) }, NOW)).toBe(true)
  })
})

describe('a value that is not a time never hides anything', () => {
  /**
   * The direction matters. A corrupt entry should re-show a card the reader has
   * already answered, never hide one they have not seen.
   */
  it('resolves garbage to null rather than to a suppression', () => {
    expect(toEpoch('not a date')).toBeNull()
    expect(toEpoch(Number.NaN)).toBeNull()
    expect(isPersonallySuppressed({ snoozedUntil: 'not a date' }, NOW)).toBe(false)
    expect(isPersonallySuppressed({ dismissedAt: 'not a date' }, NOW)).toBe(false)
  })
})

describe('deferUntil', () => {
  it('is now plus the hours asked for', () => {
    expect(deferUntil(24, NOW)).toBe(NOW + 24 * 3_600_000)
    expect(deferUntil(1, NOW)).toBe(NOW + 3_600_000)
  })

  it('is deterministic — the clock is passed in, never read', () => {
    expect(deferUntil(72, NOW)).toBe(deferUntil(72, NOW))
  })

  /** A duration that cannot be expressed suppresses nothing. */
  it('yields an already-expired deadline for a nonsense duration', () => {
    expect(isPersonallySuppressed({ snoozedUntil: deferUntil(0, NOW) }, NOW)).toBe(false)
    expect(isPersonallySuppressed({ snoozedUntil: deferUntil(-5, NOW) }, NOW)).toBe(false)
    expect(isPersonallySuppressed({ snoozedUntil: deferUntil(Number.NaN, NOW) }, NOW)).toBe(false)
  })
})
