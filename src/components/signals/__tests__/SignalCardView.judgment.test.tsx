import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { SignalCardView } from '../SignalCardView'
import { buildActiveRiskCard } from '../../../lib/signals/builders/activeRisk'
import { buildRecommendationCard } from '../../../lib/signals/builders/recommendation'
import type { CardResult, Severity, SignalCard } from '../../../lib/signals/contract'

/**
 * browse -> engage -> judge.
 *
 * Nearly every tile used to open with its question — "What best describes this
 * position?", "Does this need a price target?" — so scrolling the feed felt
 * like working through a questionnaire rather than reading one. None of the
 * questions are removed; what changed is WHEN they arrive.
 *
 * These assert the hierarchy, never the copy.
 */

const noop = () => {}

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/**
 * Real builder output, not a hand-built literal.
 *
 * The first version of this file assembled a card by hand, omitted required
 * fields, and every assertion failed on a TypeError rather than on the
 * behaviour under test — which is exactly how a fixture drifts from a contract
 * without anybody noticing.
 */
const RISK = unwrap(buildActiveRiskCard({
  assetId: 'a1', symbol: 'NVDA', companyName: 'Nvidia',
  weightPct: 6.2, benchmarkWeightPct: 3.1,
  portfolioId: 'p1', portfolioName: 'Core Equity',
  asOf: '2026-07-31T00:00:00.000Z',
}))

const REC = unwrap(buildRecommendationCard({
  id: 'r1', assetId: 'a2', symbol: 'DASH', action: 'trim',
  proposedWeightPct: 1.5, currentWeightPct: 4.0,
  currentWeightAsOf: '2026-07-31T00:00:00.000Z',
  rationale: 'Multiple has re-rated past our bull case.',
  recommendedBy: 'Priya Raman',
  portfolioId: 'p1', portfolioName: 'Core Equity',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
}))

/**
 * The same card at a chosen severity, which is the axis presentation turns on.
 * A prompt is forced on so "was the question shown" is always a fair question.
 */
const at = (c: SignalCard, severity: Severity, id = c.id): SignalCard => ({
  ...c, id, severity,
  prompt: c.prompt ?? 'What best describes this position?',
})

const panes = [
  { id: 'price', label: 'Price', content: <div>chart</div> },
  { id: 'verdict', label: 'Respond', content: <div>verdict-controls</div> },
]

const view = (c: SignalCard) =>
  render(<SignalCardView card={c} panes={panes} onAction={noop} onOpen={noop} />)

/** The card marks its regions with `data-slot`, not `data-testid`. */
const prompt = () => document.querySelector('[data-slot="prompt"]')

describe('a routine card does not interrogate the reader', () => {
  it('shows no question in the resting state', () => {
    view(at(RISK, 'critical'))
    expect(prompt()).toBeNull()
  })

  it('withholds the judgment controls too', () => {
    // Hiding the question while leaving the buttons would be worse than
    // either: a control with nothing saying what it answers.
    view(at(RISK, 'attention'))
    expect(screen.queryByText('verdict-controls')).toBeNull()
  })

  it('still shows its evidence', () => {
    // The resting state has to be worth reading on its own, or the affordance
    // is the only thing on the card.
    view(at(RISK, 'attention'))
    expect(screen.getByText('chart')).toBeTruthy()
  })

  it('offers exactly one affordance', () => {
    const { container } = view(at(RISK, 'attention'))
    expect(container.querySelectorAll('[data-slot="engage"]')).toHaveLength(1)
  })
})

describe('engaging reveals the judgment', () => {
  it('brings up the controls in place of the evidence', () => {
    /**
     * Engaging REPLACES the band; it does not add a pane. Appending one was
     * reported, accurately, as creating "another card that wasn't there
     * originally" — which is what a new pane in a pager is.
     */
    const { container } = view(at(RISK, 'critical'))
    fireEvent.click(container.querySelector('[data-slot="engage"]')!)
    expect(screen.getByText('verdict-controls')).toBeTruthy()
    expect(container.querySelector('[data-slot="judgment-open"]')).toBeTruthy()
    // The evidence steps aside rather than gaining a sibling.
    expect(screen.queryByText('chart')).toBeNull()
  })

  it('does not print the question twice', () => {
    // The response bar carries its own heading. Showing the card's prompt as
    // well is how a 390px card says one thing twice.
    const { container } = view(at(RISK, 'critical'))
    fireEvent.click(container.querySelector('[data-slot="engage"]')!)
    expect(prompt()).toBeNull()
  })

  it('offers a way back to the evidence', () => {
    // Otherwise the reader has swapped their evidence for a question with no
    // way to re-read what prompted it.
    const { container } = view(at(RISK, 'critical'))
    fireEvent.click(container.querySelector('[data-slot="engage"]')!)
    fireEvent.click(container.querySelector('[data-slot="judgment-back"]')!)
    expect(screen.getByText('chart')).toBeTruthy()
    expect(screen.queryByText('verdict-controls')).toBeNull()
  })

  it('retires the affordance once it has been used', () => {
    const { container } = view(at(RISK, 'attention'))
    fireEvent.click(container.querySelector('[data-slot="engage"]')!)
    expect(container.querySelector('[data-slot="engage"]')).toBeNull()
  })

  it('does not navigate anywhere to do it', () => {
    /**
     * The explicit requirement: do not route away merely to reveal a verdict
     * bar. Engagement happens in place, so `onOpen` must not fire.
     */
    let opened = 0
    const { container } = render(
      <SignalCardView card={at(RISK, 'attention')} panes={panes}
        onAction={noop} onOpen={() => { opened++ }} />,
    )
    fireEvent.click(container.querySelector('[data-slot="engage"]')!)
    expect(opened).toBe(0)
  })
})

