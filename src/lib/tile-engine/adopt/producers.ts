/**
 * The two shipping Mobile producers, adapted into the engine's contracts.
 *
 * ── The production paths, exactly ─────────────────────────────────────────
 *
 *   Target Expired
 *     usePortfolioLenses  → lenses.stale: StaleTarget[]
 *     buildStaleTargetCard(target)  → SignalCard
 *     MobileDashboard rankInputFor case 'stale' → PriorityInput
 *
 *   Case vs Price
 *     useScenarioCards    → buildScenarioGapCard(ScenarioGapInput) → CardResult
 *     MobileDashboard rankInputFor case 'scenario' → PriorityInput
 *
 * ── Why the adapters read the BUILT CARD ──────────────────────────────────
 *
 * Because every business decision these families make has already been made by
 * the time the card exists, and re-deriving any of it here would be the second
 * source of truth the stage forbids:
 *
 *   · whether the finding fires at all — `OVERDUE_MONTHS`, the rolling-target
 *     exemption, `timeframeMonths`, the ladder's `valid` flag, the implausible
 *     multiple, the stale-quote limit, `deriveScenarioState`;
 *   · how loud it is — `overdueMonths >= 6`, `gap >= 0.15`;
 *   · what number it turns on — `scenarioLanguage`'s metric.
 *
 * None of those are restated below. The adapters take the built card as the
 * authority, add the structural shape the engine needs, and stop. A threshold
 * appearing in this file would mean the desk could be told two different things
 * about one name depending on which renderer it went through.
 *
 * ── Why the ranking inputs are copied rather than recomputed ──────────────
 *
 * `rankInputFor` is what production hands `rankFeed` today, down to details
 * that look like accidents and are not: a stale target reports no weight and
 * no overdue days, and its deviation is `overdueMonths × 5` rather than an
 * elapsed count. A scenario gap reads its deviation back off its own metric
 * STRING, so it inherits that string's rounding.
 *
 * Reproducing the intent instead of the value would move cards in the feed.
 * The stage says the feed contract must not change, so the adapters carry
 * production's own numbers into `stakes`, and `situationPriorityInput` hands
 * them to the same scorer. Parity is then a property of the data, not of two
 * implementations agreeing.
 *
 * Pure. No React, no Supabase, no clock.
 */

import type { SignalCard } from '../../signals/contract'
import type { CoverageRelevance } from '../../signals/coverage-relevance'
import type { StaleTarget, TargetBreach } from '../../../hooks/mobile/usePortfolioLenses'
import { staleTargetSeverity, targetHitRankSeverity } from '../../signals/lens-severity'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'
import { researchBaseFor } from '../../research/case-state'
import { deriveScenarioState, dislocationPct } from '../../signals/scenario-state'
import { assembleFinding } from '../builders'
import type { Fact } from '../facts'
import type { FindingSubject, SemanticFinding } from '../finding'
import type { ArtefactAuthors } from './capability'

/** A case row as it survives onto a scenario card's evidence. */
interface AuthoredCase {
  userId?: string | null
}

/**
 * A finding the adapter declined to make, and why.
 *
 * Returned rather than `null` because a silent decline is indistinguishable
 * from a bug, and this adoption runs beside the shipping path where a card
 * that quietly stops existing is the worst available outcome. The comparison
 * harness prints these.
 */
export interface AdapterDecline {
  ok: false
  reason:
    /** The card the adapter was handed was suppressed upstream. */
    | 'not_emitted'
    /**
     * A real card that states nothing needs attention.
     *
     * Adoption B's `at_expected` decision, in the type system. See
     * `scenarioGapFinding` for the argument; the short version is that a claim
     * of agreement is not a finding, and the engine represents that by refusing
     * to make one rather than by minting a situation for it.
     */
    | 'not_an_attention_state'
    /** The card lacks a fact the engine's contract requires. */
    | 'insufficient_facts'
  detail: string
}

