/**
 * Tapping a tile's pill filters to exactly that tile's family.
 *
 * ── The defects this pins ─────────────────────────────────────────────────
 *
 * `b498a2c` moved real filtering from `kindFilter` to `tileFamily` and left the
 * rest of the filter UI pointing at the state the pill no longer writes. Three
 * things followed, and QA hit all three on one gesture:
 *
 *   1. The Case vs Price pill did nothing at all. `renderScenarioCard` received
 *      only the card, so it had nothing to resolve a family from and shipped no
 *      `onFilterKind`. Five of the six render sites had the same hole.
 *   2. Filtering by pill showed no banner and offered no Clear, because the
 *      band was still gated on `kindFilter` — which is now only ever written
 *      as null.
 *   3. The empty state ignored `tileFamily`, so a filtered view with no matches
 *      said "match for these filters" instead of naming the family.
 *
 * ── Why this file renders and computes rather than reading source ─────────
 *
 * `feed-filter-continuity.test` asserts the component's wiring by reading it,
 * for the reason its header gives. That is the wrong instrument for these
 * claims: the bug was that the pill did nothing when pressed, and only a press
 * proves otherwise. So the entries here are the shapes `MobileDashboard`
 * actually constructs, the card is built by the real builder, and the pill is
 * clicked.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SignalCardView } from '../../signals/SignalCardView'
import { buildNewsCard } from '../../../lib/signals/builders/news'
import { buildActiveRiskCard } from '../../../lib/signals/builders/activeRisk'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'
import { KIND_LABEL } from '../../signals/card-identity'
import {
  displayFamilyOf,
  entryHasExactFamily,
  familyLabel,
  familyOf,
  isExactFamily,
} from '../../../lib/mobile/feed-categories'
import { deriveFeedView } from '../../../lib/mobile/feed-continuity'

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/*
  The entry shapes MobileDashboard builds, copied from the construction site
  rather than idealised. Which fields are present is the whole subject: a lens
  entry carries `signalType` and no card, a scenario entry carries a card and
  no signalType, and four kinds carry neither.
*/
const CASE_VS_PRICE = {
  kind: 'scenario' as const, score: 0,
  card: { id: 'sc-amzn', type: 'scenario_gap', capital: null },
}
const FRAMEWORK_BREAK = {
  kind: 'scenario' as const, score: 0,
  card: { id: 'sc-msft', type: 'scenario_gap', capital: { issueType: 'framework_break' } },
}
const TARGET_EXPIRED = {
  kind: 'lens' as const, score: 58, lens: { type: 'stale' }, signalType: 'target_expired',
}
const TARGET_HIT = {
  kind: 'lens' as const, score: 60, lens: { type: 'breach' }, signalType: 'target_hit',
}
const NO_CORE_THESIS = {
  kind: 'insight' as const, score: 6, round: 0, capital: null,
  insight: { assetId: 'a1', issue: { framing: 'no_case' } },
}
const ACTIVE_RISK = {
  kind: 'template' as const, score: 4, card: { id: 't1', type: 'active_risk' },
}
/** The four with no family metadata at all. */
const CLUSTER_SIGNAL = { kind: 'signal' as const, score: 7, signal: { id: 's1' } }
const COLLEAGUE_POST = { kind: 'idea' as const, score: 8, idea: { id: 'i1' } }
const AWAITING_YOU = {
  kind: 'attention' as const, score: 9, attention: { source_type: 'project' },
}

const FEED = [
  CASE_VS_PRICE, FRAMEWORK_BREAK, TARGET_EXPIRED, TARGET_HIT,
  NO_CORE_THESIS, ACTIVE_RISK, CLUSTER_SIGNAL, COLLEAGUE_POST, AWAITING_YOU,
]

/**
 * What the banner and the empty state both say for an active pill.
 *
 * Resolves through `displayFamilyOf`, the same identity the filter uses, so the
 * band cannot name something the chip did not print.
 */
const bannerWordsFor = (entry: unknown) => familyLabel(displayFamilyOf(entry as any))

