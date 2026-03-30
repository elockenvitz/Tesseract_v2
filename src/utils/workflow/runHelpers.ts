/**
 * Run Helpers
 *
 * Shared utility functions for workflow run (branch) filtering and display.
 * Centralizes logic that was previously duplicated across ActiveRunsTable,
 * RecurringProcessesHomePanel, RunHistoryTable, and useActiveRuns.
 */

/**
 * Checks whether a date string parses to a valid Date.
 */
function isValidDate(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime())
}

// ─── Predicates ────────────────────────────────────────────────

/**
 * Returns true if the workflow row represents a run (child branch),
 * i.e. it has a non-null parent_workflow_id.
 */
export function isRun(workflow: { parent_workflow_id?: string | null }): boolean {
  return !!workflow.parent_workflow_id
}

/**
 * Returns true if the workflow row is an active run:
 *  - Is a run (has parent_workflow_id)
 *  - Not archived
 *  - Not deleted
 *  - Status is 'active' (not 'ended')
 */
export function isActiveRun(workflow: {
  parent_workflow_id?: string | null
  archived?: boolean
  archived_at?: string | null
  deleted?: boolean
  deleted_at?: string | null
  status?: string | null
}): boolean {
  if (!isRun(workflow)) return false
  if (workflow.archived === true || (workflow.archived_at != null && workflow.archived_at !== '')) return false
  if (workflow.deleted === true || (workflow.deleted_at != null && workflow.deleted_at !== '')) return false
  if (workflow.status && workflow.status !== 'active') return false
  return true
}

/**
 * Returns true if the run is "ended" (status === 'inactive', but not archived/deleted).
 *
 * Note: The DB CHECK constraint uses 'active' | 'inactive' — NOT 'ended'.
 * A run is considered ended when status='inactive' and it hasn't been archived.
 */
export function isEndedRun(workflow: {
  parent_workflow_id?: string | null
  archived?: boolean
  deleted?: boolean
  status?: string | null
}): boolean {
  if (!isRun(workflow)) return false
  if (workflow.archived === true || workflow.deleted === true) return false
  return workflow.status === 'inactive'
}

/**
 * Returns true if the run is archived.
 */
export function isArchivedRun(workflow: {
  parent_workflow_id?: string | null
  archived?: boolean
}): boolean {
  if (!isRun(workflow)) return false
  return workflow.archived === true
}

/**
 * Returns true if a parent process (workflow) is active:
 *  - Not archived
 *  - Not deleted
 *  - Status is 'active' (or null/undefined, which defaults to active)
 *
 * Works with both full WorkflowWithStats objects and partial parent data
 * from useActiveRuns (parent_archived, parent_status, parent_deleted fields).
 */
export function isActiveProcess(process: {
  archived?: boolean
  archived_at?: string | null
  deleted?: boolean
  deleted_at?: string | null
  status?: string | null
}): boolean {
  if (process.archived === true || (process.archived_at != null && process.archived_at !== '')) return false
  if (process.deleted === true || (process.deleted_at != null && process.deleted_at !== '')) return false
  if (process.status && process.status !== 'active') return false
  return true
}

// ─── Version helpers ──────────────────────────────────────────

/**
 * Returns a compact version label for a run.
 * Examples: "v1", "v3", or "v—" if no version is available.
 */
export function getRunVersionLabel(run: {
  template_version_number?: number | null
}): string {
  if (run.template_version_number != null && run.template_version_number > 0) {
    return `v${run.template_version_number}`
  }
  return 'v—'
}

/**
 * Returns a human-readable tooltip for the version chip.
 * Examples: "Process definition v1", or "No definition version" if unavailable.
 */
export function getRunVersionTooltip(run: {
  template_version_number?: number | null
}): string {
  if (run.template_version_number != null && run.template_version_number > 0) {
    return `Process definition v${run.template_version_number}`
  }
  return 'No definition version assigned'
}

// ─── Attention helpers ────────────────────────────────────────

export interface AttentionCounts {
  /** Runs with 0 total assets — run exists but no work has been scoped */
  notStarted: number
  /** Processes with >1 active run — older runs should be ended */
  multipleRuns: number
}

// ─── Date helpers ──────────────────────────────────────────────

/**
 * Determines the best "started at" date for a run.
 * Preference order: branched_at → created_at.
 * Returns null if no valid date is available.
 */
export function getRunStartedAt(workflow: {
  branched_at?: string | null
  created_at?: string | null
}): string | null {
  if (workflow.branched_at) {
    const d = new Date(workflow.branched_at)
    if (isValidDate(d)) return workflow.branched_at
  }
  if (workflow.created_at) {
    const d = new Date(workflow.created_at)
    if (isValidDate(d)) return workflow.created_at
  }
  return null
}

