/**
 * The pill is a control on every tile whose chip names a family.
 *
 * ── The browser failure this reproduces ───────────────────────────────────
 *
 * Manual QA on a phone: tapping a tile's category pill mostly did nothing and
 * the "… only / Clear" band never appeared. Traced live in the running app at a
 * 400px viewport, reading the rendered chip off the DOM:
 *
 *     tag: "SPAN"    text: "Trade idea"   onClick: undefined     ← inert
 *     tag: "BUTTON"  text: "News"         onClick: function      ← works
 *
 * Clicking the first changed nothing: no banner, no change in the feed.
 *
 * `SignalCardView` renders the chip as a button only when it is handed a
 * handler, and `pillFilterFor` withholds one unless `entryHasExactFamily` says
 * the tile has a family a reader can be offered. Three of the feed's entry
 * kinds keep their type somewhere `displayFamilyOf` was not looking, so they
 * fell through to the entry-kind fallback, which names no family — while their
 * chips printed "Trade idea", "Case gaps" and "Awaiting you".
 *
 * ── Why every existing test passed ────────────────────────────────────────
 *
 * Three suites cover this area and none of them could see it.
 *
 * `feed-filter-continuity` reads the dashboard's source and asserts that every
 * `<SignalCardSection` site is wired `onFilterKind={pillFilterFor(entry)}`. All
 * six were. The string was present and the value it produced at runtime was
 * `undefined`, which is exactly what a source scan cannot distinguish.
 *
 * `tile-family-filter` renders and clicks, but it builds its entry fixtures by
 * hand and asserted that idea, signal and attention pills SHOULD be inert —
 * encoding the deferred decision as the specification.
 *
 * `feed-integration` tests `displayFamilyOf` directly, on fixtures that all
 * carry a card or a `signalType`. The three shapes that do not were never
 * passed to it.
 *
 * So this file does the one thing none of them did: build the entry shapes the
 * dashboard ACTUALLY constructs, resolve the handler the way the dashboard
 * resolves it, render the real card view, and press the chip.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SignalCardView } from '../../signals/SignalCardView'
import { buildNewsCard } from '../../../lib/signals/builders/news'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'
import {
  displayFamilyOf, entryHasExactFamily, familyLabel,
} from '../../../lib/mobile/feed-categories'
import {
  attentionDisplayType, attentionSignalType, entrySignalType,
} from '../../../lib/mobile/entry-signal-type'
import { deriveFeedView } from '../../../lib/mobile/feed-continuity'

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/**
 * The entry shapes `MobileDashboard` builds, copied from the construction sites.
 *
 * Which property holds the type is the entire subject, so these are transcribed
 * rather than idealised: an idea entry keeps the POST under `idea`, a signal
 * entry keeps a whole `SignalCard` under `signal`, an attention entry keeps a
 * row under `attention`, and none of the three has a `card` or a `signalType`.
 */
const IDEA_TRADE = { kind: 'idea' as const, score: 3, idea: { id: 'i1', type: 'trade' } }
const IDEA_THOUGHT = { kind: 'idea' as const, score: 2, idea: { id: 'i2', type: 'note' } }
const SIGNAL = {
  kind: 'signal' as const, score: 5,
  signal: { id: 's1', type: 'crowding' } as unknown as SignalCard,
}
/**
 * `attention_type` is what decides the chip, and it is not `source_type`.
 *
 * `buildAttentionCard` maps `ATTENTION_TYPE[a.attention_type]`, so
 * `decision_required` prints "Needs review" and `action_required` prints
 * "Overdue" — whatever produced the row. These fixtures carry both fields
 * because the real ones do, and the omission is what let a resolver keyed on
 * the wrong field look correct.
 */
const ATTENTION_DECISION = {
  kind: 'attention' as const, score: 9,
  attention: { attention_id: 'a1', source_type: 'trade_queue_item', attention_type: 'decision_required' },
}
const ATTENTION_OVERDUE = {
  kind: 'attention' as const, score: 8,
  attention: { attention_id: 'a2', source_type: 'project', attention_type: 'action_required' },
}
/** The coverage-stale item: a different source, the same chip as a project. */
const ATTENTION_COVERAGE = {
  kind: 'attention' as const, score: 7,
  attention: { attention_id: 'a3', source_type: 'coverage_change', attention_type: 'action_required' },
}
/** Carries its card, and always worked. The control in the experiment. */
const SCENARIO = {
  kind: 'scenario' as const, score: 0,
  card: { id: 'sc1', type: 'scenario_gap', capital: null },
}
const LENS_EXPIRED = {
  kind: 'lens' as const, score: 58,
  lens: { type: 'stale' }, signalType: 'target_expired',
}

