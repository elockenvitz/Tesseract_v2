/**
 * The canonical ranker, run over a snapshot.
 *
 * Unlike `legacy-rankers`, this imports the LIVE modules and is supposed to:
 * its job is to report what the shipped ranker does today, so a report
 * generated after a weight change shows the weight change. The frozen oracle is
 * the other half of that contract.
 */

import { rankIdeaCandidates } from '../idea-priority'
import type { CoverageIndex } from '../../signals/coverage-relevance'
import type { RankSnapshot, ReplayResult, ReplayRow } from './types'

function indexFrom(snap: RankSnapshot): CoverageIndex {
  const c = snap.context.coverage
  return {
    ready: c.ready,
    direct: new Set(c.direct),
    assigned: new Set(c.assigned),
    held: new Set(c.held),
  }
}

export function replayCanonical(snap: RankSnapshot): ReplayResult {
  const started = Date.now()

  const ranked = rankIdeaCandidates(
    snap.candidates.map(c => ({
      id: c.id,
      type: c.type,
      created_at: c.created_at,
      author: c.authorId ? { id: c.authorId } : null,
      asset: c.assetId ? { id: c.assetId } : null,
      reactionCounts: c.reactionCount ? [{ count: c.reactionCount }] : [],
    })),
    {
      userId: snap.context.userId,
      followedIds: snap.context.followedIds,
      coverageIndex: indexFrom(snap),
      // Suppression is applied by the harness, upstream of both engines, so
      // that the comparison isolates the ranking change. See `run.ts`.
      dispositions: undefined,
    },
    snap.context.now,
  )

  const byId = new Map(snap.candidates.map(c => [c.id, c]))
  const rows: ReplayRow[] = ranked.map(r => {
    const c = byId.get(String(r.item.id))!
    return {
      id: c.id,
      type: c.type,
      tier: r.priority.tier,
      score: r.priority.total,
      suppressed: r.priority.suppressed,
      scope: r.priority.scope.kind,
      createdAt: c.created_at,
      authorId: c.authorId,
      assetSymbol: c.assetSymbol,
      reasons: r.priority.reasons.map(x => x.code),
      ageDays: Math.round(((snap.context.now - new Date(c.created_at).getTime()) / 86_400_000) * 10) / 10,
      urgency: c.urgency ?? null,
      actionable: !!r.input.openProposal,
    }
  })

  return {
    engine: 'canonical',
    ranked: rows,
    candidateCount: snap.candidates.length,
    suppressedCount: 0,
    durationMs: Date.now() - started,
  }
}
