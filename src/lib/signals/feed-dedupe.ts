/**
 * One subject, one card.
 *
 * The unreviewed-change signal is composite and deliberately broad, so it will
 * sometimes fire on a name that a sharper card is already about: a target was
 * reached, a scenario has no case behind it, a position breached a limit. Both
 * cards are true. Showing both is still wrong — the reader gets two tiles about
 * the same holding, one of which names the actual event and offers the matching
 * action, and one of which says something moved.
 *
 * Precedence, not scoring. This is not a close call, so there is no ranking to
 * do; the specific card wins and the general one is dropped for that subject.
 *
 * Kept out of `MobileDashboard` because the rule is worth testing on its own,
 * and because everything in that file needs a Supabase-backed render to reach.
 */

/** The minimum an insight has to expose to be considered here. */
export interface DedupableInsight {
  kind: string
  symbol?: string | null
}

const norm = (s: unknown): string => String(s ?? '').trim().toUpperCase()

/**
 * Collect the symbols that stronger cards have already claimed.
 *
 * Takes raw candidates rather than a typed entry union on purpose: the feed
 * composes seven kinds and each stores its subject in a different place, so the
 * extraction stays at the call site where those shapes are known, and this only
 * has to agree on normalisation. Empty and non-string values are dropped rather
 * than becoming a `""` key that would match every symbol-less insight.
 */
export function claimedSubjects(symbols: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const s of symbols) {
    const v = norm(s)
    if (v) out.add(v)
  }
  return out
}

/**
 * Drop the general card where a specific one already covers the same name.
 *
 * Applies to `stale_research` only, and deliberately NOT to `no_thesis`: a name
 * with a stale price target and a name with no written research at all are two
 * genuinely different gaps, and the second is not implied by the first. An
 * insight with no symbol is always kept — it cannot be a duplicate of anything.
 */
export function suppressCoveredInsights<T extends { insight: DedupableInsight }>(
  entries: T[],
  claimed: Set<string>,
): T[] {
  return entries.filter(e => {
    if (e.insight.kind !== 'stale_research') return true
    const sym = norm(e.insight.symbol)
    return !sym || !claimed.has(sym)
  })
}
