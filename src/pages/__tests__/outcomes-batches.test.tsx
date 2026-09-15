/**
 * Batch-aware Outcomes.
 *
 * The batch is the container a decision was committed in; each trade keeps its
 * own outcome. Pins the model (grouping, status mix, when a $ P&L may be
 * totalled, no batch return %), the search across batch / ticker / company,
 * and the phone and desktop views built on it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'

const viewport = vi.hoisted(() => ({ phone: true }))
const rowsRef = vi.hoisted(() => ({ rows: [] as unknown[] }))

vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: () => viewport.phone }))
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
vi.mock('../../hooks/usePilotMission', () => ({ usePilotMission: () => ({}) }))

const mutation = { mutate: () => {}, isPending: false, isError: false, error: null }
vi.mock('../../hooks/useDecisionAccountability', () => ({
  useDecisionAccountability: () => ({ rows: rowsRef.rows, unmatchedExecutions: [], summary: {}, isLoading: false, isError: false, refetch: () => {} }),
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
  useDecisionReviewsByIds: () => ({ data: new Map() }),
  useUpsertDecisionReview: () => mutation,
}))
vi.mock('../../hooks/usePositionLifecycle', () => ({
  usePositionLifecycle: () => ({ data: null, isLoading: false }),
  usePositionPriceHistory: () => ({ data: [], isLoading: false }),
  useHoldingsTimeSeries: () => ({ data: [] }),
}))

import { DecisionAccountabilityPage } from '../DecisionAccountabilityPage'
import { inferDecisionIntelligence } from '../../lib/decision-intelligence'
import {
  batchesByDecision, batchPnlText, groupByBatch, rowMatchesSearch, statusMixText,
} from '../../lib/outcomes/batch-groups'
import type { AccountabilityRow, RowBatch } from '../../types/decision-accountability'

const Q3: RowBatch = { id: 'b-q3', name: 'Q3 rebalance', committedAt: '2026-09-05T15:00:00Z' }
const TECH: RowBatch = { id: 'b-tech', name: 'Trim tech', committedAt: '2026-09-08T15:00:00Z' }

function makeRow(over: Partial<AccountabilityRow>): AccountabilityRow {
  return {
    decision_id: 'd-1', created_at: '2026-09-01T12:00:00Z', approved_at: '2026-09-02T12:00:00Z',
    source: 'trade_queue', category: 'acted', direction: 'buy', stage: 'approved',
    rationale_text: 'Margins inflect.', decision_note: null, deferred_until: null,
    asset_id: 'a-1', asset_symbol: 'AAPL', asset_name: 'Apple Inc.', portfolio_id: 'p-1',
    portfolio_name: 'Growth Fund', owner_name: 'PM', approver_name: 'PM',
    execution_status: 'executed', matched_executions: [], execution_lag_days: 1, days_since_decision: 12,
    decision_price: 185, decision_price_at: '2026-09-02T12:00:00Z', has_decision_price: true,
    current_price: 200, execution_price: 190, move_since_decision_pct: 8.1, move_since_execution_pct: 5.3,
    result_direction: 'positive', delay_cost_pct: null, trade_notional: 19000, size_basis: 'market_value_delta',
    weight_impact: 0.5, impact_proxy: 1500, weighted_delay_cost: null,
    batches: [],
    ...over,
  } as unknown as AccountabilityRow
}

const item = (row: AccountabilityRow) => ({ row, intel: inferDecisionIntelligence(row) })

// Q3 rebalance: AAPL (+$1,500), MSFT (+$500). Trim tech: NVDA (no P&L).
// ORCL is in no batch.
const AAPL = makeRow({ decision_id: 'd-aapl', batches: [Q3] })
const MSFT = makeRow({ decision_id: 'd-msft', asset_symbol: 'MSFT', asset_name: 'Microsoft Corp', impact_proxy: 500, batches: [Q3] })
const NVDA = makeRow({ decision_id: 'd-nvda', asset_symbol: 'NVDA', asset_name: 'NVIDIA', direction: 'trim', impact_proxy: null, batches: [TECH] })
const ORCL = makeRow({ decision_id: 'd-orcl', asset_symbol: 'ORCL', asset_name: 'Oracle', batches: [] })

describe('batch model', () => {
  it('reads each decision’s batches from the payload, once per batch, newest first', () => {
    const map = batchesByDecision([
      { trade_queue_item_id: 'd-1', batch_id: 'b-old', batch_name: ' Old ', batch_created_at: '2026-01-01T00:00:00Z' },
      { trade_queue_item_id: 'd-1', batch_id: 'b-new', batch_name: null, batch_created_at: '2026-06-01T00:00:00Z' },
      { trade_queue_item_id: 'd-1', batch_id: 'b-new', batch_name: null, batch_created_at: '2026-06-01T00:00:00Z' },
      { trade_queue_item_id: 'd-2', batch_id: null },
      { trade_queue_item_id: null, batch_id: 'b-x' },
    ])
    expect(map.get('d-1')).toEqual([
      { id: 'b-new', name: null, committedAt: '2026-06-01T00:00:00Z' },
      { id: 'b-old', name: 'Old', committedAt: '2026-01-01T00:00:00Z' },
    ])
    expect(map.has('d-2')).toBe(false)
  })

  it('groups by batch and keeps unbatched decisions standalone', () => {
    const { groups, standalone } = groupByBatch([AAPL, MSFT, NVDA, ORCL].map(item))
    expect(groups.map(g => g.batch.id)).toEqual(['b-tech', 'b-q3'])
    expect(groups.find(g => g.batch.id === 'b-q3')!.items.map(i => i.row.asset_symbol)).toEqual(['AAPL', 'MSFT'])
    expect(standalone.map(i => i.row.asset_symbol)).toEqual(['ORCL'])
  })

  it('totals $ P&L only when every trade has one', () => {
    const { groups } = groupByBatch([AAPL, MSFT, NVDA].map(item))
    expect(groups.find(g => g.batch.id === 'b-q3')!.pnl).toEqual({ kind: 'total', value: 2000 })
    expect(groups.find(g => g.batch.id === 'b-tech')!.pnl).toEqual({ kind: 'none' })

    const partial = groupByBatch([AAPL, makeRow({ decision_id: 'd-x', asset_symbol: 'X', impact_proxy: null, batches: [Q3] })].map(item))
    expect(partial.groups[0].pnl).toEqual({ kind: 'partial', known: 1, of: 2 })
    expect(batchPnlText(partial.groups[0].pnl)).toBe('P&L partial · 1 of 2')
  })

  it('does not total a trade that was committed in more than one batch', () => {
    const shared = makeRow({ decision_id: 'd-shared', asset_symbol: 'AMZN', impact_proxy: 900, batches: [Q3, TECH] })
    const { groups } = groupByBatch([AAPL, shared].map(item))
    // AMZN appears under both batches…
    expect(groups.map(g => g.items.map(i => i.row.asset_symbol).sort())).toEqual([['AMZN'], ['AAPL', 'AMZN']])
    // …but its $900 is not counted into either.
    for (const g of groups) expect(g.pnl.kind).not.toBe('total')
  })

  it('never states a batch return percentage', () => {
    const { groups } = groupByBatch([AAPL, MSFT, NVDA].map(item))
    for (const g of groups) {
      expect(batchPnlText(g.pnl) ?? '').not.toContain('%')
      expect(Object.keys(g)).not.toContain('returnPct')
    }
  })

  it('states the status mix from each trade’s own verdict', () => {
    const { groups } = groupByBatch([AAPL, MSFT].map(item))
    const label = inferDecisionIntelligence(AAPL).verdictLabel
    expect(statusMixText(groups[0].statusMix)).toBe(`2 ${label}`)
  })

  it('searches batch name, ticker and company', () => {
    expect(rowMatchesSearch(AAPL, 'q3 reb')).toBe(true)
    expect(rowMatchesSearch(AAPL, 'aapl')).toBe(true)
    expect(rowMatchesSearch(MSFT, 'microsoft')).toBe(true)
    expect(rowMatchesSearch(ORCL, 'q3')).toBe(false)

    // A batch-name match keeps the whole batch; a ticker match keeps only it.
    const byName = groupByBatch([AAPL, MSFT, NVDA, ORCL].map(item), 'q3')
    expect(byName.groups.map(g => [g.batch.id, g.matches.length])).toEqual([['b-q3', 2]])
    expect(byName.standalone).toHaveLength(0)
    const byTicker = groupByBatch([AAPL, MSFT, NVDA, ORCL].map(item), 'msft')
    expect(byTicker.groups.map(g => [g.batch.id, g.matches.map(i => i.row.asset_symbol), g.items.length])).toEqual([['b-q3', ['MSFT'], 2]])
    expect(groupByBatch([AAPL, ORCL].map(item), 'oracle').standalone.map(i => i.row.asset_symbol)).toEqual(['ORCL'])
  })

  it('is fed from the payload by the Outcomes hook, for decision rows only', () => {
    const hook = readFileSync(path.join(process.cwd(), 'src/hooks/useDecisionAccountability.ts'), 'utf8')
    expect(hook).toContain('const batchMap = batchesByDecision(outcomesPayloadQuery.data?.acceptedTrades ?? [])')
    expect(hook).toContain('return [...withBatches, ...discretionaryRows, ...passedRows]')
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/20260915020244_outcomes_payload_batches.sql'), 'utf8')
    expect(sql).toContain('at.batch_id,')
    expect(sql).toContain('tb.name AS batch_name,')
    expect(sql).toContain('tb.created_at AS batch_created_at,')
    expect(sql).toContain('LEFT JOIN trade_batches tb ON tb.id = at.batch_id')
    // Still SECURITY INVOKER: the function header declares no definer rights.
    const header = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'), sql.indexOf('AS $function$'))
    expect(header).not.toMatch(/SECURITY\s+DEFINER/i)
  })
})

describe('phone: Batches | Trades', () => {
  beforeEach(() => {
    viewport.phone = true
    sessionStorage.clear()
    rowsRef.rows = [AAPL, MSFT, NVDA, ORCL]
  })
  afterEach(cleanup)

  const batchCard = (name: string) =>
    Array.from(document.querySelectorAll('[data-slot="batch-card"]')).find(c => c.querySelector('[data-slot="batch-name"]')?.textContent === name) as HTMLElement

  it('defaults to Batches with one card per batch and the unbatched decisions below', () => {
    render(<DecisionAccountabilityPage />)
    expect(screen.getByRole('tab', { name: 'Batches' }).getAttribute('aria-selected')).toBe('true')
    const q3 = batchCard('Q3 rebalance')
    expect(within(q3).getByText('Growth Fund · Sep 5, 2026')).toBeTruthy()
    expect(q3.querySelector('[data-slot="batch-count"]')!.textContent).toBe('2 trades')
    expect(q3.querySelector('[data-slot="batch-status-mix"]')!.textContent).toMatch(/^2 /)
    expect(q3.querySelector('[data-slot="batch-pnl"]')!.textContent).toBe('+$2.0K P&L')
    expect(batchCard('Trim tech').querySelector('[data-slot="batch-pnl"]')).toBeNull()
    expect(q3.textContent).not.toMatch(/\d%/)

    const standalone = document.querySelector('[data-slot="standalone-decisions"]') as HTMLElement
    expect(within(standalone).getByText('ORCL')).toBeTruthy()
  })

  it('opens a batch to its trades, a trade to its detail, and Back to the batches', () => {
    render(<DecisionAccountabilityPage />)
    fireEvent.click(batchCard('Q3 rebalance'))
    const view = document.querySelector('[data-slot="batch-view"]') as HTMLElement
    expect(Array.from(view.querySelectorAll('[data-slot="card-ticker"]')).map(e => e.textContent)).toEqual(['AAPL', 'MSFT'])
    // Inside a batch the trade card does not repeat the batch name.
    expect(view.querySelector('[data-slot="card-batch"]')).toBeNull()

    fireEvent.click(within(view).getAllByRole('button', { name: /MSFT/ })[0])
    expect(screen.getByRole('button', { name: 'Close detail' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close detail' }))

    fireEvent.click(within(view).getByRole('button', { name: /Batches/ }))
    expect(document.querySelector('[data-slot="batch-view"]')).toBeNull()
    expect(batchCard('Q3 rebalance')).toBeTruthy()
  })

  it('returns from an opened batch on the Back gesture', () => {
    render(<DecisionAccountabilityPage />)
    fireEvent.click(batchCard('Q3 rebalance'))
    act(() => {
      window.history.replaceState({}, '')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(document.querySelector('[data-slot="batch-view"]')).toBeNull()
  })

  it('searches by ticker in Batches: the batch shows how many of its trades match', () => {
    render(<DecisionAccountabilityPage />)
    fireEvent.change(screen.getByRole('searchbox', { name: /Search batches/ }), { target: { value: 'msft' } })
    const cards = document.querySelectorAll('[data-slot="batch-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].querySelector('[data-slot="batch-count"]')!.textContent).toBe('1 of 2 trades match')
    expect(document.querySelector('[data-slot="standalone-decisions"]')).toBeNull()

    fireEvent.click(cards[0])
    const view = document.querySelector('[data-slot="batch-view"]') as HTMLElement
    expect(Array.from(view.querySelectorAll('[data-slot="card-ticker"]')).map(e => e.textContent)).toEqual(['MSFT'])
    fireEvent.click(within(view).getByRole('button', { name: 'Show all' }))
    expect(view.querySelectorAll('[data-slot="card-ticker"]')).toHaveLength(2)
  })

  it('searches by batch name in Trades, and names each trade’s batch', () => {
    render(<DecisionAccountabilityPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Trades' }))
    expect(document.querySelectorAll('[data-slot="decision-card"]')).toHaveLength(4)
    const aapl = Array.from(document.querySelectorAll('[data-slot="decision-card"]')).find(c => c.textContent?.includes('AAPL'))!
    expect(aapl.querySelector('[data-slot="card-batch"]')!.textContent).toBe('Q3 rebalance')

    fireEvent.change(screen.getByRole('searchbox', { name: /Search batches/ }), { target: { value: 'trim tech' } })
    expect(Array.from(document.querySelectorAll('[data-slot="card-ticker"]')).map(e => e.textContent)).toEqual(['NVDA'])

    fireEvent.change(screen.getByRole('searchbox', { name: /Search batches/ }), { target: { value: 'oracle' } })
    expect(Array.from(document.querySelectorAll('[data-slot="card-ticker"]')).map(e => e.textContent)).toEqual(['ORCL'])
  })
})

describe('desktop: Batches | Trades', () => {
  beforeEach(() => {
    viewport.phone = false
    sessionStorage.clear()
    rowsRef.rows = [AAPL, MSFT, NVDA, ORCL]
  })
  afterEach(cleanup)

  it('defaults to Trades, and Batches expands a batch to its table rows', () => {
    render(<DecisionAccountabilityPage />)
    expect(screen.getByRole('tab', { name: 'Trades' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Batches' }))
    const rows = document.querySelectorAll('[data-slot="desktop-batch-row"]')
    expect(rows).toHaveLength(2)
    const q3 = Array.from(rows).find(r => r.textContent?.includes('Q3 rebalance')) as HTMLElement
    expect(q3.textContent).toContain('2 trades')
    expect(q3.textContent).toContain('+$2.0K P&L')
    expect(q3.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(q3)
    expect(q3.getAttribute('aria-expanded')).toBe('true')
    const container = q3.parentElement as HTMLElement
    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('MSFT')
    expect(document.querySelector('[data-slot="desktop-standalone"]')!.textContent).toContain('ORCL')
  })
})
