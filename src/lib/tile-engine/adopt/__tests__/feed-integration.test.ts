/**
 * Tile engine composition against the stable-feed contract.
 *
 * ── What this suite is defending ──────────────────────────────────────────
 *
 * Feed continuity is authoritative: filtering is a VIEW over one base order,
 * and a filter change may not rerun ranking, change composition, reorder the
 * base, or reset an anchor. Composition is the other half — it decides what the
 * candidates ARE, before any of that.
 *
 * The pipeline those two facts imply is:
 *
 *   raw candidates
 *     → semantic findings / situations
 *     → target composition absorption
 *     → final unfiltered candidates
 *     → rank
 *     → reconcile against the page-lifetime order
 *     → derive the exact-family view
 *     → window / render
 *
 * Every test below pins one joint of it, using the real entry shapes the feed
 * carries rather than plain objects, so a shape change breaks the test rather
 * than slipping past it.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  absorbedTargetLenses, composedTargetKeys, composeTargetPair, type TargetPair,
} from '../target-composition'
import {
  clearFeedContinuity, deriveFeedView, feedScopeKey, readFeedContinuity,
  reconcileToRemembered, rememberBaseOrder, writeFeedContinuity,
} from '../../../mobile/feed-continuity'
import { feedEntryKeys } from '../../../mobile/feed-entry-key'
import { entryHasExactFamily, familyLabel, familyOf, isExactFamily } from '../../../mobile/feed-categories'
import { rankFeed, type PriorityInput } from '../../../signals/feed-priority'
import { targetHitSeverity, staleTargetSeverity } from '../../../signals/lens-severity'
import {
  dislocationCard, staleTargetCard, staleTargetRow,
  targetBreachRow, targetHitCard, thesisInsight,
} from './fixtures'

const COVERAGE = () => 'direct' as const

// ─────────────────────────────────────────────────────────────────────────────
// Real feed-entry shapes
// ─────────────────────────────────────────────────────────────────────────────

/** A lens entry, exactly as `lensEntries` builds one. */
const breachEntry = (over: Parameters<typeof targetBreachRow>[0] = {}) => ({
  kind: 'lens' as const,
  score: 60,
  lens: { type: 'breach' as const, breach: targetBreachRow(over) },
  signalType: 'target_hit',
})

const staleEntry = (over: Parameters<typeof staleTargetRow>[0] = {}) => ({
  kind: 'lens' as const,
  score: 58,
  lens: { type: 'stale' as const, target: staleTargetRow(over) },
  signalType: 'target_expired',
})

/** A scenario entry, as `scenarioEntries` builds one. Unheld: no capital stamp. */
const scenarioEntry = (over: Parameters<typeof dislocationCard>[0] = {}) => ({
  kind: 'scenario' as const,
  score: 0,
  card: dislocationCard(over),
})

/**
 * The same card with a capital stamp — a HELD framework break.
 *
 * The builder only stamps `capital` when the position is genuinely behind the
 * break, and it sets no distinct `kindLabel`, so this tile's pill reads exactly
 * what the unheld one's reads.
 */
const heldScenarioEntry = () => {
  const card = dislocationCard({ assetId: 'a-tsla', symbol: 'TSLA', companyName: 'Tesla' })
  return {
    kind: 'scenario' as const,
    score: 0,
    card: {
      ...card,
      capital: {
        issueKey: 'p-core:a-tsla:framework_break',
        issueType: 'framework_break',
        portfolioId: 'p-core',
        portfolioName: 'Core Equity',
      },
    },
  }
}

const insightEntry = () => ({
  kind: 'insight' as const,
  score: 0,
  round: 0,
  insight: thesisInsight(),
})

const pair = (
  hitOver: Parameters<typeof targetBreachRow>[0] = {},
  staleOver: Parameters<typeof staleTargetRow>[0] = {},
): TargetPair => ({
  assetId: 'a-msft',
  hit: { row: targetBreachRow(hitOver), card: targetHitCard(hitOver) },
  expired: { row: staleTargetRow(staleOver), card: staleTargetCard(staleOver) },
})

