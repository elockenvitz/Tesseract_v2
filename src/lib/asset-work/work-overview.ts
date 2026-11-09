/**
 * What the organization is doing about this asset, on one page.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * Opening Work showed a sidebar of seven headings — Processes, Ideas,
 * Investigations, Lists, Themes, Portfolios, Projects — and auto-opened
 * whichever item happened to sort first. Every category had equal weight,
 * so a portfolio the asset merely belongs to sat at the same rank as a
 * requirement due today, and the reader's first act was always to work out
 * which of seven lists to read.
 *
 * ── The ordering rule, and what it refuses to do ────────────────────────
 *
 * Everything here is derived from records that already exist. There is no
 * urgency score, no staleness heuristic and no ranking model: inventing a
 * number and sorting by it would put an unexplained judgment at the top of
 * the page, and nothing in the schema substantiates one.
 *
 * What IS used, in this order, is categorical and checkable:
 *
 *   1. a run with an explicit deadline that has passed
 *   2. a run with a deadline
 *   3. the run the reader last had open
 *   4. the run with outstanding requirements, most recently touched
 *
 * Ties keep source order. "Most recently touched" is a real column
 * (`updated_at` on the progress row), not a guess about attention.
 */

export interface OverviewRunInput {
  workflowId: string
  /** Process name without the cycle suffix, and the cycle. */
  name: string
  cycle: string | null
  currentStageId: string | null
  currentStageLabel: string | null
  isStarted: boolean
  isCompleted: boolean
  /** Requirement rows for THIS run and asset. */
  requirementsTotal: number
  requirementsDone: number
  /** The next requirement with work left, if the caller could identify one. */
  nextRequirementId: string | null
  nextRequirementText: string | null
  assigneeName: string | null
  /** ISO. Null when the run carries no deadline, which is the common case. */
  dueDate: string | null
  updatedAt: string | null
}

export interface OverviewRun extends OverviewRunInput {
  outstanding: number
  /** True only when a real due date is in the past. Never inferred. */
  overdue: boolean
}

export interface ResumeTarget {
  workflowId: string
  stageId: string | null
  requirementId: string | null
  processName: string
  cycle: string | null
  stageLabel: string | null
  requirementText: string | null
  /** Why this is the suggestion. Shown to the reader, never a score. */
  reason: string
}

export interface AssetWorkOverview {
  runs: OverviewRun[]
  resume: ResumeTarget | null
  /** True when the asset has no live work of any kind. */
  quiet: boolean
}

const outstandingOf = (r: OverviewRunInput): number =>
  Math.max(0, r.requirementsTotal - r.requirementsDone)

const isOverdue = (due: string | null, now: Date): boolean => {
  if (!due) return false
  const d = new Date(due)
  return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime()
}

/**
 * Order the active runs and pick the one to offer as "continue working".
 *
 * `lastOpenedWorkflowId` is the reader's own saved selection, which is the
 * strongest non-invented signal available: they were working on it.
 */
export function buildWorkOverview(
  runs: readonly OverviewRunInput[],
  opts: {
    lastOpenedWorkflowId?: string | null
    hasIdeas?: boolean
    hasInvestigations?: boolean
    now?: Date
  } = {},
): AssetWorkOverview {
  const now = opts.now ?? new Date()

  const live = runs
    .filter(r => !r.isCompleted)
    .map<OverviewRun>(r => ({
      ...r,
      outstanding: outstandingOf(r),
      overdue: isOverdue(r.dueDate, now),
    }))

  /* Stable: `sort` is not guaranteed stable across every engine for large
     inputs, so rank ties are broken by the input index. */
  const ranked = live
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const rank = (x: OverviewRun) =>
        x.overdue ? 0
        : x.dueDate ? 1
        : x.workflowId === opts.lastOpenedWorkflowId ? 2
        : x.outstanding > 0 ? 3
        : 4
      const d = rank(a.r) - rank(b.r)
      if (d !== 0) return d
      const t = String(b.r.updatedAt ?? '').localeCompare(String(a.r.updatedAt ?? ''))
      if (t !== 0) return t
      return a.i - b.i
    })
    .map(x => x.r)

  const resume = pickResume(ranked, opts.lastOpenedWorkflowId ?? null)

  return {
    runs: ranked,
    resume,
    quiet: ranked.length === 0 && !opts.hasIdeas && !opts.hasInvestigations,
  }
}

function pickResume(
  ranked: readonly OverviewRun[],
  lastOpened: string | null,
): ResumeTarget | null {
  /*
   * The reader's own last run wins over the ranking, provided it still has
   * work: "continue working" means continue, and overriding it with a
   * different run because that one has a deadline would be the surface
   * deciding what they are doing.
   */
  const theirs = ranked.find(r => r.workflowId === lastOpened && r.outstanding > 0)
  const candidate = theirs ?? ranked.find(r => r.outstanding > 0) ?? null
  if (!candidate) return null

  const reason =
    candidate === theirs ? 'where you left off'
    : candidate.overdue ? 'past its deadline'
    : candidate.dueDate ? 'has a deadline'
    : 'the open work on this asset'

  return {
    workflowId: candidate.workflowId,
    stageId: candidate.currentStageId,
    requirementId: candidate.nextRequirementId,
    processName: candidate.name,
    cycle: candidate.cycle,
    stageLabel: candidate.currentStageLabel,
    requirementText: candidate.nextRequirementText,
    reason,
  }
}

/** "3 of 5" and a fraction, without dividing by zero. */
export function progressOf(r: Pick<OverviewRun, 'requirementsDone' | 'requirementsTotal'>): {
  label: string
  fraction: number
} {
  if (r.requirementsTotal <= 0) return { label: 'no requirements', fraction: 0 }
  return {
    label: `${r.requirementsDone} of ${r.requirementsTotal}`,
    fraction: r.requirementsDone / r.requirementsTotal,
  }
}
