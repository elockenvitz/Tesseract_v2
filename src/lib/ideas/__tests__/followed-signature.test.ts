import { describe, it, expect } from 'vitest'

import { followedSignature } from '../followed-signature'

/**
 * The bug: `useIdeasFeed` keyed on `ctx.followedIds.length`.
 *
 * A count is not an identity. Following one analyst and unfollowing another in
 * the same sitting leaves the count unchanged, so the query key was unchanged,
 * so React Query kept serving pages built from a following list the reader no
 * longer had — as current, with no indication.
 */
describe('the followed set has an identity, not a size', () => {
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  const C = '33333333-3333-4333-8333-333333333333'

  /** THE regression. Same length, different people. */
  it('changes when the set changes at constant length', () => {
    expect(followedSignature([A, B])).not.toBe(followedSignature([A, C]))
    // And the count alone, which is what the key used to carry, cannot tell
    // these apart at all.
    expect([A, B].length).toBe([A, C].length)
  })

  /** The other half: a reorder is not a change, and must not refetch. */
  it('does not change when the same set arrives in a different order', () => {
    expect(followedSignature([A, B])).toBe(followedSignature([B, A]))
    expect(followedSignature([A, B, C])).toBe(followedSignature([C, A, B]))
  })

  it('treats duplicates as the set they describe', () => {
    expect(followedSignature([A, B, A])).toBe(followedSignature([A, B]))
  })

  it('changes when somebody is added or removed', () => {
    expect(followedSignature([A, B])).not.toBe(followedSignature([A, B, C]))
    expect(followedSignature([A, B])).not.toBe(followedSignature([A]))
  })

  /**
   * Empty and not-yet-loaded are one key on purpose: the feed they produce is
   * the same feed, and it re-keys the moment real ids arrive.
   */
  it('gives empty, null and undefined the same signature', () => {
    expect(followedSignature([])).toBe('0:0')
    expect(followedSignature(null)).toBe('0:0')
    expect(followedSignature(undefined)).toBe('0:0')
    expect(followedSignature([null, undefined])).toBe('0:0')
  })

  /** Fixed width whatever the desk follows — the key ends up in every log. */
  it('stays short for a large following list', () => {
    const many = Array.from({ length: 400 }, (_, i) => `id-${i}`)
    expect(followedSignature(many).length).toBeLessThan(24)
  })

  /**
   * The separator is load-bearing: without one, ['ab','c'] and ['a','bc']
   * concatenate to the same string.
   */
  it('does not confuse different splits of the same characters', () => {
    expect(followedSignature(['ab', 'c'])).not.toBe(followedSignature(['a', 'bc']))
  })

  it('is deterministic across calls', () => {
    expect(followedSignature([A, B, C])).toBe(followedSignature([A, B, C]))
  })
})