/** The dashboard's absorption step, as a function over entries. */
const absorb = (entries: any[], pairs: TargetPair[]) => {
  const dropped = absorbedTargetLenses(pairs, COVERAGE)
  const keys = composedTargetKeys(pairs, COVERAGE)
  if (!dropped.size) return entries
  const assetOf = (e: any): string | null => {
    if (e.kind !== 'lens') return null
    if (e.lens.type === 'breach') return e.lens.breach.assetId
    if (e.lens.type === 'stale') return e.lens.target.assetId
    return null
  }
  return entries
    .filter(e => {
      const id = assetOf(e)
      if (!id) return true
      const drop = dropped.get(id)
      return !drop || drop !== e.lens.type
    })
    .map(e => {
      const id = assetOf(e)
      const k = id ? keys.get(id) : null
      return k ? { ...e, composedKey: k } : e
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Exact-family pill filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('exact-family pill filtering', () => {
  const base = [breachEntry(), scenarioEntry(), insightEntry(), heldScenarioEntry()]

  it('tapping Case vs Price returns only Case vs Price tiles', () => {
    const tapped = familyOf(scenarioEntry())
    expect(tapped).toBe('scenario_gap')
    expect(familyLabel(tapped)).toBe('Case vs price')
    const view = deriveFeedView(base, familyOf, tapped)
    expect(view).toEqual([scenarioEntry()])
  })

  it('tapping Target Expired returns only Target Expired tiles', () => {
    const tapped = familyOf(staleEntry())
    expect(tapped).toBe('target_expired')
    expect(familyLabel(tapped)).toBe('Target expired')
    const view = deriveFeedView([...base, staleEntry()], familyOf, tapped)
    expect(view).toHaveLength(1)
    expect((view[0] as any).lens.type).toBe('stale')
  })

  it('the banner names the family in the same words the pill was printed in', () => {
    for (const e of [breachEntry(), scenarioEntry(), insightEntry(), staleEntry()]) {
      const family = familyOf(e)
      expect(isExactFamily(family), String(family)).toBe(true)
      expect(familyLabel(family), String(family)).toBeTruthy()
    }
  })

  /**
   * A producer name is not a family, so its pill is not a control.
   *
   * `familyOf` falls back to the entry kind for the four kinds that carry no
   * family metadata. Filtering by `signal` would ask for everything that hook
   * emits, which is not what the chip on such a tile says.
   */
  it('offers no filter where the family is only the hook that produced the row', () => {
    for (const kind of ['signal', 'idea', 'attention']) {
      expect(entryHasExactFamily({ kind } as any), kind).toBe(false)
    }
    /**
     * `news` is the exception, and it is not a leak.
     *
     * Its entry-kind fallback collides with a real `SignalType` of the same
     * name, so the key has a label and the pill stays a control — which is
     * correct, because the chip on a news tile reads "News" and filtering to
     * `news` is exactly what it says.
     */
    expect(entryHasExactFamily({ kind: 'news' } as any)).toBe(true)
    for (const e of [breachEntry(), scenarioEntry(), insightEntry(), staleEntry()]) {
      expect(entryHasExactFamily(e as any)).toBe(true)
    }
  })

  it('keeps the five research framings apart, because five pills say five things', () => {
    expect(familyOf(insightEntry())).toBe('research:no_case')
    expect(deriveFeedView(base, familyOf, 'research:no_case')).toHaveLength(1)
  })

  it('is a filter and never a re-sort', () => {
    const view = deriveFeedView(base, familyOf, 'scenario_gap')
    expect(view).toEqual(base.filter(e => familyOf(e) === 'scenario_gap'))
  })

  it('clearing returns the exact prior order', () => {
    expect(deriveFeedView(base, familyOf, null)).toEqual(base)
  })

  /**
   * The one place the band does NOT say what the chip said — pinned, not fixed.
   *
   * `familyOf` refines a capital-stamped tile to `portfolio:framework_break`,
   * and that key has a Curate label, so `isExactFamily` passes and the pill is
   * offered as a control. But no capital card sets a `kindLabel`, so the chip
   * on that tile prints `KIND_LABEL['scenario_gap']` — "Case vs price" — while
   * the band it opens reads "Framework break", and tapping it hides the unheld
   * tile whose chip said the identical words.
   *
   * Two of the product's families are affected: `framework_break` and
   * `material_no_thesis`. The fix is a product decision — either the capital
   * cards carry their own `kindLabel`, or the pill gesture stops refining by a
   * stamp it cannot show — and it is reported rather than chosen here.
   *
   * This test asserts the CURRENT behaviour so the divergence is visible and
   * cannot widen unnoticed. It will fail when somebody resolves it, which is
   * the point.
   */
  it('pins the known chip/band divergence on capital-stamped tiles', () => {
    const held = heldScenarioEntry()
    const unheld = scenarioEntry()

    expect(held.card.kindLabel).toBeUndefined()
    expect(unheld.card.kindLabel).toBeUndefined()
    // Same words on both chips...
    expect(held.card.type).toBe(unheld.card.type)
    // ...and different families under the thumb.
    expect(familyOf(held)).toBe('portfolio:framework_break')
    expect(familyOf(unheld)).toBe('scenario_gap')
    expect(familyLabel(familyOf(held))).toBe('Framework break')
    expect(familyLabel(familyOf(unheld))).toBe('Case vs price')

    // So tapping one does not return the other.
    expect(deriveFeedView([held, unheld], familyOf, familyOf(unheld))).toEqual([unheld])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2-4. Filter state stays out of ranking and composition
// ─────────────────────────────────────────────────────────────────────────────

describe('a filter change cannot reach ranking or composition', () => {
  /**
   * Stated structurally rather than by counting renders.
   *
   * `absorbedTargetLenses` takes the lens rows and a coverage lookup. There is
   * no parameter a filter could travel through, so no filter state can change
   * what is absorbed — which is the property the dependency list in
   * `MobileDashboard` encodes and this test makes true by construction.
   */
  it('composition takes no filter argument', () => {
    expect(absorbedTargetLenses.length).toBe(2)
    expect(composedTargetKeys.length).toBe(2)
    expect(composeTargetPair.length).toBe(2)
  })

  it('the same candidates absorb the same way whatever is filtered', () => {
    const entries = [breachEntry(), staleEntry(), scenarioEntry()]
    const composed = absorb(entries, [pair()])
    for (const family of [null, 'scenario_gap', 'target_hit', 'research:no_case']) {
      const view = deriveFeedView(composed, familyOf, family)
      // Filtering removes rows from the composed set; it never adds one back.
      expect(view.every(e => composed.includes(e))).toBe(true)
      expect(composed).toHaveLength(2)
    }
  })

  it('ranking runs on the composed set and a view never re-ranks', () => {
    const entries = absorb([breachEntry(), staleEntry(), scenarioEntry()], [pair()])
    const toInput = (e: any): PriorityInput => ({
      id: feedEntryKeys([e])[0],
      type: e.kind === 'scenario' ? 'scenario_gap' : e.signalType,
      severity: 'attention',
      occurredAt: '2026-08-31T00:00:00.000Z',
    })
    const ranked = rankFeed(entries, toInput, Date.parse('2026-09-07T12:00:00Z'))
    const base = ranked.map(r => r.item)

    // Every filtered view is a subsequence of the ranked base.
    for (const family of [null, 'scenario_gap', 'target_hit']) {
      const view = deriveFeedView(base, familyOf, family)
      const positions = view.map(v => base.indexOf(v))
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5-6. Composed tile identity
// ─────────────────────────────────────────────────────────────────────────────

describe('a composed tile is one tile with one name', () => {
  it('Target Hit + Target Expired occupy one slot, filtered or not', () => {
    const entries = absorb([breachEntry(), staleEntry(), scenarioEntry()], [pair()])
    expect(entries).toHaveLength(2)

    // And the absorbed finding does not reappear as a second filtered slot.
    const view = deriveFeedView(entries, familyOf, 'target_hit')
    expect(view).toHaveLength(1)
    expect(deriveFeedView(entries, familyOf, 'target_expired')).toHaveLength(0)
  })

  /**
   * The lead flip, and the identity that survives it.
   *
   * At six months overdue the expired finding becomes critical and takes the
   * lead from an 11% overshoot that is not. The tile is the same tile: same
   * subject, same question, same reader task.
   */
  it('a lead flip does not change the tile’s continuity key', () => {
    const hitLeads = pair({ overshootPct: 0.18 }, { overdueMonths: 3 })
    const staleLeads = pair({ overshootPct: 0.11 }, { overdueMonths: 6 })

    expect(composeTargetPair(hitLeads, 'direct')!.lead).toBe('breach')
    expect(composeTargetPair(staleLeads, 'direct')!.lead).toBe('stale')

    const a = absorb([breachEntry({ overshootPct: 0.18 }), staleEntry({ overdueMonths: 3 })], [hitLeads])
    const b = absorb([breachEntry({ overshootPct: 0.11 }), staleEntry({ overdueMonths: 6 })], [staleLeads])

    // Different lens rows survive...
    expect((a[0] as any).lens.type).toBe('breach')
    expect((b[0] as any).lens.type).toBe('stale')
    // ...and the feed sees one identity either way.
    expect(feedEntryKeys(a)).toEqual(feedEntryKeys(b))
    expect(feedEntryKeys(a)[0]).toBe('situation:asset:a-msft:target')
  })

  it('the key is derived, not random', () => {
    const p = [pair()]
    expect(composedTargetKeys(p, COVERAGE)).toEqual(composedTargetKeys(p, COVERAGE))
  })

  it('a lead flip does not move the tile in a remembered order', () => {
    const hitLeads = absorb(
      [breachEntry({ overshootPct: 0.18 }), staleEntry({ overdueMonths: 3 }), scenarioEntry()],
      [pair({ overshootPct: 0.18 }, { overdueMonths: 3 })],
    )
    const remembered = rememberBaseOrder(null, feedEntryKeys(hitLeads))

    const staleLeads = absorb(
      [breachEntry({ overshootPct: 0.11 }), staleEntry({ overdueMonths: 6 }), scenarioEntry()],
      [pair({ overshootPct: 0.11 }, { overdueMonths: 6 })],
    )
    const keyed = staleLeads.map(e => ({ key: feedEntryKeys([e])[0], item: e }))
    const reconciled = reconcileToRemembered(keyed, remembered)

    // Same position, though the finding speaking has changed.
    expect(reconciled.map(r => r.key)).toEqual(remembered)
    expect(reconciled[0].key).toBe('situation:asset:a-msft:target')
  })

  it('the severities that decide the lead come from one derivation', () => {
    expect(targetHitSeverity(0.11)).toBe('attention')
    expect(targetHitSeverity(0.18)).toBe('critical')
    expect(staleTargetSeverity(6)).toBe('critical')
    expect(staleTargetSeverity(3)).toBe('attention')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7-10. Continuity over the composed base
// ─────────────────────────────────────────────────────────────────────────────

describe('continuity holds over composed entries', () => {
  const entries = () => absorb(
    [breachEntry(), staleEntry(), scenarioEntry(), insightEntry()], [pair()])

  it('Clear restores the exact base order', () => {
    const base = entries()
    const filtered = deriveFeedView(base, familyOf, 'scenario_gap')
    expect(filtered).toHaveLength(1)
    expect(deriveFeedView(base, familyOf, null)).toEqual(base)
  })

  it('an anchor key survives a filter round trip', () => {
    const base = entries()
    const keys = feedEntryKeys(base)
    const anchor = keys[0]
    const filtered = deriveFeedView(base, familyOf, familyOf(base[0] as any))
    expect(feedEntryKeys(filtered)).toContain(anchor)
    expect(feedEntryKeys(deriveFeedView(base, familyOf, null))).toEqual(keys)
  })

  it('a remount recomputing in a different order is put back', () => {
    const base = entries()
    const remembered = rememberBaseOrder(null, feedEntryKeys(base))
    const shuffled = [...base].reverse()
    const keyed = shuffled.map(e => ({ key: feedEntryKeys([e])[0], item: e }))
    expect(reconcileToRemembered(keyed, remembered).map(r => r.key)).toEqual(remembered)
  })

  it('a background refresh appends new entries and reshuffles nothing', () => {
    const base = entries()
    const remembered = rememberBaseOrder(null, feedEntryKeys(base))
    const arrival = { kind: 'scenario' as const, score: 0, card: dislocationCard({ assetId: 'a-new', symbol: 'NEW' }) }
    const next = [arrival, ...base]
    const keyed = next.map(e => ({ key: feedEntryKeys([e])[0], item: e }))
    const reconciled = reconcileToRemembered(keyed, remembered)
    expect(reconciled.slice(0, remembered.length).map(r => r.key)).toEqual(remembered)
    expect(reconciled[reconciled.length - 1].key).toContain('a-new')
  })

  it('remembering the reconciled order is a fixed point', () => {
    const base = entries()
    const first = rememberBaseOrder(null, feedEntryKeys(base))
    const second = rememberBaseOrder(first, feedEntryKeys(base))
    expect(second).toEqual(first)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Clearing, and what a remount finds afterwards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The record outlives the component, which is why a state-only clear is a bug.
 *
 * `tileFamily` is React state and the dashboard unmounts whenever an asset
 * opens — the navigation the continuity record exists to survive. A path that
 * clears the state and not the record looks correct on screen and hands the old
 * family back on the way in. These exercise the real store, so "after a
 * remount" means what the next mount would actually read.
 */
describe('every clear path survives a remount', () => {
  const SCOPE = feedScopeKey({ userId: 'u-1', orgId: 'o-1' })

  /** What `MobileDashboard` does on entering a filter. */
  const enterFilter = (family: string, anchor: string) =>
    writeFeedContinuity(SCOPE, { family, position: { baseKey: anchor, viewKey: anchor } })

  /** The canonical clear, byte for byte as the dashboard writes it. */
  const CLEAR_TILE_FAMILY = { family: null, position: { viewKey: null } } as const
  const clearTileFamily = () => writeFeedContinuity(SCOPE, CLEAR_TILE_FAMILY)

  /** What the next mount reads. */
  const afterRemount = () => readFeedContinuity(SCOPE)

  beforeEach(() => clearFeedContinuity(SCOPE))

  it('the banner Clear cannot resurrect the filter', () => {
    enterFilter('scenario_gap', 'scenario:sc-1')
    expect(afterRemount().family).toBe('scenario_gap')
    clearTileFamily()
    expect(afterRemount().family).toBeNull()
  })

  it('the empty-state Clear filters cannot resurrect it', () => {
    enterFilter('research:no_case', 'insight:i-1:0')
    // `setFeedFilter(EMPTY_FILTER); setKindFilter(null); clearTileFamily()`
    clearTileFamily()
    expect(afterRemount().family).toBeNull()
  })

  it('Reset cannot resurrect it', () => {
    enterFilter('target_expired', 'lens:stale:MSFT')
    // `setFeedFilter(EMPTY_FILTER); clearTileFamily()`
    clearTileFamily()
    expect(afterRemount().family).toBeNull()
  })

  it('a second tap on the active pill cannot resurrect it', () => {
    enterFilter('target_hit', 'lens:breach:MSFT')
    // `toggleTileFamily` writes the same record when the family matches.
    clearTileFamily()
    expect(afterRemount().family).toBeNull()
  })

  /**
   * And the base anchor survives every one of them.
   *
   * Clearing returns the reader to the tile they filtered FROM, in the original
   * order — so the base key is kept and only the view key is dropped.
   */
  it('keeps the base anchor and drops only the view anchor', () => {
    enterFilter('scenario_gap', 'scenario:sc-1')
    clearTileFamily()
    const after = afterRemount()
    expect(after.position.baseKey).toBe('scenario:sc-1')
    expect(after.position.viewKey).toBeNull()
  })

  /**
   * A deliberate refresh is allowed to be stronger, and only it is.
   *
   * Pull-to-refresh is the reader asking for a different feed, so it drops the
   * whole record. That is a superset of the canonical clear rather than a
   * bypass: the family is gone either way.
   */
  it('a refresh drops the whole record, anchors included', () => {
    enterFilter('scenario_gap', 'scenario:sc-1')
    clearFeedContinuity(SCOPE)
    const after = afterRemount()
    expect(after.family).toBeNull()
    expect(after.position.baseKey).toBeNull()
    expect(after.baseOrder).toBeNull()
  })

  it('clearing the family leaves the base ORDER untouched', () => {
    const order = ['a', 'b', 'c']
    writeFeedContinuity(SCOPE, { baseOrder: order })
    enterFilter('scenario_gap', 'b')
    clearTileFamily()
    expect(afterRemount().baseOrder).toEqual(order)
  })
})