const FEED = [IDEA_TRADE, IDEA_THOUGHT, SIGNAL, ATTENTION_DECISION, ATTENTION_OVERDUE, ATTENTION_COVERAGE, SCENARIO, LENS_EXPIRED]

/** `pillFilterFor`, transcribed from the dashboard. */
const pillFilterFor = (entry: unknown, onToggle: (e: unknown) => void) =>
  entryHasExactFamily(entry as never) ? () => onToggle(entry) : undefined

// ─────────────────────────────────────────────────────────────────────────────
// The rendered chip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A real card, rendered, with the handler resolved the way the feed resolves it.
 *
 * The card's own type is irrelevant to the question — what decides whether the
 * chip is a button is the ENTRY the dashboard hands `pillFilterFor`.
 */
function renderChipFor(entry: unknown, onToggle = vi.fn()) {
  const card = unwrap(buildNewsCard({
    id: `n-${Math.random()}`,
    headline: 'A headline long enough to be a real one for this card',
    summary: 'A summary that is long enough to pass the quality gate on a card.',
    url: 'https://example.com/x',
    publishedAt: new Date().toISOString(),
    source: 'Reuters',
    symbols: ['AMZN'],
  } as never))
  const view = render(
    <SignalCardView card={card} onAction={() => {}} onFilterKind={pillFilterFor(entry, onToggle)} />,
  )
  return { chip: view.container.querySelector('[data-slot="kind"]')!, onToggle, view }
}

