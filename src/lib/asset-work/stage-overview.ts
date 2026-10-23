import { statusOf, isSatisfied, type RequirementStatus, type StatusBearing } from './requirement-status'

/**
 * What a stage looks like before anybody has opened a requirement.
 *
 * ── The state this replaces ─────────────────────────────────────────────
 *
 * "Pick a requirement to record what you found." — a dashed box filling two
 * thirds of the working surface beside a column of five titles. Everything
 * the organization already knew about the stage was one click away and
 * therefore invisible: which requirements carry a finding, who wrote it,
 * when, and which one the analyst had been working on. The reader had to
 * open all five to learn what the stage amounted to.
 *
 * ── Honest derivation, no new statuses ──────────────────────────────────
 *
 * The database stores completion (`unchecked | completed | na`), operational
 * notes, attachments, an assignee, a due date, and commentary rows. Nothing
 * stores "in progress" and nothing stores "blocked". So this module invents
 * neither. What it does is stop treating a requirement that carries a
 * written finding as untouched, which is the one thing the existing
 * presentation got wrong: commentary lives in `checklist_item_comments`, the
 * rail only looked at `notes`, and a thinking requirement with three
 * paragraphs of analysis rendered exactly like an empty one.
 *
 * Every label here is a restatement of a stored fact. "Documented" means a
 * commentary row, a note or an attachment exists — not that the work is
 * good, or close to done.
 */

/** Derived presentation state. Each maps to facts, never to a judgement. */
export type WorkState = 'complete' | 'not-applicable' | 'documented' | 'assigned' | 'not-started'

export interface RequirementFacts extends StatusBearing {
  id: string
  text: string
  /** A `checklist_item_comments` row by anyone. */
  hasCommentary?: boolean
  /** `asset_checklist_items.notes`, which only operational items use. */
  hasNotes?: boolean
  hasAttachments?: boolean
  assigneeName?: string | null
  dueDate?: string | null
  completedAt?: string | null
  completedByName?: string | null
  /** For "assigned to you", which outranks "assigned to somebody". */
  assigneeId?: string | null
}

export interface RequirementPresentation {
  id: string
  state: WorkState
  /** The state in words, for a reader. */
  label: string
  /** Who and when, where the data says so. Null when it does not. */
  detail: string | null
}

const shortDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const hasWorkProduct = (f: RequirementFacts): boolean =>
  !!(f.hasCommentary || f.hasNotes || f.hasAttachments)

export function presentRequirement(f: RequirementFacts): RequirementPresentation {
  const status: RequirementStatus = statusOf(f)

  if (status === 'completed') {
    const when = shortDate(f.completedAt)
    const by = f.completedByName
    return {
      id: f.id,
      state: 'complete',
      label: 'Complete',
      detail: by && when ? `${by} · ${when}` : by ?? when ?? null,
    }
  }

  if (status === 'na') {
    return { id: f.id, state: 'not-applicable', label: 'Not applicable', detail: shortDate(f.completedAt) }
  }

  if (hasWorkProduct(f)) {
    /*
     * Open, with something written against it. The strongest honest claim
     * available: somebody has started. Deliberately NOT "in progress" —
     * nothing distinguishes a half-written note from a finished thought
     * that nobody ticked.
     */
    return {
      id: f.id,
      state: 'documented',
      label: 'Documented',
      detail: f.assigneeName ?? null,
    }
  }

  if (f.assigneeName) {
    const due = shortDate(f.dueDate)
    return {
      id: f.id,
      state: 'assigned',
      label: `Assigned · ${f.assigneeName}`,
      detail: due ? `due ${due}` : null,
    }
  }

  return { id: f.id, state: 'not-started', label: 'Not started', detail: null }
}

export interface ResumeChoice {
  id: string
  text: string
  /** Why this one — shown to the reader, so the recommendation is checkable. */
  reason: string
  /** "Resume" reads wrong on a requirement nobody has touched. */
  verb: 'Resume' | 'Start'
}

/**
 * Which requirement to offer, and why.
 *
 * Precedence, strongest evidence of work in flight first. Picking the first
 * open row would send an analyst who wrote half a finding yesterday back to
 * the top of the list.
 */
