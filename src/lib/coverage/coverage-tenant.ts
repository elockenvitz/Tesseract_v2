/**
 * The tenant on a coverage row: resolving it, and refusing without it.
 *
 * ── Why this is shared ─────────────────────────────────────────────────────
 *
 * Two client paths build `coverage` insert payloads with different shapes —
 * the gaps-view bulk assign (7 fields) and the CSV import (9 fields, adding
 * `end_date` and `notes`). Both omitted `organization_id`, and both are the
 * same one-field defect with the same one-decision fix.
 *
 * Forcing them through a single payload builder would mean changing one of the
 * two payloads, and the CSV import must keep importing exactly what it imports
 * today. So what is shared is not the record shape — it is the two things that
 * actually matter and that were duplicated-by-omission:
 *
 *   `resolveCoverageTenant` — the fail-closed guard
 *   `stampCoverageTenant`   — putting the field on every row
 *
 * A caller keeps its own payload and its own validation order, and neither
 * caller owns a private copy of "what do we do when there is no organization".
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * Not the security boundary. `coverage`'s INSERT policy is
 * `WITH CHECK (is_coverage_admin() AND (organization_id IS NULL OR organization_id = current_org_id()))`
 * and `current_org_id()` resolves only for a caller holding a live active
 * membership, so a forged or stale organization is rejected by Postgres
 * whatever any client sends. What these functions close is the other half of
 * that policy — the `organization_id IS NULL` branch, which a payload missing
 * the field walks straight through, producing a row visible to every active
 * member of every organization.
 *
 * The only correct source for the argument is `useOrganization().currentOrgId`.
 * It is not derivable from the assigned analyst, a portfolio, a CSV cell or any
 * other UI state — those describe *what* is being covered and *by whom*, never
 * *whose workspace the record belongs to*.
 */

/** The single reason a coverage write is refused here. */
export type CoverageTenantRefusal = 'no_organization'

/**
 * Shown to the user, and thrown as an Error message by callers whose existing
 * failure path is a rejected mutation. One string, so the two import paths
 * cannot drift into explaining the same condition differently.
 */
export const NO_COVERAGE_TENANT_MESSAGE =
  'No workspace is selected, so coverage cannot be assigned. Reload the page or switch workspace and try again.'

export type CoverageTenantResolution =
  | { ok: true; organizationId: string }
  | { ok: false; reason: CoverageTenantRefusal }

/**
 * Resolve the organization a coverage write belongs to, or refuse.
 *
 * Callers invoke this BEFORE building or validating anything else. An unknown
 * tenant is not a payload problem to be reported after the other checks pass —
 * a caller that learns "pick an analyst" first, fixes that, and only then
 * learns the workspace was never resolved has been told the wrong thing twice.
 *
 * An empty string refuses like a null. `currentOrgId` is typed `string | null`,
 * but an empty string is what a stale cache or a half-initialised context
 * produces, and it is not an organization.
 */
export function resolveCoverageTenant(
  organizationId: string | null | undefined,
): CoverageTenantResolution {
  if (!organizationId) return { ok: false, reason: 'no_organization' }
  return { ok: true, organizationId }
}

/**
 * Put the organization on every row.
 *
 * Takes an already-resolved, non-nullable id: this function cannot be reached
 * with an unknown tenant, because the type will not allow it. That is the point
 * of splitting the two — the guard cannot be forgotten on the way to the stamp.
 *
 * `organization_id` is written LAST in the spread, so a payload that somehow
 * already carries one cannot override the canonical value. Nothing does today;
 * this makes it stay true.
 */
export function stampCoverageTenant<T extends object>(
  organizationId: string,
  records: readonly T[],
): Array<T & { organization_id: string }> {
  return records.map(record => ({ ...record, organization_id: organizationId }))
}