/**
 * Formats a date string as a safe past-relative time (e.g. "3d ago").
 * Returns "—" for null, undefined, or unparseable dates.
 */
export function safeRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (!isValidDate(date)) return '—'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'In the future'
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

/**
 * Formats a date string as a safe future-relative time (e.g. "In 3d").
 * Returns "—" for null, undefined, or unparseable dates.
 */
export function safeFutureRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (!isValidDate(date)) return '—'

  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return 'Overdue'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 7) return `In ${diffDays}d`
  if (diffDays < 30) return `In ${Math.floor(diffDays / 7)}w`
  if (diffDays < 365) return `In ${Math.floor(diffDays / 30)}mo`
  return `In ${Math.floor(diffDays / 365)}y`
}

/**
 * Formats a date as a short absolute date string.
 * Returns "—" for null/invalid.
 */
export function safeFormatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (!isValidDate(date)) return '—'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ─── Scope helpers ────────────────────────────────────────────

/**
 * Returns a human-readable "remaining" label based on scope type.
 * Examples: "3 assets", "2 portfolios", "Stage 2 of 4"
 */
export function getScopeRemainingLabel(run: {
  scope_type?: string | null
  items_remaining?: number
  total_items?: number
  assets_remaining?: number
  total_assets?: number
}): string {
  const scope = run.scope_type || 'asset'
  const remaining = run.items_remaining ?? run.assets_remaining ?? 0
  const total = run.total_items ?? run.total_assets ?? 0

  if (scope === 'general') {
    // For general scope: "Stage X of Y" is more meaningful
    // But we only have completed/total counts here, not stage position.
    // Show "1 remaining" or "Complete" style
    if (total === 0) return '—'
    if (remaining === 0) return 'Complete'
    return 'In progress'
  }

  if (total === 0) return `0 ${scope === 'portfolio' ? 'portfolios' : 'assets'}`
  const noun = scope === 'portfolio'
    ? (remaining === 1 ? 'portfolio' : 'portfolios')
    : (remaining === 1 ? 'asset' : 'assets')
  return `${remaining} ${noun}`
}

/**
 * Returns a short scope badge label for display.
 */
export function getScopeBadgeLabel(scopeType: string | null | undefined): string | null {
  switch (scopeType) {
    case 'portfolio': return 'Portfolio'
    case 'general': return 'Standalone'
    case 'asset': return 'Asset'
    default: return null
  }
}

/**
 * Returns a fixed color for a process based on its scope type.
 */
export function getScopeColor(scopeType: string | null | undefined): string {
  switch (scopeType) {
    case 'asset': return '#3b82f6'      // blue-500
    case 'portfolio': return '#8b5cf6'  // violet-500
    case 'general': return '#f59e0b'    // amber-500
    default: return '#6b7280'           // gray-500
  }
}

// ─── Grouping ─────────────────────────────────────────────────

export interface ProcessRunGroup {
  parentWorkflowId: string
  parentName: string
  parentColor: string | null
  /** Most recent run (by started_at_display) — the canonical row */
  canonical: { id: string; [key: string]: any }
  /** Older runs for the same process (need cleanup) */
  duplicates: { id: string; [key: string]: any }[]
}

/**
 * Groups runs by parent_workflow_id. Within each group, the run with the
 * most recent started_at_display is canonical; all others are duplicates.
 * Returns groups sorted by canonical run's assets_remaining DESC.
 */
export function groupRunsByProcess<T extends {
  id: string
  parent_workflow_id: string
  parent_name: string
  parent_color: string | null
  started_at_display: string | null
  assets_remaining: number
}>(runs: T[]): ProcessRunGroup[] {
  const map = new Map<string, T[]>()
  for (const run of runs) {
    const list = map.get(run.parent_workflow_id) || []
    list.push(run)
    map.set(run.parent_workflow_id, list)
  }

  const groups: ProcessRunGroup[] = []
  for (const [parentId, siblings] of map) {
    // Sort by started_at_display DESC — most recent first
    siblings.sort((a, b) => {
      const da = a.started_at_display ? new Date(a.started_at_display).getTime() : 0
      const db = b.started_at_display ? new Date(b.started_at_display).getTime() : 0
      return db - da
    })

    const [canonical, ...duplicates] = siblings
    groups.push({
      parentWorkflowId: parentId,
      parentName: canonical.parent_name,
      parentColor: canonical.parent_color,
      canonical,
      duplicates,
    })
  }

  // Sort groups by canonical's assets_remaining DESC
  groups.sort((a, b) =>
    (b.canonical as T).assets_remaining - (a.canonical as T).assets_remaining
  )

  return groups
}
