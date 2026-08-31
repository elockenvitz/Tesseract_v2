import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SignalCardView } from '../SignalCardView'
import { buildActiveRiskCard } from '../../../lib/signals/builders/activeRisk'
import { buildRecommendationCard } from '../../../lib/signals/builders/recommendation'
import { buildNewsCard } from '../../../lib/signals/builders/news'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'

/**
 * The point of these tests is not that the component renders — it is that
 * three unrelated card types render through *one* component with no per-type
 * branch anywhere.
 *
 * The old surface had seven bespoke card components, which produced three
 * header patterns, four action bars and two cards that were dead ends. The
 * only durable defence against that is a test that fails the moment a type
 * needs special handling to look right.
 */

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const RISK = unwrap(buildActiveRiskCard({
  assetId: 'a1', symbol: 'MSFT', companyName: 'Microsoft',
  weightPct: 6.2, benchmarkWeightPct: 3.1,
  portfolioId: 'p1', portfolioName: 'Core Equity',
  /**
   * RELATIVE, like `REC` below, because the assertion is about the FORM the
   * eyebrow takes and the form depends on the age.
   *
   * It was pinned to 2026-07-31 and asserted as `/^\d+ \w+ ago$/`. That held
   * while the date was inside the formatter's "N days ago" band and rotted the
   * moment it crossed a month: "about 1 month ago" has no leading digit, so the
   * suite began failing on every branch on a date nobody chose. Sixteen days
   * before now is sixteen days before now, forever.
   */
  asOf: new Date(Date.now() - 16 * 86_400_000).toISOString(),
}))

const REC = unwrap(buildRecommendationCard({
  id: 'r1', assetId: 'a2', symbol: 'DASH', action: 'trim',
  proposedWeightPct: 1.5, currentWeightPct: 4.0,
  currentWeightAsOf: '2026-07-31T00:00:00.000Z',
  rationale: 'Multiple has re-rated past our bull case and the margin story is now consensus.',
  recommendedBy: 'Priya Raman',
  portfolioId: 'p1', portfolioName: 'Core Equity',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
}))

const NEWS = unwrap(buildNewsCard({
  id: 'n1',
  headline: 'Microsoft raises quarterly dividend and expands buyback authorisation',
  summary: 'The company lifted its payout by 10% and added $60bn to its repurchase programme.',
  url: 'https://example.com/story', source: 'Reuters',
  publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
  primarySymbol: 'MSFT',
  asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
  heldIn: ['Core Equity', 'Growth'], maxWeightPct: 6.2,
}))

const ALL: [string, SignalCard][] = [
  ['active_risk', RISK],
  ['recommendation', REC],
  ['news', NEWS],
]

const noop = () => {}


/**
 * jsdom has no layout, so a clamped paragraph measures 0 by 0 and the card
 * correctly concludes nothing is clipped. The component decides tappability by
 * MEASURING rather than by counting characters — which is the fix for an
 * ellipsis that did nothing — so a test about the drawer has to supply the
 * measurement jsdom cannot.
 */
function stubClamped() {
  const proto = window.HTMLParagraphElement.prototype
  // Both axes: primary prose wraps and overflows DOWN, supporting prose is
  // `nowrap` and can only overflow SIDEWAYS, so the component measures
  // whichever one the role can actually exceed. Stubbing height alone left
  // every supporting card reading as "fits", and the drawer unreachable.
  const saved = ['scrollHeight', 'clientHeight', 'scrollWidth', 'clientWidth']
    .map(k => [k, Object.getOwnPropertyDescriptor(proto, k)] as const)
  for (const [k, v] of [['scrollHeight', 90], ['scrollWidth', 90],
                        ['clientHeight', 40], ['clientWidth', 40]] as const) {
    Object.defineProperty(proto, k, { configurable: true, get: () => v })
  }
  return () => {
    for (const [k, d] of saved) if (d) Object.defineProperty(proto, k, d)
  }
}

