/**
 * Stage deadlines: where they live, who owns them, and how to key them.
 *
 * ── The ownership model, as the database actually has it ─────────────────
 *
 * `asset_stage_deadlines` has NO `organization_id` column. Its tenant is
 * derived, and the derivation is already in the schema:
 *
 *     asset_stage_deadlines.workflow_id → workflows.id → workflows.organization_id
 *
 * `workflows` is org-owned — every one of its four policies is scoped
 * `organization_id = current_org_id()`. `assets`, by contrast, is GLOBAL
 * reference data with `USING (true)` and no org column, so the asset side of
 * the row establishes nothing about tenancy. The workflow is the anchor.
 *
 * That is why nothing here adds an `organization_id` filter to the deadline
 * table itself: an earlier pass did, and every read and write it touched
 * failed with `42703 column does not exist`. Scoping goes through the embedded
 * workflow instead, which needs no migration because the relationship is
 * already there.
 *
 * ── The conflict target ──────────────────────────────────────────────────
 *
 * The real constraint is `UNIQUE (asset_id, workflow_id, stage_id)`. The code
 * upserted on `asset_id,stage_id`, which matches no unique index — PostgREST
 * sends that as `ON CONFLICT (asset_id, stage_id)` and Postgres rejects it
 * with `42P10`. Omitting `workflow_id` is not a near-miss: the same asset at
 * the same stage can legitimately carry a different deadline in two different
 * workflows, so a two-column key would be wrong even if one existed.
 *
 * ── Known gap this module cannot close ───────────────────────────────────
 *
 * The table's RLS is permissive — SELECT is `USING (true)` and INSERT only
 * checks `auth.uid() IS NOT NULL`, with no UPDATE or DELETE policy at all.
 * So the scoping here is a correctness measure in the client, not a boundary
 * the server enforces, and re-saving or deleting a deadline cannot work until
 * those policies exist. Both need a migration. See the lane report.
 */

/** PostgREST select that pulls the owning workflow's org alongside the row.
 *
 *  `!inner` is load-bearing: without it the embed is a left join and a filter
 *  on `workflows.organization_id` would null out the embedded object while
 *  still returning the parent deadline. With it, a deadline whose workflow
 *  belongs to another org is not returned at all. */
export const STAGE_DEADLINE_ORG_SELECT = '*, workflows!inner(organization_id)'

/** The column path to filter on for tenant scope. Pairs with the select above. */
export const STAGE_DEADLINE_ORG_FILTER = 'workflows.organization_id'

/** Matches `UNIQUE (asset_id, workflow_id, stage_id)` exactly. */
export const STAGE_DEADLINE_CONFLICT_TARGET = 'asset_id,workflow_id,stage_id'

/** The unique key's columns, in order — the single source the conflict target
 *  and the row lookups are both derived from, so they cannot drift apart. */
export const STAGE_DEADLINE_UNIQUE_COLUMNS = ['asset_id', 'workflow_id', 'stage_id'] as const

export interface StageDeadlineRowInput {
  assetId: string
  workflowId: string
  stageId: string
  deadlineDate: string
  notes?: string | null
  setBy?: string | null
}

/**
 * The row to upsert.
 *
 * Throws rather than writing when `workflowId` is missing. A deadline without
 * one cannot satisfy the unique key, so the upsert would insert a second row
 * for a stage that already has a deadline instead of replacing the first —
 * and the reader, which filters on the full key, would then surface neither
 * deterministically. Failing here makes that a visible bug at the call site
 * rather than a duplicate row discovered later.
 */
export function buildStageDeadlineRow(input: StageDeadlineRowInput) {
  if (!input.workflowId) {
    throw new Error('stage deadline: workflowId is required — it is part of the unique key')
  }
  if (!input.assetId || !input.stageId) {
    throw new Error('stage deadline: assetId and stageId are required')
  }
  return {
    asset_id: input.assetId,
    workflow_id: input.workflowId,
    stage_id: input.stageId,
    deadline_date: input.deadlineDate,
    notes: input.notes || null,
    set_by: input.setBy ?? null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Query key for ONE stage's deadline.
 *
 * `orgId` leads the variable part so switching organizations refetches rather
 * than showing the previous org's deadline from cache while the new request is
 * in flight. `workflowId` is in the key because it is in the unique key: the
 * same asset and stage under a different workflow is a different row.
 */
export function stageDeadlineKey(
  orgId: string | null | undefined,
  assetId: string,
  workflowId: string | null | undefined,
  stageId: string,
) {
  return ['stage-deadline', orgId ?? null, assetId, workflowId ?? null, stageId] as const
}

/** Query key for every deadline on one asset under one workflow. */
export function workflowDeadlinesKey(
  orgId: string | null | undefined,
  assetId: string | null | undefined,
  workflowId: string | null | undefined,
) {
  return ['asset-workflow-deadlines', orgId ?? null, assetId ?? null, workflowId ?? null] as const
}
