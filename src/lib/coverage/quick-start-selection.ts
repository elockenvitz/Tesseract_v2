/**
 * Staging a coverage selection before any of it reaches the database.
 *
 * ── Why this is separate from the component ───────────────────────────────
 *
 * Three sources now feed one selection — the names already in the workspace's
 * holdings, a sector's current constituents, and a company search — and they
 * overlap constantly. A holding is usually in a sector; a searched name is
 * often already a holding. The merge rule is where that goes wrong quietly, so
 * it is here where it can be asserted rather than inside a click handler.
 *
 * ── What "already covered" means ──────────────────────────────────────────
 *
 * Both lanes. `useMyCoverage.assetIds` spans the personal rows the user
 * declared and the org rows somebody assigned them, and neither may be
 * duplicated: re-declaring an assigned name would create a second active row
 * for the same asset, and the org row is not this user's to touch at all. So a
 * covered asset is not merely hidden — it can never enter the selection, which
 * is what makes the save path incapable of duplicating one.
 *
 * Pure: no React, no Supabase, no clock.
 */

export interface CoverageCandidate {
  id: string
  symbol: string
  company_name: string | null
  sector: string | null
  /** Which source offered it. Presentation only; never affects the write. */
  reason?: 'holding' | 'sector' | 'team' | 'search'
  /**
   * The sector whose constituents brought it in, if that is how it arrived.
   *
   * Recorded so the reader can see WHY a name they never typed is in their
   * list. It is a snapshot: selecting a sector selects the names in it now,
   * and nothing re-evaluates later, because the coverage model has no rule
   * lane and inventing one would be a migration.
   */
  viaSector?: string
}

/**
 * Add candidates to a staged selection.
 *
 * Deduped by asset id, already-covered names refused, and the FIRST arrival
 * wins so a name that came in with a sector keeps saying so when the user
 * later searches for it.
 */
export function mergeCandidates(
  current: Map<string, CoverageCandidate>,
  incoming: CoverageCandidate[],
  alreadyCovered: ReadonlySet<string>,
): Map<string, CoverageCandidate> {
  const next = new Map(current)
  for (const candidate of incoming) {
    if (!candidate?.id) continue
    if (alreadyCovered.has(candidate.id)) continue
    if (next.has(candidate.id)) continue
    next.set(candidate.id, candidate)
  }
  return next
}

/** Toggle one candidate. Covered names are inert rather than removable. */
export function toggleCandidate(
  current: Map<string, CoverageCandidate>,
  candidate: CoverageCandidate,
  alreadyCovered: ReadonlySet<string>,
): Map<string, CoverageCandidate> {
  if (alreadyCovered.has(candidate.id)) return current
  const next = new Map(current)
  if (next.has(candidate.id)) next.delete(candidate.id)
  else next.set(candidate.id, candidate)
  return next
}

export function removeCandidate(
  current: Map<string, CoverageCandidate>,
  assetId: string,
): Map<string, CoverageCandidate> {
  if (!current.has(assetId)) return current
  const next = new Map(current)
  next.delete(assetId)
  return next
}

/**
 * How many of a sector's constituents a press would actually add.
 *
 * The reader is told this before they commit, because "Technology" adding
 * eleven names and "Technology" adding none look identical on a button.
 */
export function newFromSector(
  constituents: CoverageCandidate[],
  current: Map<string, CoverageCandidate>,
  alreadyCovered: ReadonlySet<string>,
): number {
  let n = 0
  for (const c of constituents) {
    if (alreadyCovered.has(c.id) || current.has(c.id)) continue
    n += 1
  }
  return n
}
