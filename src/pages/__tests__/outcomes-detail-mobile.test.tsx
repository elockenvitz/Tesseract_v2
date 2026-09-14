/**
 * The Outcomes decision detail on a phone.
 *
 * Pins the phone layout: the chart is behind a Show chart / Hide chart toggle
 * and starts hidden, Summary is the one open section, and the story reads as
 * seven cards in a fixed order. Also pins what must not move: the pilot
 * Outcomes banner still hears the thesis section open, and desktop keeps its
 * open Next actions and has no chart toggle in the panel.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'

const viewport = vi.hoisted(() => ({ phone: true }))

vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: () => viewport.phone }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'org-1' }) }))
vi.mock('../../components/common/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }))
vi.mock('../../components/outcomes/PositionChart', () => ({ PositionChart: () => <div data-testid="position-chart" /> }))
vi.mock('../../components/outcomes/ScorecardViews', () => ({ AnalystScorecardsView: () => null, PMScorecardsView: () => null }))
vi.mock('../../components/mobile/MobileDecisionLedger', () => ({ MobileDecisionLedger: () => null }))
vi.mock('../../components/pilot/PilotOutcomesGetStarted', () => ({ PilotOutcomesGetStarted: () => null }))
vi.mock('../../components/ui/MultiSelectFilter', () => ({ MultiSelectFilter: () => null }))
vi.mock('../../components/ui/OptionPicker', () => ({ OptionPicker: () => null }))
vi.mock('../../hooks/usePilotMode', () => ({ usePilotMode: () => ({ effectiveIsPilot: false }) }))
vi.mock('../../hooks/usePilotMission', () => ({ usePilotMission: () => ({}) }))

const mutation = { mutate: () => {}, isPending: false, isError: false, error: null }
vi.mock('../../hooks/useDecisionAccountability', () => ({
  useDecisionAccountability: () => ({ data: null, isLoading: false }),
  useDecisionStory: () => ({ data: null, isLoading: false }),
  fetchDecisionStory: async () => null,
  usePortfoliosForFilter: () => ({ data: [] }),
  useCandidateTradeEvents: () => ({ data: [], isLoading: false }),
  useManualMatch: () => mutation,
  useUnlinkMatch: () => mutation,
  useMarkDecisionSkipped: () => mutation,
  useDecisionReflections: () => ({ data: { reflections: [], acceptedTradeId: 'at-1', decisionRequestId: null }, isLoading: false }),
  useAddReflection: () => mutation,
  useAddThesis: () => mutation,
}))
vi.mock('../../hooks/useDecisionReview', () => ({
  useDecisionReview: () => ({ data: null, isLoading: false }),
  useDecisionReviewsByIds: () => ({ data: {} }),
  useUpsertDecisionReview: () => mutation,
}))
vi.mock('../../hooks/usePositionLifecycle', () => ({
  usePositionLifecycle: () => ({ data: null, isLoading: false }),
  usePositionPriceHistory: () => ({ data: [], isLoading: false }),
  useHoldingsTimeSeries: () => ({ data: [] }),
}))

import { DetailPanel } from '../DecisionAccountabilityPage'
import type { AccountabilityRow } from '../../types/decision-accountability'

const row = {
  decision_id: 'd-1',
  created_at: '2026-09-01T12:00:00Z',
  approved_at: '2026-09-02T12:00:00Z',
  source: 'trade_queue',
  category: 'acted',
  direction: 'buy',
  stage: 'approved',
  rationale_text: 'Margins inflect as the new product line ships.',
  decision_note: null,
  deferred_until: null,
  asset_id: 'a-1',
  asset_symbol: 'AAPL',
  asset_name: 'Apple Incorporated Common Stock',
  portfolio_id: 'p-1',
  portfolio_name: 'Global Long-Only Growth Fund',
  owner_name: 'Pilot',
  approver_name: 'PM',
  execution_status: 'executed',
  matched_executions: [{
    event_id: 'e-1', event_date: '2026-09-03T12:00:00Z', action_type: 'add', match_method: 'explicit_link',
    quantity_delta: 100, execution_price: 190, weight_delta: 0.5, lag_days: 1, market_value_after: 19000,
  }],
  execution_lag_days: 1,
  days_since_decision: 12,
  decision_price: 185,
  decision_price_at: '2026-09-02T12:00:00Z',
  has_decision_price: true,
  current_price: 200,
  execution_price: 190,
  move_since_decision_pct: 8.1,
  move_since_execution_pct: 5.3,
  result_direction: 'positive',
  delay_cost_pct: null,
  trade_notional: 19000,
  size_basis: 'market_value_delta',
  weight_impact: 0.5,
  impact_proxy: 1539,
} as unknown as AccountabilityRow

const PHONE_ORDER = [
  'Summary',
  'Why this decision was made',
  'Decision',
  'Execution',
  'Performance so far',
  'Reflections',
  'Next actions',
]

function renderPanel() {
  return render(<DetailPanel row={row} onClose={() => {}} onSelectDecision={() => {}} />)
}

/** Section headings in document order: the Summary h2, then each card's title. */
function sectionTitles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('h2, [aria-expanded] > span.min-w-0 > span:first-child'))
    .map(el => el.textContent?.trim())
}

