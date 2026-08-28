/**
 * The two rankers as they stood at 9d15564, frozen.
 *
 * ── Why a copy, which is normally the wrong answer ────────────────────────
 *
 * Unification deletes one algorithm and rewrites the other. After that lands
 * there is no way to ask "what would the old feed have shown for this candidate
 * set" — and that is the only question that makes a reorder reviewable, because
 * the candidate set changed too. A stored list of yesterday's top 20 cannot
 * answer it: it was produced from a different input.
 *
 * So the pre-unification arithmetic is preserved here verbatim, as a REFERENCE
 * ORACLE. Nothing in the application imports this file. It exists so that a
 * snapshot — the deterministic fixture today, a real staging capture later —
 * can be run through both engines and the difference attributed.
 *
 * ── Rules for this file ───────────────────────────────────────────────────
 *
 * It is frozen. It does not get fixed, tuned, or kept in sync with anything.
 * If it ever needs to change, the honest change is to delete it, because a
 * "before" that has been edited is not a before. It has no imports from the
 * live ranking modules for exactly that reason: an oracle that drifts when the
 * subject drifts proves nothing.
 *
 * Copied from:
 *   `scoreFeedItem`                   src/hooks/ideas/useIdeasFeed.ts
 *   `applyDiversity`                  src/hooks/ideas/useIdeasFeed.ts
 *   `rankInputFor` case 'idea'        src/components/mobile/MobileDashboard.tsx
 */

import type { RankSnapshot, ReplayResult, ReplayRow, SnapshotCandidate } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Frozen constants — do not reference the live ones, see the header
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_COVERAGE_BONUS_DESKTOP = 0.12
const LEGACY_PAGE_SIZE = 15
const PROPOSAL_FRESHNESS_FLOOR = 0.55

/** `coverageRelevanceFor`, frozen. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function legacyCoverage(snap: RankSnapshot, assetId: string | null): string {
  const c = snap.context.coverage
  if (!assetId || !UUID.test(assetId)) return 'unknown'
  if (!c.ready) return 'unknown'
  if (c.direct.includes(assetId)) return 'direct'
  if (c.assigned.includes(assetId)) return 'assigned'
  if (c.held.includes(assetId)) return 'held'
  if (c.direct.length === 0 && c.assigned.length === 0) return 'unknown'
  return 'none'
}

/** `desktopAssetRelevanceFor`, frozen. */
function legacyAssetRelevance(relevance: string): number {
  if (relevance === 'direct' || relevance === 'assigned') return 1
  if (relevance === 'held') return 0.9
  return 0.3
}

/** `coverageBonusFor`, frozen. */
const legacyBonus = (relevance: string) =>
  relevance === 'direct' || relevance === 'assigned' ? 1 : 0

// ─────────────────────────────────────────────────────────────────────────────
// The legacy desktop scorer
// ─────────────────────────────────────────────────────────────────────────────

export function legacyScore(
  c: SnapshotCandidate,
  snap: RankSnapshot,
  mode: 'for_you' | 'following' | 'latest' = 'for_you',
): { score: number; scope: string } {
  const now = snap.context.now
  const ageHours = (now - new Date(c.created_at).getTime()) / (1000 * 60 * 60)
  const decayed = Math.pow(0.5, ageHours / 18)

  const isOpenProposal = c.type === 'trade_idea' || c.type === 'pair_trade'
  const freshness = isOpenProposal ? Math.max(decayed, PROPOSAL_FRESHNESS_FLOOR) : decayed

  const isOwn = c.authorId === snap.context.userId
  const isFollowed = snap.context.followedIds.includes(c.authorId || '')
  const authorRelevance = isOwn ? 0.7 : isFollowed ? 0.9 : 0.3

  const scope = legacyCoverage(snap, c.assetId)
  const assetRelevance = legacyAssetRelevance(scope)
  const coverageBonus = legacyBonus(scope) * LEGACY_COVERAGE_BONUS_DESKTOP

  const contentLen = c.contentLength
  const quality = Math.min(1, (contentLen > 200 ? 0.4 : contentLen > 50 ? 0.2 : 0.1) +
    (c.assetId ? 0.3 : 0) + (c.hasSentiment ? 0.2 : 0))

  const engagement = Math.min(1, Math.log2(c.reactionCount + 1) / 4)

  let score: number
  if (mode === 'latest') {
    score = freshness
  } else if (mode === 'following') {
    score = freshness * 0.5 + authorRelevance * 0.3 + quality * 0.2
  } else {
    score = freshness * 0.25 + authorRelevance * 0.2 + assetRelevance * 0.2 +
            quality * 0.15 + engagement * 0.2 + coverageBonus
  }
  return { score, scope }
}

