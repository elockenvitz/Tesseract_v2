/**
 * What the team actually established during one Process cycle.
 *
 * ── What this is ────────────────────────────────────────────────────────
 *
 * A reading of rows that already exist: `asset_checklist_items` for the
 * requirements and their completion, `checklist_item_comments` for written
 * assessments, the notes column for operational work, and attachments.
 * Nothing here is stored. The report is a VIEW of the canonical work, so
 * it cannot drift from it and there is no second copy to maintain.
 *
 * ── The rules this module exists to enforce ─────────────────────────────
 *
 * The temptation in a report is to make it read well. Every rule below
 * exists because the readable version would be a lie:
 *
 *   No conclusion from completion. A ticked requirement with nothing
 *   written is "done, nothing recorded" — never summarised as a finding,
 *   and never counted as one. This is the distinction the report exists
 *   to preserve, so it is modelled explicitly rather than implied by an
 *   empty string.
 *
 *   No merging of contributors. Two people who wrote against the same
 *   requirement produce two attributed entries. Collapsing them would
 *   manufacture a consensus nobody stated, and if they disagree it would
 *   erase the disagreement.
 *
 *   No synthesis. There is no stage summary and no report conclusion.
 *   Composing one from the entries would put words in the organization's
 *   mouth under a heading that reads as theirs.
 *
 *   No decisions that are not decisions. A `decision` entry is only ever
 *   a row the caller read from a decision record. A commentary is
 *   commentary however decisive it sounds.
 *
 *   Nothing invented. No estimates, no consensus, no sources, no dates
 *   other than the ones on the rows.
 */

export type EntryKind = 'assessment' | 'note' | 'attachment'

export interface ReportEntry {
  kind: EntryKind
  /** Verbatim. Never summarised, never truncated here. */
  text: string
  authorName: string | null
  /** ISO, from the row. */
  at: string | null
  /** For attachments: what to open. */
  href?: string | null
}

/** How much of an answer a requirement carries. Order matters: see below. */
export type RequirementOutcome =
  /** Work was written down. */
  | 'documented'
  /** Marked done, nothing written. The distinction the brief requires. */
  | 'done-undocumented'
  /** Explicitly not applicable. */
  | 'not-applicable'
  /** Nothing yet. */
  | 'outstanding'

export interface ReportRequirement {
  requirementId: string
  text: string
  outcome: RequirementOutcome
  entries: ReportEntry[]
  completedAt: string | null
  completedByName: string | null
}

export interface ReportStage {
  stageId: string
  label: string
  /** The Process definition's own description, when it has one. */
  objective: string | null
  requirements: ReportRequirement[]
  documented: number
  outstanding: number
}

export interface ReportContributor {
  name: string
  /** How many entries they wrote. Attribution, not a leaderboard. */
  entries: number
}

export interface ProcessReport {
  stages: ReportStage[]
  contributors: ReportContributor[]
  /** Requirements carrying written work, across the whole cycle. */
  documented: number
  /** Ticked with nothing written. Reported separately, never as findings. */
  doneUndocumented: number
  outstanding: number
  total: number
  /** Earliest and latest entry dates, from the rows. Null when none. */
  firstAt: string | null
  lastAt: string | null
  /** True when no requirement in the cycle carries any written work. */
  empty: boolean
}

export interface ReportRequirementInput {
  requirementId: string
  stageId: string | null
  text: string | null
  status?: string | null
  completed?: boolean | null
  completedAt?: string | null
  completedByName?: string | null
  notes?: string | null
  /** One per contributor, as stored. Never pre-merged by the caller. */
  commentaries?: ReadonlyArray<{
    text: string | null
    authorName: string | null
    at: string | null
  }> | null
  attachments?: ReadonlyArray<{
    name: string | null
    at: string | null
    authorName?: string | null
    href?: string | null
  }> | null
}

export interface ReportStageInput {
  stageId: string
  label: string
  description?: string | null
  sortOrder?: number
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim()
  return t ? t : null
}

function entriesFor(r: ReportRequirementInput): ReportEntry[] {
  const out: ReportEntry[] = []

  /* One entry per contributor, in the order the caller read them. */
  for (const c of r.commentaries ?? []) {
    const text = clean(c.text)
    if (text) out.push({ kind: 'assessment', text, authorName: c.authorName ?? null, at: c.at ?? null })
  }

  /*
   * Notes are the operational requirements' store, so they are real work
   * and belong in the report. They carry no author or timestamp of their
   * own; borrowing the completion fields would attribute the text to
   * whoever ticked the box, which is a different act and often a
   * different person.
   */
  const notes = clean(r.notes)
  if (notes) out.push({ kind: 'note', text: notes, authorName: null, at: null })

  for (const a of r.attachments ?? []) {
    const name = clean(a.name)
    if (name) {
      out.push({
        kind: 'attachment', text: name,
        authorName: a.authorName ?? null, at: a.at ?? null, href: a.href ?? null,
      })
    }
  }

  return out
}

