/**
 * The conclusion band states a position. These tests are about the ways it
 * must refuse to.
 *
 * As of UX1b the band no longer carries rating, target or exposure — those live
 * in the persistent header strip (and their correctness guarantees moved there:
 * see asset-context-strip.test.tsx). What remains here is what the header does
 * NOT carry: the bear/bull reward-to-risk framing, and the differentiated view
 * quoted in the analyst's own words. The failure mode is still a number that
 * looks authoritative and is computed against a missing operand, or a paraphrase
 * presented as a quote.
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
  target: 268,
  spot: 231.4,
  ladder: ladder([['Bear', 168], ['Base', 224], ['Bull', 296]]),
  sections: [section('where_different', 'We treat the take-rate as a contract term.')],
  onOpenResearch: vi.fn(),
}

describe('the bear/bull framing is shown only when both ends are defensible', () => {
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

  it('no longer repeats the rating, target or exposure the header now owns', () => {
    // UX1b de-dup: these three were tiles here; they must be gone from the band.
    const { container } = render(<InvestmentConclusion {...base} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/Our rating|Our exposure/)
    expect(text).not.toMatch(/to spot/)      // the target's upside sub-line
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
