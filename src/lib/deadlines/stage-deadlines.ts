/**
 * Stage deadlines: the unique key, the row shape, and the query keys.
 *
 * ── Who owns a deadline ──────────────────────────────────────────────────
 *
 * `asset_stage_deadlines` has no `organization_id`. Its tenant is derived,
 * and the derivation is already in the schema:
 *
 *     asset_stage_deadlines.workflow_id → workflows.id → workflows.organization_id
 *
 * `workflows` is org-owned; `assets` is global reference data with no org
 * column, so the asset side of the row establishes nothing about tenancy.
 * The production policies enforce this server-side — all four commands check
 * an EXISTS over the owning workflow — so nothing here adds an organization
 * filter. The client's job is to supply a correct `workflow_id`, not to
 * re-implement the boundary.
 *
 * ── The conflict target ──────────────────────────────────────────────────
 *
 * The real constraint is `UNIQUE (asset_id, workflow_id, stage_id)`. The code
 * upserted on `asset_id,stage_id`, which matches no unique index: PostgREST
 * sends it as `ON CONFLICT (asset_id, stage_id)` and Postgres rejects it with
 * `42P10`. Saving a deadline has never worked.
 *
 * Omitting `workflow_id` is not a near-miss. The same asset at the same stage
 * carries a different deadline in two different workflows, so a two-column
 * key would be wrong even if one existed.
 */

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
 * `workflowId` is in the key because it is in the unique key: the same asset
 * and stage under a different workflow is a different row, and without it a
 * cached deadline would follow the reader from one workflow to another.
 */
export function stageDeadlineKey(
  assetId: string,
  workflowId: string | null | undefined,
  stageId: string,
) {
  return ['stage-deadline', assetId, workflowId ?? null, stageId] as const
}

/**
 * Query key for every deadline on one asset under one workflow.
 *
 * This is the key `InvestmentTimeline` already reads. Saving used to
 * invalidate `['asset-deadlines', assetId]`, which no query uses, so a saved
 * deadline did not appear on the timeline until something else refetched.
 */
export function workflowDeadlinesKey(
  assetId: string | null | undefined,
  workflowId: string | null | undefined,
) {
  return ['asset-workflow-deadlines', assetId ?? null, workflowId ?? null] as const
}