describe('Outcomes detail on a phone', () => {
  beforeEach(() => {
    viewport.phone = true
    // jsdom has no element scrolling; the toggle scrolls the story to the top.
    Element.prototype.scrollTo = () => {}
  })
  afterEach(cleanup)

  it('hides the chart until Show chart is tapped, and Hide chart puts it away', async () => {
    const { container } = renderPanel()
    const toggle = screen.getByRole('button', { name: 'Show chart' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-slot="outcomes-phone-chart"]')).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide chart' }).getAttribute('aria-expanded')).toBe('true')
    const chart = container.querySelector('[data-slot="outcomes-phone-chart"]') as HTMLElement
    expect(chart).not.toBeNull()
    await waitFor(() => expect(within(chart).getByText(/No price history available for AAPL/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Hide chart' }))
    expect(container.querySelector('[data-slot="outcomes-phone-chart"]')).toBeNull()
  })

  it('puts the chart toggle above the story, not below it', () => {
    const { container } = renderPanel()
    const toggle = container.querySelector('[data-slot="outcomes-chart-toggle"]')!
    const summary = container.querySelector('[data-section-id="summary"]')!
    expect(toggle.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reads as seven sections in order', () => {
    const { container } = renderPanel()
    expect(sectionTitles(container)).toEqual(PHONE_ORDER)
  })

  it('opens Summary only; every other section starts collapsed', () => {
    const { container } = renderPanel()
    const summary = container.querySelector('[data-section-id="summary"]') as HTMLElement
    expect(within(summary).getByText('System Insight')).toBeTruthy()

    const headers = Array.from(container.querySelectorAll('button[aria-expanded]'))
      .filter(b => b.getAttribute('data-slot') !== 'outcomes-chart-toggle')
    expect(headers).toHaveLength(PHONE_ORDER.length - 1)
    for (const h of headers) expect(h.getAttribute('aria-expanded')).toBe('false')
    // Next actions was open by default before; on a phone it is not.
    expect(screen.queryByText(/The loop runs continuously/)).toBeNull()
  })

  it('expands a section on tap and still tells the pilot banner the thesis was opened', () => {
    const opened: string[] = []
    const onOpened = (e: Event) => opened.push((e as CustomEvent).detail?.sectionId)
    window.addEventListener('outcomes:section-opened', onOpened)
    try {
      renderPanel()
      const why = screen.getByRole('button', { name: /Why this decision was made/ })
      fireEvent.click(why)
      expect(why.getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText('Margins inflect as the new product line ships.')).toBeTruthy()
      expect(opened).toContain('thesis')
    } finally {
      window.removeEventListener('outcomes:section-opened', onOpened)
    }
  })

  it('shows the whole asset and portfolio name, with a 44px close', () => {
    renderPanel()
    const meta = screen.getByText(/Apple Incorporated Common Stock/)
    expect(meta.textContent).toContain('Global Long-Only Growth Fund')
    expect(meta.className).not.toContain('truncate')
    expect(meta.className).toContain('break-words')
    const close = screen.getByRole('button', { name: 'Close detail' })
    expect(close.className).toContain('w-11')
    expect(close.className).toContain('h-11')
  })

  it('lifts the section type and button size through the phone-body class', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8')
    const block = css.slice(css.indexOf('.outcomes-phone-body { overflow-wrap: anywhere; }'))
    expect(block).toContain('.outcomes-phone-body .text-\\[11px\\] { font-size: 14px; }')
    expect(block).toContain('.outcomes-phone-body button { min-height: 44px; }')
  })
})

describe('Outcomes detail on desktop', () => {
  beforeEach(() => { viewport.phone = false })
  afterEach(cleanup)

  it('has no chart toggle in the panel and keeps Next actions open', () => {
    const { container } = renderPanel()
    expect(container.querySelector('[data-slot="outcomes-chart-toggle"]')).toBeNull()
    expect(container.querySelector('[data-section-id="summary"]')).toBeNull()
    expect(screen.getByText(/The loop runs continuously/)).toBeTruthy()
    expect(screen.getByText('Performance so far')).toBeTruthy()
  })
})

describe('the page', () => {
  it('no longer pins a chart under the phone detail panel', () => {
    const page = readFileSync(path.join(process.cwd(), 'src/pages/DecisionAccountabilityPage.tsx'), 'utf8')
    const overlay = page.slice(page.indexOf("'fixed inset-0 z-[85]"), page.indexOf('// Column headers'))
    expect(overlay).not.toContain('<DeferredChartPanel')
  })
})
