/**
 * The Outcomes filter invariants.
 *
 * The bug these exist to prevent: a filter narrowing the list on a surface
 * that cannot show it is on. On a phone the portfolio selector read "All
 * portfolios" while a portfolio chosen earlier in the desktop table still
 * constrained the rows, and nothing on the phone could clear it. The reader
 * could not tell whether the control or the list was lying.
 *
 * Two rules are asserted here, both at the filtering boundary rather than at
 * the render site — hiding a control while the filter it sets keeps biting is
 * the defect, not the fix:
 *
 *   1. A persisted portfolio id that no longer exists filters nothing.
 *   2. Desktop column filters do not apply where their controls do not exist.
 */
import { describe, it, expect } from 'vitest'
import {
  resolvePortfolioFilter,
  applyColumnFilters,
  activeColumnFilters,
  columnFiltersApply,
  type ColumnFilterState,
} from '../outcomesFilterScope'

// ─── Fixtures ───────────────────────────────────────────────────────────

const PORTFOLIOS = [{ id: 'pf-growth' }, { id: 'pf-income' }]

const NO_COLUMN_FILTERS: ColumnFilterState = {
  typeFilter: null,
  tickerSearch: '',
  nameSearch: '',
  portfolioFilter: null,
  issueSearch: '',
  actionFilter: null,
  ownerFilter: null,
}

/**
 * Rows must differ on every field a filter reads. Sharing an `asset_name`
 * across all three made `nameSearch` match everything, which looks like the
 * filter being ignored on desktop — a fixture that cannot tell the two apart
 * proves nothing.
 */
function entry(row: Record<string, unknown>, intel: { primaryIssue: string; actionNeeded: unknown }) {
  return { row: { execution_status: 'pending', ...row }, intel } as never
}

const ROWS = [
  entry(
    { decision_id: 'd1', direction: 'buy', asset_symbol: 'AAPL', asset_name: 'Apple Inc', portfolio_name: 'Growth Fund', owner_name: 'Eric Lockenvitz' },
    { primaryIssue: 'Awaiting execution', actionNeeded: 'Confirm fill' },
  ),
  entry(
    { decision_id: 'd2', direction: 'sell', asset_symbol: 'MSFT', asset_name: 'Microsoft Corp', portfolio_name: 'Income Fund', owner_name: 'Colin Knox' },
    { primaryIssue: 'Thesis unreviewed', actionNeeded: null },
  ),
  entry(
    { decision_id: 'd3', direction: 'buy', asset_symbol: 'NVDA', asset_name: 'Nvidia Corp', portfolio_name: 'Income Fund', owner_name: 'Eric Lockenvitz' },
    { primaryIssue: 'Position drifted', actionNeeded: null },
  ),
]

const ids = (list: ReturnType<typeof applyColumnFilters>) =>
  list.map((e: { row: { decision_id: string } }) => e.row.decision_id)

// ─── Portfolio id validity ──────────────────────────────────────────────

describe('the portfolio filter that is actually applied', () => {
  it('keeps a persisted selection that still exists', () => {
    expect(resolvePortfolioFilter('pf-growth', PORTFOLIOS, true)).toBe('pf-growth')
  })

  it('drops a persisted id that no longer exists', () => {
    // The stale case: the <select> finds no matching option and falls back to
    // "All portfolios", so the filter must fall back with it.
    expect(resolvePortfolioFilter('pf-deleted', PORTFOLIOS, true)).toBeNull()
  })

  it('does not treat an unloaded list as proof the id is stale', () => {
    // Mid-fetch the list is empty. Dropping the filter here would refetch the
    // wrong rows and flash the full dataset.
    expect(resolvePortfolioFilter('pf-growth', [], false)).toBe('pf-growth')
  })

  it('drops the id once the list has loaded and is genuinely empty', () => {
    expect(resolvePortfolioFilter('pf-growth', [], true)).toBeNull()
  })

  it('leaves the unfiltered state alone', () => {
    expect(resolvePortfolioFilter(null, PORTFOLIOS, true)).toBeNull()
  })

  it('never returns an id absent from the list it was given', () => {
    // The invariant stated directly: whatever comes back must be selectable
    // in the control, or be the unfiltered state.
    for (const candidate of ['pf-growth', 'pf-income', 'pf-deleted', null]) {
      const resolved = resolvePortfolioFilter(candidate, PORTFOLIOS, true)
      if (resolved !== null) {
        expect(PORTFOLIOS.some(p => p.id === resolved)).toBe(true)
      }
    }
  })
})