export function chooseResume(
  facts: readonly RequirementFacts[],
  viewerId?: string | null,
): ResumeChoice | null {
  const open = facts.filter(f => !isSatisfied(statusOf(f)))
  if (!open.length) return null

  const documented = open.find(hasWorkProduct)
  if (documented) {
    return {
      id: documented.id,
      text: documented.text,
      reason: 'it already carries a finding to finish',
      verb: 'Resume',
    }
  }

  const mine = viewerId ? open.find(f => f.assigneeId === viewerId) : undefined
  if (mine) {
    return { id: mine.id, text: mine.text, reason: 'it is assigned to you', verb: 'Start' }
  }

  const dated = open
    .filter(f => !!shortDate(f.dueDate))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0]
  if (dated) {
    return {
      id: dated.id,
      text: dated.text,
      reason: `it is due first, on ${shortDate(dated.dueDate)}`,
      verb: 'Start',
    }
  }

  return {
    id: open[0].id,
    text: open[0].text,
    reason: 'it is the first requirement still open',
    verb: 'Start',
  }
}

export interface StageObjective {
  text: string
  /** `definition` is the organization's own words; `fallback` is not. */
  source: 'definition' | 'fallback'
}

/**
 * The stage's question, from the Process definition.
 *
 * A stage with no configured description gets its own label and a stated
 * absence rather than a composed objective — this surface must never put
 * words in the organization's mouth under a heading that reads as theirs.
 */
export function stageObjective(stage: { label?: string | null; description?: string | null }): StageObjective {
  const description = stage.description?.trim()
  if (description) return { text: description, source: 'definition' }
  return { text: stage.label?.trim() || 'This stage', source: 'fallback' }
}

export interface StageTally {
  total: number
  complete: number
  /** Open requirements that already carry written work. */
  documented: number
  /**
   * SATISFIED requirements that carry written work — the ones that were
   * argued rather than only ticked. Counted separately from `documented`
   * because a finished stage has no open requirements left, and a single
   * count would have reported a fully ticked, entirely unwritten stage as
   * though the analysis were done.
   */
  argued: number
  open: number
  /** True when every requirement is satisfied — nothing left to resume. */
  finished: boolean
}

export function tallyStage(facts: readonly RequirementFacts[]): StageTally {
  const total = facts.length
  const complete = facts.filter(f => isSatisfied(statusOf(f))).length
  const open = total - complete
  return {
    total,
    complete,
    documented: facts.filter(f => !isSatisfied(statusOf(f)) && hasWorkProduct(f)).length,
    argued: facts.filter(f => isSatisfied(statusOf(f)) && hasWorkProduct(f)).length,
    open,
    finished: total > 0 && open === 0,
  }
}

/**
 * How far this stage's argument has actually been written.
 *
 * ── What this used to say, and why it no longer says it ─────────────────
 *
 * This explained the schema: "a stage conclusion is not stored separately",
 * "recorded on the requirements themselves". True, and no business of the
 * analyst's — it answered a question about tables for a reader asking a
 * question about an investment. Where the stage's reasoning lives is the
 * surface's problem, not something to narrate.
 *
 * So this now reports only the substance: how much of the stage is argued
 * rather than merely ticked. It still never synthesises — a stage summary
 * assembled from requirement commentary would put one analyst's note under
 * a heading implying the firm's view.
 */
export function synthesisNote(t: StageTally): string {
  if (t.total === 0) return 'This stage has no requirements yet.'
  if (t.finished) {
    /* Satisfied is not the same as argued: a stage can be fully ticked with
       nothing written down, and saying "every requirement is satisfied"
       alone would let that pass as finished analysis. */
    if (t.argued === 0) {
      return `Every requirement is ticked, but ${t.complete === 1 ? 'it carries' : 'none carries'} a written assessment.`
    }
    if (t.argued === t.complete) {
      return `Every requirement is satisfied, each with a written assessment.`
    }
    return `Every requirement is satisfied; ${t.argued} of ${t.complete} ${t.argued === 1 ? 'carries' : 'carry'} a written assessment.`
  }
  /* "None carries a written finding" read as a claim about the whole stage
     when a completed requirement's finding was displayed directly above it.
     Both branches now say which requirements they are counting. */
  return t.documented === 0
    ? `None of the ${t.open} open ${t.open === 1 ? 'requirement has' : 'requirements has'} an assessment written yet.`
    : `${t.documented} of ${t.open} open ${t.documented === 1 ? 'has' : 'have'} an assessment written.`
}
