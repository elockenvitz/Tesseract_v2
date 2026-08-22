import {
  emit,
  suppress,
  type CardResult,
  type Severity,
  type SignalCard,
} from '../contract'
import { gate, isDisplayableNumber, isQualityContent } from '../suppression'
import { actions, assetHref, dayKey, pct } from './shared'
import { hasBenchmarkWeight, isHoldable, type InstrumentClass } from '../instrument'

/**
 * Active risk: where the book differs from the benchmark.
 *
 * A position is not a bet; the difference between the position and the index
 * is. A 6% weight in a name the benchmark holds at 5.8% expresses almost no
 * view, and the old card said "6% of the book" without that denominator — true
 * and useless.
 *
 * The number here comes from `portfolio_holdings`, an upload-time mark carried
 * forward nightly. That is legitimate for a *weight*, which is a ratio of two
 * marks taken on the same day and therefore survives both being stale — and
 * illegitimate for anything compared against a live quote. This builder
 * touches only weights, so it never trips `snapshot_vs_live`. The eyebrow
 * still renders "book 31 Jul" via `source: 'holdings'`, because a fifteen-day-
 * old weight and a live one should not look identical on screen.
 */

export interface ActiveRiskInput {
  assetId: string
  symbol: string
  companyName?: string | null
  /** Portfolio weight, percent. */
  weightPct: number
  /** Benchmark weight, percent. Null when the name is not in the index. */
  benchmarkWeightPct: number | null
  /**
   * How many names the portfolio's benchmark file actually lists.
   *
   * Load-bearing, and the card is wrong without it. A null
   * `benchmarkWeightPct` has two completely different meanings: "the index
   * does not hold this name", which is a finding, and "there is no benchmark
   * data for this portfolio at all", which is missing data. They are
   * indistinguishable from the name's own row, and this builder read every one
   * as the first — printing "the benchmark does not hold it, so all of it is
   * active risk" over three portfolios whose benchmark table was empty.
   *
   * Measured per organisation 2026-08-18, which is the only way this number
   * means anything: two orgs (Tesseract, Kappy Capital) carry all 483
   * benchmark rows, and every other populated org has a book and no benchmark
   * at all. So the empty case is the COMMON one for a pilot tenant, not an
   * edge. Omit only when the caller genuinely cannot count, which suppresses
   * rather than guesses.
   */
  benchmarkNameCount?: number
  portfolioId: string
  portfolioName: string
  /** Date of the holdings snapshot the portfolio weight comes from. ISO. */
  asOf: string
  /**
   * What KIND of instrument this is, from `assets.asset_type`.
   *
   * Null is permissive — it means nobody has classified the row yet, and
   * refusing to render for that would silently empty the feed. What it gates
   * is the structurally impossible: an index is not a position, and a currency
   * pair is not an index constituent, so neither has an "active weight" in the
   * sense this card asserts.
   */
  instrumentClass?: InstrumentClass
  /**
   * Where the benchmark weight came from — mandatory when one is supplied.
   *
   * S7: a card computed against an ETF proxy must say so on its face. SPY is
   * not the S&P 500; it is a fund that tracks it, with its own cash drag,
   * rebalance lag and as-of date. Presenting a proxy weight as "the benchmark"
   * would be the same class of error as presenting a normalised probability
   * distribution as the analyst's own.
   */
  benchmarkSource?: {
    /** What the portfolio claims to track, e.g. "S&P 500". */
    index: string
    /** The instrument actually used, e.g. "SPY". */
    proxy: string
    /** As-of date taken from the issuer file itself, never ingestion time. */
    asOf: string
    /** False once a licensed benchmark feed replaces the proxy. */
    isProxy: boolean
  }
}

/**
 * Where an active bet stops being a rounding difference.
 *
 * 1.5% because below it the position is inside the noise of a monthly rebalance
 * and flagging it would fire on most of the book — a filter wearing a finding's
 * clothes.
 */
export const MIN_ACTIVE_PCT = 1.5
/** A bet this size is the portfolio's identity, not a tilt. */
const CRITICAL_ACTIVE_PCT = 5

/** "14 Aug" in UTC — the date belongs to the issuer file, not the reader. */
function shortUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'undated'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function severityFor(active: number, offBenchmark: boolean): Severity {
  const size = Math.abs(active)
  if (size >= CRITICAL_ACTIVE_PCT) return 'critical'
  // An off-benchmark name has no offset at all: the entire position is the
  // bet. That earns a step up even at a moderate size.
  if (offBenchmark && size >= MIN_ACTIVE_PCT * 2) return 'critical'
  return 'attention'
}

