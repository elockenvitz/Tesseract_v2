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

/** Newest `thesis.reviewed` per asset, from rows already fetched. The caller
 *  owns the query; this owns the rule that newest wins. */
export function latestReviewByAsset(
  rows: ReadonlyArray<{ subject_id: string; occurred_at: string }>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows) {
    if (!r.subject_id || !r.occurred_at) continue
    const seen = out.get(r.subject_id)
    if (!seen || r.occurred_at > seen) out.set(r.subject_id, r.occurred_at)
  }
  return out
}
