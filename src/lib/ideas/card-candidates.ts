/**
 * Scenario ladders and portfolio lenses, as canonical candidates.
 *
 * ── What this is, and what it deliberately is not ─────────────────────────
 *
 * It is an EXTRACTION, not a design. Every mapping below already existed,
 * fully worked out and argued in comments, inside `rankInputFor` in
 * `MobileDashboard` — a 4,600-line component. That is why desktop never had
 * them: not because anyone decided desktop should not rank a price through its
 * own bear case, but because the only code that knew how to read one lived in a
 * `switch` inside a `useCallback` on the phone.
 *
 * So nothing here is retuned, rescaled or re-severitied. The numbers, the
 * thresholds and the reasoning are moved verbatim, and mobile now calls these
 * functions instead of its own copies. A test asserts the two produce identical
 * `PriorityInput`s, so "extraction" is a claim with evidence rather than an
 * intention.
 *
 * ── Why this matters more than the count of new sources ───────────────────
 *
 * `scenario_gap` is tier 0, base 1.00 — the highest entry in the entire TIER
 * table, and the only signal that compares a price against the desk's own full
 * ladder rather than a single number. The desktop cockpit's Attention band had
 * exactly one producer (`thesis_conflict`) because this one was unreachable.
 */

import type { SignalCard, SignalType } from '../signals/contract'
import type { PriorityInput } from '../signals/feed-priority'
import { scopeRelevanceFor, EMPTY_COVERAGE_INDEX, type CoverageIndex } from '../signals/coverage-relevance'
import { dispositionEntityFor, dispositionKey, type DispositionMap } from '../signals/dispositions'

export interface CardRankContext {
  coverageIndex?: CoverageIndex
  dispositions?: DispositionMap
}

/**
 * The stored answer for a contract card, at the key the card itself defines.
 *
 * `dispositionEntityFor` is the one rule: a machine-derived finding keys on its
 * ASSET, because it is a recurring claim about a name and tomorrow's rebuild is
 * the same claim; a colleague's post keys on the post. Reused rather than
 * restated, so a scenario card dismissed on a phone is the same record as one
 * dismissed on a laptop.
 */
function judgmentForCard(card: SignalCard, dispositions?: DispositionMap) {
  if (!dispositions) return null
  const d = dispositions[dispositionKey(card.type, dispositionEntityFor(card))]
  if (!d) return null
  return { key: d.key ?? d.verdict ?? null, kind: d.kind, at: d.at }
}

/**
 * Any contract `SignalCard`, as the canonical ranker reads it.
 *
 * Generic on purpose. `buildScenarioGapCard`, the legacy-kind builders and
 * anything else emitting a `SignalCard` all carry the four things ranking needs
 * — a canonical `type`, a `severity` the builder computed from real conditions,
 * an entity, and a provenance time — so a per-builder adapter would be five
 * copies of one function waiting to drift.
 *
 * ── The deviation, read back rather than recomputed ───────────────────────
 *
 * The card's own metric IS the deviation: the percentage of the case the price
 * broke through, and the same number the builder derived its severity from.
 * Parsing it back is slightly ugly and strictly better than recomputing it
 * differently in a second place — which is how two surfaces come to disagree
 * about how far through its bear case a position is.
 *
 * ── Only a PERCENTAGE is a deviation ─────────────────────────────────────
 *
 * The first version parsed any number out of the metric, which is wrong for a
 * card whose metric is a price. `buildScenarioGapCard` writes "14% below" for a
 * breach and "$820" for a price sitting at expected value — so an at-expected
 * card, the most benign state the builder emits, would have reported a
 * deviation of 820 and taken the top of `deviationBand`. The calmest card in
 * the set would have scored like the most broken one.
 *
 * So the metric is read as a deviation only when it is expressed as one.
 * Anything else yields null, which `deviationBand` scores at its documented
 * neutral band — the honest answer for a number that is not a deviation.
 */
