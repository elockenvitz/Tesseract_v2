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

import { describe, expect, it } from 'vitest'

import {
  absorbedTargetLenses, composedTargetKeys, composeTargetPair, type TargetPair,
} from '../target-composition'
import { deriveFeedView, reconcileToRemembered, rememberBaseOrder } from '../../../mobile/feed-continuity'
import { feedEntryKeys } from '../../../mobile/feed-entry-key'
import { familyOf, pillFamilyOf } from '../../../mobile/feed-categories'
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
    const tapped = pillFamilyOf(scenarioEntry())
    expect(tapped).toBe('scenario_gap')
    const view = deriveFeedView(base, pillFamilyOf, tapped)
    expect(view.map(e => e.kind)).toEqual(['scenario', 'scenario'])
  })

  /**
   * The QA defect, pinned.
   *
   * A held framework break and an unheld case-vs-price print the same pill,
   * because no capital card sets a `kindLabel`. `familyOf` separates them and
   * the pill does not, so keying the pill filter on `familyOf` hid a tile whose
   * pill said exactly what the tapped one said.
   */
  it('does not hide a tile whose pill says the same thing', () => {
    expect(familyOf(heldScenarioEntry())).not.toBe(familyOf(scenarioEntry()))
    expect(pillFamilyOf(heldScenarioEntry())).toBe(pillFamilyOf(scenarioEntry()))

    const wrong = deriveFeedView(base, familyOf, familyOf(scenarioEntry()))
    const right = deriveFeedView(base, pillFamilyOf, pillFamilyOf(scenarioEntry()))
    expect(wrong).toHaveLength(1)
    expect(right).toHaveLength(2)
  })

  it('keeps the five research framings apart, because five pills say five things', () => {
    expect(pillFamilyOf(insightEntry())).toBe('research:no_case')
    const view = deriveFeedView(base, pillFamilyOf, 'research:no_case')
    expect(view).toHaveLength(1)
  })

  it('tapping another family returns only that family', () => {
    const view = deriveFeedView(base, pillFamilyOf, pillFamilyOf(breachEntry()))
    expect(view).toHaveLength(1)
    expect((view[0] as any).lens.type).toBe('breach')
  })

  it('is a filter and never a re-sort', () => {
    const view = deriveFeedView(base, pillFamilyOf, 'scenario_gap')
    const order = base.filter(e => pillFamilyOf(e) === 'scenario_gap')
    expect(view).toEqual(order)
  })

  it('clearing returns the exact prior order', () => {
    const cleared = deriveFeedView(base, pillFamilyOf, null)
    expect(cleared).toEqual(base)
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
      const view = deriveFeedView(composed, pillFamilyOf, family)
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
      const view = deriveFeedView(base, pillFamilyOf, family)
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
    const view = deriveFeedView(entries, pillFamilyOf, 'target_hit')
    expect(view).toHaveLength(1)
    expect(deriveFeedView(entries, pillFamilyOf, 'target_expired')).toHaveLength(0)
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
    const filtered = deriveFeedView(base, pillFamilyOf, 'scenario_gap')
    expect(filtered).toHaveLength(1)
    expect(deriveFeedView(base, pillFamilyOf, null)).toEqual(base)
  })

  it('an anchor key survives a filter round trip', () => {
    const base = entries()
    const keys = feedEntryKeys(base)
    const anchor = keys[0]
    const filtered = deriveFeedView(base, pillFamilyOf, pillFamilyOf(base[0] as any))
    expect(feedEntryKeys(filtered)).toContain(anchor)
    expect(feedEntryKeys(deriveFeedView(base, pillFamilyOf, null))).toEqual(keys)
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
