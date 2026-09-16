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
  for (const r of rows) {
    if (!r.subject_id || !r.occurred_at) continue
    const outcome = (r.payload as { outcome?: string } | null | undefined)?.outcome
    if (!resetsStaleClock(outcome)) continue
    const seen = out.get(r.subject_id)
    if (!seen || r.occurred_at > seen) out.set(r.subject_id, r.occurred_at)
  }
  return out
}
