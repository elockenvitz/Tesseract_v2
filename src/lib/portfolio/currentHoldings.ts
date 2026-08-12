/**
 * Reduce dated holdings snapshots to the current position per asset.
 *
 * `portfolio_holdings` is a snapshot table — UNIQUE is
 * (portfolio_id, asset_id, date) — so a portfolio uploaded more than once
 * carries one row per asset *per upload*. The current position is the newest
 * row for each asset; the older ones are history.
 *
 * Summing the raw rows counts every past snapshot as a live position, which
 * shows a portfolio uploaded twice at double its real NAV. This was fixed on
 * the portfolio detail page first; the dashboard surfaces had the same bug and
 * now share this helper so the rule lives in one place rather than being
 * re-derived (and re-forgotten) per component.
 *
 * The caller must have ordered rows newest-date-first — every call site
 * already does, and re-sorting here would silently paper over a query that
 * did not.
 */

interface DatedHolding {
  asset_id?: string | null
  portfolio_id?: string | null
  date?: string | null
}

/**
 * Keep the first row seen per asset.
 *
 * @param rows   Holdings ordered newest date first.
 * @param scope  'asset' for a single portfolio's rows; 'portfolio-asset' when
 *               the list spans several portfolios, where keying on asset alone
 *               would drop the same name held in a second portfolio.
 */
export function currentHoldings<T extends DatedHolding>(
  rows: T[] | null | undefined,
  scope: 'asset' | 'portfolio-asset' = 'asset',
): T[] {
  if (!rows?.length) return []
  const seen = new Map<string, T>()
  for (const row of rows) {
    if (!row?.asset_id) continue
    const key = scope === 'portfolio-asset'
      ? `${row.portfolio_id ?? ''}:${row.asset_id}`
      : String(row.asset_id)
    if (!seen.has(key)) seen.set(key, row)
  }
  return [...seen.values()]
}
