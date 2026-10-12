/**
 * The conclusion band states a position. These tests are about the ways it
 * must refuse to.
 *
 * It is the most prominent thing on the Asset page, so every figure on it is
 * read at a glance and acted on. The failure mode is never a crash — it is a
 * number that looks authoritative and is one analyst's opinion, an arithmetic
 * result computed against a missing operand, or a paraphrase presented as a
 * quote.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InvestmentConclusion, type ConclusionSection } from '../InvestmentConclusion'
import type { CurrentLadder } from '../../../lib/signals/current-ladder'

const ladder = (cases: [string, number][]): CurrentLadder => ({
  assetId: 'a', symbol: 'AAPL', companyName: 'Apple', updatedAt: '2026-09-28T10:00:00Z',
  valid: true, reason: '',
  cases: cases.map(([name, price], i) => ({
    scenarioId: `s${i}`, name, price, probability: null, timeframe: null,
    reasoning: null, id: `p${i}`, userId: null,
  })),
})

const section = (s: string, content: string, over: Partial<ConclusionSection> = {}): ConclusionSection => ({
  section: s, content, updatedAt: '2026-09-28T10:00:00Z', authorName: 'Ana Bell', ...over,
})

const base = {
  symbol: 'AAPL',
  rating: { value: 'Buy', count: 3 },
  analystCount: 5,
  target: 268,
  spot: 231.4,
  ladder: ladder([['Bear', 168], ['Base', 224], ['Bull', 296]]),
  sections: [section('where_different', 'We treat the take-rate as a contract term.')],
  weightPct: 2.55,
  bookName: 'Tech & Consumer Growth',
  heldBookCount: 3,
  onOpenResearch: vi.fn(),
}

describe('the rating never stands alone', () => {
  it('always shows the count it rests on', () => {
    render(<InvestmentConclusion {...base} />)
    expect(screen.getByText('Buy')).toBeInTheDocument()
    expect(screen.getByText('3 of 5 analysts')).toBeInTheDocument()
  })

  it('does not round one analyst up to a firm position', () => {
    /*
     * The whole reason the count is never suppressed. A single Buy rendered
     * bare reads as "the firm rates this Buy", and the Firm Consensus panel
     * elsewhere already states a percentage with no minimum-n gate.
     */
    render(<InvestmentConclusion {...base} rating={{ value: 'Buy', count: 1 }} analystCount={1} />)
    expect(screen.getByText('1 of 1 analyst')).toBeInTheDocument()
  })

  it('says the rating is not set rather than inventing a neutral one', () => {
    render(<InvestmentConclusion {...base} rating={null} analystCount={0} />)
    expect(screen.queryByText('Buy')).not.toBeInTheDocument()
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
  })
})

describe('arithmetic is only shown when both operands exist', () => {
  it('states upside against a real spot', () => {
    render(<InvestmentConclusion {...base} />)
    expect(screen.getByText('+15.8% to spot')).toBeInTheDocument()
  })

  it('withholds upside when there is no spot', () => {
    // A target with no price to compare is a number, not a return.
    render(<InvestmentConclusion {...base} spot={null} />)
    expect(screen.queryByText(/to spot/)).not.toBeInTheDocument()
    expect(screen.getByText('No spot to compare')).toBeInTheDocument()
  })

  it('states the bear/bull range and the reward-to-risk ratio', () => {
    render(<InvestmentConclusion {...base} />)
    expect(screen.getByText('$168 – $296')).toBeInTheDocument()
    expect(screen.getByText(/-27\.4% \/ \+27\.9%/)).toBeInTheDocument()
    expect(screen.getByText(/1\.0:1/)).toBeInTheDocument()
  })

  it('withholds the ratio when only one end of the ladder exists', () => {
    /*
     * A one-sided ladder gives a ratio against an unknown. That is the kind of
     * figure that gets quoted in a meeting and cannot be defended.
     */
    render(<InvestmentConclusion {...base} ladder={ladder([['Base', 224], ['Bull', 296]])} />)
    expect(screen.queryByText(/:1/)).not.toBeInTheDocument()
    expect(screen.getByText('Needs both a bear and a bull case')).toBeInTheDocument()
  })

  it('withholds the range entirely when there is no ladder', () => {
    render(<InvestmentConclusion {...base} ladder={null} />)
    expect(screen.getByText('Needs both a bear and a bull case')).toBeInTheDocument()
  })
})

describe('the differentiated view is quoted, never manufactured', () => {
  it('shows the variant view verbatim with its author', () => {
    render(<InvestmentConclusion {...base} />)
    expect(screen.getByText(/We treat the take-rate as a contract term\./)).toBeInTheDocument()
    expect(screen.getByText(/Ana Bell/)).toBeInTheDocument()
  })

  it('does not fall back to the thesis and relabel it', () => {
    /*
     * The first build did exactly this, which printed the same paragraph twice
     * on one screen — here and in The case below — and called a thesis a
     * differentiated view. The absence is the finding.
     */
    render(<InvestmentConclusion {...base} sections={[section('thesis', 'Services mix is mispriced.')]} />)
    expect(screen.queryByText(/Services mix is mispriced/)).not.toBeInTheDocument()
    expect(screen.getByTestId('conclusion-no-variant')).toBeInTheDocument()
    expect(screen.getByText(/Nobody has recorded what this firm sees/)).toBeInTheDocument()
  })

  it('says no case exists when nothing is written at all', () => {
    render(<InvestmentConclusion {...base} sections={[]} />)
    expect(screen.getByText(/No investment case has been written for AAPL/)).toBeInTheDocument()
  })
})

describe('exposure is described, not judged', () => {
  it('states the weight and the number of books', () => {
    render(<InvestmentConclusion {...base} />)
    expect(screen.getByText('2.55%')).toBeInTheDocument()
    expect(screen.getByText(/Tech & Consumer Growth · 3 books/)).toBeInTheDocument()
  })

  it('reports a selected book that does not hold the name', () => {
    render(<InvestmentConclusion
      {...base} notInSelectedBook weightPct={null} bookName="Core Income" />)
    expect(screen.getByText('Not held')).toBeInTheDocument()
    expect(screen.getByText('Core Income does not hold it')).toBeInTheDocument()
  })

  it('never offers a sizing opinion', () => {
    /*
     * "Underweight relative to conviction" is a position-sizing judgement, and
     * nobody has asked a landing surface to have one. Asserted on the rendered
     * text so a future "helpful" addition fails here.
     */
    const { container } = render(<InvestmentConclusion {...base} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/underweight|overweight|too small|too large|should be/i)
  })
})
