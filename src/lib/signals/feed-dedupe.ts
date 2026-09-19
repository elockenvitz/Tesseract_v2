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

/**
 * The coverage-stale attention item, where a Research card already says it.
 *
 * ── Two producers, one finding ────────────────────────────────────────────
 *
 * `useAttention` walks the reader's coverage and raises an item for any name
 * with no research contribution in three weeks: title "<SYM> — Research stale",
 * reason "No research update in N days — thesis may be stale".
 *
 * That is the same observation `useDerivedInsights` makes through
 * `researchIssueFor`, which calls it `long_silence` and gives it a Research
 * card with the framing's own pill, its own panes and an action that opens the
 * thesis. The attention copy has none of that: it carries no due date, it maps
 * to `awaiting_review`, and it wears a workflow chip reading "Needs review" on
 * a finding that is not workflow at all.
 *
 * So the feed said one thing twice, in two vocabularies, and the weaker copy
 * was the one that multiplied — reported from a phone as a run of Needs Review
 * tiles.
 *
 * ── Precedence, not scoring ───────────────────────────────────────────────
 *
 * The same rule and the same reason as `suppressCoveredInsights` above, in the
 * other direction: the card that names the finding and offers the matching
 * action wins, and the general one is dropped for that subject. Nothing is
 * lost, because the Research card says strictly more.
 *
 * ── Why the reason code and not the source type ──────────────────────────
 *
 * This keyed on `source_type === 'coverage_change'`, and that field is a junk
 * drawer: `collectNeglectedCoverage` and `collectUpcomingEarnings` both stamp
 * it. So a Research card on a name silently suppressed that name's upcoming
 * earnings item too — a calendar entry that duplicates nothing, dropped
 * because it was filed beside something that did.
 *
 * `reason_code` names what was actually noticed. Only `coverage_neglected` is
 * the observation a Research card can already be making; every other attention
 * item is a real workflow item — a trade awaiting a call, a deliverable past
 * its date, a print on Thursday — with no Research equivalent to duplicate.
 *
 * ── The set this takes is a semantic set, not an asset list ───────────────
 *
 * The caller used to pass every asset with ANY Research card on it, which made
 * the rule "an asset with research loses its coverage tile". That is not the
 * duplicate rule, it is a subject rule, and it deleted a coverage finding
 * because an unrelated one happened to share a name. `coverageDuplicateAssets`
 * is the predicate now, and it is narrow: one framing, the one that makes the
 * same claim.
 */

/**
 * Which insights are the coverage finding said again, rather than said near.
 *
 * ── One framing, and the argument for it ──────────────────────────────────
 *
 * `researchIssueFor` produces five framings, and only one of them is this
 * observation:
 *
 *   long_silence      nothing has been added to the record in a long time
 *   price_move        the price moved and the case has not answered it
 *   new_evidence      material arrived and the case has not answered it
 *   no_case           no thesis was ever written
 *   incomplete_case   part of one was
 *
 * `long_silence` and `coverage_neglected` are one claim in two vocabularies:
 * both fire on quiet alone, both measure from the last contribution, and
 * neither asserts that anything happened. The other four assert something that
 * did — an arrival, a move, an absence of authorship — and answer a different
 * reader question. A name can carry one of those AND have gone quiet, and both
 * are true, so both survive.
 *
 * This is identity by the producer's own structured framing. There is no text
 * matching and no threshold of similarity, which is deliberate: the framing is
 * a decision `researchIssueFor` already made and states, and reproducing that
 * judgement from titles would be a second opinion about the same rows.
 */
export interface CoverageDuplicateInsight {
  assetId?: string | null
  issue?: { framing?: string | null } | null
}

export function coverageDuplicateAssets(
  insights: readonly CoverageDuplicateInsight[],
): Set<string> {
  const out = new Set<string>()
  for (const i of insights) {
    if (i?.issue?.framing !== 'long_silence') continue
    if (i.assetId) out.add(i.assetId)
  }
  return out
}
export interface DedupableAttention {
  kind?: string
  attention?: {
    reason_code?: string | null
    context?: { asset_id?: string | null } | null
  } | null
}

export function suppressCoveredAttention<T extends DedupableAttention>(
  entries: T[],
  /**
   * Assets whose Research card makes the SAME claim, from
   * `coverageDuplicateAssets`. Not every asset with research on it.
   */
  researched: Set<string>,
): T[] {
  if (!researched.size) return entries
  return entries.filter(e => {
    if (e.kind !== 'attention') return true
    const a = e.attention
    if (a?.reason_code !== 'coverage_neglected') return true
    const assetId = a.context?.asset_id
    // No asset means nothing to compare it against, so it is never a duplicate.
    return !assetId || !researched.has(assetId)
  })
}
