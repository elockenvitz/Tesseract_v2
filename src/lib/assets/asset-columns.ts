/**
 * The columns of `public.assets` an ordinary user may read.
 *
 * `assets` is one shared row per ticker with no organization, so anything on it
 * is readable by every tenant. That is correct for identity, listing and market
 * reference — a ticker means the same thing to everyone — and wrong for the
 * research and workflow columns that accumulated there over time.
 *
 * Those columns are revoked at the database level (see
 * `scripts/sql/security-c1/09-assets-proprietary-columns.sql`): the table-wide
 * SELECT grant is replaced by a grant of exactly this list. Postgres expands
 * `SELECT *` to every column and then checks privileges on all of them, so a
 * bare `select('*')` against `assets` now fails outright rather than silently
 * omitting the restricted columns. This constant is what callers select
 * instead, and keeping it in one place means the SQL grant and the client have
 * a single shared definition of "reference data".
 *
 * The restricted columns and where they actually live:
 *
 *   thesis, where_different, risks_to_thesis  -> asset_contributions (section)
 *   quick_note, quick_note_updated_at         -> asset_contributions
 *   thesis_references                         -> asset_contributions.attachments
 *   completeness                              -> derived from contributions
 *   process_stage                             -> asset_workflow_progress
 *   priority                                  -> asset_workflow_priorities
 *   workflow_id                               -> asset_workflow_progress
 */
export const ASSET_REFERENCE_COLUMNS = [
  'id',
  'symbol',
  'company_name',
  'sector',
  'industry',
  'country',
  'exchange',
  'asset_type',
  'currency',
  'isin',
  'figi',
  'mic',
  'identity_source',
  'market_cap',
  'current_price',
  'lifecycle_status',
  'current_symbol',
  'lifecycle_checked_at',
  'lifecycle_note',
  'created_at',
  'updated_at',
  'created_by',
] as const

/** Comma-separated form for a PostgREST `.select(...)` argument. */
export const ASSET_REFERENCE_SELECT = ASSET_REFERENCE_COLUMNS.join(', ')

/** Embedded form, for selecting an asset through a relationship: `assets(...)`. */
export const ASSET_REFERENCE_EMBED = `assets(${ASSET_REFERENCE_SELECT})`
