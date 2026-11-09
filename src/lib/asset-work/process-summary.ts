/**
 * The active workflow, summarised — shared between InvestmentTimeline and the
 * Work pane.
 *
 * ── Why a selector and not a second query ────────────────────────────────
 *
 * Stage progress is a fold over rows both surfaces already fetch:
 * `workflow-stages` for the shape and `asset-workflow-checklist` for what is
 * done. The Work pane previously had none of it, so its summary said "Active
 * process" and nothing else. Computing it twice, differently, is how two
 * surfaces come to disagree about the same workflow — so the fold lives here
 * and the hook that feeds it reuses the existing query keys verbatim.
 *
 * ── Unknown is not zero ──────────────────────────────────────────────────
 *
 * Every function here distinguishes "no rows" from "not fetched". A workflow
 * whose checklist has not loaded reports `null` progress, never `0/0`, and a
 * stage list that has not arrived reports an unknown active stage, never "no
 * open stage". The first version of this summary got both wrong and told a
 * reader their asset had no process when it had one.
 */

export type ProcessSummaryStatus =
  /** No workflow is running on this asset. A fact. */
  | 'none'
  /** A workflow is running; its detail is still arriving. */
  | 'loading'
  /** A workflow is running and its detail is here. */
  | 'ready'

export interface ProcessStageRow {
  id: string
  label: string
  /** Completed checklist items in this stage, or null when not fetched. */
  done: number | null
  /** Total checklist items in this stage, or null when not fetched. */
  total: number | null
  active: boolean
}

export interface ChecklistItemLike {
  stage_id?: string | null
  completed?: boolean | null
  /** 'completed' and 'na' both count as done; see `isDone`. */
  status?: string | null
  /** A custom item exists only as a saved row — it has no template. */
  is_custom?: boolean | null
}

/** A row of `workflow_checklist_templates`: what a stage is SUPPOSED to hold. */
export interface ChecklistTemplateLike {
  stage_id?: string | null
}

/**
 * The rule InvestmentTimeline applies: an item is done when its status is
 * 'completed' or 'na', falling back to the boolean when no status is stored.
 * "Not applicable" is a resolved item, not an outstanding one.
 */
function isDone(item: ChecklistItemLike): boolean {
  const status = item.status ?? (item.completed ? 'completed' : 'unchecked')
  return status === 'completed' || status === 'na'
}

export interface StageLike {
  id: string
  label?: string | null
  name?: string | null
}

/**
 * Fold the checklist onto the stages.
 *
 * ── Where a stage's TOTAL comes from ─────────────────────────────────────
 *
 * Not from the saved rows. `asset_checklist_items` holds only items somebody
 * has touched, so counting it gave "0/0" for a stage the Process rail showed
 * as "0/4" — two numbers for one stage, now visibly side by side since both
 * render in Work. The total is the stage's TEMPLATE (`workflow_checklist_
 * templates`) plus any custom items saved against that stage, which is
 * exactly the merge `InvestmentTimeline` performs before it counts.
 *
 * `undefined` for either input means NOT FETCHED and yields null counts; two
 * empty arrays mean a workflow with no checklist, which is legitimately 0/0.
 */
export function buildStageProgress(
  stages: readonly StageLike[] | undefined,
  items: readonly ChecklistItemLike[] | undefined,
  activeStageId: string | null | undefined,
  templates: readonly ChecklistTemplateLike[] | undefined,
): ProcessStageRow[] {
  if (!stages) return []
  const known = items !== undefined && templates !== undefined
  const byStage = new Map<string, { done: number; total: number }>()
  const bump = (key: string | null | undefined, field: 'done' | 'total') => {
    if (!key) return
    const cur = byStage.get(key) ?? { done: 0, total: 0 }
    cur[field] += 1
    byStage.set(key, cur)
  }
  for (const t of templates ?? []) bump(t.stage_id, 'total')
  for (const it of items ?? []) {
    /* A custom item has no template, so it adds to the total; a saved row
       for a template item is already counted above. */
    if (it.is_custom) bump(it.stage_id, 'total')
    if (isDone(it)) bump(it.stage_id, 'done')
  }
  return stages.map(s => {
    const counts = byStage.get(s.id)
    return {
      id: s.id,
      label: s.label ?? s.name ?? 'Stage',
      done: known ? Math.min(counts?.done ?? 0, counts?.total ?? 0) : null,
      total: known ? (counts?.total ?? 0) : null,
      active: !!activeStageId && s.id === activeStageId,
    }
  })
}

/** The active stage, or null when the stage list has not arrived. */
export function activeStage(stages: readonly ProcessStageRow[]): ProcessStageRow | null {
  return stages.find(s => s.active) ?? null
}

export interface DeadlineLike {
  stage_id?: string | null
  deadline_date?: string | null
}

/**
 * The nearest deadline that has not passed, as an ISO date string.
 *
 * Undefined input means not fetched → null. Past deadlines are excluded
 * because "next" means next; an overdue item is the Process tab's business,
 * and surfacing it here as "next" would misdate it.
 */
export function nextDeadline(
  deadlines: readonly DeadlineLike[] | undefined,
  today: Date = new Date(),
): string | null {
  if (!deadlines || deadlines.length === 0) return null
  const cutoff = today.toISOString().slice(0, 10)
  const upcoming = deadlines
    .map(d => d.deadline_date)
    .filter((d): d is string => !!d && d >= cutoff)
    .sort()
  return upcoming[0] ?? null
}

/**
 * Is there enough to show? `loading` while a workflow is known to exist but
 * its stages have not arrived — never `none`, which would claim a fact.
 */
export function processStatus(
  workflowId: string | null | undefined,
  stages: readonly StageLike[] | undefined,
): ProcessSummaryStatus {
  if (!workflowId) return 'none'
  return stages === undefined ? 'loading' : 'ready'
}
