/**
 * One address for a piece of work, whichever door you came through.
 *
 * ── The two routes ──────────────────────────────────────────────────────
 *
 *   asset-first     Asset → Work overview → Process → Stage → Requirement
 *   process-first   Processes → Cycle → Asset → Stage → Requirement
 *
 * Both have to land on the same surface reading the same rows. They do not
 * need a second record to agree on where they are — they need the same
 * ADDRESS, which is this module. A destination is always identifiers
 * (`workflow_id`, `stage_id`, `asset_checklist_items.id`), never a label and
 * never an array position: a stage's label is editable and its position
 * changes when a Process definition is reordered, so either would resolve a
 * saved link to the wrong stage after a routine edit.
 *
 * ── Why the overview needs a sentinel ───────────────────────────────────
 *
 * `resolveSelection` used to treat "nothing saved" as "pick the first item
 * for them", so Work could never open on its own landing page: the moment
 * an asset had any work, something was selected. Three states have to be
 * told apart, and two of them look identical as `null`:
 *
 *   OVERVIEW   the reader is on the landing page, deliberately
 *   <item key> the reader opened that item
 *   null       nothing is known yet — a first visit, or state that was lost
 *
 * The first and third are now different values, so returning to the
 * overview is a destination the reader can hold, and a first visit lands
 * there rather than somewhere chosen for them.
 */

/** The selection key meaning "the Work overview, on purpose". */
export const WORK_OVERVIEW_KEY = 'overview'

export const isOverviewKey = (key: string | null | undefined): boolean =>
  key === WORK_OVERVIEW_KEY

/**
 * Where a reader is working inside one Process run.
 *
 * Every field is optional going down the chain: a link may name only the
 * run (open it at its own resume point), the run and a stage, or all three.
 * A requirement without its run is not expressible, which is deliberate —
 * requirement rows are per-run, so an id without its run is unresolvable.
 */
export interface WorkDestination {
  workflowId: string
  stageId?: string | null
  /** `asset_checklist_items.id`, this run's own row. */
  requirementId?: string | null
}

/** What a caller hands over when it wants a specific asset opened at work. */
export interface WorkArrival {
  assetId: string
  destination: WorkDestination
  /**
   * Where "back" goes, as a label the arriving surface can render.
   *
   * A string, not a route: the shell is tab-based, so returning means
   * re-selecting a tab the caller already owns. Carrying a label lets the
   * asset say "Back to Earnings Season" instead of an unexplained arrow.
   */
  returnLabel?: string | null
}

/**
 * Read a destination out of the tab payload the shell delivers.
 *
 * `openAsset` merges arbitrary `data` into the tab, and three different
 * callers already put workflow identifiers in there under three spellings
 * (`workflowId`, `stageId`, `taskId`). This is the one place that knows
 * them, so a fourth caller does not invent a fourth.
 *
 * Returns null when there is no workflow to go to. A stage or task without
 * a run is dropped rather than guessed at.
 */
export function destinationFromTabData(
  data: Record<string, unknown> | null | undefined,
): WorkDestination | null {
  if (!data) return null
  const workflowId = typeof data.workflowId === 'string' ? data.workflowId : null
  if (!workflowId) return null
  const stageId = typeof data.stageId === 'string' ? data.stageId : null
  /* `taskId` is this payload's older name for the requirement row. */
  const requirementId =
    typeof data.requirementId === 'string' ? data.requirementId
    : typeof data.taskId === 'string' ? data.taskId
    : null
  return { workflowId, stageId, requirementId }
}

/** The work-item key a process destination selects in the navigator. */
export const processKey = (workflowId: string): string => `process:${workflowId}`

/**
 * Should this arrival be applied, or has it already been?
 *
 * The same replay problem `arrival-focus` solves for sub-pages: tab data is
 * durable, so a destination delivered once would re-apply on every remount
 * and drag a reader back out of wherever they had navigated since. The
 * caller stamps a request id; this compares it with what was consumed.
 */
export function shouldApplyArrival(
  requestId: string | null | undefined,
  consumed: string | null | undefined,
): boolean {
  if (!requestId) return false
  return requestId !== consumed
}

/** A stable id for one arrival request, for the comparison above. */
export function arrivalKey(
  dest: WorkDestination | null,
  requestId: string | null | undefined,
): string | null {
  if (!dest) return null
  const parts = [dest.workflowId, dest.stageId ?? '', dest.requirementId ?? '', requestId ?? '']
  return parts.join('|')
}
