/**
 * The feed contract, asserted field by field.
 *
 * ── Why this suite exists separately ──────────────────────────────────────
 *
 * "The feed must not change" is the load-bearing constraint of this stage, and
 * it is the one an adoption is most likely to break by accident. The parity
 * suite next door checks that the engine AGREES with production; this one
 * checks something stricter and simpler — that the projection cannot alter the
 * inputs the feed pipeline reads, whatever the resolver decides.
 *
 * Every field below is named because something downstream reads it:
 *
 *   id           `compareRanked`'s final tie-break; the key for dispositions,
 *                dwell tracking and pane state
 *   type         the tier partition, `categoryOf`, `readerQuestionFor`, and
 *                every Curate filter
 *   severity     a ranking component
 *   provenance   `occurredAt`, which ranking and the eyebrow both read
 *   entity       `symbolOfEntry`, the asset facets, the coverage lookup
 *   dedupeKey    whether a claim the reader already dealt with resurfaces
 *   expiry       when the card resolves itself
 *   capital      the Portfolio family in Curate
 *
 * A change to any of them is a feed change wearing a rendering change's
 * clothes, so the test is exhaustive rather than representative.
 */

import { describe, expect, it } from 'vitest'

import { adoptScenarioGap, adoptStaleTarget, cardOrOriginal } from '../mobile'
import { categoryOf } from '../../../mobile/feed-categories'
import { readerQuestionFor } from '../../../signals/reader-question'
import type { SignalCard } from '../../../signals/contract'
import {
  PHONE, dislocationCard, staleTargetCard, staleTargetRow,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
const CAPITAL = { weightPct: 4.8 }

/** Every pair the feed reads, old and new. */
const pairs = (): { name: string; original: SignalCard; next: SignalCard }[] => {
  const stale = staleTargetCard()
  const staleR = adoptStaleTarget(staleTargetRow(), stale, READER, PHONE)
  const gap = dislocationCard()
  const gapR = adoptScenarioGap(gap, CAPITAL, READER, PHONE)
  return [
    { name: 'target_expired', original: stale, next: cardOrOriginal(stale, staleR) },
    { name: 'scenario_gap', original: gap, next: cardOrOriginal(gap, gapR) },
  ]
}

describe('the projection cannot change what the feed reads', () => {
  it('preserves identity', () => {
    for (const { name, original, next } of pairs()) {
      expect(next.id, name).toBe(original.id)
    }
  })

  it('preserves the type, and so the tier, the category and the question', () => {
    for (const { name, original, next } of pairs()) {
      expect(next.type, name).toBe(original.type)
      expect(readerQuestionFor(next.type), name).toBe(readerQuestionFor(original.type))
    }
  })

  it('preserves severity', () => {
    for (const { name, original, next } of pairs()) {
      expect(next.severity, name).toBe(original.severity)
    }
  })

  it('preserves provenance, and so the ranked occurredAt', () => {
    for (const { name, original, next } of pairs()) {
      expect(next.provenance, name).toEqual(original.provenance)
    }
  })

  it('preserves the entity, and so the symbol every facet filters on', () => {
    for (const { name, original, next } of pairs()) {
      expect(next.entity, name).toEqual(original.entity)
    }
  })

  it('preserves the dedupe key, so nothing already dealt with resurfaces', () => {
    for (const { name, original, next } of pairs()) {
      expect(next.dedupeKey, name).toBe(original.dedupeKey)
    }
  })

  it('preserves expiry and capital', () => {
    for (const { name, original, next } of pairs()) {
      expect(next.expiry, name).toEqual(original.expiry)
      expect(next.capital, name).toEqual(original.capital)
    }
  })

  it('leaves the Curate category exactly where it was', () => {
    for (const { name, original, next } of pairs()) {
      const asEntry = (c: SignalCard) => ({ kind: 'scenario', card: c })
      expect(categoryOf(asEntry(next)), name).toBe(categoryOf(asEntry(original)))
    }
  })
})

describe('the seam is safe in both positions', () => {
  /**
   * The identity property, stated directly.
   *
   * `adoptTile` in `MobileDashboard` returns its argument when the flag is
   * off. This asserts the other half — that turning it ON cannot remove a
   * card, because a decline hands back the original object.
   */
  it('a card is never lost, whatever the engine decides', () => {
    for (const { name, original, next } of pairs()) {
      expect(next, name).toBeTruthy()
      expect(next.id, name).toBe(original.id)
    }
  })

  it('adoption runs after ranking, so it reads no ranking state', () => {
    // Neither entry point takes a rank, a tier, a position or a feed.
    expect(adoptStaleTarget.length).toBe(4)
    expect(adoptScenarioGap.length).toBe(4)
  })
})