function outcomeOf(r: ReportRequirementInput, entries: readonly ReportEntry[]): RequirementOutcome {
  /* An attachment alone is evidence, not an assessment — but it IS work
     recorded against the requirement, so it counts as documented. */
  if (entries.length > 0) return 'documented'
  if (r.status === 'na') return 'not-applicable'
  if (r.completed || r.status === 'completed') return 'done-undocumented'
  return 'outstanding'
}

/**
 * Assemble the cycle's record.
 *
 * `stages` comes from the Process definition and fixes the order; a
 * requirement whose stage is not in that list is kept under an "unfiled"
 * stage rather than dropped, because losing somebody's written work
 * because a definition changed underneath it is the worst failure this
 * surface has.
 */
export function buildProcessReport(
  stages: readonly ReportStageInput[],
  requirements: readonly ReportRequirementInput[],
): ProcessReport {
  const ordered = [...stages].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const byStage = new Map<string, ReportRequirement[]>()
  const contributors = new Map<string, number>()
  let firstAt: string | null = null
  let lastAt: string | null = null

  const UNFILED = '__unfiled__'

  for (const r of requirements) {
    const entries = entriesFor(r)
    const outcome = outcomeOf(r, entries)

    for (const e of entries) {
      if (e.authorName) contributors.set(e.authorName, (contributors.get(e.authorName) ?? 0) + 1)
      if (e.at) {
        if (!firstAt || e.at < firstAt) firstAt = e.at
        if (!lastAt || e.at > lastAt) lastAt = e.at
      }
    }

    const key = r.stageId && ordered.some(s => s.stageId === r.stageId) ? r.stageId : UNFILED
    const list = byStage.get(key) ?? []
    list.push({
      requirementId: r.requirementId,
      /* An untouched template row has no text of its own. */
      text: clean(r.text) ?? 'Untitled requirement',
      outcome,
      entries,
      completedAt: r.completedAt ?? null,
      completedByName: r.completedByName ?? null,
    })
    byStage.set(key, list)
  }

  const build = (stageId: string, label: string, objective: string | null): ReportStage => {
    const reqs = byStage.get(stageId) ?? []
    return {
      stageId,
      label,
      objective,
      requirements: reqs,
      documented: reqs.filter(x => x.outcome === 'documented').length,
      outstanding: reqs.filter(x => x.outcome === 'outstanding').length,
    }
  }

  const out: ReportStage[] = ordered.map(s => build(s.stageId, s.label, clean(s.description)))
  if (byStage.has(UNFILED)) {
    out.push(build(UNFILED, 'Not in the current definition', null))
  }

  const all = out.flatMap(s => s.requirements)

  return {
    stages: out,
    contributors: [...contributors.entries()]
      .map(([name, entries]) => ({ name, entries }))
      .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name)),
    documented: all.filter(r => r.outcome === 'documented').length,
    doneUndocumented: all.filter(r => r.outcome === 'done-undocumented').length,
    outstanding: all.filter(r => r.outcome === 'outstanding').length,
    total: all.length,
    firstAt,
    lastAt,
    empty: all.every(r => r.entries.length === 0),
  }
}

/**
 * A report shell for the moment before the real one has loaded.
 *
 * It lives here rather than beside the component so the component file
 * exports only components, which is what fast refresh needs.
 */
export const EMPTY_REPORT: ProcessReport = {
  stages: [], contributors: [], documented: 0, doneUndocumented: 0,
  outstanding: 0, total: 0, firstAt: null, lastAt: null, empty: true,
}

/** What the header says about the cycle's state. Derived, never asserted. */
export function reportHeadline(report: ProcessReport): string {
  if (report.total === 0) return 'This cycle has no requirements.'
  if (report.empty) {
    /*
     * "Nothing written" and "nothing written, but four were ticked" are
     * different states, and the second is the one worth seeing: it means
     * the cycle LOOKS finished and holds no reasoning. An early return
     * that only said "nothing written yet" buried exactly that.
     */
    if (report.doneUndocumented > 0) {
      return `No work has been written down in this cycle yet — ${report.doneUndocumented} ` +
        `${report.doneUndocumented === 1 ? 'requirement is' : 'requirements are'} ` +
        'marked done without a written finding.'
    }
    return 'No work has been written down in this cycle yet.'
  }
  const parts = [`${report.documented} of ${report.total} requirements carry written work`]
  if (report.doneUndocumented > 0) {
    /* Named, not folded into the documented count. */
    parts.push(`${report.doneUndocumented} marked done without a written finding`)
  }
  if (report.outstanding > 0) parts.push(`${report.outstanding} still open`)
  return parts.join(' · ')
}
