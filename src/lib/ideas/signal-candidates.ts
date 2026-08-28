/**
 * System signals, normalized into the one ranker.
 *
 * ── The problem this closes ───────────────────────────────────────────────
 *
 * `useSignalCards` produces the findings that most deserve a reader's
 * attention — a team split on a name, a held position nobody has touched in a
 * month — and they were appended into the feed by `insertSignalsIntoFeed`,
 * which paces them at fixed positions (2, 6, 10, 15, 20, 26) regardless of what
 * they say or what they are competing with. So the cockpit's Attention band was
 * structurally empty: every ranked row was a post, and every post is tier 4.
 *
 * A surface whose first question is "what needs my attention" could not answer
 * it, because the only candidates that could answer it were never ranked.
 *
 * ── Why a mapping and not a score ─────────────────────────────────────────
 *
 * The tempting shortcut is `total = signal.priority`, since the cards already
 * carry a 0–1 number. That number is not comparable to anything: it is
 * `min(1, count/10)` for a cluster, a hard-coded 0.8 for a conflict and 0.6 for
 * stale coverage. Three different scales, none of them measuring what
 * `priorityFor` measures, and feeding them in as a total would be a second
 * scoring system wearing the first one's field name.
 *
 * So each signal is mapped onto its SEMANTICS — what kind of finding it is, how
 * severe, whose name it is about — and the canonical ranker scores it the way
 * it scores everything else. The `priority` float is discarded.
 *
 * ── The mapping, and why each one ─────────────────────────────────────────
 *
 *   conflict         → `thesis_conflict`  tier 0, base 0.70
 *       The desk holds opposing recorded views on one name. That is a framework
 *       problem, not a matter of taste, and tier 0 is where the contract
 *       already files it.
 *
 *   stale_coverage   → `research_stale`   tier 2, base 0.70
 *       A held position nobody has looked at. Real, and not a decision that has
 *       gone wrong — which is the line between tier 2 and tier 0.
 *
 *   attention_cluster → `team_focus`      tier 2, base 0.40
 *       Colleagues are talking about a name. The weakest of the three, and
 *       deliberately so: activity is not a finding. It sits at the bottom of
 *       tier 2 and will usually rank below the notes it is describing.
 *
 * Nothing is promoted into Attention for being a signal. `thesis_conflict`
 * reaches it because the tier table says a contradicted framework belongs
 * there; the other two do not reach it, and should not.
 */

import type { Severity, SignalType } from '../signals/contract'
import type { PriorityInput } from '../signals/feed-priority'
import { scopeRelevanceFor, EMPTY_COVERAGE_INDEX, type CoverageIndex } from '../signals/coverage-relevance'
import { dispositionKey, type DispositionMap } from '../signals/dispositions'

/** The generator's own vocabulary, which is not the ranker's. */
export type GeneratedSignalType =
  | 'attention_cluster'
  | 'stale_coverage'
  | 'conflict'
  | 'catalyst_proximity'
  | 'prompt'

/** The shape `useSignalCards` emits. Structural, so a test can build one. */
export interface GeneratedSignal {
  id: string
  signalType: GeneratedSignalType
  headline: string
  body: string
  relatedAssets: readonly { id: string; symbol: string }[]
  metric?: string
  metricLabel?: string
  createdAt: string
  /** The generator's 0–1 float. Deliberately unused — see the header. */
  priority: number
}

interface Mapping {
  type: SignalType
  severity: Severity
  /** Whether an answer can be filed against it. See `signalDispositionRef`. */
  suppressible: boolean
}

/**
 * `catalyst_proximity` and `prompt` are declared in the union and produced by
 * nothing. They are mapped anyway rather than left to fall through to
 * `UNTIERED`, so that whoever writes the generator gets a tier that was
 * decided rather than a default of 0.1 at the bottom of tier 4.
 */