describe('every tile whose chip names a family offers a control', () => {
  it.each([
    ['an idea post', IDEA_TRADE],
    ['a thought', IDEA_THOUGHT],
    ['a signal', SIGNAL],
    ['a decision-required item', ATTENTION_DECISION],
    ['an overdue item', ATTENTION_OVERDUE],
    ['a coverage-stale item', ATTENTION_COVERAGE],
    ['a scenario card', SCENARIO],
    ['a target-expired lens', LENS_EXPIRED],
  ])('renders the pill on %s as a button that fires', (_name, entry) => {
    const { chip, onToggle } = renderChipFor(entry)
    // The exact DOM facts the browser reported: a SPAN with no handler is the
    // failure, a BUTTON that fires is the fix.
    expect(chip.tagName).toBe('BUTTON')
    fireEvent.click(chip)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  /**
   * The shape the fallback is genuinely for.
   *
   * An entry with no type anywhere resolves only to its hook name, which names
   * no family — so its pill stays inert rather than quietly widening the feed
   * to everything that hook emits.
   */
  it('leaves a pill inert when nothing names a family', () => {
    const { chip, onToggle } = renderChipFor({ kind: 'mystery', score: 1 })
    expect(chip.tagName).toBe('SPAN')
    fireEvent.click(chip)
    expect(onToggle).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The identity behind it
// ─────────────────────────────────────────────────────────────────────────────

describe('the entry resolves to the type its card will carry', () => {
  it.each([
    ['idea/trade', IDEA_TRADE, 'trade_idea'],
    ['idea/note', IDEA_THOUGHT, 'thought'],
    ['signal', SIGNAL, 'crowding'],
    ['attention/decision_required', ATTENTION_DECISION, 'awaiting_review'],
    ['attention/action_required', ATTENTION_OVERDUE, 'project_overdue'],
    ['attention/coverage, action_required', ATTENTION_COVERAGE, 'project_overdue'],
    ['scenario', SCENARIO, 'scenario_gap'],
    ['lens', LENS_EXPIRED, 'target_expired'],
  ])('%s → %s', (_n, entry, expected) => {
    expect(entrySignalType(entry as never)).toBe(expected)
    expect(displayFamilyOf(entry as never)).toBe(expected)
  })

  it('gives every one of them a reader-facing label', () => {
    for (const e of FEED) {
      const label = familyLabel(displayFamilyOf(e as never))
      expect(label, JSON.stringify(e.kind)).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// And the filter it drives
// ─────────────────────────────────────────────────────────────────────────────

describe('tapping the pill narrows the feed to that family', () => {
  it('an idea pill selects the idea family and nothing else', () => {
    const family = displayFamilyOf(IDEA_TRADE as never)
    const view = deriveFeedView(FEED, e => displayFamilyOf(e as never), family)
    expect(view).toEqual([IDEA_TRADE])
    expect(familyLabel(family)).toBe('Trade idea')
  })

  it('separates a trade idea from a thought, which wear different chips', () => {
    expect(displayFamilyOf(IDEA_TRADE as never)).not.toBe(displayFamilyOf(IDEA_THOUGHT as never))
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), displayFamilyOf(IDEA_THOUGHT as never)))
      .toEqual([IDEA_THOUGHT])
  })

  /**
   * ── The reported failure ────────────────────────────────────────────────
   *
   * "I tap Needs Review. The feed filters, but Overdue tiles are still
   * present."
   *
   * The display resolver keyed on `source_type`, which sends anything that is
   * not a trade queue item or a project to `awaiting_review`. A coverage-stale
   * item is `coverage_change` with `attention_type: 'action_required'`, so its
   * CHIP reads "Overdue" and its family said "Needs review". Tapping one
   * returned the other.
   */
  it('does not return Overdue tiles under the Needs review filter', () => {
    const needsReview = displayFamilyOf(ATTENTION_DECISION as never)
    expect(familyLabel(needsReview)).toBe('Needs review')

    const view = deriveFeedView(FEED, e => displayFamilyOf(e as never), needsReview)
    expect(view).toEqual([ATTENTION_DECISION])
    expect(view).not.toContain(ATTENTION_OVERDUE)
    expect(view).not.toContain(ATTENTION_COVERAGE)
  })

  it('returns every Overdue tile under the Overdue filter, whatever produced it', () => {
    const overdue = displayFamilyOf(ATTENTION_OVERDUE as never)
    expect(familyLabel(overdue)).toBe('Overdue')
    // Two different sources, one visible chip: they filter together.
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), overdue))
      .toEqual([ATTENTION_OVERDUE, ATTENTION_COVERAGE])
  })

  it('still filters the kinds that already worked', () => {
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), 'scenario_gap')).toEqual([SCENARIO])
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), 'target_expired')).toEqual([LENS_EXPIRED])
  })

  it('clearing restores the exact order', () => {
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), null)).toEqual(FEED)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The band says what the chip said, including for attention items
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── The report ────────────────────────────────────────────────────────────
 *
 * "when i click on 'Needs Review' it filters to 'Awaiting Decisions Only', but
 * it should be filtering to Needs Review only."
 *
 * `attentionSignalType` types every trade-queue item as a `recommendation`,
 * which is right for RANKING — a trade awaiting the desk's call belongs in that
 * tier whether or not its card has loaded. The CARD is a different question:
 * `MobileDashboard` renders a recommendation only when `recommendationBySource`
 * holds one for that `source_id`, and otherwise falls through to the generic
 * attention card, whose chip reads "Needs review".
 *
 * So the tile printed one family and the band named another. The two answers
 * are now separate functions that say which is which.
 */
