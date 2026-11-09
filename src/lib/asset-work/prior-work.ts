/**
 * What this organization wrote the last time it ran this requirement.
 *
 * ── Why matching is hard here, and what it is allowed to claim ──────────
 *
 * A recurring Process is re-cut as a new workflow each cycle, so nothing is
 * shared between runs: requirement rows are per-run, and `item_id` points at
 * that run's own template copy. There is no foreign key from this quarter's
 * "Read/Summarize News" to last quarter's.
 *
 * What there is, reliably, is the requirement's TEXT, stored on the row the
 * moment anybody works it (`asset_checklist_items.item_text`). Two rows in
 * two cycles of one Process carrying the identical label are the same step
 * of the same procedure, and that is the only claim made here.
 *
 * ── The three outcomes, and why ambiguity is one of them ────────────────
 *
 *   matched     exactly one prior row whose normalised label equals this
 *               one's. Its finding is shown, read-only, attributed.
 *   ambiguous   several rows in one prior run share the label. Pairing one
 *               of them would be a guess, so the RUN is offered for the
 *               reader to open instead.
 *   none        no prior row carries this label. Said plainly.
 *
 * Normalisation is deliberately conservative — case, surrounding space and
 * runs of whitespace only. Not punctuation, not stemming, not "close
 * enough": "Review Our Model" and "Review our models" are different
 * instructions, and a surface that silently equates them would attribute
 * one analyst's conclusion to a question nobody asked.
 */

export type PriorWorkOutcome = 'matched' | 'ambiguous' | 'none'

export interface PriorRunRef {
  workflowId: string
  /** "Mar 27 2026", or the process name when a run carries no suffix. */
  label: string
  /** When the cycle was cut. */
  at: string | null
}

export interface PriorWorkRow {
  /** `asset_checklist_items.id` in the earlier run. */
  itemId: string
  run: PriorRunRef
  requirementText: string
  /** The written assessment, verbatim. Never summarised. */
  finding: string | null
  authorName: string | null
  writtenAt: string | null
  /** `asset_checklist_items.notes`, for operational requirements. */
  notes: string | null
  completed: boolean
}

export interface PriorWork {
  outcome: PriorWorkOutcome
  /** Populated only when `matched`. */
  match: PriorWorkRow | null
  /**
   * Runs worth opening by hand: those carrying work this module declined
   * to pair, plus the ambiguous ones.
   */
  runsToReview: PriorRunRef[]
}

/** Case, outer space, and runs of whitespace. Nothing else. */
export const normalizeLabel = (text: string | null | undefined): string =>
  (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** A row carries work when somebody wrote something against it. */
export const carriesWork = (r: Pick<PriorWorkRow, 'finding' | 'notes'>): boolean =>
  !!(r.finding?.trim() || r.notes?.trim())

/**
 * Pair this requirement with the work recorded against the same label in
 * earlier cycles.
 *
 * `candidates` must already be limited to the SAME asset and to runs of the
 * same Process — this function does not know what a Process is and must not
 * be handed rows from elsewhere.
 */
export function matchPriorWork(
  requirementText: string | null | undefined,
  candidates: readonly PriorWorkRow[],
): PriorWork {
  const target = normalizeLabel(requirementText)
  const withWork = candidates.filter(carriesWork)

  if (!target) {
    return { outcome: 'none', match: null, runsToReview: distinctRuns(withWork) }
  }

  const sameLabel = withWork.filter(c => normalizeLabel(c.requirementText) === target)

  if (sameLabel.length === 0) {
    /* Nothing with this label, but the reader may still want the cycles
       where other work was done. */
    return { outcome: 'none', match: null, runsToReview: distinctRuns(withWork) }
  }

  /* Newest first, so "last quarter" wins over the quarter before it. */
  const ordered = [...sameLabel].sort((a, b) =>
    String(b.run.at ?? '').localeCompare(String(a.run.at ?? '')))

  const newestRun = ordered[0].run.workflowId
  const inNewestRun = ordered.filter(r => r.run.workflowId === newestRun)

  if (inNewestRun.length > 1) {
    /* One run, two requirements with the same name. Which one this quarter's
       step continues is not knowable from a label. */
    return { outcome: 'ambiguous', match: null, runsToReview: distinctRuns(sameLabel) }
  }

  return {
    outcome: 'matched',
    match: inNewestRun[0],
    /* Earlier cycles beyond the one shown, for a reader following a trend. */
    runsToReview: distinctRuns(ordered.slice(1)),
  }
}

function distinctRuns(rows: readonly PriorWorkRow[]): PriorRunRef[] {
  const seen = new Map<string, PriorRunRef>()
  for (const r of rows) if (!seen.has(r.run.workflowId)) seen.set(r.run.workflowId, r.run)
  return [...seen.values()].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
}
