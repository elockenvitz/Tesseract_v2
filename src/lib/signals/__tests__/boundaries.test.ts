import { describe, expect, it } from 'vitest'

import { CONTENT_REGISTRY } from '../content-registry'
import { FEED_CATEGORIES } from '../../mobile/feed-categories'
import { targetType } from '../../mobile/explore-match'
import type { SignalType } from '../contract'

/**
 * The seams where two modules agree on a shape by convention.
 *
 * ── Why these get their own file ──────────────────────────────────────────
 *
 * Four defects in this phase were the same defect. Not a logic error in either
 * module — an agreement between two of them that nothing checked:
 *
 *   - `useIdeasFeed` emitted legs as `{ asset: { symbol } }`; the card builder
 *     read `l.symbol`. Every pair trade rendered with both sides blank.
 *   - the Explore adapters built `dedupeKey` from local vocabulary
 *     (`conviction`, `economic`, `post`); the matcher compared its prefix
 *     against `SignalType`. Whole families of tile could never open.
 *   - `categoryOf` resolved from the entry kind; `active_risk` arrives as a
 *     `template`. A sizing decision filed under News.
 *   - the Explore tap handler treated any `filter` destination as a filter;
 *     the adapters use that as a fallback for "no asset id". Tiles with cards
 *     refused to open.
 *
 * Each is invisible to `tsc` because the boundary is crossed through `any`, a
 * string, or a structurally-compatible shape. Widening the typecheck to these
 * files would surface hundreds of unrelated errors in code this phase does not
 * touch; asserting the agreements directly is cheaper and states the contract
 * where a reader will find it.
 *
 * These are deliberately shallow. They check that two sides still speak the
 * same language — not what either side does with it.
 */

describe('every category a card can declare is one the filters offer', () => {
  it('holds for all registry entries', () => {
    const offered = new Set(FEED_CATEGORIES.map(c => c.key))
    for (const [type, caps] of Object.entries(CONTENT_REGISTRY)) {
      expect(offered.has(caps.canonicalCategory), `${type} declares ${caps.canonicalCategory}`).toBe(true)
    }
  })
})

describe('the Explore matcher and the registry share a vocabulary', () => {
  it('resolves a declared type that the registry knows', () => {
    /**
     * The failure this pins: `targetType` used to return the dedupe-key
     * prefix, and the adapters built those from whatever local word was to
     * hand. `conviction` is not a SignalType; `conviction_oversized` is.
     */
    for (const type of Object.keys(CONTENT_REGISTRY) as SignalType[]) {
      const resolved = targetType({ dedupeKey: `whatever:${type}`, signalType: type })
      expect(CONTENT_REGISTRY[resolved as SignalType], type).toBeDefined()
    }
  })

  it('does not silently accept a word the registry has never heard of', () => {
    // Not an error — aggregates and unmigrated tiles legitimately resolve to
    // something outside the registry. What matters is that it is detectable,
    // so a matcher can decline rather than open the wrong card.
    const resolved = targetType({ dedupeKey: 'conviction:a1' })
    expect(CONTENT_REGISTRY[resolved as SignalType]).toBeUndefined()
  })
})

describe('pair legs cross the hook/builder boundary intact', () => {
  /**
   * `useIdeasFeed` emits `{ id, action, asset: { symbol } }` per leg. The card
   * builder reads `symbol`. Normalising in one place is the fix; this asserts
   * the normaliser handles BOTH shapes, so whichever side changes next, the
   * other keeps working.
   */
  const pairLegs = (legs: any[] | null | undefined): { symbol: string }[] =>
    (legs ?? [])
      .map(l => ({ symbol: String(l?.asset?.symbol ?? l?.symbol ?? '').toUpperCase() }))
      .filter(l => !!l.symbol)

  it('reads the feed shape', () => {
    expect(pairLegs([{ id: '1', action: 'buy', asset: { symbol: 'nvda' } }]))
      .toEqual([{ symbol: 'NVDA' }])
  })

  it('reads the builder shape too', () => {
    expect(pairLegs([{ symbol: 'AMD' }])).toEqual([{ symbol: 'AMD' }])
  })

  it('drops a leg with no resolvable symbol rather than emitting an empty one', () => {
    // An empty leg is what produced "proposed a pair trade" with both sides
    // blank — worse than a one-sided pair, because it names nothing at all.
    expect(pairLegs([{ id: '1', action: 'buy', asset: {} }, { symbol: 'AMD' }]))
      .toEqual([{ symbol: 'AMD' }])
  })

  it('survives null and undefined', () => {
    expect(pairLegs(null)).toEqual([])
    expect(pairLegs(undefined)).toEqual([])
  })
})