describe('SignalCardView renders every builder output', () => {
  it.each(ALL)('%s', (_name, card) => {
    render(<SignalCardView card={card} onAction={noop} onOpen={noop} />)
    expect(screen.getByText(card.headline)).toBeTruthy()
    /**
     * `capture` is called "Actions" in the bar, in BOTH slots.
     *
     * It was renamed in the quick slot only, and `capture` is the primary on
     * about a dozen types — every market template, every post, active risk,
     * crowding, both conviction cards — so one action id wore two names
     * depending on which button it landed in. This asserts the display rule
     * rather than the contract label, which is what a reader actually meets.
     */
    const primaryText = card.actions.primary.id === 'capture'
      ? 'Actions'
      : card.actions.primary.label
    expect(screen.getByText(primaryText)).toBeTruthy()
    // `actions.open` is still on the contract — the actions sheet reads its
    // label and href — but the footer no longer renders it as a button.
    expect(screen.queryByText(card.actions.open.label)).toBeNull()
  })

  it('shows the KIND, not the surface, in the eyebrow', () => {
    // Inverted deliberately. Four surface words across seventeen types meant a
    // stale-coverage card, a missing thesis and an expired target all read as
    // "Research", and nothing on screen changed between them. The surface
    // survives as the colour carrying the label.
    const { rerender } = render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} />)
    expect(screen.getByText('Active risk')).toBeTruthy()
    expect(screen.queryByText('Risk')).toBeNull()

    rerender(<SignalCardView card={REC} onAction={noop} onOpen={noop} />)
    expect(screen.getByText('Awaiting decision')).toBeTruthy()

    rerender(<SignalCardView card={NEWS} onAction={noop} onOpen={noop} />)
    expect(screen.getByText('News')).toBeTruthy()
  })

  it('the kind chip narrows the feed', () => {
    // Restores the legacy tile chip's one-tap "more like this". The first
    // convergence dropped it entirely.
    const onFilterKind = vi.fn()
    render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} onFilterKind={onFilterKind} />)
    fireEvent.click(screen.getByText('Active risk'))
    expect(onFilterKind).toHaveBeenCalledWith('active_risk')
  })

  it('flags a number that came from the book rather than a live quote', () => {
    render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} />)
    // occurredAt and asOf are the same day, so the eyebrow renders one date.
    // No "holdings" qualifier: readers assume holdings and prices are current,
    // and the vintage distinction is an engineering concern the suppression
    // rules enforce — not something to put on the face of a card.
    expect(screen.queryByText(/holdings/)).toBeNull()
    expect(screen.queryByText(/^book /)).toBeNull()
  })

  it('renders one date when the event and the number share a day', () => {
    render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} />)
    // "16 days ago · 31 Jul" is one fact in two formats, so only the relative
    // form appears.
    //
    // Asserted on the EYEBROW, not on the card's whole textContent. The
    // previous version matched /ago.*book/ across everything, which passed
    // only because the eyebrow said "book" — the moment that qualifier was
    // removed the same regex started matching the BODY, which says "6.2% of
    // the book against 3.1% in the benchmark". A test that reads the whole
    // card cannot tell a label from prose.
    const eyebrow = screen.getByText(/ago$/)
    expect(eyebrow.textContent).toMatch(/^\d+ \w+ ago$/)
    expect(eyebrow.textContent).not.toMatch(/book|holdings/)
  })

  it('renders both dates when they genuinely differ', () => {
    // The recommendation was made a day ago; the weight it argues against is
    // from the 31st. That gap changes what you conclude.
    render(<SignalCardView card={REC} onAction={noop} onOpen={noop} />)
    expect(screen.getByText(/ago/)).toBeTruthy()
    // Two dates, neither of them labelled with where it came from.
    expect(screen.queryByText(/holdings/)).toBeNull()
  })

  it('never labels a number with the table it came from', () => {
    for (const c of [NEWS, REC]) {
      const { unmount } = render(<SignalCardView card={c} onAction={noop} onOpen={noop} />)
      expect(screen.queryByText(/holdings/)).toBeNull()
      expect(screen.queryByText(/^book /)).toBeNull()
      unmount()
    }
  })

  it('renders a card with no metric without leaving a hole', () => {
    const noMetric = unwrap(buildRecommendationCard({
      id: 'r2', assetId: 'a3', symbol: 'NVDA', action: 'sell',
      proposedWeightPct: null, currentWeightPct: null, currentWeightAsOf: null,
      rationale: 'Position has no owner since Sam left and nobody is maintaining the model.',
      recommendedBy: null, portfolioId: 'p1', portfolioName: 'Core Equity',
      createdAt: new Date().toISOString(),
    }))
    render(<SignalCardView card={noMetric} onAction={noop} onOpen={noop} />)
    expect(screen.getByText(noMetric.headline)).toBeTruthy()
    expect(screen.getByText('Approve')).toBeTruthy()
  })

  it('routes every footer action through one callback', () => {
    // `onOpen` used to be the second: the footer's third button called it
    // directly rather than going through `onAction`. That button is gone —
    // opening the asset is the first entry in the actions sheet — so the bar
    // has a single path out of it again.
    const onAction = vi.fn()
    render(<SignalCardView card={REC} onAction={onAction} />)

    fireEvent.click(screen.getByText('Approve'))
    fireEvent.click(screen.getByText('Decline'))

    expect(onAction.mock.calls.map(c => c[0])).toEqual(['approve', 'reject'])
    expect(screen.queryByText('Open DASH')).toBeNull()
  })

  it('every card says why it is here, without being asked', () => {
    /**
     * This used to click a "Why am I seeing this" menu item and assert the
     * action fired. The item is gone.
     *
     * The menu opens with `provenance.reason` printed under its own heading, so
     * the button sat a few pixels below the answer to its own question — and
     * every call site in the feed wired it to a no-op, so pressing it did
     * nothing at all. The answer stayed and the control went.
     */
    for (const [type, card] of ALL) {
      const { container, unmount } = render(
        <SignalCardView card={card} onAction={noop} onOpen={noop} />,
      )
      fireEvent.click(screen.getByLabelText('More options'))

      const reason = container.querySelector('[data-slot="menu-reason"]')
      expect(reason?.textContent, `${type} should state its reason`).toBe(card.provenance.reason)
      expect(screen.queryByText('Why am I seeing this'), `${type} should not ask it too`).toBeNull()
      unmount()
    }
  })

  it('keeps snooze and dismiss out of the action bar', () => {
    // Four buttons gave housekeeping the same weight as the decision, and were
    // why the row overflowed at 390px.
    render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} />)
    expect(screen.queryByText('Snooze for a week')).toBeNull()
    fireEvent.click(screen.getByLabelText('More options'))
    expect(screen.getByText('Snooze for a week')).toBeTruthy()
    // "Dismiss", not "Not useful". The action hides the card and says nothing
    // about whether it was worth showing; "Not useful" is now a separate menu
    // item that records feed feedback to a different store. One label for two
    // meanings was the conflation Phase 6B exists to end.
    expect(screen.getByText('Dismiss')).toBeTruthy()
  })

  it('separates feed feedback from card housekeeping in the menu', () => {
    const onFeedback = vi.fn()
    render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} onFeedback={onFeedback} />)
    fireEvent.click(screen.getByLabelText('More options'))

    // Housekeeping above, feedback below its own heading.
    expect(screen.getByText('Dismiss')).toBeTruthy()
    expect(screen.getByText('About this card')).toBeTruthy()

    fireEvent.click(screen.getByText('Not useful'))
    expect(onFeedback).toHaveBeenCalledTimes(1)
    expect(onFeedback.mock.calls[0][0].key).toBe('feed_not_useful')
    // The menu closes, and nothing navigated.
    expect(screen.queryByText('About this card')).toBeNull()
  })

  it('offers no feedback items when the surface cannot record them', () => {
    // `onFeedback` absent means the host has nowhere to send it, so the section
    // is not rendered rather than showing controls that go nowhere.
    render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} />)
    fireEvent.click(screen.getByLabelText('More options'))
    expect(screen.queryByText('About this card')).toBeNull()
  })

  it('opens the commentary drawer, and closes it again', () => {
    /**
     * Reversibility is still the property under test; the container changed.
     *
     * The body used to expand inside the card — first pushing layout, then as
     * an overlay capped at 70% of a fixed-height tile. Both were bounded by a
     * card that is exactly one viewport and cannot grow, so long commentary was
     * clipped either way. A bottom sheet is the one place a vertical scroller
     * is legitimate here, because it is an overlay rather than a member of the
     * snap feed.
     */
    const restore = stubClamped()
    try {
    const long = { ...REC, body: 'x'.repeat(400) }
    render(<SignalCardView card={long} onAction={noop} onOpen={noop} />)
    expect(screen.queryByTestId('body-drawer')).toBeNull()

    fireEvent.click(screen.getByText('more'))
    const drawer = document.querySelector('[data-slot="body-drawer"]')
    expect(drawer).toBeTruthy()
    // The whole body, not a clamped prefix.
    expect(drawer!.textContent).toContain('x'.repeat(400))

    fireEvent.click(screen.getByLabelText('Close'))
    } finally { restore() }
  })

  it('opens the drawer when the paragraph itself is tapped', () => {
    // The paragraph carries the affordance, so a reader who taps the text they
    // are trying to read gets the rest of it rather than nothing.
    const restore = stubClamped()
    try {
      const long = { ...REC, body: 'y'.repeat(400) }
      const { container } = render(<SignalCardView card={long} onAction={noop} onOpen={noop} />)
      fireEvent.click(container.querySelector('[data-slot="body-toggle"]')!)
      expect(document.querySelector('[data-slot="body-drawer"]')).toBeTruthy()
    } finally { restore() }
  })

  it('shows detail in place, with no toggle to find it behind', () => {
    const onOpen = vi.fn()
    render(
      <SignalCardView card={REC} onAction={noop} onOpen={onOpen}
        detail={<div data-testid="the-detail" />} detailLabel="See all 3 cases" />,
    )
    // The detail is part of the card, not a disclosure.
    //
    // It used to sit behind a 44px row reading "Show detail" / "Hide detail" —
    // which cost more height than most of what it hid, on a surface with
    // exactly one screen to spend, and named the interface rather than the
    // investment. Removed rather than relabelled.
    expect(screen.getByTestId('the-detail')).toBeTruthy()
    expect(screen.queryByText(/hide detail/i)).toBeNull()
    expect(screen.queryByText(/show detail/i)).toBeNull()
    expect(screen.queryByText('See all 3 cases')).toBeNull()
    // And reaching it still never navigates.
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('omits evidence entirely when no card argues for it', () => {
    // A chart needs a reason to appear. None of the three has one, so none
    // gets a slot — the previous tiles rendered an empty chart panel anyway.
    const { container } = render(
      <SignalCardView card={NEWS} onAction={noop} onOpen={noop}
        evidence={<div data-testid="chart" />} />,
    )
    expect(container.querySelector('[data-testid="chart"]')).toBeNull()
  })
})