describe('unresolved decision events still lead with their question', () => {
  it('asks immediately when the situation is material', () => {
    // A breach, a target substantially exceeded, an unanswered recommendation:
    // the question IS the content, and withholding it withholds the point.
    for (const type of ['scenario_gap', 'target_hit', 'recommendation'] as const) {
      const { container, unmount } = view(at({ ...REC, type } as SignalCard, 'critical'))
      expect(prompt(), type).toBeTruthy()
      // The response is a PANE, beside the evidence rather than under it —
      // one thing at a time on a card with room for one.
      expect(screen.getByText('verdict-controls'), type).toBeTruthy()
      expect(container.querySelector('[data-slot="engage"]'), type).toBeNull()
      unmount()
    }
  })

  /**
   * Severity governs URGENCY — but only where the card has not already made
   * the judgment a first-class pane.
   *
   * ── What changed, and why ────────────────────────────────────────────────
   *
   * This used to assert that any non-critical `scenario_gap` grew a "Your
   * view" affordance. Measured on two real cards, that produced two different
   * navigation architectures for ONE card type: AMZN breaches its framework by
   * 48% so it is `critical` and pages Ladder / Respond / Price / Cases, while
   * DASH sits at its expected value, is `informational`, and grew "Your view"
   * plus a "< Evidence" back link — on which the footer kept offering
   * `Review cases` while the reader was looking at the response UI.
   *
   * So the rule is now about what the CARD supplies, not only how loud it is.
   * A declared-inline type that hands over a multi-pane shell with the
   * judgment already in it keeps that shell at every severity.
   */
  it('keeps its own shell at any severity when it supplies one', () => {
    const { container } = view(at({ ...REC, type: 'scenario_gap' } as SignalCard, 'informational'))
    // No second way in, and no second footer contract.
    expect(container.querySelector('[data-slot="engage"]')).toBeNull()
    expect(screen.getByText('verdict-controls')).toBeTruthy()
  })

  /**
   * And severity still decides for a card that did NOT bring a shell — the
   * original rule, on the path it was written for.
   */
  it('still withholds the question when the card has only a judgment to show', () => {
    const { container } = render(
      <SignalCardView
        card={at({ ...REC, type: 'recommendation' } as SignalCard, 'informational')}
        panes={[
          { id: 'price', label: 'Price', content: <div>chart</div> },
          { id: 'detail', label: 'Detail', content: <div>detail</div> },
        ]}
        onAction={noop} onOpen={noop} />,
    )
    // No judgment pane at all, so there is nothing to engage with either way.
    expect(container.querySelector('[data-slot="engage"]')).toBeNull()
    expect(prompt()).toBeNull()
  })
})

describe('cards with nothing to ask', () => {
  it('offers no affordance when there is no judgment pane', () => {
    // An affordance that reveals nothing is worse than no affordance.
    const { container } = render(
      <SignalCardView card={at(RISK, 'attention')}
        panes={[{ id: 'price', label: 'Price', content: <div>chart</div> }]}
        onAction={noop} onOpen={noop} />,
    )
    expect(container.querySelector('[data-slot="engage"]')).toBeNull()
  })
})

describe('engagement does not survive card reuse', () => {
  it('resets when the slot renders a different card', () => {
    /**
     * Windowed slots are reused. An engaged state carried across would put one
     * card's answer controls under another card's headline, and the reader
     * would have no idea they had been opened.
     */
    const { container, rerender } = view(at(RISK, 'attention'))
    fireEvent.click(container.querySelector('[data-slot="engage"]')!)
    expect(container.querySelector('[data-slot="judgment-open"]')).toBeTruthy()

    rerender(<SignalCardView card={at(RISK, 'attention', 'a-different-card')} panes={panes}
      onAction={noop} onOpen={noop} />)
    expect(container.querySelector('[data-slot="judgment-open"]')).toBeNull()
    expect(container.querySelector('[data-slot="engage"]')).toBeTruthy()
  })
})
