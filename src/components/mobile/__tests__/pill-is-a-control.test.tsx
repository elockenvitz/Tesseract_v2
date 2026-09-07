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
import { entrySignalType } from '../../../lib/mobile/entry-signal-type'
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
const ATTENTION_TRADE = {
  kind: 'attention' as const, score: 9,
  attention: { attention_id: 'a1', source_type: 'trade_queue_item' },
}
const ATTENTION_PROJECT = {
  kind: 'attention' as const, score: 8,
  attention: { attention_id: 'a2', source_type: 'project' },
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

const FEED = [IDEA_TRADE, IDEA_THOUGHT, SIGNAL, ATTENTION_TRADE, ATTENTION_PROJECT, SCENARIO, LENS_EXPIRED]

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
    ['an awaiting-you item', ATTENTION_TRADE],
    ['an overdue project', ATTENTION_PROJECT],
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
    ['attention/trade queue', ATTENTION_TRADE, 'recommendation'],
    ['attention/project', ATTENTION_PROJECT, 'project_overdue'],
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

  it('separates an awaiting-you item from an overdue project', () => {
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), 'recommendation'))
      .toEqual([ATTENTION_TRADE])
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), 'project_overdue'))
      .toEqual([ATTENTION_PROJECT])
  })

  it('still filters the kinds that already worked', () => {
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), 'scenario_gap')).toEqual([SCENARIO])
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), 'target_expired')).toEqual([LENS_EXPIRED])
  })

  it('clearing restores the exact order', () => {
    expect(deriveFeedView(FEED, e => displayFamilyOf(e as never), null)).toEqual(FEED)
  })
})
