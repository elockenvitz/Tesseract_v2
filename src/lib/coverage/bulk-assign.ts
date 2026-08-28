/**
 * Building the rows for a bulk coverage assignment, and refusing to build them
 * when the tenant is unknown.
 *
 * ── Why this is a module and not four lines in the component ───────────────
 *
 * `CoverageGapsView.handleBulkAssign` built its insert payload inline and
 * omitted `organization_id`. Production has zero coverage rows with a NULL
 * organization today, but this path is capable of creating them, and a row with
 * no tenant is readable by every active member of every organization under the
 * `organization_id IS NULL` branch that the coverage policies still carry. It
 * is also the one thing standing between the schema and an eventual
 * `organization_id NOT NULL`.
 *
 * The fix is one field. It lives here rather than inline because the
 * interesting part is not the field, it is the *refusal*: when the current
 * organization cannot be resolved, no INSERT may be issued at all. That is a
 * decision worth being able to test without mounting a React tree, a query
 * client and a toast provider — and worth having exactly one copy of if a
 * second caller ever appears.
 *
 * ── Why the tenant is a parameter and not looked up here ──────────────────
 *
 * This function cannot reach for the organization itself, by construction. Its
 * input carries the analyst as two opaque strings (`analystId`, `analystName`)
 * and the group as an id — there is no user object, no portfolio and no
 * membership list in scope, so there is nothing here that could be mistaken for
 * a tenant. The caller passes `useOrganization().currentOrgId` and has no other
 * plausible value to pass.
 *
 * ── What actually guarantees a foreign tenant cannot be written ────────────
 *
 * Not this file. `coverage`'s INSERT policy is
 * `WITH CHECK (is_coverage_admin() AND (organization_id IS NULL OR organization_id = current_org_id()))`,
 * and `current_org_id()` returns the caller's organization only when they hold
 * a live active membership of it. So a forged or stale organization is rejected
 * by Postgres regardless of what any client sends. What this file changes is
 * the *other* half of that policy: the `organization_id IS NULL` escape hatch,
 * which a payload without the field walks straight through.
 */

/** The columns a bulk assignment writes. Deliberately explicit: an inferred
 *  type would silently absorb a new field the day someone adds one. */
export interface BulkCoverageRecord {
  asset_id: string
  user_id: string
  analyst_name: string
  team_id: string | null
  visibility: 'team' | 'division' | 'firm'
  start_date: string
  changed_by: string | null
  organization_id: string
}

export interface BulkAssignInput {
  /**
   * The caller's current organization, from `useOrganization()`.
   *
   * Nullable because the context genuinely resolves to null — before
   * memberships load, and for a user whose membership was revoked. Both are
   * refusals, not defaults.
   */
  organizationId: string | null | undefined
  assetIds: string[]
  /** Opaque. Cannot influence the tenant; see the module comment. */
  analystId: string
  /** Denormalised display name, as every other coverage writer stores. */
  analystName: string
  /** `'__firm__'`, or an `org_chart_nodes.id`. */
  groupId: string | null
  /** `org_chart_nodes.node_type` for the selected group, when it is a node. */
  nodeType?: string | null
  startDate: string
  changedBy: string | null | undefined
}

export type BulkAssignRefusal =
  /** No resolvable current organization. The important one. */
  | 'no_organization'
  /** Nothing selected to assign. */
  | 'no_assets'
  /** No analyst or no group chosen. */
  | 'incomplete_selection'

export type BulkAssignBuild =
  | { ok: true; records: BulkCoverageRecord[] }
  | { ok: false; reason: BulkAssignRefusal }

/** Copy shown to the user for each refusal. */
export const BULK_ASSIGN_REFUSAL_MESSAGE: Record<BulkAssignRefusal, string> = {
  no_organization:
    'No workspace is selected, so coverage cannot be assigned. Reload the page or switch workspace and try again.',
  no_assets: 'Select at least one asset to assign.',
  incomplete_selection: 'Choose an analyst and a team before assigning.',
}

/**
 * The visibility a bulk assignment records.
 *
 * Unchanged from the inline version it replaces — firm-wide selections are
 * `firm`, divisions and departments are `division`, everything else is `team`.
 * Reproduced here rather than rewritten so this stays a one-field change.
 */
function visibilityFor(isFirm: boolean, nodeType: string | null | undefined) {
  if (isFirm) return 'firm' as const
  return nodeType === 'division' || nodeType === 'department'
    ? ('division' as const)
    : ('team' as const)
}

/**
 * Build the rows, or refuse.
 *
 * Refusing is the point. Returning a partial payload for the caller to "fix up"
 * would put the tenant decision back in the component, which is where it was
 * lost in the first place.
 */
export function buildBulkCoverageRecords(input: BulkAssignInput): BulkAssignBuild {
  const { organizationId, assetIds, analystId, analystName, groupId, nodeType } = input

  // Fail closed, and first: an unknown tenant is not a payload problem to be
  // reported after the other validations pass.
  if (!organizationId) return { ok: false, reason: 'no_organization' }

  if (!analystId || !groupId) return { ok: false, reason: 'incomplete_selection' }
  if (assetIds.length === 0) return { ok: false, reason: 'no_assets' }

  const isFirm = groupId === '__firm__'

  return {
    ok: true,
    records: assetIds.map(assetId => ({
      asset_id: assetId,
      user_id: analystId,
      analyst_name: analystName,
      team_id: isFirm ? null : groupId,
      visibility: visibilityFor(isFirm, nodeType),
      start_date: input.startDate,
      changed_by: input.changedBy ?? null,
      // The fix. Every other coverage writer in the app already sets this;
      // this path did not, and so could produce tenant-less rows.
      organization_id: organizationId,
    })),
  }
}
