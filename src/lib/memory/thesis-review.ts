/**
 * When was this thesis last LOOKED AT, as opposed to last edited?
 *
 * ── The gap ──────────────────────────────────────────────────────────────
 *
 * Staleness has always been measured from `asset_contributions.updated_at` --
 * the last time somebody changed the text. That makes "I read this and it
 * still holds" unrecordable: the only way to clear a stale flag was to edit a
 * thesis that did not need editing. So the finding recurred every morning, and
 * the honest answer ("three people have read this and agreed") was
 * indistinguishable from the alarming one ("nobody has looked in 100 days").
 *
 * `memory_events` now carries `thesis.reviewed`. This is the one shared read
 * that turns those events into a per-asset timestamp, so Research and Today
 * cannot disagree about what counts as recent.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It does not touch the thesis. `asset_contributions` remains authoritative
 * for the content and for the written/edited date the reader sees on screen --
 * a review is not an edit, and relabelling one as the other would be a lie
 * about the document. Only the ATTENTION clock moves.
 */

/** The age clock for a thesis: the later of when it was written and when it
 *  was last confirmed to still hold. Either may be absent. */
export function effectiveThesisDate(
  thesisUpdatedAt: string | null | undefined,
  lastReviewedAt: string | null | undefined,
): string | null {
  const written = thesisUpdatedAt || null
  const reviewed = lastReviewedAt || null
  if (!written) return reviewed
  if (!reviewed) return written
  // ISO-8601 from Postgres sorts lexically, which is what every other date
  // comparison in this codebase relies on.
  return reviewed > written ? reviewed : written
}

/** Whole days between the effective date and `now`. Null when there is no
 *  date at all -- a subject with no thesis is not a stale one. */
export function thesisAgeDays(
  thesisUpdatedAt: string | null | undefined,
  lastReviewedAt: string | null | undefined,
  now: Date,
): number | null {
  const at = effectiveThesisDate(thesisUpdatedAt, lastReviewedAt)
  if (!at) return null
  return Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000)
}

/**
 * Which conclusions stop the staleness clock.
 *
 * Only `holds`. That is the EXISTING rule, not a new one: the clock exists to
 * ask "does anyone still stand behind this?", and `holds` is the only outcome
 * that answers yes.
 *
 * It has to be stated explicitly now because it used to be true by accident.
 * The reviews query never read the payload, and `holds` was the only outcome
 * the interface could produce -- so an outcome-blind clock and a holds-only
 * clock were the same clock. Offering `changed` and `needs_work` separates
 * them, and without this a reader marking a thesis BROKEN would clear the very
 * flag telling everyone to look at it.
 *
 * Extending this set is a product decision about what "current" means, and is
 * deliberately not made here.
 */
const CLOCK_RESETTING_OUTCOMES: ReadonlySet<string> = new Set(['holds'])

/** Does this conclusion mean the case is still current? */
export function resetsStaleClock(outcome: string | null | undefined): boolean {
  // Absent outcome counts. Every review written before outcomes were offered
  // was a "still holds" -- it was the only thing the button could say -- and
  // reclassifying those rows would rewrite history the reader did not make.
  if (!outcome) return true
  return CLOCK_RESETTING_OUTCOMES.has(outcome)
}

/**
 * Newest CLOCK-RESETTING `thesis.reviewed` per asset, from rows already
 * fetched. The caller owns the query; this owns both rules -- newest wins, and
 * only a conclusion that the case still holds counts.
 *
 * A `changed` or `needs_work` review is still a durable, recorded fact; it just
 * is not evidence that the thesis is current, so it does not move this clock.
 */
