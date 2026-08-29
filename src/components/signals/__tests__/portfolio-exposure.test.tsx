import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SignalCardView } from '../SignalCardView'
import { buildScenarioGapCard } from '../../../lib/signals/builders/scenarioGap'
import type { SignalCard } from '../../../lib/signals/contract'

/**
 * A missing benchmark is not a zero benchmark.
 *
 * ── The distinction the sheet has to hold ─────────────────────────────────
 *
 * `benchmarkFor` in `usePortfolioLenses` answers three different ways and the
 * disclosure must render three different things:
 *
 *   null   the book has NO benchmark file. Its index weight is unknown, and
 *          Active is undefined with it. Measured in production: 7 active
 *          portfolios have a file and the rest do not.
 *   0      the file EXISTS and does not list this name. A genuine zero — the
 *          whole position is active.
 *   n      the index weight.
 *
 * Rendering the first as "0.0%" would invent a benchmark the desk does not
 * have and overstate every active weight measured against it.
 */

/**
 * A real `scenario_gap` card from the real builder, with the chip's books
 * swapped for the case under test. Building it rather than hand-rolling an
 * object keeps this honest about the shape the view actually receives.
 */
const card = (portfolios: unknown[]): SignalCard => {
  const built = buildScenarioGapCard({
    assetId: 'a1', symbol: 'AMZN', companyName: 'Amazon',
    price: 266.43, priceAsOf: new Date().toISOString(),
    cases: [
      { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
      { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
      { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
    ],
    heldIn: [{ name: 'Core Equity' }, { name: 'Growth' }],
    statedAt: '2026-08-23T19:13:53Z',
  })
  if (!built.ok) throw new Error(`fixture suppressed: ${built.reason}`)
  return {
    ...built.card,
    context: built.card.context.map(c =>
      c.label.includes('portfolio') ? { ...c, label: '2 portfolios', portfolios } : c) as never,
  }
}

const noop = () => {}

function open(portfolios: unknown[]) {
  render(<SignalCardView card={card(portfolios)} onAction={noop} onOpen={noop} />)
  fireEvent.click(screen.getByText('2 portfolios'))
}

const stat = (slot: string) =>
  document.querySelector(`[data-slot="${slot}"]`)?.textContent ?? null

describe('the portfolio disclosure leads with exposure', () => {
  it('shows Portfolio, Benchmark and Active for a book with a benchmark', () => {
    open([{ id: 'p1', name: 'Core Equity', weightPct: 4.8, benchmarkPct: 3.1, activePct: 1.7 }])
    expect(stat('pf-weight')).toContain('Portfolio')
    expect(stat('pf-weight')).toContain('4.8%')
    expect(stat('pf-benchmark')).toContain('3.1%')
    expect(stat('pf-active')).toContain('+1.7%')
  })

  it('signs an underweight with a minus', () => {
    open([{ id: 'p1', name: 'Growth', weightPct: 0.8, benchmarkPct: 2.2, activePct: -1.4 }])
    expect(stat('pf-active')).toContain('−1.4%')
  })

  /** THE rule. No benchmark file → em dashes, never 0.0%. */
  it('renders an em dash, not a zero, when the book has no benchmark file', () => {
    open([{ id: 'p1', name: 'Opportunistic', weightPct: 4.8, benchmarkPct: null }])
    expect(stat('pf-weight')).toContain('4.8%')
    expect(stat('pf-benchmark')).toContain('—')
    expect(stat('pf-benchmark')).not.toContain('0.0')
    expect(stat('pf-active')).toContain('—')
    expect(stat('pf-active')).not.toContain('0.0')
    expect(document.querySelector('[data-slot="pf-no-benchmark"]')?.textContent)
      .toContain('Benchmark data unavailable')
  })

  /** A real zero is different: the index exists and omits the name. */
  it('renders a real 0.0% when the index simply does not hold the name', () => {
    open([{ id: 'p1', name: 'Core Equity', weightPct: 4.8, benchmarkPct: 0, activePct: 4.8 }])
    expect(stat('pf-benchmark')).toContain('0.0%')
    expect(stat('pf-active')).toContain('+4.8%')
    expect(document.querySelector('[data-slot="pf-no-benchmark"]')).toBeNull()
  })

  /** No denominator, or too few positions, means no weight — not a guess. */
  it('omits the weight entirely when the book cannot support one', () => {
    open([{ id: 'p1', name: 'Two-Position Book', valueUsd: 1_000_000 }])
    expect(document.querySelector('[data-slot="pf-weight"]')).toBeNull()
    expect(document.querySelector('[data-slot="pf-active"]')).toBeNull()
    // The name and what is known still show.
    expect(screen.getByText('Two-Position Book')).toBeTruthy()
    expect(stat('pf-value')).toBeTruthy()
  })

  it('lists every book the name is held in', () => {
    open([
      { id: 'p1', name: 'Core Equity', weightPct: 4.8, benchmarkPct: 3.1, activePct: 1.7 },
      { id: 'p2', name: 'Growth', weightPct: 2.2, benchmarkPct: 0.8, activePct: 1.4 },
    ])
    expect(document.querySelectorAll('[data-slot="portfolio-row"]')).toHaveLength(2)
    expect(screen.getByText('Core Equity')).toBeTruthy()
    expect(screen.getByText('Growth')).toBeTruthy()
  })

  /** Value is secondary — exposure is the question, money is the inference. */
  it('puts value after the three weights', () => {
    open([{ id: 'p1', name: 'Core Equity', weightPct: 4.8, benchmarkPct: 3.1, activePct: 1.7, valueUsd: 2_400_000 }])
    const row = document.querySelector('[data-slot="portfolio-row"]')!
    const order = [...row.querySelectorAll('[data-slot^="pf-"]')].map(n => n.getAttribute('data-slot'))
    expect(order).toEqual(['pf-weight', 'pf-benchmark', 'pf-active', 'pf-value'])
  })

  /** The disclosure is in-card: nothing navigates, nothing is written. */
  it('opens in place without an action', () => {
    let acted = false
    render(<SignalCardView
      card={card([{ id: 'p1', name: 'Core Equity', weightPct: 4.8, benchmarkPct: 3.1, activePct: 1.7 }])}
      onAction={() => { acted = true }} onOpen={() => { acted = true }} />)
    fireEvent.click(screen.getByText('2 portfolios'))
    expect(document.querySelector('[data-slot="portfolio-row"]')).toBeTruthy()
    expect(acted).toBe(false)
  })
})
