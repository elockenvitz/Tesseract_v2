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
    render(<SignalCardView card={card} onAction={noop} onOpen={noop} onWhy={noop} />)
    expect(screen.getByText(card.headline)).toBeTruthy()
    expect(screen.getByText(card.actions.primary.label)).toBeTruthy()
    expect(screen.getByText(card.actions.open.label)).toBeTruthy()
  })

  it('shows the surface, not the type, in the eyebrow', () => {
    // "Risk", "Research", "Market" — four surfaces. Not seventeen type labels,
    // and never the shouting ACTIVE RISK badge the old card led with.
    const { rerender } = render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} onWhy={noop} />)
    expect(screen.getByText('Risk')).toBeTruthy()
    rerender(<SignalCardView card={REC} onAction={noop} onOpen={noop} onWhy={noop} />)
    expect(screen.getByText('Research')).toBeTruthy()
    rerender(<SignalCardView card={NEWS} onAction={noop} onOpen={noop} onWhy={noop} />)
    expect(screen.getByText('Market')).toBeTruthy()
  })

  it('flags a number that came from the book rather than a live quote', () => {
    render(<SignalCardView card={RISK} onAction={noop} onOpen={noop} onWhy={noop} />)
    // occurredAt and asOf are the same day here, so the eyebrow renders one
    // date — but it keeps the qualifier, because "this weight is off the book"
    // is the thing the reader cannot recover from anything else on the card.
    expect(screen.getByText(/^book /)).toBeTruthy()
    expect(screen.queryByText(/ago/)).toBeNull()
  })

  it('renders one date when the event and the number share a day', () => {
    const { container } = render(
      <SignalCardView card={RISK} onAction={noop} onOpen={noop} onWhy={noop} />)
    // "16 days ago · book Jul 31" is one fact in two formats.
    expect(container.textContent).not.toMatch(/ago.*book/)
  })

  it('renders both dates when they genuinely differ', () => {
    // The recommendation was made a day ago; the weight it argues against is
    // from the 31st. That gap changes what you conclude.
    render(<SignalCardView card={REC} onAction={noop} onOpen={noop} onWhy={noop} />)
    expect(screen.getByText(/ago/)).toBeTruthy()
    expect(screen.getByText(/^book /)).toBeTruthy()
  })

  it('does not flag a live quote as book data', () => {
    render(<SignalCardView card={NEWS} onAction={noop} onOpen={noop} onWhy={noop} />)
    expect(screen.queryByText(/^book /)).toBeNull()
  })

  it('renders a card with no metric without leaving a hole', () => {
    const noMetric = unwrap(buildRecommendationCard({
      id: 'r2', assetId: 'a3', symbol: 'NVDA', action: 'sell',
      proposedWeightPct: null, currentWeightPct: null, currentWeightAsOf: null,
      rationale: 'Position has no owner since Sam left and nobody is maintaining the model.',
      recommendedBy: null, portfolioId: 'p1', portfolioName: 'Core Equity',
      createdAt: new Date().toISOString(),
    }))
    render(<SignalCardView card={noMetric} onAction={noop} onOpen={noop} onWhy={noop} />)
    expect(screen.getByText(noMetric.headline)).toBeTruthy()
    expect(screen.getByText('Approve')).toBeTruthy()
  })

  it('routes every action through the same two callbacks', () => {
    const onAction = vi.fn()
    const onOpen = vi.fn()
    render(<SignalCardView card={REC} onAction={onAction} onOpen={onOpen} onWhy={noop} />)

    fireEvent.click(screen.getByText('Approve'))
    fireEvent.click(screen.getByText('Decline'))
    fireEvent.click(screen.getByText('Open DASH'))

    expect(onAction.mock.calls.map(c => c[0])).toEqual(['approve', 'reject'])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('every card can be asked why it is here', () => {
    const onWhy = vi.fn()
    for (const [, card] of ALL) {
      const { unmount } = render(
        <SignalCardView card={card} onAction={noop} onOpen={noop} onWhy={onWhy} />,
      )
      fireEvent.click(screen.getByLabelText('Why am I seeing this'))
      unmount()
    }
    expect(onWhy).toHaveBeenCalledTimes(3)
  })

  it('omits evidence entirely when no card argues for it', () => {
    // A chart needs a reason to appear. None of the three has one, so none
    // gets a slot — the previous tiles rendered an empty chart panel anyway.
    const { container } = render(
      <SignalCardView card={NEWS} onAction={noop} onOpen={noop} onWhy={noop}
        evidence={<div data-testid="chart" />} />,
    )
    expect(container.querySelector('[data-testid="chart"]')).toBeNull()
  })
})
