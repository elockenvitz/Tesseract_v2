/**
 * The mobile List row.
 *
 * Pinned because of what it used to show: status, assignee and tags, and no
 * investment state at all. The one thing a list is for — knowing which name
 * needs a look — was only reachable by opening every row, which on a phone is
 * the most expensive gesture available.
 *
 * So the assertions are about PRIORITY, not mere presence: investment state
 * has to be on the row, and the list's own process metadata has to come after
 * it. Asserting presence alone would pass against the version that put tags
 * first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const hooks = vi.hoisted(() => ({
  signal: {
    state: null as any, subject: null as any, weightPct: null as number | null,
    closes: null as number[] | null, ratingValue: null as string | null,
    ratingColor: null as string | null, conviction: null as any,
    targetPrice: null as number | null,
  },
}))

vi.mock('../../../hooks/lists/useListRowSignals', () => ({
  useListRowSignals: () => ({ signalFor: () => hooks.signal, complete: true }),
}))
// The expansion is its own surface with its own tests; this file is about the
// collapsed row.
vi.mock('../ListRowExpansion', () => ({
  ListRowExpansion: () => <div data-testid="expansion" />,
}))

import { MobileListRows } from '../MobileListRows'

const asset = {
  id: 'a-aapl', _rowId: 'r1', symbol: 'AAPL', company_name: 'Apple Inc.',
  current_price: 170.5,
  _status: { id: 's1', name: 'Reviewing', color: '#6366f1' },
  _assignee: { first_name: 'Dana', email: 'd@x.com' },
  _tags: [{ id: 't1', name: 'Quality' }],
  _addedBy: 'u1',
}

const permissions = { canEditItemNotes: () => true } as any

function renderRows(over: Record<string, unknown> = {}) {
  return render(
    <MobileListRows
      listId="l-1"
      assets={[asset]}
      permissions={permissions}
      {...(over as any)}
    />,
  )
}

beforeEach(() => {
  hooks.signal = {
    state: null, subject: null, weightPct: null, closes: null,
    ratingValue: null, ratingColor: null, conviction: null, targetPrice: null,
  }
})

describe('the mobile row carries investment state', () => {
  it('shows price, one-month move, weight and rating', () => {
    hooks.signal = {
      ...hooks.signal,
      closes: [100, 105, 110], weightPct: 4.25, ratingValue: 'Buy', ratingColor: '#10b981',
    }
    renderRows()
    expect(screen.getByText('170.50')).toBeInTheDocument()
    // (110 - 100) / 100 = +10.0%
    expect(screen.getByText('+10.0%')).toBeInTheDocument()
    expect(screen.getByText('4.3% wt')).toBeInTheDocument()
    expect(screen.getByText('Buy')).toBeInTheDocument()
  })

  it('names the work state and counts unreviewed research', () => {
    hooks.signal = {
      ...hooks.signal,
      state: 'evidence-since-review',
      subject: { newSinceReview: 3 },
    }
    renderRows()
    expect(screen.getByText('New research 3')).toBeInTheDocument()
  })

  it('gives a current case no work chip', () => {
    hooks.signal = { ...hooks.signal, state: 'current' }
    renderRows()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
  })

  it('puts investment state ahead of the list process metadata', () => {
    hooks.signal = { ...hooks.signal, weightPct: 4.25, state: 'stale' }
    const { container } = renderRows()
    const text = container.textContent ?? ''
    // Weight and work state before status, assignee and tags.
    expect(text.indexOf('4.3% wt')).toBeLessThan(text.indexOf('Reviewing'))
    expect(text.indexOf('Review due')).toBeLessThan(text.indexOf('Quality'))
  })

  it('shows nothing rather than placeholders when nothing is known', () => {
    renderRows({ assets: [{ ...asset, current_price: null }] })
    const row = screen.getByRole('button', { name: /AAPL/ })
    expect(row.textContent).not.toContain('wt')
    expect(row.textContent).not.toContain('%')
    expect(row.textContent).not.toContain('—')
  })

  it('drops the list-scoped metadata entirely on a screen list', () => {
    // A criteria-computed screen has no curated rows, so status/assignee/tags
    // do not apply — but the investment state still does.
    hooks.signal = { ...hooks.signal, weightPct: 4.25 }
    renderRows({ hideListColumns: true })
    expect(screen.getByText('4.3% wt')).toBeInTheDocument()
    expect(screen.queryByText('Reviewing')).not.toBeInTheDocument()
    expect(screen.queryByText('Quality')).not.toBeInTheDocument()
  })
})
