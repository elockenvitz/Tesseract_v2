import { describe, expect, it } from 'vitest'

import {
  feedActionIsRoutable,
  resolveFeedAction,
  type FeedActionKey,
} from '../feed-actions'
import { buildStaleTargetCard, buildTargetHitCard, buildNoTargetCard, buildInsightCard } from '../builders/legacy-kinds'
import { buildScenarioGapCard } from '../builders/scenarioGap'
import type { SignalCard } from '../contract'

/**
 * The contract that stops a label promising a surface that does not exist.
 *
 * The failure this guards against is specific and has a name: "Review cases" →
 * generic Capture. A contextual label is only allowed where a destination
 * resolves, so the test that matters is not "does the button say the right
 * thing" but "is every declared primary either handled in place or a real
 * destination".
 */

const ASSET = { assetId: 'a-1', symbol: 'AAPL' }
const unwrap = (r: ReturnType<typeof buildTargetHitCard>): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

describe('resolveFeedAction', () => {
  it('sends the case and target actions to the right part of the asset page', () => {
    // One editor, two entry points. `MobileCaseTargets` is both the scenario
    // ladder and the price targets, so these differ by focus rather than by
    // destination — which is the honest description of the product.
    expect(resolveFeedAction('open_cases', ASSET)).toMatchObject({
      type: 'asset', id: 'a-1', data: { focus: 'cases' },
    })
    expect(resolveFeedAction('review_target', ASSET)).toMatchObject({
      type: 'asset', data: { focus: 'target' },
    })
    expect(resolveFeedAction('set_target', ASSET)).toMatchObject({
      type: 'asset', data: { focus: 'target' },
    })
  })

  it('sends both research actions to the thesis field', () => {
    for (const k of ['update_thesis', 'add_rationale'] as FeedActionKey[]) {
      expect(resolveFeedAction(k, ASSET)).toMatchObject({ type: 'asset', data: { focus: 'thesis' } })
    }
  })

  it('always carries a focus, so a stale one cannot survive a second navigation', () => {
    // Tab data is MERGED, not replaced. A navigation that omitted `focus` would
    // inherit whichever focus the tab was last opened with.
    const t = resolveFeedAction('open_cases', ASSET)
    expect(t!.data).toHaveProperty('focus')
  })

  it('resolves nothing for an action with no asset', () => {
    // A contextual key without an asset id is a dead end, and saying so is what
    // makes the fallback in `contextualActions` fire.
    expect(resolveFeedAction('open_cases', { assetId: null })).toBeNull()
    expect(feedActionIsRoutable('open_cases', { assetId: null })).toBe(false)
  })

  it('does not pretend to route the actions the card surface handles', () => {
    for (const k of ['capture', 'open_asset', 'open_item', 'resolve'] as FeedActionKey[]) {
      expect(resolveFeedAction(k, ASSET)).toBeNull()
      // Still offerable — the surface handles them itself.
      expect(feedActionIsRoutable(k, ASSET)).toBe(true)
    }
  })

  it('has no route for the actions the product cannot honestly perform', () => {
    // `review_position` — there is no position view on the mobile asset page.
    // `update_status`   — `project` is registered read-only in mobile-surfaces.
    // Neither is in the vocabulary, so neither can be declared by accident.
    expect(feedActionIsRoutable('review_position', ASSET)).toBe(false)
    expect(feedActionIsRoutable('update_status', ASSET)).toBe(false)
  })
})

const cards: SignalCard[] = [
  unwrap(buildTargetHitCard({
    assetId: 'a-1', symbol: 'AAPL', companyName: 'Apple', price: 200, target: 180,
    caseName: 'Base', cases: [], overshootPct: 0.11, conviction: null, heldIn: ['Core'], heldInIds: ['p1'],
    statedAt: '2025-06-01T00:00:00Z', asOf: new Date().toISOString(),
  })),
  unwrap(buildStaleTargetCard({
    assetId: 'a-1', symbol: 'AAPL', companyName: 'Apple', target: 245, price: 212,
    timeframe: '12 months', ageMonths: 18, overdueMonths: 6,
    heldIn: ['Core'], heldInIds: ['p1'],
    statedAt: '2025-02-14T00:00:00Z', expiredAt: '2026-02-13T00:00:00Z',
    asOf: new Date().toISOString(),
  })),
  unwrap(buildNoTargetCard({
    assetId: 'a-1', symbol: 'AAPL', companyName: 'Apple', weightPct: 4.8,
    portfolioName: 'Core', price: 212, heldIn: ['Core'], heldInIds: ['p1'],
    conviction: 'high', asOf: new Date().toISOString(),
  })),
  unwrap(buildInsightCard({
    id: 'i1', kind: 'no_thesis', headline: 'AAPL has no research', body: 'b',
    assetId: 'a-1', symbol: 'AAPL', score: 1,
  })),
  unwrap(buildInsightCard({
    id: 'i2', kind: 'stale_research', headline: 'Nobody has written on AAPL', body: 'b',
    assetId: 'a-1', symbol: 'AAPL', daysSinceActivity: 120, score: 1,
  })),
  unwrap(buildScenarioGapCard({
    assetId: 'a-1', symbol: 'AAPL', price: 100, priceAsOf: new Date().toISOString(),
    cases: [
      { name: 'Bear', price: 300, probability: null, timeframe: '12 months' },
      { name: 'Base', price: 320, probability: null, timeframe: '12 months' },
    ],
    heldIn: ['Core'], statedAt: '2026-03-21T00:00:00Z',
  })),
]