describe('the pill filters to exactly the family printed on it', () => {
  it('Case vs Price selects every tile printed Case vs Price', () => {
    const family = displayFamilyOf(CASE_VS_PRICE)!
    const view = deriveFeedView(FEED, displayFamilyOf, family)

    expect(view).toEqual([CASE_VS_PRICE, FRAMEWORK_BREAK])
  })

  /**
   * ── The decision this replaces ──────────────────────────────────────────
   *
   * This asserted the opposite: that the held variant was a different card and
   * had to stay out. It is a different card INTERNALLY — `familyOf` refines it,
   * Curate offers it by name, and `composeFeed` keys diversity on it. None of
   * that is on the tile. Only `buildInsightCard` sets a `kindLabel`, so both of
   * these chips print `KIND_LABEL['scenario_gap']`, and the reader was tapping
   * one of two identical words and watching the other vanish.
   *
   * Visible pill identity wins for user-facing filtering. The refinement is
   * still there and still used; it just no longer reaches the thumb or the band.
   */
  it('brings the held variant with it, because both chips say the same words', () => {
    expect(displayFamilyOf(FRAMEWORK_BREAK)).toBe(displayFamilyOf(CASE_VS_PRICE))
    const view = deriveFeedView(FEED, displayFamilyOf, displayFamilyOf(FRAMEWORK_BREAK)!)

    expect(view).toContain(CASE_VS_PRICE)
    expect(view).toContain(FRAMEWORK_BREAK)
    // Tapping either gives the same view: one family, two tiles.
    expect(view).toEqual(deriveFeedView(FEED, displayFamilyOf, displayFamilyOf(CASE_VS_PRICE)!))
  })

  it('keeps the internal refinement available for everything else', () => {
    // Composition, diversity, Curate and Explore still separate them.
    expect(familyOf(FRAMEWORK_BREAK)).toBe('portfolio:framework_break')
    expect(familyOf(CASE_VS_PRICE)).toBe('scenario_gap')
    expect(familyOf(FRAMEWORK_BREAK)).not.toBe(familyOf(CASE_VS_PRICE))
  })

  it('Target Expired selects only Target Expired', () => {
    const view = deriveFeedView(FEED, displayFamilyOf, displayFamilyOf(TARGET_EXPIRED)!)

    expect(view).toEqual([TARGET_EXPIRED])
    // The sibling lens family shares an entry kind and must not come with it.
    expect(view).not.toContain(TARGET_HIT)
  })

  it('never widens to the category the family belongs to', () => {
    // Target expired, Target hit and Active risk are Decisions, Portfolio or
    // Risk. Asking for one must not return the bucket.
    for (const entry of [TARGET_EXPIRED, TARGET_HIT, ACTIVE_RISK]) {
      expect(deriveFeedView(FEED, displayFamilyOf, displayFamilyOf(entry)!)).toEqual([entry])
    }
  })
})

describe('the banner names the family in the pill own words', () => {
  it('says Case vs price, the label the chip is printed with', () => {
    expect(bannerWordsFor(CASE_VS_PRICE)).toBe(KIND_LABEL.scenario_gap)
    expect(bannerWordsFor(CASE_VS_PRICE)).toBe('Case vs price')
  })

  it('says Target expired', () => {
    expect(bannerWordsFor(TARGET_EXPIRED)).toBe(KIND_LABEL.target_expired)
    expect(bannerWordsFor(TARGET_EXPIRED)).toBe('Target expired')
  })

  /**
   * The held variant wears the SAME chip, so the band says the same words.
   *
   * It used to assert "Framework break" here — a Curate row the tile never
   * displays. A band naming a refinement the chip did not print is the defect
   * this replaces.
   */
  it('says Case vs price for the held variant too, because that is its chip', () => {
    expect(bannerWordsFor(FRAMEWORK_BREAK)).toBe('Case vs price')
    expect(bannerWordsFor(FRAMEWORK_BREAK)).toBe(bannerWordsFor(CASE_VS_PRICE))
  })

  it('uses the research framing, not the broad research type', () => {
    // `no_research` covers two framings and `research_stale` three. The band
    // has to say which one the reader asked for.
    expect(bannerWordsFor(NO_CORE_THESIS)).toBeTruthy()
    expect(bannerWordsFor(NO_CORE_THESIS)).not.toBe(KIND_LABEL.no_research)
  })

  it('never falls back to a category word', () => {
    for (const entry of [CASE_VS_PRICE, TARGET_EXPIRED, ACTIVE_RISK, NO_CORE_THESIS]) {
      expect(bannerWordsFor(entry)).not.toBe('Decisions')
      expect(bannerWordsFor(entry)).not.toBe('Portfolio')
      expect(bannerWordsFor(entry)).not.toBe('Research')
    }
  })
})