/** `applyDiversity`, frozen — defer-and-retry over author and asset runs. */
function legacyDiversity<T extends { authorId: string | null; assetId: string | null }>(
  items: T[],
): T[] {
  const result: T[] = []
  const deferred: T[] = []
  const recentAuthors: string[] = []
  const recentAssets: string[] = []

  const take = (item: T) => {
    result.push(item)
    recentAuthors.push(item.authorId || '')
    recentAssets.push(item.assetId || '')
  }
  const blocked = (item: T) => {
    const a = recentAuthors.slice(-5).filter(x => x === (item.authorId || '')).length
    const s = recentAssets.slice(-4).filter(x => x === (item.assetId || '') && x !== '').length
    return a >= 3 || s >= 2
  }

  for (const item of items) {
    if (blocked(item)) { deferred.push(item); continue }
    take(item)
  }
  const stillBlocked: T[] = []
  for (const item of deferred) {
    if (blocked(item)) { stillBlocked.push(item); continue }
    take(item)
  }
  return [...result, ...stillBlocked]
}

/**
 * The desktop feed exactly as it ranked before unification.
 *
 * Note what this does NOT do: it applies no suppression of its own. The harness
 * removes suppressed rows from the snapshot before either engine sees it,
 * because suppression is shared and settled and is not what this comparison is
 * measuring — see `run.ts`. Duplicating it here would also make this file
 * depend on a live module, which the header forbids.
 */
export function replayLegacyDesktop(snap: RankSnapshot): ReplayResult {
  const started = Date.now()
  const scored = snap.candidates.map(c => {
    const { score, scope } = legacyScore(c, snap)
    return { c, score, scope }
  })

  // `scored.sort((a, b) => b.score - a.score)` — no tie-break, which is itself
  // one of the findings. Reproduced with a stable sort over capture order.
  scored.sort((a, b) => b.score - a.score)

  const diverse = legacyDiversity(
    scored.map(s => ({ ...s, authorId: s.c.authorId, assetId: s.c.assetId })),
  )

  const ranked: ReplayRow[] = diverse.map(s => ({
    id: s.c.id,
    type: s.c.type,
    tier: null,
    score: s.score,
    suppressed: false,
    scope: s.scope,
    createdAt: s.c.created_at,
    authorId: s.c.authorId,
    assetSymbol: s.c.assetSymbol,
    reasons: [],
  }))

  return {
    engine: 'legacy-desktop',
    ranked,
    candidateCount: snap.candidates.length,
    suppressedCount: 0,
    durationMs: Date.now() - started,
  }
}

/**
 * What mobile actually received, which is the desktop page and not the pool.
 *
 * The structural defect this phase removes, expressed as code: mobile's idea
 * candidates were whatever survived `slice(0, PAGE_SIZE)` above. Everything
 * mobile then did — pooling with seven other kinds, `priorityFor`, diversify,
 * interleave — operated on those fifteen rows.
 *
 * Only the idea kind is modelled here. The other seven mobile kinds come from
 * sources this snapshot does not capture, and inventing them would make the
 * comparison a fiction.
 */
export function replayLegacyMobileIntake(snap: RankSnapshot): ReplayResult {
  const desktop = replayLegacyDesktop(snap)
  const started = Date.now()
  const ranked = desktop.ranked.slice(0, LEGACY_PAGE_SIZE)
  return {
    engine: 'legacy-mobile',
    ranked,
    candidateCount: snap.candidates.length,
    suppressedCount: 0,
    durationMs: desktop.durationMs + (Date.now() - started),
  }
}
