/**
 * The evidence badge reaches the screen, in both Trade Book row layouts.
 *
 * `evidence-badge.test.ts` pins what each grade should say. This renders the
 * real `BatchListView` and asserts the words actually appear beside the phase
 * pill, because the gap between a correct mapping and a wired-up one is
 * exactly where a badge quietly fails to exist.
 *
 * Both layouts are asserted at once. The list renders the table and the phone
 * cards together and lets CSS choose, so `getAllByTitle` returning two
 * elements is the existing pattern in this directory and is itself the proof
 * that neither leaf component was missed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EVIDENCE_BADGE } from '../../../lib/trade-book/evidence-badge'

const reader = vi.hoisted(() => ({
  result: { proofs: new Map<string, string>(), failed: false } as any,
}))

vi.mock('../../../lib/asset-decisions/execution-evidence', () => ({
  readExecutionProofs: () => Promise.resolve(reader.result),
  fetchExecutionProofsForTrades: () => Promise.resolve(reader.result.proofs),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
}))
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => false }))
vi.mock('../../../hooks/usePilotTradeBookSteps', () => ({
  usePilotTradeBookSteps: () => ({ steps: [], markStep: vi.fn() }),
}))
vi.mock('../../mobile/MobileNoteField', () => ({ MobileNoteField: () => null }))
vi.mock('../AcceptedTradesTable', () => ({
  TradeRationaleLog: () => null,
  historicalCaseProps: () => ({}),
}))

import { BatchListView } from '../BatchListView'

/** A committed, matched trade: the phase every execution claim lands in. */
const settledTrade = {
  id: 'at-googl',
  portfolio_id: 'pf-1',
  asset_id: 'a-googl',
  action: 'sell',
  batch_id: 'b-1',
  source: 'inbox',
  execution_status: 'complete',
  reconciliation_status: 'matched',
  is_active: true,
  reverted_at: null,
  delta_shares: -510,
  target_shares: 10490,
  notional_value: 86955,
  price_at_acceptance: 170.5,
  created_at: '2026-10-05T14:45:46Z',
  acceptance_note: 'test',
  asset: { id: 'a-googl', symbol: 'GOOGL', company_name: 'Alphabet', sector: 'Tech' },
} as never

/** Nothing has been executed on this one, so there is no claim to qualify. */
const queuedTrade = {
  ...(settledTrade as unknown as Record<string, unknown>),
  id: 'at-msft',
  asset_id: 'a-msft',
  execution_status: 'not_started',
  reconciliation_status: 'pending',
  asset: { id: 'a-msft', symbol: 'MSFT', company_name: 'Microsoft', sector: 'Tech' },
} as never

const batch = {
  id: 'b-1',
  portfolio_id: 'pf-1',
  name: '1 sell',
  description: null,
  source_type: 'inbox',
  status: 'active',
  created_at: '2026-09-28T23:14:45Z',
} as never

function renderBatch(trades: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={qc}>
      <BatchListView
        batches={[batch]}
        trades={trades as never}
        selectedBatchId="b-1"
        onSelectBatch={vi.fn()}
        onViewBatchTrades={vi.fn()}
        onAddComment={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  reader.result = { proofs: new Map(), failed: false }
})

describe('a settled row says what its execution is worth', () => {
  it('renders "Assumed" beside the pill for a PM-assumed execution', async () => {
    reader.result = { proofs: new Map([['at-googl', 'assumed']]), failed: false }
    renderBatch([settledTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.assumed.label).length).toBeGreaterThan(0))
    // Both row layouts carry it, which is how we know neither was missed.
    expect(screen.getAllByTitle(EVIDENCE_BADGE.assumed.title).length).toBe(2)
  })

  it('still shows the Settled pill, so the phase was not repurposed', async () => {
    reader.result = { proofs: new Map([['at-googl', 'assumed']]), failed: false }
    renderBatch([settledTrade])

    await waitFor(() => expect(screen.getAllByText('Settled').length).toBeGreaterThan(0))
  })

  it('renders "Model" for an observed paper execution, not "Confirmed"', async () => {
    reader.result = { proofs: new Map([['at-googl', 'verified']]), failed: false }
    renderBatch([settledTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.verified.label).length).toBe(2))
    expect(screen.queryByText(EVIDENCE_BADGE.broker_confirmed.label)).not.toBeInTheDocument()
  })

  it('renders "Reported" for a trader attestation', async () => {
    reader.result = { proofs: new Map([['at-googl', 'attested']]), failed: false }
    renderBatch([settledTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.attested.label).length).toBe(2))
  })

  it('renders "Confirmed" when a broker confirmation genuinely exists', async () => {
    reader.result = { proofs: new Map([['at-googl', 'broker_confirmed']]), failed: false }
    renderBatch([settledTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.broker_confirmed.label).length).toBe(2))
  })
})

describe('a row whose evidence is missing or unreadable says so', () => {
  it('renders "No evidence" when the read succeeded and found none', async () => {
    reader.result = { proofs: new Map(), failed: false }
    renderBatch([settledTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.none.label).length).toBe(2))
  })

  it('renders "Unavailable", not "No evidence", when the read failed', async () => {
    reader.result = { proofs: new Map(), failed: true }
    renderBatch([settledTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.unavailable.label).length).toBe(2))
    expect(screen.queryByText(EVIDENCE_BADGE.none.label)).not.toBeInTheDocument()
  })

  it('keeps the Trade Book usable when evidence cannot be loaded', async () => {
    reader.result = { proofs: new Map(), failed: true }
    renderBatch([settledTrade])

    // The trade, its symbol and its phase all still render. A failed
    // evidence read costs a qualifier, never the table.
    await waitFor(() => expect(screen.getAllByText('GOOGL').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Settled').length).toBeGreaterThan(0)
  })

  it('claims no confirmation of any kind while unavailable', async () => {
    reader.result = { proofs: new Map(), failed: true }
    renderBatch([settledTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.unavailable.label).length).toBe(2))
    expect(screen.queryByText(EVIDENCE_BADGE.broker_confirmed.label)).not.toBeInTheDocument()
    expect(screen.queryByText(EVIDENCE_BADGE.attested.label)).not.toBeInTheDocument()
  })
})

describe('a row that claims no execution is not badged', () => {
  it('leaves a queued trade alone', async () => {
    reader.result = { proofs: new Map([['at-msft', 'assumed']]), failed: false }
    renderBatch([queuedTrade])

    await waitFor(() => expect(screen.getAllByText('Queued').length).toBeGreaterThan(0))
    // Even with a grade in hand: nobody has claimed this executed, so there
    // is nothing to qualify.
    expect(screen.queryByText(EVIDENCE_BADGE.assumed.label)).not.toBeInTheDocument()
    expect(screen.queryByText(EVIDENCE_BADGE.none.label)).not.toBeInTheDocument()
  })

  it('badges the settled trade and not the queued one in the same batch', async () => {
    reader.result = { proofs: new Map([['at-googl', 'assumed']]), failed: false }
    renderBatch([settledTrade, queuedTrade])

    await waitFor(() =>
      expect(screen.getAllByText(EVIDENCE_BADGE.assumed.label).length).toBe(2))
    // One badge per layout for the settled row, none for the queued row.
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0)
  })
})