describe('a pill is a control only where it can act', () => {
  it('offers the filter for every entry that has an exact family', () => {
    for (const entry of [CASE_VS_PRICE, FRAMEWORK_BREAK, TARGET_EXPIRED, TARGET_HIT, NO_CORE_THESIS, ACTIVE_RISK]) {
      expect(entryHasExactFamily(entry)).toBe(true)
    }
  })

  it('refuses it where the family is only the hook that produced the row', () => {
    // These would have asked for every finding that hook emits, under a chip
    // that named one of them.
    for (const entry of [CLUSTER_SIGNAL, COLLEAGUE_POST, AWAITING_YOU]) {
      expect(familyOf(entry)).toBe(entry.kind)
      expect(entryHasExactFamily(entry)).toBe(false)
    }
  })

  it('treats a producer name as unnameable, which is why it is refused', () => {
    for (const producer of ['signal', 'idea', 'attention', 'insight', 'lens', 'scenario', 'template']) {
      expect(isExactFamily(producer)).toBe(false)
    }
  })
})

describe('the chip renders as a button only when it filters', () => {
  const NEWS = unwrap(buildNewsCard({
    id: 'n1',
    headline: 'Microsoft raises quarterly dividend',
    summary: 'The company lifted its payout by 10%.',
    url: 'https://example.com/a',
    source: 'Reuters',
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    assetId: 'a1', symbol: 'MSFT', companyName: 'Microsoft',
  } as any))

  const RISK = unwrap(buildActiveRiskCard({
    assetId: 'a1', symbol: 'MSFT', companyName: 'Microsoft',
    weightPct: 6.2, benchmarkWeightPct: 3.1,
    portfolioId: 'p1', portfolioName: 'Core Equity',
    asOf: new Date(Date.now() - 16 * 86_400_000).toISOString(),
  }))

  it('calls back with the card type when a handler is given', () => {
    const onFilterKind = vi.fn()
    const { container } = render(<SignalCardView card={RISK} onAction={() => {}} onFilterKind={onFilterKind} />)
    const chip = container.querySelector('[data-slot="kind"]') as HTMLElement

    expect(chip.tagName).toBe('BUTTON')
    fireEvent.click(chip)

    expect(onFilterKind).toHaveBeenCalledWith(RISK.type)
  })

  it('renders a label, not a button, when there is no handler', () => {
    // The chip was always a button. Five of six render sites passed no
    // handler, so most tiles offered a control that swallowed the tap.
    const { container } = render(<SignalCardView card={NEWS} onAction={() => {}} />)
    const chip = container.querySelector('[data-slot="kind"]') as HTMLElement

    expect(chip.tagName).not.toBe('BUTTON')
    expect(chip.closest('button')).toBeNull()
  })

  it('says the same words either way', () => {
    const withHandler = render(<SignalCardView card={RISK} onAction={() => {}} onFilterKind={() => {}} />)
    const chipA = withHandler.container.querySelector('[data-slot="kind"]')!.textContent
    withHandler.unmount()

    const without = render(<SignalCardView card={RISK} onAction={() => {}} />)
    const chipB = without.container.querySelector('[data-slot="kind"]')!.textContent

    expect(chipA).toBe(chipB)
  })

  it('prints the family the banner would name', () => {
    render(<SignalCardView card={RISK} onAction={() => {}} onFilterKind={() => {}} />)

    expect(screen.getByText(KIND_LABEL.active_risk)).toBeTruthy()
    expect(familyLabel(familyOf(ACTIVE_RISK))).toBe(KIND_LABEL.active_risk)
  })
})

describe('an empty filtered view names the family that emptied it', () => {
  it('resolves a label for a family with no matches', () => {
    const lonely = [CLUSTER_SIGNAL, COLLEAGUE_POST]
    const family = familyOf(TARGET_EXPIRED)!

    expect(deriveFeedView(lonely, familyOf, family)).toEqual([])
    // The sentence the empty state builds from.
    expect(familyLabel(family)).toBe('Target expired')
  })
})
