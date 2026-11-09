/**
 * What the process switcher offers, and in what order.
 *
 * ── The structure this replaces ─────────────────────────────────────────
 *
 * Switching process used to be: open the "⋯" menu, find a dropdown TRIGGER
 * inside it, click that, and get a 384px floating panel listing four
 * categories. A menu inside a menu, where the first click revealed not a
 * choice but another control, and the process already open was listed as
 * though it had to be picked again before anything else became reachable.
 *
 * The grouping is pulled out here so the order and the membership rules can
 * be tested without mounting a popover, and so the component does nothing
 * but render what this returns.
 *
 * ── Cycles are a lineage, not a status ──────────────────────────────────
 *
 * A recurring Process is re-cut each period as a new workflow carrying
 * `parent_workflow_id` back to the original. So "previous cycles" means the
 * runs sharing THIS run's root — not "every completed workflow on the
 * asset", which would mix last quarter's Earnings Season in with a finished
 * Onboarding Review and call both the same kind of thing.
 */

export interface SwitcherRunRow {
  workflow_id: string
  is_completed?: boolean | null
  is_started?: boolean | null
  created_at?: string | null
  workflows?: {
    id?: string
    name?: string | null
    branch_suffix?: string | null
    status?: string | null
    parent_workflow_id?: string | null
    archived?: boolean | null
    created_at?: string | null
  } | null
}

export interface SwitcherJoinable {
  id: string
  name: string
  branch_suffix?: string | null
  description?: string | null
}

export interface SwitcherEntry {
  workflowId: string
  /** The process name, without the run suffix where one was split off. */
  name: string
  /** "Q2 2026", "Apr 10 2026" — null when the run carries no suffix. */
  run: string | null
  completed: boolean
  /** True for the run currently open. Exactly one entry, at most. */
  current: boolean
  at: string | null
}

export interface SwitcherGroups {
  /** The run open right now, if it is still among the asset's runs. */
  current: SwitcherEntry | null
  /** Other live processes on this asset. Never includes `current`. */
  active: SwitcherEntry[]
  /** Earlier runs of the SAME process, newest first. */
  previousCycles: SwitcherEntry[]
  /** Finished runs of other processes, newest first. */
  otherCompleted: SwitcherEntry[]
  /** Processes the asset could be added to. */
  joinable: SwitcherJoinable[]
  /**
   * True when the open run is finished or belongs to a past cycle, so the
   * surface should offer an explicit way back to the live one.
   */
  viewingPast: boolean
  /** Where "back to the current cycle" should go, when there is one. */
  returnTo: SwitcherEntry | null
}

const rootOf = (r: SwitcherRunRow): string =>
  r.workflows?.parent_workflow_id ?? r.workflow_id

const when = (r: SwitcherRunRow): string | null =>
  r.workflows?.created_at ?? r.created_at ?? null

/**
 * Split "Earnings Season - Q2 2026" into its process and its run.
 *
 * Conservative on purpose: only the separators the Process builder actually
 * emits. A name it does not recognise is returned whole, because guessing
 * where a name ends would print half a process title as a date.
 */
export function splitProcessRun(
  name: string | null | undefined,
  suffix?: string | null,
): { name: string; run: string | null } {
  const whole = (name ?? '').trim()
  const suf = suffix?.trim() || null
  if (!whole) return { name: 'Process', run: suf }

  if (suf && whole.endsWith(suf)) {
    const head = whole.slice(0, whole.length - suf.length).replace(/[\s–—-]+$/, '').trim()
    if (head) return { name: head, run: suf }
  }

  const m = whole.match(/^(.*?)\s+[-–—]\s+(.+)$/)
  if (m && m[1].trim()) return { name: m[1].trim(), run: m[2].trim() }

  return { name: whole, run: suf }
}

const toEntry = (r: SwitcherRunRow, currentId: string | null): SwitcherEntry => {
  const split = splitProcessRun(r.workflows?.name, r.workflows?.branch_suffix)
  return {
    workflowId: r.workflow_id,
    name: split.name,
    run: split.run,
    completed: !!r.is_completed,
    current: r.workflow_id === currentId,
    at: when(r),
  }
}

/** Newest first; rows with no date sort last rather than to the top. */
const byNewest = (a: SwitcherEntry, b: SwitcherEntry): number =>
  String(b.at ?? '').localeCompare(String(a.at ?? ''))

export function groupProcesses(
  rows: readonly SwitcherRunRow[],
  currentWorkflowId: string | null,
  joinable: readonly SwitcherJoinable[] = [],
): SwitcherGroups {
  const live = rows.filter(r => !r.workflows?.archived)
  const currentRow = live.find(r => r.workflow_id === currentWorkflowId) ?? null
  const current = currentRow ? toEntry(currentRow, currentWorkflowId) : null

  const currentRoot = currentRow ? rootOf(currentRow) : null

  const others = live.filter(r => r.workflow_id !== currentWorkflowId)

  /* Same lineage as the open run — this process's earlier cycles. */
  const sameLineage = currentRoot
    ? others.filter(r => rootOf(r) === currentRoot)
    : []
  const sameLineageIds = new Set(sameLineage.map(r => r.workflow_id))

  const rest = others.filter(r => !sameLineageIds.has(r.workflow_id))

  const active = rest
    .filter(r => !r.is_completed && r.workflows?.status !== 'ended')
    .map(r => toEntry(r, currentWorkflowId))
    .sort(byNewest)

  const previousCycles = sameLineage
    .map(r => toEntry(r, currentWorkflowId))
    .sort(byNewest)

  const otherCompleted = rest
    .filter(r => r.is_completed || r.workflows?.status === 'ended')
    .map(r => toEntry(r, currentWorkflowId))
    .sort(byNewest)

  /*
   * "Back to the current cycle" is offered only when there IS a newer live
   * run of the same process to go back to. A finished one-off process has
   * no current cycle, and pointing at one would be an invitation to a run
   * that does not exist.
   */
  const liveSibling = previousCycles.find(e => !e.completed) ?? null
  const viewingPast = !!current && current.completed
  const returnTo = viewingPast ? liveSibling : null

  /* Never offer to add a process the asset is already running. */
  const held = new Set(live.map(r => r.workflow_id))
  const joinableOut = joinable.filter(j => !held.has(j.id))

  return {
    current,
    active,
    previousCycles,
    otherCompleted,
    joinable: joinableOut,
    viewingPast,
    returnTo,
  }
}
