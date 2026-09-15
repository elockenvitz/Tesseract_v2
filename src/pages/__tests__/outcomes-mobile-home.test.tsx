/**
 * The Outcomes main page on a phone.
 *
 * Return behaviour: a selected decision is transient — leaving Outcomes and
 * coming back lands on the page, a "View in Outcomes" focus opens its decision
 * once, and Back closes the detail. Layout: decision cards, the review-status
 * card, and a range control that fits the width.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'

vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: () => true }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false, refetch: () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {}, prefetchQuery: () => Promise.resolve(), getQueryData: () => undefined }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'org-1' }) }))
vi.mock('../../components/common/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }))
vi.mock('../../components/outcomes/PositionChart', () => ({ PositionChart: () => null }))
vi.mock('../../components/outcomes/PositionChartMobile', () => ({ PositionChartMobile: () => null }))
vi.mock('../../components/outcomes/ScorecardViews', () => ({ AnalystScorecardsView: () => null, PMScorecardsView: () => null }))
vi.mock('../../components/pilot/PilotOutcomesGetStarted', () => ({ PilotOutcomesGetStarted: () => null }))
vi.mock('../../hooks/usePilotMode', () => ({ usePilotMode: () => ({ isPilot: false, isLoading: false, effectiveIsPilot: false }) }))
const mission = vi.hoisted(() => ({ reviewIdeaId: null as string | null }))
vi.mock('../../hooks/usePilotMission', () => ({ usePilotMission: () => ({ reviewIdeaId: mission.reviewIdeaId }) }))

const mutation = { mutate: () => {}, isPending: false, isError: false, error: null }
const rowsRef = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('../../hooks/useDecisionAccountability', () => ({
  useDecisionAccountability: () => ({ rows: rowsRef.rows, unmatchedExecutions: [], summary: {}, isLoading: false, isError: false, refetch: () => {} }),
  useDecisionStory: () => ({ data: null, isLoading: false }),
  fetchDecisionStory: async () => null,
  usePortfoliosForFilter: () => ({ data: [{ id: 'p-1', name: 'Global Long-Only Growth Fund' }] }),
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
  useDecisionReviewsByIds: () => ({ data: new Map() }),
  useUpsertDecisionReview: () => mutation,
}))
vi.mock('../../hooks/usePositionLifecycle', () => ({
  usePositionLifecycle: () => ({ data: null, isLoading: false }),
  usePositionPriceHistory: () => ({ data: [], isLoading: false }),
  useHoldingsTimeSeries: () => ({ data: [] }),
}))

import { DecisionAccountabilityPage } from '../DecisionAccountabilityPage'
import { MobileDecisionLedger } from '../../components/mobile/MobileDecisionLedger'
import { OutcomesRangeControl } from '../../components/mobile/OutcomesRangeControl'
import { inferDecisionIntelligence } from '../../lib/decision-intelligence'
import type { AccountabilityRow } from '../../types/decision-accountability'

function makeRow(over: Partial<AccountabilityRow>): AccountabilityRow {
  return {
    decision_id: 'd-1', created_at: '2026-09-01T12:00:00Z', approved_at: '2026-09-02T12:00:00Z',
    source: 'trade_queue', category: 'acted', direction: 'buy', stage: 'approved',
    rationale_text: 'Margins inflect.', decision_note: null, deferred_until: null,
    asset_id: 'a-1', asset_symbol: 'AAPL', asset_name: 'Apple Inc.', portfolio_id: 'p-1',
    portfolio_name: 'Global Long-Only Growth Fund', owner_name: 'PM', approver_name: 'PM',
    execution_status: 'executed', matched_executions: [], execution_lag_days: 1, days_since_decision: 12,
    decision_price: 185, decision_price_at: '2026-09-02T12:00:00Z', has_decision_price: true,
    current_price: 200, execution_price: 190, move_since_decision_pct: 8.1, move_since_execution_pct: 5.3,
    result_direction: 'positive', delay_cost_pct: null, trade_notional: 19000, size_basis: 'market_value_delta',
    weight_impact: 0.5, impact_proxy: 1539,
    ...over,
  } as unknown as AccountabilityRow
}

const STATE_KEY = 'outcomes_page_state_u1_org-1'
const detailOpen = () => screen.queryByRole('button', { name: 'Close detail' }) != null

describe('returning to Outcomes on a phone', () => {
  beforeEach(() => {
    sessionStorage.clear()
    rowsRef.rows = [makeRow({}), makeRow({ decision_id: 'd-2', asset_symbol: 'MSFT', direction: 'sell' })]
  })
  afterEach(cleanup)

  it('lands on the main page after a decision was open when Outcomes was left', () => {
    const first = render(<DecisionAccountabilityPage />)
    fireEvent.click(screen.getAllByRole('button', { name: /AAPL/ })[0])
    expect(detailOpen()).toBe(true)

    // Leaving Outcomes unmounts it (DashboardPage switches on the active tab).
    first.unmount()
    expect(JSON.parse(sessionStorage.getItem(STATE_KEY) ?? '{}')).not.toHaveProperty('selectedId')

    render(<DecisionAccountabilityPage />)
    expect(detailOpen()).toBe(false)
    expect(screen.getAllByRole('button', { name: /AAPL/ }).length).toBeGreaterThan(0)
  })

  it('ignores a selection left in a snapshot written before the fix', () => {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ activeTab: 'decisions', selectedId: 'd-1' }))
    render(<DecisionAccountabilityPage />)
    expect(detailOpen()).toBe(false)
  })

  it('opens a deep-linked decision once and reports it consumed', () => {
    const onFocusConsumed = vi.fn()
    const { rerender } = render(<DecisionAccountabilityPage focusDecisionId="d-2" onFocusConsumed={onFocusConsumed} />)
    expect(detailOpen()).toBe(true)
    expect(onFocusConsumed).toHaveBeenCalledTimes(1)

    // The shell has not cleared the id yet: no second opening.
    fireEvent.click(screen.getByRole('button', { name: 'Close detail' }))
    rerender(<DecisionAccountabilityPage focusDecisionId="d-2" onFocusConsumed={onFocusConsumed} />)
    expect(detailOpen()).toBe(false)
    expect(onFocusConsumed).toHaveBeenCalledTimes(1)

    // The shell clears it; an ordinary render stays on the page.
    rerender(<DecisionAccountabilityPage focusDecisionId={null} onFocusConsumed={onFocusConsumed} />)
    expect(detailOpen()).toBe(false)

    // A new explicit "View in Outcomes" for the same decision opens it again.
    rerender(<DecisionAccountabilityPage focusDecisionId="d-2" onFocusConsumed={onFocusConsumed} />)
    expect(detailOpen()).toBe(true)
    expect(onFocusConsumed).toHaveBeenCalledTimes(2)
  })

  it('does not reopen the deep-linked decision on the next visit once the shell dropped it', () => {
    const first = render(<DecisionAccountabilityPage focusDecisionId="d-2" onFocusConsumed={() => {}} />)
    expect(detailOpen()).toBe(true)
    first.unmount()
    render(<DecisionAccountabilityPage focusDecisionId={null} />)
    expect(detailOpen()).toBe(false)
  })

  it('closes the detail on Back and stays on Outcomes', () => {
    render(<DecisionAccountabilityPage />)
    fireEvent.click(screen.getAllByRole('button', { name: /AAPL/ })[0])
    expect(detailOpen()).toBe(true)
    // The detail pushed a history entry; Back pops it.
    act(() => {
      window.history.replaceState({}, '')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(detailOpen()).toBe(false)
    expect(screen.getAllByRole('button', { name: /AAPL/ }).length).toBeGreaterThan(0)
  })

  it('has the shell drop the focus from the Outcomes tab once consumed', () => {
    const shell = readFileSync(path.join(process.cwd(), 'src/pages/DashboardPage.tsx'), 'utf8')
    const outcomes = shell.slice(shell.indexOf("case 'outcomes':"), shell.indexOf("case 'files':"))
    expect(outcomes).toContain('onFocusConsumed=')
    expect(outcomes).toContain("t.type !== 'outcomes' || !t.data?.tradeQueueItemId")
    expect(outcomes).toContain('delete data.tradeQueueItemId')
  })
})

describe('"Finish the loop" step arrows from the Outcomes page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    mission.reviewIdeaId = null
    rowsRef.rows = [makeRow({}), makeRow({ decision_id: 'd-2', asset_symbol: 'MSFT', direction: 'sell' })]
    // jsdom has no scrolling; the opened section scrolls itself into view.
    Element.prototype.scrollIntoView = () => {}
  })
  afterEach(cleanup)

  // Exactly what the banner's step 2 and step 3 arrows send. Two act scopes:
  // the page opens the decision when the first ends, and repeats the section
  // request on a timer the second waits for.
  const arrow = async (sectionId: 'thesis' | 'performance') => {
    await act(async () => {
      window.dispatchEvent(new CustomEvent('outcomes:open-section', { detail: { sectionId } }))
    })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  }
  const sectionHeader = (title: string) => screen.getByRole('button', { name: new RegExp(title) })
  const openedSymbol = () => (screen.getByRole('button', { name: 'Close detail' }).closest('.fixed') as HTMLElement).textContent

  it('step 3 opens the reviewed decision at Performance so far', async () => {
    mission.reviewIdeaId = 'd-2'
    const opened: string[] = []
    const onOpened = (e: Event) => opened.push((e as CustomEvent).detail?.sectionId)
    window.addEventListener('outcomes:section-opened', onOpened)
    try {
      render(<DecisionAccountabilityPage />)
      expect(detailOpen()).toBe(false)
      await arrow('performance')
      expect(detailOpen()).toBe(true)
      expect(openedSymbol()).toContain('MSFT')
      expect(sectionHeader('Performance so far').getAttribute('aria-expanded')).toBe('true')
      // That open is what ticks step 3.
      expect(opened).toContain('performance')
    } finally {
      window.removeEventListener('outcomes:section-opened', onOpened)
    }
  })

  it('step 2 opens it at Why this decision was made, where the rationale is added', async () => {
    mission.reviewIdeaId = 'd-2'
    render(<DecisionAccountabilityPage />)
    await arrow('thesis')
    expect(openedSymbol()).toContain('MSFT')
    expect(sectionHeader('Why this decision was made').getAttribute('aria-expanded')).toBe('true')
  })

  it('falls back to the first decision when the reviewed one is not listed', async () => {
    mission.reviewIdeaId = 'not-on-this-page'
    render(<DecisionAccountabilityPage />)
    await arrow('performance')
    expect(openedSymbol()).toContain('AAPL')
  })

  it('leaves an already open decision where it is', async () => {
    mission.reviewIdeaId = 'd-2'
    render(<DecisionAccountabilityPage />)
    fireEvent.click(screen.getAllByRole('button', { name: /AAPL/ })[0])
    await arrow('performance')
    expect(openedSymbol()).toContain('AAPL')
    expect(sectionHeader('Performance so far').getAttribute('aria-expanded')).toBe('true')
  })

  it('does nothing when there is no decision to open', async () => {
    rowsRef.rows = []
    render(<DecisionAccountabilityPage />)
    await arrow('performance')
    expect(detailOpen()).toBe(false)
  })
})

describe('phone Outcomes main page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    rowsRef.rows = [makeRow({}), makeRow({ decision_id: 'd-2', asset_symbol: 'MSFT', direction: 'sell', execution_status: 'pending', has_decision_price: false })]
  })
  afterEach(cleanup)

  it('puts the review status in a compact card instead of the loose ATTENTION line', () => {
    render(<DecisionAccountabilityPage />)
    const card = document.querySelector('[data-slot="outcomes-review-status"]') as HTMLElement
    expect(card).not.toBeNull()
    expect(within(card).getByText('To review')).toBeTruthy()
    expect(within(card).getByText('Execution')).toBeTruthy()
    expect(within(card).getByText('Working')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/ATTENTION|Attention ·/)
  })

  it('keeps Decisions / Scorecards and a compact portfolio select in the header', () => {
    render(<DecisionAccountabilityPage />)
    const header = document.querySelector('[data-slot="outcomes-phone-header"]') as HTMLElement
    expect(within(header).getByRole('tab', { name: 'Decisions' })).toBeTruthy()
    expect(within(header).getByRole('tab', { name: 'Scorecards' })).toBeTruthy()
    const select = within(header).getByRole('combobox', { name: 'Portfolio' })
    expect(select.className).toMatch(/\bh-9\b/)
  })
})

describe('decision cards', () => {
  afterEach(cleanup)

  const items = (rows: AccountabilityRow[]) => rows.map(row => ({ row, intel: inferDecisionIntelligence(row) }))

  it('reads action + ticker, portfolio / date, status, with the return and a chevron', () => {
    render(<MobileDecisionLedger items={items([makeRow({})])} selectedId={null} onSelect={() => {}} />)
    const card = document.querySelector('[data-slot="decision-card"]') as HTMLElement
    const order = ['card-action', 'card-ticker', 'card-meta', 'card-status', 'card-result']
      .map(s => card.querySelector(`[data-slot="${s}"]`) as HTMLElement)
    order.forEach(el => expect(el).not.toBeNull())
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(order[0].textContent).toBe('Buy')
    expect(order[1].textContent).toBe('AAPL')
    expect(order[2].textContent).toBe('Global Long-Only Growth Fund · Sep 2, 2026')
    expect(order[3].textContent).toBe(inferDecisionIntelligence(makeRow({})).verdictLabel)
    expect(order[4].textContent).toContain('%')
    expect(card.querySelector('svg.lucide-chevron-right')).not.toBeNull()
  })

  it('shows the real action for every direction, never a dash', () => {
    const rows = (['buy', 'add', 'sell', 'trim', 'short'] as const).map((d, i) => makeRow({ decision_id: `d-${i}`, direction: d }))
    render(<MobileDecisionLedger items={items(rows)} selectedId={null} onSelect={() => {}} />)
    const labels = Array.from(document.querySelectorAll('[data-slot="card-action"]')).map(e => e.textContent)
    expect(labels).toEqual(['Buy', 'Add', 'Sell', 'Trim', 'Short'])
  })

  it('leaves out the "no decision price" footnote and a missed move', () => {
    const row = makeRow({ execution_status: 'pending', has_decision_price: false, impact_proxy: null })
    render(<MobileDecisionLedger items={items([row])} selectedId={null} onSelect={() => {}} />)
    expect(document.body.textContent).not.toMatch(/no decision price|missed|Pending$/)
    expect(document.querySelector('[data-slot="card-result"]')).toBeNull()
  })
})

describe('range control', () => {
  afterEach(cleanup)
  const px = (cls: string, prefix: string) => Number(new RegExp(`${prefix}\\[(\\d+)px\\]`).exec(cls)?.[1] ?? NaN)

  it('fits a 390px screen without scrolling or clipping Custom', () => {
    render(<OutcomesRangeControl filters={{}} onChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'Date range' })
    expect(group.className).not.toMatch(/overflow-x-auto|no-scrollbar/)
    const presets = within(group).getAllByRole('radio')
    expect(presets.map(p => p.textContent)).toEqual(['7D', '30D', '90D', 'QTD', 'YTD', '1Y', 'All'])
    const custom = screen.getByRole('button', { name: 'Custom range' })
    // Minimum drawn width: presets + track padding + gap + the 36px calendar button.
    const width = presets.reduce((s, p) => s + px(p.className, 'min-w-'), 0) + 4 + 6 + 36
    expect(custom.className).toMatch(/\bw-9\b/)
    expect(width).toBeLessThanOrEqual(390 - 24) // page gutter px-3 each side
  })

  it('selects a preset, and opens Custom inline rather than as a popover', () => {
    const onChange = vi.fn()
    render(<OutcomesRangeControl filters={{}} onChange={onChange} />)
    expect(within(screen.getByRole('radiogroup', { name: 'Date range' })).getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '90D' }))
    expect(onChange.mock.calls[0][0].dateRange.start).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    const custom = document.querySelector('[data-slot="outcomes-range-custom"]') as HTMLElement
    expect(custom.className).not.toMatch(/\babsolute\b|\bfixed\b/)
    fireEvent.change(within(custom).getByLabelText('From'), { target: { value: '2026-01-01' } })
    fireEvent.click(within(custom).getByRole('button', { name: 'Apply' }))
    expect(onChange.mock.calls[1][0].dateRange.start).toBe(new Date('2026-01-01').toISOString())
  })
})
