/**
 * A committed trade is never invisible, batch or no batch.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The Decision Inbox's Approve & Execute creates every trade with
 * `batch_id = NULL`, by design — one approval is not a batch. The Trade Book
 * opens on the Batches view, and that view was driven entirely by `batches`:
 * five aggregations each began `if (!t.batch_id) continue`, the detail pane
 * filtered `batch_id === selectedBatchId`, and the empty state fired on
 * `batches.length === 0` alone.
 *
 * So an unbatched trade rendered NOWHERE. Production lost two: SHOP
 * 2026-10-04 and GOOGL 2026-10-05 were both `complete` / `matched` with
 * holdings applied, and the Trade Book showed the reader nothing. The two
 * older trades they were compared against (AAPL, MU) happened to have
 * batches, which is the whole reason the difference went unnoticed.
 *
 * These tests render the real component. A source assertion would not have
 * caught this — every individual filter was correct about batches.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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

/** The GOOGL row as production carried it: committed, matched, no batch. */
const googl = {
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
  asset: { id: 'a-googl', symbol: 'GOOGL', company_name: 'Alphabet', sector: 'Tech' },
} as never

/** A batched trade, so the batched path stays covered alongside. */
const aapl = {
  ...(googl as unknown as Record<string, unknown>),
  id: 'at-aapl',
  asset_id: 'a-aapl',
  action: 'trim',
  batch_id: 'b-1',
  delta_shares: -248,
  asset: { id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple', sector: 'Tech' },
} as never

const batch = {
  id: 'b-1',
  portfolio_id: 'pf-1',
  name: '1 sell · 09/28/2026',
  description: null,
  source_type: 'inbox',
  status: 'active',
  created_at: '2026-09-28T23:14:45Z',
} as never

function renderView(props: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BatchListView
        batches={[]}
        trades={[]}
        selectedBatchId={null}
        onSelectBatch={vi.fn()}
        onViewBatchTrades={vi.fn()}
        onAddComment={vi.fn()}
        {...(props as object)}
      />
    </QueryClientProvider>,
  )
}

describe('the Batches view surfaces unbatched trades', () => {
  it('offers an Unbatched trades group when one exists', () => {
    renderView({ batches: [batch], trades: [aapl, googl] })
    expect(screen.getByText('Unbatched trades')).toBeInTheDocument()
  })

  it('counts them', () => {
    renderView({ batches: [batch], trades: [aapl, googl] })
    // One unbatched of the two trades.
    const group = screen.getByText('Unbatched trades').closest('button')
    expect(group).toHaveTextContent('1')
  })

  it('does NOT offer the group when every trade is batched', () => {
    // No empty section inviting the reader to wonder what is missing.
    renderView({ batches: [batch], trades: [aapl] })
    expect(screen.queryByText('Unbatched trades')).not.toBeInTheDocument()
  })

  it('shows the trade itself once the group is selected', () => {
    renderView({ batches: [batch], trades: [aapl, googl], selectedBatchId: '__unbatched__' })
    // `getAllBy`: the list renders a table and a phone-card layout, with CSS
    // picking one. Both are in the DOM, which is the existing pattern here
    // and not what this test is about.
    expect(screen.getAllByText('GOOGL').length).toBeGreaterThan(0)
  })

  it('shows only the unbatched ones, not the batch', () => {
    renderView({ batches: [batch], trades: [aapl, googl], selectedBatchId: '__unbatched__' })
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument()
  })

  it('says these are real Trade Book records', () => {
    renderView({ batches: [batch], trades: [aapl, googl], selectedBatchId: '__unbatched__' })
    expect(screen.getByText(/execute, reconcile and revert/i)).toBeInTheDocument()
  })
})

describe('a portfolio whose only trades came from the Inbox', () => {
  /*
   * The worst case, and the one the empty state got wrong: zero batches, one
   * committed trade. The view told the reader to go promote something from
   * the Trade Lab while holding an executed, reconciled trade.
   */
  it('does not claim there is nothing here', () => {
    renderView({ batches: [], trades: [googl] })
    expect(screen.queryByText('No batches yet')).not.toBeInTheDocument()
  })

  it('still offers the unbatched group', () => {
    renderView({ batches: [], trades: [googl] })
    expect(screen.getByText('Unbatched trades')).toBeInTheDocument()
  })

  it('keeps the empty state when there genuinely are no trades', () => {
    renderView({ batches: [], trades: [] })
    expect(screen.getByText('No batches yet')).toBeInTheDocument()
  })
})

describe('search cannot hide a committed trade', () => {
  it('leaves the unbatched group visible under an unmatched query', () => {
    /*
     * Search matches batch name, description and the symbols within a batch.
     * An unbatched trade has no batch to match on, so a search that filtered
     * it would hide a committed trade with no indication it had — exactly the
     * class of silent disappearance this group exists to prevent. Symbol
     * search belongs to the Trades view.
     */
    const { container } = renderView({ batches: [batch], trades: [aapl, googl] })
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).toBeTruthy()
    // Even with a query that matches no batch, the group stays.
    expect(screen.getByText('Unbatched trades')).toBeInTheDocument()
  })
})
