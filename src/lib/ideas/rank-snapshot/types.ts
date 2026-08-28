/**
 * A replayable snapshot of everything the Ideas ranking reads.
 *
 * ── Why raw inputs and not ranked output ──────────────────────────────────
 *
 * Ranking unification reorders every feed in the product, and "the order
 * changed" is unfalsifiable without a before. The tempting artifact is a list
 * of the top 20 as they stood — but a stored OUTPUT can only ever be compared
 * against itself. The moment the implementation changes, there is no way to ask
 * "what would the OLD ranker have done with THIS candidate set", which is
 * exactly the question a reviewer needs answered when the candidate set has
 * also been widened.
 *
 * So a snapshot stores the INPUTS: the candidate rows, and the reader context
 * that scores them. `replayLegacy` and `replayCanonical` then both run against
 * the same snapshot, and the diff between them is attributable to the ranker
 * rather than to two different feeds captured at two different times.
 *
 * The same file shape comes out of a deterministic fixture and out of a real
 * authenticated staging workspace, so a staging capture taken later can be
 * replayed through both rankers without any of this being rebuilt.
 *
 * ── What is deliberately not in here ──────────────────────────────────────
 *
 * No post text, no email addresses, no user ids, no organization id. Ranking
 * reads `content.length`, never the words, so the length is what is stored.
 * People are renumbered to `author-1`, `author-2` by `redactPeople`, stably
 * within one snapshot and meaninglessly across snapshots. A committed snapshot
 * has to be safe to read in a pull request.
 */

import type { DispositionMap } from '../../signals/dispositions'

export const SNAPSHOT_VERSION = 1

/** One candidate row, reduced to the fields any ranker actually reads. */
export interface SnapshotCandidate {
  id: string
  /** The feed's own item type: quick_thought, trade_idea, pair_trade, … */
  type: string
  created_at: string
  /** Opaque, renumbered. Never a real user id. */
  authorId: string | null
  assetId: string | null
  /** Ticker is not personal and is what makes a snapshot readable. */
  assetSymbol: string | null
  /** Ranking reads the length, never the words. */
  contentLength: number
  hasSentiment: boolean
  reactionCount: number
  /** Proposal fields, where the source carries them. */
  urgency?: string | null
  status?: string | null
  /** Which source query produced it, for recall accounting. */
  source: string
  /**
   * Whether the OLD recency-only window would have retrieved this row at all.
   *
   * Set by the capture when it can tell — a candidate that only exists because
   * of the relevance pool is the single most interesting row in the file, and
   * without this flag the after-comparison cannot separate "ranked higher" from
   * "was not previously fetched".
   */
  fromRelevancePool?: boolean
}

/** The reader, with nothing identifying in it. */
export interface SnapshotContext {
  /** Opaque, renumbered — matches `SnapshotCandidate.authorId`. */
  userId: string | null
  followedIds: string[]
  heldAssetIds: string[]
  coverage: {
    ready: boolean
    direct: string[]
    assigned: string[]
    held: string[]
  }
  dispositions: DispositionMap
  /** Fixed clock, so a replay is reproducible months later. */
  now: number
}

export interface RankSnapshot {
  version: number
  capturedAt: string
  /** `fixture` is deterministic and committed; `staging` is a real workspace. */
  source: 'fixture' | 'staging'
  /** Free-text note about what this capture is for. Never identifying. */
  label: string
  context: SnapshotContext
  candidates: SnapshotCandidate[]
}

/** One ranked row, as either ranker produces it. */
export interface ReplayRow {
  id: string
  type: string
  /** Absent for the legacy desktop scorer, which has no tiers. */
  tier: number | null
  score: number
  suppressed: boolean
  scope: string
  createdAt: string
  authorId: string | null
  assetSymbol: string | null
  reasons: string[]
  /** Days between the row's timestamp and the snapshot clock. */
  ageDays: number
  /** Proposal urgency where the source carries one. */
  urgency: string | null
  /** True when the row is in the feed because it is unresolved. */
  actionable: boolean
}

export interface ReplayResult {
  /** Which engine produced this, for the report header. */
  engine: 'legacy-desktop' | 'legacy-mobile' | 'canonical'
  /** Every candidate considered, in final order, suppressed rows removed. */
  ranked: ReplayRow[]
  /** Candidates in, before suppression. */
  candidateCount: number
  /** Removed by suppression. */
  suppressedCount: number
  /** Milliseconds spent ranking, excluding retrieval. */
  durationMs: number
}

/**
 * Rename every person to a stable pseudonym.
 *
 * In-snapshot stability is what makes "the same author appears three times"
 * still legible for diversity accounting; cross-snapshot meaninglessness is
 * what makes the file safe to commit.
 */
export function redactPeople(ids: readonly (string | null | undefined)[]): Map<string, string> {
  const map = new Map<string, string>()
  let n = 0
  for (const id of ids) {
    if (!id || map.has(id)) continue
    map.set(id, `author-${++n}`)
  }
  return map
}