export type AdapterResult =
  | { ok: true; finding: SemanticFinding }
  | AdapterDecline

const decline = (reason: AdapterDecline['reason'], detail: string): AdapterDecline =>
  ({ ok: false, reason, detail })

// ─────────────────────────────────────────────────────────────────────────────
// 1. Target Expired
// ─────────────────────────────────────────────────────────────────────────────

export interface StaleTargetAdapterInput {
  /** The lens row, exactly as `usePortfolioLenses` produced it. */
  source: StaleTarget
  /** `buildStaleTargetCard(source)`, unwrapped. The severity authority. */
  card: SignalCard
  /** From `coverageRelevanceFor`, as `withJudgment` supplies it. */
  coverage: CoverageRelevance
}

/**
 * Who wrote the artefact a revision would change, per family.
 *
 * Read here rather than sniffed off the card's evidence, so a producer that
 * cannot answer says `null` instead of having its shape misread. See
 * `capability.ts` for what each answer means.
 */
export function staleTargetAuthors(s: StaleTarget): ArtefactAuthors {
  return s.authorId === undefined ? null : [s.authorId]
}

/** The ladder's authors, as `selectCurrentLadders` already resolves them. */
export function scenarioGapAuthors(card: SignalCard): ArtefactAuthors {
  const cases = (card.evidence?.data as { cases?: AuthoredCase[] } | undefined)?.cases
  if (!Array.isArray(cases) || !cases.some(c => c && 'userId' in c)) return null
  return cases.map(c => c?.userId ?? null)
}

