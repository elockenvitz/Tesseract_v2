/**
 * Building the rows a CSV coverage import writes.
 *
 * ── Why this moved out of the component ────────────────────────────────────
 *
 * `CoverageManager`'s bulk-upload mutation built its insert payload inline and
 * omitted `organization_id` — the same defect as the gaps-view bulk assign, in
 * a second place, and the last live client path capable of producing a
 * tenant-less coverage row.
 *
 * It is here for the same reason `bulk-assign.ts` is: the interesting part is
 * the refusal, and a refusal buried in a `useMutation` body inside a
 * 7,000-line component cannot be tested without standing up a query client, an
 * org context and a file input.
 *
 * ── Why this is a separate builder from bulk-assign ────────────────────────
 *
 * The two payloads genuinely differ. A CSV row carries `end_date` and `notes`
 * that the gaps-view assign has no concept of, and its `start_date` falls back
 * to today when the cell is blank. Routing both through one builder would mean
 * changing one of the two payloads, and this import has to keep importing
 * exactly what it imports today.
 *
 * What the two share is `coverage-tenant.ts` — the guard and the stamp, which
 * is the part that was duplicated by being absent from both.
 *
 * ── What the tenant is never derived from ──────────────────────────────────
 *
 * Not the CSV. Not `row.user`, who is the analyst being assigned and may sit in
 * a different organization from the importer. Not `row.orgNode`, which selects
 * a team within the workspace, not the workspace. The organization is passed in
 * from `useOrganization().currentOrgId` and there is deliberately no other
 * candidate in scope.
 */

import {
  resolveCoverageTenant,
  stampCoverageTenant,
} from './coverage-tenant'

/** One validated CSV row, as the upload preview produces it. */
export interface CsvCoverageRow {
  asset: { id: string; symbol: string }
  user: { id: string; name: string }
  orgNode: { id: string; node_type: string } | null
  isFirm: boolean
  start_date: string
  end_date: string
  notes: string
}

/** The columns a CSV import writes. Two more than a bulk assign. */
export interface CsvCoverageRecord {
  asset_id: string
  user_id: string
  analyst_name: string
  team_id: string | null
  visibility: 'team' | 'division' | 'firm'
  start_date: string
  end_date: string | null
  notes: string | null
  changed_by: string | null
  organization_id: string
}

export type CsvImportBuild =
  | { ok: true; records: CsvCoverageRecord[] }
  | { ok: false; reason: 'no_organization' }

export interface CsvImportOptions {
  /**
   * Who performed the import.
   *
   * Passed in rather than read from a row: `changed_by` is the importer, not
   * the analyst the row assigns coverage to. Reading it from `row.user` would
   * record every analyst as the author of their own assignment.
   */
  changedBy?: string | null
  /**
   * Today, as `YYYY-MM-DD`, for rows whose `start_date` cell is blank.
   *
   * Injectable only so tests are not date-dependent. The default is exactly
   * the expression this code replaced, so behaviour is unchanged.
   */
  today?: string
}

/** Unchanged from the inline version: firm-wide is `firm`, divisions and
 *  departments are `division`, everything else is `team`. */
function visibilityFor(row: CsvCoverageRow) {
  if (row.isFirm) return 'firm' as const
  const t = row.orgNode?.node_type
  return t === 'division' || t === 'department' ? ('division' as const) : ('team' as const)
}

/**
 * Build the import payload, or refuse.
 *
 * An empty row list is NOT a refusal here — it maps to an empty payload and the
 * caller decides. That differs from `buildBulkCoverageRecords`, which refuses
 * an empty selection, and the difference is real: an empty selection is a user
 * who clicked assign without choosing anything, while an empty CSV has already
 * been reported by the upload's own validation.
 */
export function buildCsvCoverageRecords(
  organizationId: string | null | undefined,
  rows: readonly CsvCoverageRow[],
  options: CsvImportOptions = {},
): CsvImportBuild {
  // First, before anything is built. See coverage-tenant.
  const tenant = resolveCoverageTenant(organizationId)
  if (!tenant.ok) return { ok: false, reason: 'no_organization' }

  const today = options.today ?? new Date().toISOString().split('T')[0]

  const records = rows.map(row => ({
    asset_id: row.asset.id,
    user_id: row.user.id,
    analyst_name: row.user.name,
    team_id: row.isFirm ? null : row.orgNode?.id || null,
    visibility: visibilityFor(row),
    start_date: row.start_date || today,
    end_date: row.end_date || null,
    notes: row.notes || null,
    changed_by: options.changedBy ?? null,
  }))

  return { ok: true, records: stampCoverageTenant(tenant.organizationId, records) }
}
