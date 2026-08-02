import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { interestScore, loadInterest, recordInterest } from '../feed-telemetry'

const USER = 'user-1'

describe('feed-telemetry', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores a glance but credits a real read', () => {
    recordInterest({ userId: USER, signal: 'dwell', assetId: 'a', dwellMs: 300 })
    expect(loadInterest(USER).assets.a).toBeUndefined()

    recordInterest({ userId: USER, signal: 'dwell', assetId: 'a', dwellMs: 5000 })
    expect(loadInterest(USER).assets.a).toBeCloseTo(5, 1)
  })

  it('caps a single dwell so a pocketed phone cannot dominate', () => {
    recordInterest({ userId: USER, signal: 'dwell', assetId: 'a', dwellMs: 10 * 60 * 1000 })
    // Capped at 45s of credit, not 600.
    expect(loadInterest(USER).assets.a).toBeLessThanOrEqual(45)
  })

  it('weights explicit signals above passive dwell', () => {
    recordInterest({ userId: USER, signal: 'dwell', assetId: 'passive', dwellMs: 5000 })
    recordInterest({ userId: USER, signal: 'readthrough', assetId: 'explicit' })

    const vector = loadInterest(USER)
    expect(vector.assets.explicit).toBeGreaterThan(vector.assets.passive)
  })

  it('accumulates across interactions', () => {
    recordInterest({ userId: USER, signal: 'reaction', assetId: 'a' })
    recordInterest({ userId: USER, signal: 'reaction', assetId: 'a' })
    expect(loadInterest(USER).assets.a).toBeCloseTo(40, 1)
  })

  it('decays interest over time', () => {
    recordInterest({ userId: USER, signal: 'reaction', assetId: 'a' })
    const fresh = loadInterest(USER).assets.a

    // Jump forward one half-life (21 days).
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 21 * 86_400_000))

    const decayed = loadInterest(USER).assets.a
    expect(decayed).toBeLessThan(fresh)
    expect(decayed).toBeCloseTo(fresh / 2, 0)
  })

  it('scores relative to the user\'s own strongest interest', () => {
    recordInterest({ userId: USER, signal: 'readthrough', assetId: 'strong' })
    recordInterest({ userId: USER, signal: 'dwell', assetId: 'weak', dwellMs: 2000 })

    const vector = loadInterest(USER)
    const strong = interestScore(vector, { assetId: 'strong' })
    const weak = interestScore(vector, { assetId: 'weak' })
    const unknown = interestScore(vector, { assetId: 'never-seen' })

    expect(strong).toBeGreaterThan(weak)
    expect(unknown).toBe(0)
    expect(strong).toBeLessThanOrEqual(1)
  })

  it('weights the asset above the author', () => {
    recordInterest({ userId: USER, signal: 'readthrough', assetId: 'a' })
    recordInterest({ userId: USER, signal: 'readthrough', authorId: 'z' })

    const vector = loadInterest(USER)
    expect(interestScore(vector, { assetId: 'a' })).toBeGreaterThan(
      interestScore(vector, { authorId: 'z' })
    )
  })

  it('keeps users separate and tolerates a missing user', () => {
    recordInterest({ userId: USER, signal: 'reaction', assetId: 'a' })
    expect(loadInterest('someone-else').assets.a).toBeUndefined()

    expect(() => recordInterest({ userId: '', signal: 'reaction', assetId: 'a' })).not.toThrow()
  })

  it('ignores an interaction with no subject', () => {
    recordInterest({ userId: USER, signal: 'reaction' })
    expect(Object.keys(loadInterest(USER).assets)).toHaveLength(0)
  })
})
