/**
 * The third Trade Book consumer: the committed-trades table's State column.
 *
 * `BatchListView`'s two row layouts are covered in
 * `trade-book-evidence-badge.test.tsx`. This is the Trades view, the surface
 * a PM actually scans down, and it is the one place where a missing badge
 * would be least noticed and most consequential: the column is literally
 * headed "State", and before this change "Settled" was the whole answer.
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
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }))
vi.mock('../../../hooks/useAcceptedTrades', () => ({
  useAcceptedTradeComments: () => ({ data: [] }),
}))
vi.mock('../../mobile/MobileNoteField', () => ({ MobileNoteField: () => null }))

import { AcceptedTradesTable } from '../AcceptedTradesTable'

const settledTrade = {
  id: 'at-googl',
  portfolio_id: 'pf-1',
  asset_id: 'a-googl',
  action: 'sell',
  batch_id: null,
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
  reconciliation_detail: null,
  asset: { id: 'a-googl', symbol: 'GOOGL', company_name: 'Alphabet', sector: 'Tech' },
} as never

function renderTable(trades: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={qc}>
      <AcceptedTradesTable
        trades={trades as never}
        batches={[] as never}
        holdingsSource={'manual_eod' as never}
        onUpdateExecutionStatus={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  reader.result = { proofs: new Map(), failed: false }
})

describe('the State column qualifies the execution it reports', () => {
  it('shows "Assumed" next to Settled for a PM-assumed execution', async () => {
    reader.result = { proofs: new Map([['at-googl', 'assumed']]), failed: false }
    renderTable([settledTrade])

    await waitFor(() =>
      expect(screen.getByTitle(EVIDENCE_BADGE.assumed.title)).toBeInTheDocument())
    expect(screen.getAllByText('Settled').length).toBeGreaterThan(0)
  })

  it('shows "Model" for an observed paper execution and never "Confirmed"', async () => {
    reader.result = { proofs: new Map([['at-googl', 'verified']]), failed: false }
    renderTable([settledTrade])

    await waitFor(() =>
      expect(screen.getByText(EVIDENCE_BADGE.verified.label)).toBeInTheDocument())
    expect(screen.queryByText(EVIDENCE_BADGE.broker_confirmed.label)).not.toBeInTheDocument()
  })

  it('shows "Reported" for a trader attestation', async () => {
    reader.result = { proofs: new Map([['at-googl', 'attested']]), failed: false }
    renderTable([settledTrade])

    await waitFor(() =>
      expect(screen.getByText(EVIDENCE_BADGE.attested.label)).toBeInTheDocument())
  })

  it('shows "Confirmed" only when a broker confirmation is recorded', async () => {
    reader.result = { proofs: new Map([['at-googl', 'broker_confirmed']]), failed: false }
    renderTable([settledTrade])

    await waitFor(() =>
      expect(screen.getByText(EVIDENCE_BADGE.broker_confirmed.label)).toBeInTheDocument())
  })

  it('distinguishes no evidence from unreadable evidence', async () => {
    reader.result = { proofs: new Map(), failed: false }
    const { unmount } = renderTable([settledTrade])
    await waitFor(() =>
      expect(screen.getByText(EVIDENCE_BADGE.none.label)).toBeInTheDocument())
    unmount()

    reader.result = { proofs: new Map(), failed: true }
    renderTable([settledTrade])
    await waitFor(() =>
      expect(screen.getByText(EVIDENCE_BADGE.unavailable.label)).toBeInTheDocument())
    expect(screen.queryByText(EVIDENCE_BADGE.none.label)).not.toBeInTheDocument()
  })

  it('still renders the trade when the evidence read fails', async () => {
    reader.result = { proofs: new Map(), failed: true }
    renderTable([settledTrade])

    await waitFor(() => expect(screen.getAllByText('GOOGL').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Settled').length).toBeGreaterThan(0)
  })
})
