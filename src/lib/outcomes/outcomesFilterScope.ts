/**
 * Which Outcomes filters are allowed to constrain the list, and what the
 * portfolio filter actually resolves to.
 *
 * Outcomes carries two kinds of filter state and they had been treated as
 * one. Some of it is shared product state the reader can see and change on
 * any device — the portfolio, the date range, the attention chip. The rest is
 * a desktop table-view preference, set from a column header that exists only
 * on the wide layout.
 *
 * The second kind was still filtering the phone. A portfolio chosen in the
 * desktop table kept constraining the data after switching to mobile, where
 * the visible portfolio selector read "All portfolios" and nothing could
 * clear it — the control contradicted the list and there was no way to tell
 * which was right. Seven column filters behaved this way.
 *
 * The rule this module enforces: a filter may only narrow what you see if the
 * surface you are on can show you that it is on. It is applied here, at the
 * filtering boundary, rather than by hiding a control while the filter it
 * sets keeps biting.
 */

import { buildSystemInsight } from '../decision-insights'
import type { AccountabilityRow } from '../../types/decision-accountability'

/** The desktop column-header filters. Each is a table-view preference. */
export interface ColumnFilterState {
  typeFilter: string | null
  tickerSearch: string
  nameSearch: string
  /** A `portfolio_name`, not an id — the other portfolio vocabulary. */
  portfolioFilter: string | null
  issueSearch: string
  actionFilter: string | null
  ownerFilter: string | null
}

/** Only the fields the filters read, so this is not tied to the page. */
export interface FilterableEntry {
  row: Pick<AccountabilityRow, 'direction' | 'asset_symbol' | 'asset_name' | 'portfolio_name' | 'owner_name' | 'execution_status'> & AccountabilityRow
  intel: { primaryIssue: string; actionNeeded: unknown }
}

/**
 * Resolve the portfolio id that may actually be applied.
 *
 * `selectedPortfolioId` is restored from sessionStorage unvalidated, so a
 * snapshot naming a portfolio that has since been deleted kept filtering the
 * data while the `<select>`, finding no matching option, displayed "All
 * portfolios". An id that is not in the current list therefore resolves to
 * null — the UI and the dataset cannot then disagree.
 *
 * While the list is still loading the id is passed through untouched: an
 * empty array mid-fetch is not evidence that an id is stale, and treating it
 * as such would drop a valid filter and refetch the wrong rows.
 */
export function resolvePortfolioFilter(
  selectedPortfolioId: string | null,
  portfolios: Array<{ id: string }>,
  portfoliosLoaded: boolean,
): string | null {
  if (!selectedPortfolioId) return null
  if (!portfoliosLoaded) return selectedPortfolioId
  return portfolios.some(p => p.id === selectedPortfolioId) ? selectedPortfolioId : null
}

/**
 * True when the desktop column filters are allowed to apply.
 *
 * They are ignored on a phone rather than cleared: the reader's desktop table
 * view survives the round trip, it simply stops filtering a surface that
 * cannot show it.
 */
export function columnFiltersApply(isMobileViewport: boolean): boolean {
  return !isMobileViewport
}

/** The column filters that are currently narrowing the list. */
export function activeColumnFilters(state: ColumnFilterState): string[] {
  const active: string[] = []
  if (state.typeFilter) active.push('typeFilter')
  if (state.tickerSearch) active.push('tickerSearch')
  if (state.nameSearch) active.push('nameSearch')
  if (state.portfolioFilter) active.push('portfolioFilter')
  if (state.issueSearch) active.push('issueSearch')
  if (state.actionFilter) active.push('actionFilter')
  if (state.ownerFilter) active.push('ownerFilter')
  return active
}

/**
 * Apply the desktop column filters — or don't, on a phone.
 *
 * Returns the input untouched when the controls that set these filters are
 * not on screen. Semantics of each individual filter are unchanged from the
 * table; only whether the set runs at all is new.
 */
export function applyColumnFilters<E extends FilterableEntry>(
  entries: E[],
  state: ColumnFilterState,
  { isMobileViewport }: { isMobileViewport: boolean },
): E[] {
  if (!columnFiltersApply(isMobileViewport)) return entries

  let mapped = entries
  const { typeFilter, tickerSearch, nameSearch, portfolioFilter, issueSearch, actionFilter, ownerFilter } = state

  if (typeFilter) mapped = mapped.filter(({ row }) => row.direction === typeFilter)
  if (tickerSearch) { const q = tickerSearch.toLowerCase(); mapped = mapped.filter(({ row }) => row.asset_symbol?.toLowerCase().includes(q)) }
  if (nameSearch) { const q = nameSearch.toLowerCase(); mapped = mapped.filter(({ row }) => row.asset_name?.toLowerCase().includes(q)) }
  if (portfolioFilter) mapped = mapped.filter(({ row }) => row.portfolio_name === portfolioFilter)
  if (issueSearch) {
    const q = issueSearch.toLowerCase()
    mapped = mapped.filter(({ row, intel }) => {
      if (intel.primaryIssue.toLowerCase().includes(q)) return true
      // Also match against the system insight so searches behave
      // consistently with what's actually rendered in the column.
      if (row.execution_status === 'executed') {
        return buildSystemInsight(row).text.toLowerCase().includes(q)
      }
      return false
    })
  }
  if (actionFilter) {
    if (actionFilter === 'has_action') mapped = mapped.filter(({ intel }) => intel.actionNeeded != null)
    else if (actionFilter === 'no_action') mapped = mapped.filter(({ intel }) => intel.actionNeeded == null)
  }
  if (ownerFilter) mapped = mapped.filter(({ row }) => row.owner_name === ownerFilter)

  return mapped
}