describe('no builder declares a label it cannot honour', () => {
  /**
   * The regression guard. Every primary action a builder emits must be either
   * handled by the card surface or resolvable to a destination — there is no
   * third category, and a contextual label without a destination is the exact
   * defect this phase exists to prevent.
   */

  it('every primary resolves or is handled in place', () => {
    for (const c of cards) {
      const ctx = {
        assetId: c.entity.kind === 'asset' ? c.entity.id : null,
        symbol: c.entity.ticker ?? null,
      }
      expect(
        feedActionIsRoutable(c.actions.primary.id, ctx),
        `${c.type} primary "${c.actions.primary.label}" (${c.actions.primary.id}) goes nowhere`,
      ).toBe(true)
    }
  })

  it('keeps Capture available on every card', () => {
    // Demoted to a quick action where a contextual primary took its place, and
    // never deleted: it is still the only way to write a free-form thought from
    // the feed.
    for (const c of cards) {
      const hasCapture = c.actions.primary.id === 'capture'
        || c.actions.quick.some(a => a.id === 'capture')
      expect(hasCapture, `${c.type} has lost Capture entirely`).toBe(true)
    }
  })

  it('gives target-expired the target action, not the case action', () => {
    // The first behavioural separation of the two. target_expired fires purely
    // on an elapsed horizon and is not a case-vs-price breach, so it must not
    // inherit the case editor simply because the two share card plumbing.
    const stale = cards.find(c => c.type === 'target_expired')!
    const gap = cards.find(c => c.type === 'scenario_gap')!
    expect(stale.actions.primary.id).toBe('review_target')
    expect(gap.actions.primary.id).toBe('open_cases')
    expect(stale.actions.primary.id).not.toBe(gap.actions.primary.id)
  })

  it('labels the no-target action for what the destination can actually do', () => {
    // "Set framework" is the product intent and the surface cannot honour it:
    // `MobileCaseTargets` sets a price and a horizon, and there is nowhere to
    // record that a position is deliberately not price-driven — which the
    // judgment set on this very card allows.
    const noTarget = cards.find(c => c.type === 'no_target')!
    expect(noTarget.actions.primary.label).toBe('Set a target')
    expect(noTarget.actions.primary.label).not.toContain('framework')
  })
})

describe('progressive-disclosure follow-ons', () => {
  /**
   * The dedup rule lives in `MobileDashboard.resolveNextFor`, which is a
   * closure over navigation and cannot be imported. What CAN be asserted here
   * is the property it depends on: whether a follow-on and a card primary are
   * the same action, which is an id comparison over data the builders emit.
   */
  const ctx = { assetId: 'a-1', symbol: 'AAPL' }

  it('the no-target card duplicates its own primary, so the inline CTA is suppressed', () => {
    const noTarget = cards.find(c => c.type === 'no_target')!
    // `price_target` declares `set_target`; the card primary IS `set_target`.
    // Two identical buttons ~150px apart, one of them permanently visible in a
    // sticky bar.
    expect(noTarget.actions.primary.id).toBe('set_target')
  })

  it('the target-expired card does NOT duplicate, so both render', () => {
    // Primary is the target editor; `cases_outdated` offers the case editor.
    // Different focus, different destination, both worth showing.
    const stale = cards.find(c => c.type === 'target_expired')!
    expect(stale.actions.primary.id).toBe('review_target')
    expect(stale.actions.primary.id).not.toBe('open_cases')
  })

  it('every follow-on any judgment declares is routable', () => {
    // The same guard Phase 4 applies to card primaries, applied to follow-ons:
    // a declared nextAction with no destination would be a dead-end button.
    for (const key of ['set_target', 'open_cases', 'open_coverage', 'update_thesis', 'add_rationale']) {
      expect(feedActionIsRoutable(key, ctx), `${key} is declared but routes nowhere`).toBe(true)
    }
  })

  it('has no follow-on vocabulary for actions the product cannot perform', () => {
    // `reduce_exit` deliberately declares none: there is no execution workflow,
    // and a "Sell" button the product cannot honour is the worst possible CTA.
    for (const key of ['sell', 'trade', 'reduce_position', 'resize', 'update_status']) {
      expect(feedActionIsRoutable(key, ctx)).toBe(false)
    }
  })
})

