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
 * ── The server enforces the boundary. Measured, not assumed ──────────────
 *
 * An earlier version of this comment said the table's RLS was permissive
 * (`SELECT USING (true)`, INSERT checking only `auth.uid() IS NOT NULL`, no
 * UPDATE or DELETE policy at all) and that the scoping here was therefore the
 * only thing doing the work. That was true when it was written and is no
 * longer. Queried live on 2026-11-09, `asset_stage_deadlines` has all four
 * policies, each an EXISTS over the owning workflow:
 *
 *     SELECT / DELETE  EXISTS (workflows w WHERE w.id = workflow_id
 *                              AND w.organization_id = current_org_id())
 *     INSERT / UPDATE  the same, AND (set_by IS NULL OR set_by = auth.uid())
 *
 * So the tenant boundary is the server's, and re-saving and deleting work.
 *
 * The client-side scoping below is kept anyway, for a reason RLS cannot
 * address: `orgId` leads the QUERY KEY. React Query caches per key, and
 * without the org in it a deadline fetched under one organization is served
 * from cache after switching to another, until the refetch lands. RLS governs
 * what the server returns, never what the client already holds. The select
 * and filter are then defense in depth over the same boundary, which is
 * cheap and costs one embed.
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

/** Shown when a stage is rendered outside any workflow. Deliberately explains
 *  the cause rather than saying "error": the fix is to open the stage from a
 *  workflow, which the reader can act on. */
export const NO_WORKFLOW_MESSAGE =
  'Deadlines belong to a workflow. Open this stage from a workflow to set one.'

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
 * and the server would refuse it anyway, because the INSERT policy resolves
 * the organization through exactly this column. Failing here makes that a
 * visible bug at the call site rather than a confusing `42501` later.
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

/**
 * Query key for every deadline on one asset under one workflow.
 *
 * This is the key `InvestmentTimeline` already reads. Saving used to
 * invalidate `['asset-deadlines', assetId]`, which no query uses, so a saved
 * deadline did not appear on the timeline until something else refetched.
 */
export function workflowDeadlinesKey(
  orgId: string | null | undefined,
  assetId: string | null | undefined,
  workflowId: string | null | undefined,
) {
  return ['asset-workflow-deadlines', orgId ?? null, assetId ?? null, workflowId ?? null] as const
}
