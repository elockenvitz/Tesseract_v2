/**
 * Scorecards on a phone: a compact header with its explanation under Why, and
 * pillars with no data as one compact "Not yet measurable" card rather than a
 * stack of mostly-empty cards. Desktop keeps its pillar cards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { buildAnalystPillars, interpretAnalystScorecard } from '../../../lib/scorecard-engine'

const viewport = vi.hoisted(() => ({ phone: true }))
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => viewport.phone }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../hooks/useScorecards', () => ({
  useAnalystScorecard: () => ({ data: null, isLoading: false }),
  usePMScorecard: () => ({ data: null, isLoading: false }),
  useScorecardVisibility: () => ({ isLoading: false, canViewLeaderboard: false, visibility: 'open' }),
  useTeamMembers: () => ({ data: [], isLoading: false }),
}))

import { AnalystScorecardsView } from '../ScorecardViews'

describe('Scorecards on a phone', () => {
  beforeEach(() => { viewport.phone = true })
  afterEach(cleanup)

  it('collects pillars with no data into one compact Not yet measurable card', () => {
    const pillars = buildAnalystPillars(null)
    expect(pillars.length).toBeGreaterThan(0)
    expect(pillars.every(p => !p.measurable)).toBe(true)

    render(<AnalystScorecardsView />)
    const card = document.querySelector('[data-slot="pillars-unavailable"]') as HTMLElement
    expect(card).not.toBeNull()
    expect(document.querySelectorAll('[data-slot="pillars-unavailable"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-slot="pillar-card"]')).toHaveLength(0)
    const rows = card.querySelectorAll('[data-slot="pillar-unavailable"]')
    expect(rows).toHaveLength(pillars.length)
    expect(within(card).getByText(`Not yet measurable · ${pillars.length}`)).toBeTruthy()
    // No empty score or metric columns: one title and one Why per row.
    for (const p of pillars) {
      expect(within(card).getByText(p.title)).toBeTruthy()
      for (const m of p.metrics) expect(within(card).queryByText(m.label)).toBeNull()
    }
  })

  it('keeps each pillar’s explanation behind Why', () => {
    const pillar = buildAnalystPillars(null).find(p => p.takeaway)!
    render(<AnalystScorecardsView />)
    const card = document.querySelector('[data-slot="pillars-unavailable"]') as HTMLElement
    expect(within(card).queryByText(pillar.takeaway)).toBeNull()
    const row = within(card).getByText(pillar.title).closest('[data-slot="pillar-unavailable"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /Why/ }))
    expect(within(row).getByText(pillar.takeaway)).toBeTruthy()
  })

  it('shows a compact header with the interpretation under Why', () => {
    const verdict = interpretAnalystScorecard(null)
    render(<AnalystScorecardsView />)
    const header = document.querySelector('[data-slot="scorecard-header"]') as HTMLElement
    expect(within(header).getByText(verdict.headline)).toBeTruthy()
    expect(within(header).queryByText(verdict.interpretation)).toBeNull()
    fireEvent.click(within(header).getByRole('button', { name: /Why/ }))
    expect(within(header).getByText(verdict.interpretation)).toBeTruthy()
    // No 60px score ring on the phone.
    expect(header.querySelector('svg circle')).toBeNull()
  })

  it('lays the outcome stats out without a horizontal strip', () => {
    render(<AnalystScorecardsView />)
    const breakdown = document.querySelector('[data-slot="scorecard-breakdown"]') as HTMLElement
    expect(breakdown.querySelector('dl')!.className).toContain('grid-cols-3')
    expect(breakdown.textContent).not.toContain('→')
  })
})

describe('Scorecards on desktop', () => {
  beforeEach(() => { viewport.phone = false })
  afterEach(cleanup)

  it('keeps the desktop pillar cards and header', () => {
    render(<AnalystScorecardsView />)
    expect(document.querySelector('[data-slot="pillars-unavailable"]')).toBeNull()
    expect(document.querySelector('[data-slot="scorecard-header"]')).toBeNull()
    expect(screen.getAllByText('Not yet measurable').length).toBe(buildAnalystPillars(null).length)
  })
})
