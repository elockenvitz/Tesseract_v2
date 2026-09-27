/**
 * The standalone Trades list on a phone.
 *
 * Two claims worth pinning. A trade must be readable without a sideways drag —
 * the desktop surface is a 720px twelve-column table and the phone got it
 * verbatim. And the execution status, which is the one writable thing on a
 * trade, must be reachable: it used to sit in the twelfth column, present in
 * the DOM and unreachable in practice.
 *
 * The write gates are the caller's, not this component's, so the tests check
 * that it honours what it is given rather than that it re-derives permission.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MobileTradeRows } from '../MobileTradeRows'
import type { AcceptedTradeWithJoins } from '../../../types/trading'

function makeTrade(over: Partial<AcceptedTradeWithJoins> = {}): AcceptedTradeWithJoins {
  return {
    id: 't1',
    portfolio_id: 'p1',
    asset_id: 'a1',
    action: 'buy',
    sizing_input: '2.5',
    sizing_spec: null,
    target_weight: 2.5,
    target_shares: null,
    delta_weight: 0.45,
    delta_shares: 3_200,
    // Stored unsigned, as the column is.
    notional_value: 1_200_000,
    price_at_acceptance: null,
    source: 'inbox',
    execution_status: 'not_started',
    reconciliation_status: 'pending',
    batch_id: null,
    acceptance_note: null,
    created_at: '2026-09-01T00:00:00Z',
    asset: { id: 'a1', symbol: 'AAPL', company_name: 'Apple Inc', sector: null },
    ...over,
  } as AcceptedTradeWithJoins
}

const noop = () => {}

describe('a trade reads without a sideways drag', () => {
  it('leads with the symbol, the action and the size', () => {
    render(<MobileTradeRows trades={[makeTrade()]} selectedTradeId={null} onSelect={noop} />)

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('buy')).toBeInTheDocument()
    expect(screen.getByText('$1.2M')).toBeInTheDocument()
  })

  it('shows the weight change and the share change', () => {
    render(<MobileTradeRows trades={[makeTrade()]} selectedTradeId={null} onSelect={noop} />)

    expect(screen.getByText('+0.45%')).toBeInTheDocument()
    expect(screen.getByText(/\+3,200 sh/)).toBeInTheDocument()
    expect(screen.getByText('2.50%')).toBeInTheDocument()
  })

  it('renders a sell as a reduction, not as a positive amount', () => {
    // The row must apply the sign from the action; the stored value is unsigned.
    render(
      <MobileTradeRows
        trades={[makeTrade({ action: 'sell', notional_value: 1_200_000, delta_weight: -0.45 })]}
        selectedTradeId={null}
        onSelect={noop}
      />,
    )
    expect(screen.getByText('-$1.2M')).toBeInTheDocument()
    expect(screen.queryByText('$1.2M')).toBeNull()
  })

  it('keeps the exact figure available rather than losing it to abbreviation', () => {
    render(<MobileTradeRows trades={[makeTrade()]} selectedTradeId={null} onSelect={noop} />)
    expect(screen.getByText('$1.2M')).toHaveAttribute('title', '$1,200,000')
  })

  it('renders no table', () => {
    render(<MobileTradeRows trades={[makeTrade()]} selectedTradeId={null} onSelect={noop} />)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says so when the filters match nothing', () => {
    render(<MobileTradeRows trades={[]} selectedTradeId={null} onSelect={noop} />)
    expect(screen.getByText(/No trades match/)).toBeInTheDocument()
  })

  it('opens the detail for the trade that was tapped', () => {
    const onSelect = vi.fn()
    render(
      <MobileTradeRows
        trades={[makeTrade({ id: 'a' }), makeTrade({ id: 'b', asset: { id: 'a2', symbol: 'MSFT', company_name: 'Microsoft', sector: null } })]}
        selectedTradeId={null}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByText('MSFT'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })
})

describe('execution status is reachable, and only writable when permitted', () => {
  it('offers the control when the caller says the user may write', () => {
    const onUpdate = vi.fn()
    render(
      <MobileTradeRows
        trades={[makeTrade()]}
        selectedTradeId={null}
        onSelect={noop}
        canUpdateExecution
        onUpdateExecutionStatus={onUpdate}
      />,
    )
    // Present in the row itself, not twelve columns away.
    const row = document.querySelector('[data-slot="mobile-trade-row"]') as HTMLElement
    expect(within(row).getByText('Not Started')).toBeInTheDocument()
  })

  it('shows the state read-only when the caller withholds the write', () => {
    // Withholding the write must not hide the status — a trader still needs
    // to know where the trade stands.
    render(
      <MobileTradeRows
        trades={[makeTrade()]}
        selectedTradeId={null}
        onSelect={noop}
        canUpdateExecution={false}
        onUpdateExecutionStatus={vi.fn()}
        renderState={() => <span>Queued</span>}
      />,
    )
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })

  it('withholds the write in a terminal phase, as the table does', () => {
    render(
      <MobileTradeRows
        trades={[makeTrade({ execution_status: 'complete' })]}
        selectedTradeId={null}
        onSelect={noop}
        canUpdateExecution
        onUpdateExecutionStatus={vi.fn()}
        isTerminalPhase={() => true}
        renderState={() => <span>Settled</span>}
      />,
    )
    expect(screen.getByText('Settled')).toBeInTheDocument()
  })

  it('never invents permission the caller did not grant', () => {
    render(
      <MobileTradeRows
        trades={[makeTrade()]}
        selectedTradeId={null}
        onSelect={noop}
        renderState={() => <span>Queued</span>}
      />,
    )
    // No handler passed at all — the status is shown, nothing is writable.
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.queryByText('Not Started')).toBeNull()
  })
})