describe('an attention tile filters to the family its chip prints', () => {
  const tradeQueueItem = {
    attention_id: 'a9', source_type: 'trade_queue_item', source_id: 'tq-1',
    attention_type: 'decision_required',
  }

  it('names it Needs review when no recommendation card exists for it', () => {
    const family = attentionDisplayType(tradeQueueItem, false)
    expect(family).toBe('awaiting_review')
    expect(familyLabel(family)).toBe('Needs review')
  })

  it('names it Awaiting decision only when the card actually is one', () => {
    const family = attentionDisplayType(tradeQueueItem, true)
    expect(family).toBe('recommendation')
    expect(familyLabel(family)).toBe('Awaiting decision')
  })

  /**
   * The ranking answer is unchanged, deliberately.
   *
   * A trade-queue item still ranks in the recommendation tier whichever card it
   * renders as, because that is a statement about consequence rather than about
   * what the chip says.
   */
  it('leaves the ranking type alone', () => {
    expect(attentionSignalType(tradeQueueItem)).toBe('recommendation')
  })

  it('is unchanged for every other attention source', () => {
    /**
     * The chip follows `attention_type`, whatever the source was.
     *
     * This is the correction: the same `action_required` prints "Overdue" from
     * a project and from a coverage row alike, and the ranker's source-type
     * mapping — which is about TIER — has no say in it.
     */
    for (const source of ['project', 'project_deliverable', 'coverage_change', 'task']) {
      const a = { source_type: source, attention_type: 'action_required' }
      expect(attentionDisplayType(a, false), source).toBe('project_overdue')
      expect(attentionDisplayType(a, true), source).toBe('project_overdue')
    }
    for (const source of ['project', 'coverage_change', 'notification']) {
      const a = { source_type: source, attention_type: 'decision_required' }
      expect(attentionDisplayType(a, false), source).toBe('awaiting_review')
    }
    // And the ranker is untouched, so no tier moves.
    expect(attentionSignalType({ source_type: 'project', attention_type: 'decision_required' }))
      .toBe('project_overdue')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Exact-family filtering: the invariants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The contract, stated once and checked per family.
 *
 * Tapping a pill may return only tiles whose VISIBLE family is the one printed
 * on it. The predicate is equality on the display family and nothing else — no
 * producer hook, no attention bucket, no ranking family, no source type, and no
 * fallback that widens the match.
 */
describe('a pill filter returns exactly its own visible family', () => {
  const EVERY = [
    IDEA_TRADE, IDEA_THOUGHT, SIGNAL,
    ATTENTION_DECISION, ATTENTION_OVERDUE, ATTENTION_COVERAGE,
    SCENARIO, LENS_EXPIRED,
  ]
  const view = (family: string | null) =>
    deriveFeedView(EVERY, e => displayFamilyOf(e as never), family)

  it.each([
    ['Needs review', ATTENTION_DECISION],
    ['Overdue', ATTENTION_OVERDUE],
    ['Trade idea', IDEA_TRADE],
    ['Target expired', LENS_EXPIRED],
    ['Case vs price', SCENARIO],
  ])('%s returns only tiles printing that label', (label, tile) => {
    const family = displayFamilyOf(tile as never)
    expect(familyLabel(family)).toBe(label)
    for (const kept of view(family)) {
      expect(familyLabel(displayFamilyOf(kept as never))).toBe(label)
    }
    expect(view(family)).toContain(tile)
  })

  it('never returns a differently named family under any pill', () => {
    for (const tile of EVERY) {
      const family = displayFamilyOf(tile as never)
      const labels = new Set(view(family).map(e => familyLabel(displayFamilyOf(e as never))))
      expect(labels.size, String(family)).toBe(1)
    }
  })

  /**
   * The existing contract, preserved: same visible label, one filter.
   *
   * A project deliverable and a stale coverage row are different situations
   * internally and both print "Overdue". Tapping either returns both.
   */
  it('groups two internal situations that print the same label', () => {
    expect(ATTENTION_OVERDUE.attention.source_type)
      .not.toBe(ATTENTION_COVERAGE.attention.source_type)
    const family = displayFamilyOf(ATTENTION_OVERDUE as never)
    expect(view(family)).toEqual([ATTENTION_OVERDUE, ATTENTION_COVERAGE])
  })

  it('preserves the relative order of the base feed', () => {
    for (const tile of EVERY) {
      const kept = view(displayFamilyOf(tile as never))
      const positions = kept.map(k => EVERY.indexOf(k))
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    }
  })

  it('clearing restores the exact base order', () => {
    expect(view(null)).toEqual(EVERY)
  })

  /**
   * The banner cannot name something the chip did not print.
   *
   * Both resolve through the same function, so this is a property rather than a
   * coincidence — but it is the property that failed twice, so it is asserted.
   */
  it('names the filter exactly as the chip is labelled', () => {
    for (const tile of EVERY) {
      const family = displayFamilyOf(tile as never)
      expect(familyLabel(family), String(family)).toBeTruthy()
      expect(familyLabel(family)).toBe(familyLabel(displayFamilyOf(view(family)[0] as never)))
    }
  })
})
