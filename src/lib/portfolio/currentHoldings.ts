/**
 * One position per asset.
 *
 * `portfolio_holdings` is the current working book — UNIQUE is
 * (portfolio_id, asset_id), one live row per position, no row means not held
 * (migration 20260907100000). So on production data this is a no-op the
 * database already guarantees.
 *
 * It used to be a snapshot table keyed on (portfolio_id, asset_id, date),
 * where a portfolio uploaded twice carried one row per asset per upload and
 * summing the raw rows showed double its real NAV. This helper was that fix.
 * It stays as a safety net for fixtures and merged result sets, where a
 * duplicate can still reach a denominator.
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