export function staleTargetFinding(input: StaleTargetAdapterInput): AdapterResult {
  const { source: s, card, coverage } = input

  if (!Number.isFinite(s.target) || !s.expiredAt || !s.statedAt) {
    return decline('insufficient_facts', `${s.symbol}: target ${s.target}, expiredAt ${s.expiredAt}`)
  }

  /**
   * The target, and the mark the lens read it against.
   *
   * Both carried, with different provenance, because they genuinely have it:
   * the target is `stated` and the price on a `StaleTarget` is a
   * `portfolio_holdings` mark, not a quote. The card is careful never to print
   * that mark as "the price" — see the body comment in `buildStaleTargetCard`
   * — and the engine inherits the care by labelling the fact rather than by
   * remembering the rule.
   */
  const facts: Fact[] = [
    { key: 'target_price', value: s.target, source: 'stated', asOf: s.statedAt },
    { key: 'holdings_mark', value: s.price, source: 'holdings', asOf: s.asOf },
  ]

  const subject: FindingSubject = {
    kind: 'asset', id: s.assetId, name: s.companyName || s.symbol, ticker: s.symbol,
  }

  return {
    ok: true,
    finding: assembleFinding('target_expired', {
      /**
       * The card's own id, not a new one.
       *
       * Ids are the final tie-break in `compareRanked`, and the situation's id
       * is a composition key rather than a card identity. Carrying the card's
       * keeps every downstream store that is already keyed by it — dispositions,
       * dwell tracking, pane state — pointing at the same object.
       */
      id: card.id,
      subject,
      claim: {
        predicate: 'expired',
        /**
         * Months, because that is the unit production states and ranks in.
         *
         * The reference builder counts days, which is a better unit and the
         * wrong one here: `overdueMonths` is what the metric prints, what the
         * severity turns on, and what `rankInputFor` multiplies by five. A
         * second unit would be a second answer to "how late is this".
         */
        quantity: { value: s.overdueMonths, unit: 'count', direction: 'bad' },
        interval: { from: s.statedAt, to: s.expiredAt },
      },
      facts,
      stakes: {
        /**
         * Production's own ranking inputs, copied.
         *
         * `weightPct` is null and `overdueDays` is absent because
         * `rankInputFor` supplies neither — `StaleTarget` carries no weight,
         * and null is its own materiality band rather than the bottom one.
         * `deviationPct` is `overdueMonths × 5`, which is that call site's
         * conversion of months-past-horizon into the band's 0-100 shape.
         */
        weightPct: null,
        held: true,
        deviationPct: s.overdueMonths * 5,
        coverage,
      },
      occurredAt: s.expiredAt,
      /**
       * Production decides, through the shared expression.
       *
       * The card and the ranker agree on this family, so reading `card.severity`
       * would give the same answer. `lens-severity` is used anyway so the two
       * target families take their severity from one place — which is what made
       * target-hit's disagreement visible instead of inherited.
       */
      severity: staleTargetSeverity(s.overdueMonths),
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Case vs Price / Scenario Dislocation
// ─────────────────────────────────────────────────────────────────────────────

/** The shape `buildScenarioGapCard` puts in `evidence.data`. */
interface LadderEvidence {
  price: number
  cases: { name: string; price: number; probability: number | null }[]
  expected?: number | null
}

export interface ScenarioGapAdapterInput {
  /** `buildScenarioGapCard(...)`, unwrapped. */
  card: SignalCard
  /**
   * The position behind the framework, from `frameworkCapitalFor`.
   *
   * Exactly what `rankInputFor`'s scenario branch computes, passed in rather
   * than recomputed so the two cannot drift. Null means unheld.
   */
  capital: { weightPct?: number | null } | null
  coverage: CoverageRelevance
}

/**
 * The deviation, from the ladder — the same structured source production reads.
 *
 * ── What this used to do, and why it stopped ──────────────────────────────
 *
 * It parsed the digits out of `card.metric.value`, because that was what
 * `rankInputFor` did and parity meant matching it. Adoption C fixed the
 * shipping ranker instead: the metric for `at_expected` is a price, so a
 * fairly-valued name was ranking as a 244% deviation.
 *
 * Both sides now call `dislocationPct` on the state the builder itself derives,
 * so parity is a property of one shared function rather than of two readers
 * agreeing about a string. The rounding that `toFixed(0)` used to introduce is
 * gone from both at once.
 */
function deviationFromLadder(
  price: number, cases: { name: string; price: number }[],
): number | null {
  const state = deriveScenarioState(price, cases as any[])
  return state ? dislocationPct(price, state) : null
}

export function scenarioGapFinding(input: ScenarioGapAdapterInput): AdapterResult {
  const { card, capital, coverage } = input

  const evidence = card.evidence?.data as LadderEvidence | undefined
  const cases = evidence?.cases ?? []
  if (!evidence || cases.length < 2 || !Number.isFinite(evidence.price)) {
    return decline('insufficient_facts', `${card.entity.ticker ?? card.entity.id}: no usable ladder on the card`)
  }

  /**
   * `usable` is already sorted ascending by the builder. Read, never re-sorted:
   * a second sort is a second opinion about which case is the floor.
   */
  const low = cases[0].price
  const high = cases[cases.length - 1].price
  const current = evidence.price

  /**
   * `at_expected` is not an attention situation, and gets no taxonomy.
   *
   * ── The question the stage asked ────────────────────────────────────────
   *
   * Is it (A) another state of the Case vs Price relationship, (B) a separate
   * investor situation, or (C) an ordinary non-attention state that should not
   * produce an attention situation? The product's own behaviour answers it, in
   * three places that agree.
   *
   *   · The builder suppresses every OTHER inside-range state with the reason
   *     "the price being somewhere between the bear and bull cases is the
   *     normal state of every position, and a card that fires on it fires on
   *     everything." `at_expected` is inside the range. It is that normal state
   *     with a tighter tolerance around one point in it.
   *
   *   · It is the only scenario claim the builder marks `informational` — the
   *     bottom severity band — while `scenario_gap` sits at tier 0 with base
   *     1.00, the highest in the product. Tier 0 is named `decision_mismatch`
   *     and means "the price has left the framework". Nothing has left
   *     anything. A card that says so does not belong at the head of the feed,
   *     and the ranking table has no way to express that for one claim of one
   *     type.
   *
   *   · Its own metric is a PRICE — `$244`, the expected value — where the
   *     other two claims carry a percentage gap. That is a report, not a
   *     deviation.
   *
   * So: (C). It is a confirmation that the market agrees with the desk's own
   * arithmetic, which is worth knowing and is not something anybody must act
   * on. Minting a seventh canonical situation for it would be creating taxonomy
   * to preserve a legacy card type, which the stage forbids and which would
   * also put "nothing is wrong" permanently into an attention surface.
   *
   * The smallest change that represents the right answer is therefore a decline
   * with an honest reason, and the reason is a NAMED SEMANTIC STATE rather than
   * a coverage gap. `not_an_attention_state` is the whole architecture change.
   *
   * The card still renders exactly as production built it — the engine declines
   * to reframe it, it does not remove it. Whether production should keep
   * emitting it at tier 0 is a feed decision, out of scope here, and reported.
   */
  const outside = current < low || current > high
  if (!outside) {
    return decline(
      'not_an_attention_state',
      `${card.entity.ticker ?? card.entity.id}: price ${current} is inside [${low}, ${high}] — at_expected, a confirmation rather than a finding`,
    )
  }

  const breached = current < low ? cases[0] : cases[cases.length - 1]

  const facts: Fact[] = [
    {
      key: 'quote', value: current, source: 'quote',
      /** The card's metric is the claim, so its `asOf` is the quote's time. */
      asOf: card.metric?.asOf ?? card.provenance.occurredAt,
    },
    ...cases.map<Fact<number>>(c => ({
      key: `case:${c.name}`, value: c.price, source: 'stated',
      asOf: card.provenance.occurredAt,
    })),
  ]

  const subject: FindingSubject = {
    kind: 'asset',
    id: card.entity.id,
    name: card.entity.name,
    ticker: card.entity.ticker,
  }

  return {
    ok: true,
    finding: assembleFinding('case_price_dislocation', {
      id: card.id,
      subject,
      claim: {
        predicate: 'outside_band',
        /** Production's own figure, rounding included. See above. */
        quantity: {
          value: deviationFromLadder(current, cases) ?? 0,
          unit: 'pct',
          direction: card.metric?.direction ?? 'bad',
        },
        band: { low, high, current, breachedLabel: breached.name },
      },
      facts,
      stakes: {
        weightPct: capital?.weightPct ?? null,
        held: capital != null,
        deviationPct: deviationFromLadder(current, cases),
        coverage,
      },
      /** `provenance.occurredAt` is `priceAsOf` — what `rankInputFor` reads. */
      occurredAt: card.provenance.occurredAt,
      severity: card.severity,
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Target Hit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The production path:
 *
 *   usePortfolioLenses → lenses.breaches: TargetBreach[]
 *   buildTargetHitCard(breach) → SignalCard
 *   MobileDashboard rankInputFor case 'breach' → PriorityInput
 *
 * ── What is NOT decided here ──────────────────────────────────────────────
 *
 * Which case counts as reached. `usePortfolioLenses` sorts the ladder, excludes
 * the lowest rung — "passing the LOWEST is the downside scenario not happening,
 * it is Tuesday" — and takes the highest of the ones the price has passed. That
 * rule was reported, argued and fixed once already; restating any part of it
 * here would be the second implementation the stage forbids.
 *
 * ── The one place the card is not the authority ───────────────────────────
 *
 * Severity. `buildTargetHitCard` calls it critical past a 10% overshoot and
 * `rankInputFor` past 15%, so the shipping card and the shipping ranker
 * genuinely disagree for a band of real positions. The finding's severity feeds
 * the SCORER, so it takes the ranking answer through `lens-severity`; the
 * projection preserves the card's own severity for the rail. Both shipping
 * behaviours survive, and the divergence is reported rather than silently
 * picked.
 */
export interface TargetHitAdapterInput {
  /** The lens row, exactly as `usePortfolioLenses` produced it. */
  source: TargetBreach
  /** `buildTargetHitCard(source)`, unwrapped. Identity and display. */
  card: SignalCard
  coverage: CoverageRelevance
}

export function targetHitFinding(input: TargetHitAdapterInput): AdapterResult {
  const { source: b, card, coverage } = input

  if (!Number.isFinite(b.target) || !Number.isFinite(b.overshootPct)) {
    return decline('insufficient_facts', `${b.symbol}: target ${b.target}, overshoot ${b.overshootPct}`)
  }

  /**
   * The target, and the mark it was measured against.
   *
   * Separately sourced because they are separately sourced in the product: the
   * target is `stated`, and `TargetBreach.price` is a `portfolio_holdings`
   * mark. The card's own body is careful to say "the position is marked at"
   * rather than "the price is", and carrying the provenance on the fact is how
   * the engine inherits that care without having to remember the rule.
   */
  const facts: Fact[] = [
    { key: 'target_price', value: b.target, source: 'stated', asOf: b.statedAt },
    { key: 'holdings_mark', value: b.price, source: 'holdings', asOf: b.asOf },
  ]

  const overshoot = b.overshootPct * 100

  return {
    ok: true,
    finding: assembleFinding('target_reached', {
      id: card.id,
      subject: {
        kind: 'asset', id: b.assetId, name: b.companyName || b.symbol, ticker: b.symbol,
      },
      claim: {
        predicate: 'threshold_passed',
        quantity: { value: overshoot, unit: 'pct', direction: 'good' },
        threshold: {
          level: b.target,
          observed: b.price,
          /** The case the price passed, where the row names one. */
          ...(b.caseName ? { label: b.caseName } : {}),
        },
      },
      facts,
      stakes: {
        /**
         * `rankInputFor`'s breach branch, copied.
         *
         * `TargetBreach` carries no weight at all, and null is the neutral
         * materiality band rather than the bottom one — the distinction the
         * scorer's own header insists on.
         */
        weightPct: null,
        held: true,
        deviationPct: Math.abs(overshoot),
        coverage,
      },
      occurredAt: b.asOf,
      /** The RANKING severity. See the header. */
      severity: targetHitRankSeverity(b.overshootPct),
    }),
  }
}

/** The ladder behind the breach carries no author on this row. */
export function targetHitAuthors(): ArtefactAuthors {
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. No Core Thesis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The production path:
 *
 *   useDerivedInsights → researchIssueFor → DerivedInsight { kind: 'no_thesis' }
 *   buildInsightCard(insight, capital) → SignalCard
 *   MobileDashboard rankInputFor case 'insight' → PriorityInput
 *
 * ── What "no core thesis" actually means in this product ──────────────────
 *
 * `researchSignalTypeFor` maps TWO framings onto `no_research`: `no_case`, all
 * three core sections absent, and `incomplete_case`, some written and some
 * not. Both are the same claim — capital or coverage without a complete
 * argument — and the product deliberately keeps them one type while letting
 * the card name itself precisely. `buildInsightCard` refuses the capital
 * reframe on `incomplete_case` because "a partial view is still a view, and
 * telling somebody their capital has no thesis when two thirds of one is
 * written would be false", and the finding carries the same distinction in
 * `claim.completeness` rather than in a second kind.
 *
 * ── Nothing about WHETHER it fires is decided here ────────────────────────
 *
 * `researchIssueFor` owns that, including the precedence that gives one case
 * at most one issue, the core-section list, the staleness threshold and the
 * anchor rules. This adapter is handed an insight that already qualified.
 */
export interface NoCoreThesisAdapterInput {
  /** The insight, exactly as `useDerivedInsights` produced it. */
  insight: DerivedInsight
  /** `buildInsightCard(insight, capital)`, unwrapped. */
  card: SignalCard
  coverage: CoverageRelevance
}

export function noCoreThesisFinding(input: NoCoreThesisAdapterInput): AdapterResult {
  const { insight: i, card, coverage } = input

  if (i.kind !== 'no_thesis') {
    /**
     * `stale_research` is the other half of this producer and is NOT adopted.
     *
     * Declining by kind rather than by framing keeps the boundary at the same
     * place production draws it — `insightSignalType` — so the adopted set can
     * never silently widen because a framing was reclassified upstream.
     */
    return decline('insufficient_facts', `${i.symbol}: kind ${i.kind} is not an adopted situation`)
  }

  const expected = i.issue.present.length + i.issue.missing.length
  if (expected <= 0) {
    return decline('insufficient_facts', `${i.symbol}: the issue names no core sections`)
  }

  /**
   * The absence itself, dated by the clock the producer anchored on.
   *
   * A case that was never written has no `caseWrittenAt`, and the fact carries
   * that as a genuine null value rather than as a missing fact — the
   * distinction `AbsentFact` exists for. `reviewAnchor` is what every
   * production condition measures from, so it is the honest `asOf` when there
   * is one.
   */
  const facts: Fact[] = [
    {
      key: 'core_thesis',
      value: i.caseWrittenAt,
      source: 'stated',
      asOf: i.reviewAnchor ?? i.caseWrittenAt ?? card.provenance.occurredAt,
    },
  ]

  const subject: FindingSubject = {
    kind: 'asset', id: i.assetId, name: i.companyName || i.symbol, ticker: i.symbol,
  }

  return {
    ok: true,
    finding: assembleFinding('no_core_thesis', {
      id: card.id,
      subject,
      claim: {
        predicate: 'absent',
        /**
         * The shape of the gap, and no number.
         *
         * Production shows no metric on this card unless the capital reframe
         * applies, and `buildNoTargetCard` says why counting an absence is
         * wrong: a count of missing things "is a number standing in for
         * nothing". `completeness` tells a void case from a partly written one,
         * which is what the copy needs and is not a hero figure.
         */
        completeness: { present: i.issue.present.length, expected },
      },
      facts,
      stakes: {
        /**
         * `rankInputFor`'s insight branch, copied field for field.
         *
         * `deviationPct` is null there and deliberately so — the move's
         * magnitude is already inside `researchBaseFor`, and passing it twice
         * inverted the family's order once already.
         *
         * `base` is `researchBaseFor(issue)` and NOT `insight.score`. The two
         * differ by a weight nudge that `useDerivedInsights` adds for its own
         * within-family sort, and `rankInputFor` deliberately does not pass:
         * materiality already enters the score through `weightPct`, so sending
         * the nudged figure counts size twice. Calling production's own
         * function is carrying its answer, not restating its rule.
         */
        weightPct: i.weightPct ?? null,
        held: i.held,
        deviationPct: null,
        base: researchBaseFor(i.issue),
        coverage,
      },
      /**
       * `reviewAnchor`, and the empty string where there is none.
       *
       * Production passes `null` here and the scorer treats an unparseable
       * value exactly as it treats null — `toEpoch` returns null for both, so
       * `recencyBoost` contributes nothing. The engine's `occurredAt` is typed
       * as a string because every other finding genuinely has one, and a case
       * that was never written genuinely does not. Same ranking, stated where a
       * reader will find it rather than in a nullable field nothing else needs.
       */
      occurredAt: i.reviewAnchor ?? '',
      /** Production's own: Research is amber, never red and never grey. */
      severity: card.severity,
    }),
  }
}

/**
 * A case that was never written has no author to check.
 *
 * Not a gap in the data and not something to guess at: there is no row, so
 * nobody wrote it, and the artefact a "write the thesis" action would create
 * does not exist yet. `null` says the producer cannot answer, which resolves to
 * a non-commit path — the correct outcome rather than a defaulted one.
 */
export function noCoreThesisAuthors(): ArtefactAuthors {
  return null
}