const MAPPING: Record<GeneratedSignalType, Mapping | null> = {
  conflict: { type: 'thesis_conflict', severity: 'attention', suppressible: true },
  stale_coverage: { type: 'research_stale', severity: 'informational', suppressible: true },
  attention_cluster: { type: 'team_focus', severity: 'informational', suppressible: true },
  catalyst_proximity: { type: 'catalyst_ahead', severity: 'attention', suppressible: true },
  /**
   * A prompt is a request addressed to this reader, not a finding about a
   * name — so it has no asset entity, and `dispositionEntityFor`'s rule for
   * machine findings (key on the asset) would file it under nothing.
   * Excluded until it has an identity, rather than given a fuzzy one.
   */
  prompt: null,
}

/** The canonical type a generated signal ranks as, or null if it should not rank. */
export function canonicalTypeFor(signalType: GeneratedSignalType): SignalType | null {
  return MAPPING[signalType]?.type ?? null
}

/**
 * Where an answer about this signal is filed.
 *
 * The rule is `dispositionEntityFor`'s, not a new one: a machine-derived
 * finding is a recurring claim about a NAME — "AAPL's coverage gap is handled"
 * — so it keys on the asset, and tomorrow's regenerated card is the same claim.
 * Keying on the signal's own id would be worse than useless, because the id
 * embeds the asset and the generator rebuilds it every five minutes.
 *
 * Returns null when there is no asset to key on, which is the honest answer for
 * a signal that is not about one. Such a signal is simply not dismissible yet.
 */
export function signalDispositionRef(
  signal: GeneratedSignal,
): { type: SignalType; entityId: string } | null {
  const mapping = MAPPING[signal.signalType]
  const assetId = signal.relatedAssets[0]?.id
  if (!mapping || !mapping.suppressible || !assetId) return null
  return { type: mapping.type, entityId: assetId }
}

export interface SignalRankContext {
  coverageIndex?: CoverageIndex
  dispositions?: DispositionMap
}

/**
 * A generated signal, as the canonical ranker reads it.
 *
 * Returns null for anything that should not enter the stream, which the caller
 * filters — better than emitting a candidate with an invented type and letting
 * the tier table give it a default.
 *
 * ── Why `occurredAt` is null ──────────────────────────────────────────────
 *
 * `createdAt` on these cards is `new Date()` — the moment the generator ran —
 * so every signal would claim to be seconds old and take the full recency
 * boost, forever. That is not freshness, it is a timestamp of the query.
 *
 * The honest answer is that these describe STANDING CONDITIONS with no event
 * behind them. A team is split until it is not; a position is untouched until
 * somebody touches it. The card exists only while the condition holds — the
 * generator recomputes it from live data every time — so there is no age to
 * report, and `recencyBoost` returning zero is correct rather than a penalty.
 * Their standing matters through tier and base, which is what those are for.
 */
export function signalPriorityInput(
  signal: GeneratedSignal,
  ctx: SignalRankContext,
): PriorityInput | null {
  const mapping = MAPPING[signal.signalType]
  if (!mapping) return null

  const assetId = signal.relatedAssets[0]?.id ?? null
  const ref = signalDispositionRef(signal)

  return {
    id: signal.id,
    type: mapping.type,
    severity: mapping.severity,
    occurredAt: null,
    /**
     * Held, but with no weight to report.
     *
     * `stale_coverage` is generated FROM holdings, so the position is real;
     * the generator does not carry its size. `materialityBand` scores a held
     * position with an unknown weight at its neutral band rather than at the
     * bottom, which is exactly the case it documents.
     */
    weightPct: null,
    held: signal.signalType === 'stale_coverage',
    scope: scopeRelevanceFor(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX, assetId),
    /**
     * The stored answer, read at the signal's own key.
     *
     * Deliberately NOT through `judgmentRecordFor`: that composes a POST's
     * identity — `thought:idea:quick_thought:abc` — and a machine finding is
     * keyed on the asset. Same store, same `dispositionKey`, same policy; a
     * different entity, because they are different kinds of claim.
     */
    judgment: ref && ctx.dispositions
      ? lookupSignalJudgment(ref, ctx.dispositions)
      : null,
  }
}

function lookupSignalJudgment(
  ref: { type: SignalType; entityId: string },
  dispositions: DispositionMap,
) {
  const d = dispositions[dispositionKey(ref.type, ref.entityId)]
  if (!d) return null
  return { key: d.key ?? d.verdict ?? null, kind: d.kind, at: d.at }
}
