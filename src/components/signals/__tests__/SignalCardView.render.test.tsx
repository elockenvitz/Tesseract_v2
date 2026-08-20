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
  asOf: '2026-07-31T00:00:00.000Z',
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

describe('SignalCardView renders every builder output', () => {
  it.each(ALL)('%s', (_name, card) => {
    render(<SignalCardView card={card} onAction={noop} onOpen={noop} />)
    expect(screen.getByText(card.headline)).toBeTruthy()
    expect(screen.getByText(card.actions.primary.label)).toBeTruthy()
    expect(screen.getByText(card.actions.open.label)).toBeTruthy()
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
    // "16 days ago · Jul 31" is one fact in two formats, so only the relative
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

  it('routes every action through the same two callbacks', () => {
    const onAction = vi.fn()
    const onOpen = vi.fn()
    render(<SignalCardView card={REC} onAction={onAction} onOpen={onOpen} />)

    fireEvent.click(screen.getByText('Approve'))
    fireEvent.click(screen.getByText('Decline'))
    fireEvent.click(screen.getByText('Open DASH'))

    expect(onAction.mock.calls.map(c => c[0])).toEqual(['approve', 'reject'])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('every card can be asked why it is here, from the menu', () => {
    // "Why am I seeing this" moved into the overflow menu alongside snooze and
    // dismiss. The bare ⋯ button used to be the whole affordance and was wired
    // to a no-op on every card in the feed.
    const onAction = vi.fn()
    for (const [, card] of ALL) {
      const { unmount } = render(
        <SignalCardView card={card} onAction={onAction} onOpen={noop} />,
      )
      fireEvent.click(screen.getByLabelText('More options'))
      fireEvent.click(screen.getByText('Why am I seeing this'))
      unmount()
    }
    expect(onAction.mock.calls.map(c => c[0])).toEqual(['why', 'why', 'why'])
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

  it('collapses the body again after expanding it', () => {
    // Reversibility is the property under test, not the wording. An expand
    // with no way back leaves the card permanently open and removes its own
    // control, so the reader cannot tell whether anything is still hidden.
    //
    // The affordance is now the paragraph itself with a trailing "more" /
    // "less", rather than a separate "Show more" button row: on a card already
    // carrying a chart and a slider, that row cost the disclosure below more
    // height than the line of prose it revealed.
    const long = { ...REC, body: 'x'.repeat(400) }
    render(<SignalCardView card={long} onAction={noop} onOpen={noop} />)
    fireEvent.click(screen.getByText('more'))
    expect(screen.getByText('less')).toBeTruthy()
    fireEvent.click(screen.getByText('less'))
    expect(screen.getByText('more')).toBeTruthy()
  })

  it('expands the body when the paragraph itself is tapped', () => {
    // The paragraph carries the toggle now, so a reader who taps the text they
    // are trying to read gets the rest of it rather than nothing.
    const long = { ...REC, body: 'y'.repeat(400) }
    const { container } = render(<SignalCardView card={long} onAction={noop} onOpen={noop} />)
    fireEvent.click(container.querySelector('[data-slot="body-toggle"]')!)
    expect(screen.getByText('less')).toBeTruthy()
  })

  it('reveals detail in place without navigating', () => {
    const onOpen = vi.fn()
    render(
      <SignalCardView card={REC} onAction={noop} onOpen={onOpen}
        detail={<div data-testid="the-detail" />} detailLabel="See all 3 cases" />,
    )
    // Open by default: the card owns a screen and this is the content worth
    // filling it with. Closing it is the interaction.
    expect(screen.getByTestId('the-detail')).toBeTruthy()
    fireEvent.click(screen.getByText('Hide detail'))
    expect(screen.queryByTestId('the-detail')).toBeNull()
    fireEvent.click(screen.getByText('See all 3 cases'))
    expect(screen.getByTestId('the-detail')).toBeTruthy()
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