export function buildActiveRiskCard(input: ActiveRiskInput): CardResult {
  return gate('active_risk', () => {
    const { assetId, symbol, weightPct, benchmarkWeightPct, portfolioName, asOf } = input
    const entity = symbol || assetId

    if (!isQualityContent(symbol)) {
      return suppress('content_quality', entity, `symbol: ${JSON.stringify(symbol)}`)
    }

    /**
     * The claim has to be POSSIBLE before it can be checked.
     *
     * An index cannot be a position — you hold a fund that tracks it, not the
     * index — so "6.2% of the book" is not a statement that can be true of
     * one. A currency pair or a commodity future is not an equity-index
     * constituent, so its benchmark weight is absent for a structural reason
     * rather than a data one, and computing active weight against zero would
     * render it as a deliberate off-benchmark bet.
     *
     * That is the same false claim `insufficient_coverage` was added to stop
     * from the other direction, so it gets the same suppression.
     */
    const cls = input.instrumentClass ?? null
    if (!isHoldable(cls)) {
      return suppress('insufficient_coverage', entity, `${cls} is not a position`)
    }
    if (!hasBenchmarkWeight(cls)) {
      return suppress('insufficient_coverage', entity, `${cls} is not an equity-index constituent`)
    }
    // Weight zero is a name that is not held — no position, no bet, nothing to
    // say. Rejecting it here rather than treating it as "0% active" matters
    // because a missing join produces exactly that shape.
    if (!isDisplayableNumber(weightPct)) {
      return suppress('missing_number', entity, `weightPct: ${weightPct}`)
    }
    if (!asOf || Number.isNaN(new Date(asOf).getTime())) {
      return suppress('missing_number', entity, `asOf: ${JSON.stringify(asOf)}`)
    }

    /**
     * Absence of a benchmark row is only a finding if there IS a benchmark.
     *
     * Without this the card asserts "the benchmark does not hold it, so all of
     * it is active risk" on a portfolio whose benchmark file was never loaded —
     * a statement about the index derived entirely from an empty table. That is
     * the same defect as reading a null quote as a zero price: absence
     * rendering as a meaningful number.
     *
     * `insufficient_coverage`, not `missing_number`, because nothing on this
     * name is missing. The portfolio has no benchmark to be active against, so
     * there is no such thing as its active weight.
     */
    if (input.benchmarkNameCount != null && input.benchmarkNameCount === 0) {
      return suppress(
        'insufficient_coverage',
        entity,
        `${portfolioName} has no benchmark weights, so "active" is undefined`,
      )
    }

    // A null benchmark weight means the index does not hold the name; a zero
    // means the same thing. Both are genuinely zero, so `allowZero` — this is
    // the case the contract's default rejection is wrong about.
    const bench = benchmarkWeightPct ?? 0
    if (!isDisplayableNumber(bench, { allowZero: true }) || bench < 0) {
      return suppress('missing_number', entity, `benchmarkWeightPct: ${benchmarkWeightPct}`)
    }
    if (weightPct < 0 || weightPct > 100 || bench > 100) {
      // A weight outside 0–100 is a unit error — fractions stored where
      // percents were expected, or the reverse. Rendering it would put an
      // impossible number on a card that claims to be checkable.
      return suppress(
        'inconsistent_numbers',
        entity,
        `weight ${weightPct}% vs benchmark ${bench}% — outside 0–100`,
      )
    }

    const active = weightPct - bench
    const offBenchmark = benchmarkWeightPct == null || benchmarkWeightPct === 0
    const over = active > 0

    const card: SignalCard = {
      id: `active_risk:${input.portfolioId}:${assetId}`,
      type: 'active_risk',
      surface: 'risk',
      severity: severityFor(active, offBenchmark),
      // The claim and its qualifier, no number — the metric block below
      // carries it. "MSFT is a +3.1% overweight" over "+3.1% ACTIVE WEIGHT"
      // put the same figure on screen twice.
      headline: `${symbol} is ${offBenchmark ? 'an off-benchmark' : `an active`} ${over ? 'overweight' : 'underweight'} in ${portfolioName}`,
      metric: {
        value: pct(active),
        label: 'Active weight',
        // Deliberately neutral. An overweight is not "good" and an underweight
        // is not "bad" — colouring them would editorialise the portfolio
        // manager's own decision back at them.
        direction: 'neutral',
        source: 'holdings',
        asOf,
      },
      body: offBenchmark
        ? `The position is ${weightPct.toFixed(1)}% of the portfolio and the benchmark does not hold it, so all of it is active risk. Nothing offsets this if the thesis is wrong.`
        : `${weightPct.toFixed(1)}% of the portfolio against ${bench.toFixed(1)}% in the benchmark. This is where the view is being expressed.`,
      prompt: 'Is this bet the size you meant it to be?',
      entity: {
        kind: 'asset',
        id: assetId,
        name: input.companyName || symbol,
        ticker: symbol,
      },
      context: [
        /**
         * The book, as a DISCLOSURE rather than as inert text.
         *
         * This was `{ label: portfolioName }` — a bare string. So on an active
         * risk card the portfolio name was not tappable, not navigable, and
         * carried none of the position detail this card already knows.
         * Reported as portfolios like "Vision Fund 10k" not being hyperlinked,
         * and separately as the disclosure having nothing worth reading in it.
         *
         * Both are the same omission. This builder holds the weight AND the
         * benchmark weight, so it can state the position and its active
         * distance without another query — which is exactly what a reader
         * opening "which book, and how big" is asking for.
         */
        {
          label: portfolioName,
          portfolios: [{
            id: input.portfolioId,
            name: portfolioName,
            weightPct,
            // The number this card is ABOUT. Omitted where there is no
            // benchmark rather than reported as a zero active weight, which
            // would be a claim that the position is neutral.
            ...(Number.isFinite(bench) ? { activePct: weightPct - bench } : {}),
          }],
        },
        offBenchmark ? { label: 'Off benchmark' } : { label: `Bench ${bench.toFixed(1)}%` },
        // S7. Never omitted when a proxy was used: the reader has to be able to
        // tell a licensed benchmark from an ETF standing in for one, and to see
        // how old the standing-in file is.
        ...(input.benchmarkSource
          ? [{
              label: input.benchmarkSource.isProxy
                ? `${input.benchmarkSource.index} via ${input.benchmarkSource.proxy} (ETF proxy) · ${shortUtc(input.benchmarkSource.asOf)}`
                : `${input.benchmarkSource.index} · ${shortUtc(input.benchmarkSource.asOf)}`,
            }]
          : []),
      ],
      // Evidence: the portfolio's other active weights. A sparkline of price
      // would say nothing about active weight, but the ranked peer list is the
      // comparison that makes one active weight mean anything — measured, the
      // card was 58% empty without it.
      evidence: { kind: 'peer_bar', data: { subject: symbol, activePct: active } },
      actions: actions(
        // Recording a view is the one thing genuinely resolvable from a feed.
        // Changing the size is not, and pretending otherwise with an inline
        // control would be a lie about what the button does.
        //
        // The what-if slider the feed hangs off this card's detail slot
        // (`WhatIfSize`) does not contradict that: dragging it computes and
        // writes nothing, and holding it records the proposed size as a note.
        // Exploration became local; the commit is still a record, not a trade.
        { id: 'capture', label: 'Capture', inline: true },
        { label: `Open ${symbol}`, href: assetHref(assetId) },
      ),
      provenance: {
        occurredAt: asOf,
        reason: `${symbol} carries ${pct(active)} of active weight in ${portfolioName}, the ${
          over ? 'largest overweights' : 'largest underweights'
        } being where the portfolio can differ from its benchmark.`,
      },
      expiry: {
        // Weights move with the market daily, but the *bet* does not. A week
        // is roughly how long an active position stays the same decision.
        staleAfterDays: 7,
      },
      // Trigger period is the snapshot date: the same overweight on a new
      // book is a new statement of the same claim, and should re-surface once
      // the numbers behind it have actually changed.
      dedupeKey: `active_risk:${assetId}:${dayKey(asOf)}`,
    }

    return emit(card)
  })
}

/**
 * Rank candidates and keep the ones worth a card.
 *
 * Thresholding lives here rather than in the builder on purpose: "too small to
 * mention" is a selection decision, not a suppression, and logging it as one
 * would bury the genuine data faults — the unit errors and missing joins the
 * builder does catch — under thousands of routine below-threshold lines.
 */
export function selectActiveRisk(
  holdings: ActiveRiskInput[],
  opts: { minActivePct?: number; limit?: number } = {},
): ActiveRiskInput[] {
  const { minActivePct = MIN_ACTIVE_PCT, limit = 3 } = opts
  return holdings
    .map(h => ({ h, active: h.weightPct - (h.benchmarkWeightPct ?? 0) }))
    .filter(({ active }) => Number.isFinite(active) && Math.abs(active) >= minActivePct)
    .sort((a, b) => Math.abs(b.active) - Math.abs(a.active))
    .slice(0, limit)
    .map(({ h }) => h)
}