export function latestReviewByAsset(
  rows: ReadonlyArray<{ subject_id: string; occurred_at: string; payload?: unknown }>,
): Map<string, string> {
  const out = new Map<string, string>()
  /*
   * ── Newest FIRST, then the clock test -- not the other way round ────────
   *
   * This used to skip every non-`holds` row before comparing dates, so the
   * map held the newest HOLD rather than the newest CONCLUSION. The
   * difference is the whole correction path: a reader who pressed "Still
   * holds" by accident and then "Changed" to fix it left the earlier hold
   * standing as the clock's answer, and the stale flag stayed cleared
   * forever. There was no way to take it back -- the interface offered a
   * later word and the clock could not hear it.
   *
   * `thesisChangedAfterCommit` already resolved its own newest-per-asset
   * before asking what the outcome was, and said so in as many words. The
   * two halves of the same question therefore disagreed about what a
   * reader's current position was. They agree now, in the same order.
   */
  const latest = new Map<string, { at: string; outcome: string | undefined }>()
  for (const r of rows) {
    if (!r.subject_id || !r.occurred_at) continue
    const outcome = (r.payload as { outcome?: string } | null | undefined)?.outcome
    const seen = latest.get(r.subject_id)
    if (!seen || r.occurred_at > seen.at) latest.set(r.subject_id, { at: r.occurred_at, outcome })
  }
  for (const [assetId, { at, outcome }] of latest) {
    // The reader's LAST word decides. An asset whose newest conclusion is
    // `changed` or `needs_work` is absent from this map however many holds
    // precede it, which is what makes the flag come back.
    if (!resetsStaleClock(outcome)) continue
    out.set(assetId, at)
  }
  return out
}

/** The three verdicts in the words every surface prints. Declared before its
 *  reader: a module const read from a function below it is the TDZ shape this
 *  codebase has been bitten by. */
const CONCLUSION_LABELS: Record<string, string> = {
  holds: 'Still holds',
  changed: 'Changed',
  needs_work: 'Needs work',
}

/**
 * The standing conclusion as a sentence, for the bar that offers to change it.
 *
 * Worded here rather than in each pane because two surfaces offer this choice
 * -- the Research detail pane and the list row -- and they already keep
 * separate copies of the three labels. A third divergence, in the line that
 * says what is on the record, would let one surface claim a verdict the other
 * does not show.
 *
 * "You marked" vs "Marked": whose conclusion it is decides whether correcting
 * it is a correction or an override of a colleague, and the reader is entitled
 * to know which before they press anything.
 */
export function conclusionWords(
  outcome: string,
  occurredAt: string,
  byMe: boolean,
  now: Date,
): string {
  const label = CONCLUSION_LABELS[outcome] ?? outcome
  const days = Math.floor((now.getTime() - new Date(occurredAt).getTime()) / 86_400_000)
  // `${n}d ago` is Research's existing idiom for an age; `today` is what it
  // says instead of "0d ago". A negative age (clock skew between the browser
  // and Postgres) reads as today rather than as the future.
  const when = days <= 0 ? 'today' : `${days}d ago`
  return `${byMe ? 'You marked' : 'Marked'} this ${label} · ${when}`
}

/** A conclusion as a surface needs to show it back to the person who made it. */
export interface ThesisConclusion {
  outcome: string
  occurredAt: string
  /** Who recorded it, where the row carries it. */
  actorId: string | null
}

/**
 * The CURRENT conclusion per asset -- newest wins, whatever it said.
 *
 * Separate from `latestReviewByAsset`, which answers "is this case current"
 * and so counts only `holds`. This answers "what did the reader last say",
 * which is the question a surface asking them to correct it has to put on
 * screen. A pane that cannot show the standing verdict cannot offer to change
 * it: the three buttons read as unanswered every time the pane remounts, and
 * an accidental press is invisible rather than fixable.
 *
 * Rows with no outcome are skipped. They are pre-outcome reviews and there is
 * no verdict word to display for them -- `resetsStaleClock` still treats them
 * as holds for the clock, which is a different question from what to print.
 */
export function latestConclusionByAsset(
  rows: ReadonlyArray<{
    subject_id: string; occurred_at: string
    outcome?: string | null; actor_id?: string | null
  }>,
): Map<string, ThesisConclusion> {
  const out = new Map<string, ThesisConclusion>()
  for (const r of rows) {
    if (!r.subject_id || !r.occurred_at || !r.outcome) continue
    const seen = out.get(r.subject_id)
    if (!seen || r.occurred_at > seen.occurredAt) {
      out.set(r.subject_id, {
        outcome: r.outcome, occurredAt: r.occurred_at, actorId: r.actor_id ?? null,
      })
    }
  }
  return out
}