// ─── Desktop-only column filters ────────────────────────────────────────

describe('desktop column filters cannot silently constrain a phone', () => {
  const desktopPortfolioFilter: ColumnFilterState = { ...NO_COLUMN_FILTERS, portfolioFilter: 'Growth Fund' }

  it('applies on desktop, where the column header exists', () => {
    const out = applyColumnFilters(ROWS, desktopPortfolioFilter, { isMobileViewport: false })
    expect(ids(out)).toEqual(['d1'])
  })

  it('does not apply on a phone, where nothing can show or clear it', () => {
    // The headline bug: the phone's own selector says "All portfolios", so
    // the list must be every portfolio.
    const out = applyColumnFilters(ROWS, desktopPortfolioFilter, { isMobileViewport: true })
    expect(ids(out)).toEqual(['d1', 'd2', 'd3'])
  })

  it.each([
    ['typeFilter', { ...NO_COLUMN_FILTERS, typeFilter: 'buy' }],
    ['tickerSearch', { ...NO_COLUMN_FILTERS, tickerSearch: 'AAPL' }],
    ['nameSearch', { ...NO_COLUMN_FILTERS, nameSearch: 'Apple' }],
    ['portfolioFilter', { ...NO_COLUMN_FILTERS, portfolioFilter: 'Growth Fund' }],
    ['issueSearch', { ...NO_COLUMN_FILTERS, issueSearch: 'unreviewed' }],
    ['actionFilter', { ...NO_COLUMN_FILTERS, actionFilter: 'has_action' }],
    ['ownerFilter', { ...NO_COLUMN_FILTERS, ownerFilter: 'Colin Knox' }],
  ] as Array<[string, ColumnFilterState]>)(
    'every sibling obeys the same rule: %s',
    (_name, state) => {
      // Each of these narrows on desktop...
      const desktop = applyColumnFilters(ROWS, state, { isMobileViewport: false })
      expect(desktop.length).toBeLessThan(ROWS.length)
      // ...and none of them narrows on a phone.
      const mobile = applyColumnFilters(ROWS, state, { isMobileViewport: true })
      expect(ids(mobile)).toEqual(['d1', 'd2', 'd3'])
    },
  )

  it('returns the same list identity on a phone rather than a filtered copy', () => {
    const state = { ...NO_COLUMN_FILTERS, ownerFilter: 'Colin Knox' }
    expect(applyColumnFilters(ROWS, state, { isMobileViewport: true })).toBe(ROWS)
  })

  it('changes nothing on desktop when no column filter is set', () => {
    const out = applyColumnFilters(ROWS, NO_COLUMN_FILTERS, { isMobileViewport: false })
    expect(ids(out)).toEqual(['d1', 'd2', 'd3'])
  })

  it('states plainly where the column filters apply', () => {
    expect(columnFiltersApply(false)).toBe(true)
    expect(columnFiltersApply(true)).toBe(false)
  })
})

// ─── Switching between presentations ────────────────────────────────────

describe('moving between desktop and phone', () => {
  it('does not leave the two presentations contradicting each other', () => {
    // A reader filters the desktop table to Growth Fund by name, then opens
    // the same session on a phone. The phone's portfolio control is at its
    // unfiltered default, so the phone's list must be unfiltered too.
    const state: ColumnFilterState = { ...NO_COLUMN_FILTERS, portfolioFilter: 'Growth Fund' }
    const phone = applyColumnFilters(ROWS, state, { isMobileViewport: true })
    const phonePortfolio = resolvePortfolioFilter(null, PORTFOLIOS, true)

    expect(phonePortfolio).toBeNull()
    expect(ids(phone)).toEqual(['d1', 'd2', 'd3'])
  })

  it('preserves the desktop table view for the return trip', () => {
    // Ignored on the phone, not cleared: going back to desktop restores the
    // filter the reader set there.
    const state: ColumnFilterState = { ...NO_COLUMN_FILTERS, portfolioFilter: 'Growth Fund' }
    expect(activeColumnFilters(state)).toEqual(['portfolioFilter'])
    expect(ids(applyColumnFilters(ROWS, state, { isMobileViewport: false }))).toEqual(['d1'])
  })

  it('reports every column filter currently narrowing the list', () => {
    const state: ColumnFilterState = {
      ...NO_COLUMN_FILTERS,
      typeFilter: 'buy',
      ownerFilter: 'Eric Lockenvitz',
      tickerSearch: 'AAPL',
    }
    expect(activeColumnFilters(state).sort()).toEqual(['ownerFilter', 'tickerSearch', 'typeFilter'])
  })
})
