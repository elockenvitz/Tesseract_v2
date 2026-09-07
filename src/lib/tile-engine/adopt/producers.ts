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
import type { StaleTarget } from '../../../hooks/mobile/usePortfolioLenses'
import { assembleFinding } from '../builders'
import type { Fact } from '../facts'
import type { FindingSubject, SemanticFinding } from '../finding'

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
    /** A real card, of a claim this situation does not cover. See below. */
    | 'claim_out_of_scope'
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
      /** Production decides. `overdueMonths >= 6 ? critical : attention`. */
      severity: card.severity,
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
 * Read the deviation the way production reads it: off the metric string.
 *
 * ── Why not recompute it from the ladder ──────────────────────────────────
 *
 * Because production does not. `rankInputFor` strips the non-numerics out of
 * `card.metric.value`, and that string has already been through `toFixed(0)`.
 * A raw recomputation is a better number and a different one: 14.6 recomputed
 * stays under `MATERIAL_DEVIATION_PCT`, while "15%" read back off the card
 * crosses it, and a card would change bands purely by being adapted.
 *
 * The stage says the ranking input semantics must not change, so the engine
 * inherits the rounding rather than improving it. Improving it is a separate,
 * visible decision about the shipping feed.
 */
function deviationFromMetric(card: SignalCard): number | null {
  const raw = String(card.metric?.value ?? '').replace(/[^0-9.]/g, '')
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
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
   * `at_expected` is a real card and NOT a dislocation.
   *
   * ── Why this declines rather than stretching the situation ──────────────
   *
   * `buildScenarioGapCard` emits three claims. Two are the price leaving the
   * modelled range; the third fires when the price sits within 3% of the
   * probability-weighted expected value, INSIDE the range, and says the market
   * agrees with the analyst's own arithmetic. The builder explicitly suppresses
   * every other inside-range state as "the normal state of every position".
   *
   * "Fairly valued against your own work" is a different claim from "the price
   * has left the band you wrote", with a different question behind it and a
   * different action. Widening `case_price_dislocation` to hold both would make
   * the predicate `outside_band` false for one of its own members — the exact
   * shape of the `research_stale` problem the contract documents at length.
   *
   * So it is declined, loudly, and the comparison harness reports it as a
   * declared coverage gap rather than a card that quietly stopped existing.
   * Covering it is a seventh situation, which this stage is scoped out of.
   */
  const outside = current < low || current > high
  if (!outside) {
    return decline(
      'claim_out_of_scope',
      `${card.entity.ticker ?? card.entity.id}: price ${current} is inside [${low}, ${high}] — at_expected, not a dislocation`,
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
          value: deviationFromMetric(card) ?? 0,
          unit: 'pct',
          direction: card.metric?.direction ?? 'bad',
        },
        band: { low, high, current, breachedLabel: breached.name },
      },
      facts,
      stakes: {
        weightPct: capital?.weightPct ?? null,
        held: capital != null,
        deviationPct: deviationFromMetric(card),
        coverage,
      },
      /** `provenance.occurredAt` is `priceAsOf` — what `rankInputFor` reads. */
      occurredAt: card.provenance.occurredAt,
      severity: card.severity,
    }),
  }
}