export function cardPriorityInput(
  card: SignalCard,
  ctx: CardRankContext,
): PriorityInput {
  const metricValue = String(card.metric?.value ?? '')
  const dev = metricValue.includes('%')
    ? Number(metricValue.replace(/[^0-9.]/g, ''))
    : NaN
  return {
    id: card.id,
    type: card.type as SignalType,
    severity: card.severity,
    occurredAt: card.provenance?.occurredAt ?? card.metric?.asOf ?? null,
    deviationPct: Number.isFinite(dev) && dev > 0 ? dev : null,
    /**
     * A ladder exists because somebody covers the name, and the card carries
     * the portfolios it sits in as context chips. `weightPct` is genuinely
     * unknown — the builder never had it — so it stays null, which
     * `materialityBand` reads as the neutral band for a held position rather
     * than as a tiny one.
     */
    held: (card.context ?? []).some(chip => /portfolio/i.test(String(chip?.label ?? ''))),
    weightPct: null,
    scope: scopeRelevanceFor(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX, card.entity?.id ?? null),
    judgment: judgmentForCard(card, ctx.dispositions),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio lenses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The lens shapes, structurally. Mirrors what `usePortfolioLenses` emits.
 *
 * Deliberately loose: this module's job is to read a lens, not to own its
 * schema. Tightening it would make `lib/ideas` the place a portfolio lens is
 * defined, which is `hooks/mobile/usePortfolioLenses` and should stay there.
 */
export type PortfolioLens =
  | { type: 'breach'; breach: { assetId: string; overshootPct: number; asOf?: string | null } }
  | { type: 'stale'; target: { assetId: string; overdueMonths: number; expiredAt?: string | null } }
  | { type: 'untargeted'; position: { assetId: string; weightPct: number; asOf?: string | null } }
  | { type: 'conviction'; gap: { assetId: string; direction: string; weightPct: number; tension: number; asOf?: string | null } }
  | { type: 'crowded'; name: { assetId: string; maxWeightPct: number; asOf?: string | null } }

const lensJudgment = (
  type: SignalType,
  assetId: string,
  dispositions?: DispositionMap,
) => {
  if (!dispositions) return null
  const d = dispositions[dispositionKey(type, assetId)]
  if (!d) return null
  return { key: d.key ?? d.verdict ?? null, kind: d.kind, at: d.at }
}

/**
 * A portfolio lens, as the canonical ranker reads it.
 *
 * Moved verbatim from `MobileDashboard.rankInputFor`, including the two
 * deviation conversions, which are the only interesting part:
 *
 *   · a stale target's months overdue become the band's 0–100 shape (×5)
 *     rather than being compared against a price move, which they are not
 *   · a conviction gap's `tension` is its own mismatch measure on its own
 *     scale, scaled into the band rather than reused raw
 *
 * Both are lossy and both were argued for where they were written. They are
 * carried over unchanged because retuning them here would be a ranking change
 * smuggled into a refactor.
 */
export function lensPriorityInput(
  lens: PortfolioLens,
  ctx: CardRankContext,
): PriorityInput {
  const scopeFor = (assetId: string) =>
    scopeRelevanceFor(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX, assetId)

  switch (lens.type) {
    case 'breach':
      return {
        id: `breach-${lens.breach.assetId}`,
        type: 'target_hit',
        severity: Math.abs(lens.breach.overshootPct * 100) >= 15 ? 'critical' : 'attention',
        occurredAt: lens.breach.asOf ?? null,
        // `TargetBreach` carries no weight at all. Null is neutral here, not
        // zero — see `materialityBand`.
        weightPct: null,
        held: true,
        deviationPct: Math.abs(lens.breach.overshootPct * 100),
        scope: scopeFor(lens.breach.assetId),
        judgment: lensJudgment('target_hit', lens.breach.assetId, ctx.dispositions),
      }
    case 'stale':
      return {
        id: `stale-${lens.target.assetId}`,
        type: 'target_expired',
        severity: lens.target.overdueMonths >= 6 ? 'critical' : 'attention',
        occurredAt: lens.target.expiredAt ?? null,
        weightPct: null,
        held: true,
        deviationPct: lens.target.overdueMonths * 5,
        scope: scopeFor(lens.target.assetId),
        judgment: lensJudgment('target_expired', lens.target.assetId, ctx.dispositions),
      }
    case 'untargeted':
      return {
        id: `untargeted-${lens.position.assetId}`,
        type: 'no_target',
        severity: lens.position.weightPct >= 5 ? 'critical' : 'attention',
        occurredAt: lens.position.asOf ?? null,
        weightPct: lens.position.weightPct,
        held: true,
        deviationPct: null,
        scope: scopeFor(lens.position.assetId),
        judgment: lensJudgment('no_target', lens.position.assetId, ctx.dispositions),
      }
    case 'conviction': {
      const type: SignalType = lens.gap.direction === 'overweight'
        ? 'conviction_oversized'
        : 'conviction_undersized'
      return {
        id: `conviction-${lens.gap.assetId}`,
        type,
        severity: 'attention',
        occurredAt: lens.gap.asOf ?? null,
        weightPct: lens.gap.weightPct,
        held: true,
        deviationPct: Math.min(Math.abs(lens.gap.tension) * 100, 100),
        scope: scopeFor(lens.gap.assetId),
        judgment: lensJudgment(type, lens.gap.assetId, ctx.dispositions),
      }
    }
    default:
      return {
        id: `crowded-${lens.name.assetId}`,
        type: 'crowding',
        severity: 'informational',
        occurredAt: lens.name.asOf ?? null,
        weightPct: lens.name.maxWeightPct,
        held: true,
        deviationPct: null,
        scope: scopeFor(lens.name.assetId),
        judgment: lensJudgment('crowding', lens.name.assetId, ctx.dispositions),
      }
  }
}

/**
 * Where an answer about a lens finding is filed.
 *
 * ── Why these are asset-keyed and distinct per type ───────────────────────
 *
 * Each lens is a durable, single condition about one position: the price has
 * passed the target, the target has expired, the position has no target. So
 * `type + assetId` is the right identity, and it is stable across every rebuild
 * of the lens.
 *
 * What it must NOT be is one identity per ASSET across types. Dismissing "this
 * position has no price target" would then also silence "the price has passed
 * the target it does not have", which is incoherent — and the reason
 * `dispositionKey` takes a type at all.
 */
export function lensDispositionRef(
  lens: PortfolioLens,
): { type: SignalType; entityId: string } {
  const input = lensPriorityInput(lens, {})
  const assetId =
    lens.type === 'breach' ? lens.breach.assetId
    : lens.type === 'stale' ? lens.target.assetId
    : lens.type === 'untargeted' ? lens.position.assetId
    : lens.type === 'conviction' ? lens.gap.assetId
    : lens.name.assetId
  return { type: input.type, entityId: assetId }
}

/**
 * Where an answer about a contract card is filed.
 *
 * Straight through to `dispositionEntityFor`, which is the product's one rule
 * for this. A `scenario_gap` card is `scenario_gap:{assetId}` — one durable
 * condition per asset, which is genuinely what the detector represents: a
 * ladder has one price and one breach state at a time.
 */
export function cardDispositionRef(
  card: SignalCard,
): { type: SignalType; entityId: string } {
  return { type: card.type as SignalType, entityId: dispositionEntityFor(card) }
}

/** What `usePortfolioLenses` returns: five buckets, not a list. */
export interface PortfolioLensBuckets {
  conviction?: readonly any[]
  crowded?: readonly any[]
  breaches?: readonly any[]
  stale?: readonly any[]
  untargeted?: readonly any[]
}

/**
 * The five buckets, flattened into one list of findings.
 *
 * Shared so both shells enumerate the same lenses in the same way. Mobile used
 * to do this inline while attaching its own positional scores (60, 58, 55, 40,
 * 38) — those scores are gone: the canonical ranker decides the order now, and
 * a hand-tuned bucket precedence sitting in front of it was a second ranking
 * system. The ORDER those numbers encoded is preserved where it belongs, in the
 * TIER table: `target_hit` and `target_expired` are tier 0, `no_target` and the
 * conviction pair tier 1, `crowding` tier 2.
 */
export function toPortfolioLenses(buckets: PortfolioLensBuckets | null | undefined): PortfolioLens[] {
  if (!buckets) return []
  return [
    ...(buckets.breaches ?? []).map(breach => ({ type: 'breach' as const, breach })),
    ...(buckets.stale ?? []).map(target => ({ type: 'stale' as const, target })),
    ...(buckets.untargeted ?? []).map(position => ({ type: 'untargeted' as const, position })),
    ...(buckets.conviction ?? []).map(gap => ({ type: 'conviction' as const, gap })),
    ...(buckets.crowded ?? []).map(name => ({ type: 'crowded' as const, name })),
  ]
}

/** A builder result that produced a card, as opposed to a suppression. */
export function emittedCards(results: readonly any[] | null | undefined): SignalCard[] {
  return (results ?? []).filter(r => r?.ok === true).map(r => r.card as SignalCard)
}
