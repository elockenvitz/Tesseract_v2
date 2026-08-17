import {
  emit,
  suppress,
  type CardResult,
  type Severity,
  type SignalCard,
} from '../contract'
import { gate, isDisplayableNumber, isQualityContent } from '../suppression'
import { actions, assetHref, dayKey, pct } from './shared'

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
  portfolioId: string
  portfolioName: string
  /** Date of the holdings snapshot the portfolio weight comes from. ISO. */
  asOf: string
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
    // Weight zero is a name that is not held — no position, no bet, nothing to
    // say. Rejecting it here rather than treating it as "0% active" matters
    // because a missing join produces exactly that shape.
    if (!isDisplayableNumber(weightPct)) {
      return suppress('missing_number', entity, `weightPct: ${weightPct}`)
    }
    if (!asOf || Number.isNaN(new Date(asOf).getTime())) {
      return suppress('missing_number', entity, `asOf: ${JSON.stringify(asOf)}`)
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
        ? `The position is ${weightPct.toFixed(1)}% of the book and the benchmark does not hold it, so all of it is active risk. Nothing offsets this if the thesis is wrong.`
        : `${weightPct.toFixed(1)}% of the book against ${bench.toFixed(1)}% in the benchmark. This is where the portfolio is expressing a view.`,
      entity: {
        kind: 'asset',
        id: assetId,
        name: input.companyName || symbol,
        ticker: symbol,
      },
      context: [
        { label: portfolioName },
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
      // No evidence. A sparkline of price says nothing about active weight,
      // and the contract's rule is that a chart needs an argument to appear.
      actions: actions(
        // Recording a view is the one thing genuinely resolvable from a feed.
        // Changing the size is not, and pretending otherwise with an inline
        // control would be a lie about what the button does.
        { id: 'capture', label: 'Capture', inline: true },
        { label: `Open ${symbol}`, href: assetHref(assetId) },
      ),
      provenance: {
        occurredAt: asOf,
        reason: `${symbol} carries ${pct(active)} of active weight in ${portfolioName}, the ${
          over ? 'largest overweights' : 'largest underweights'
        } being where the book can differ from its benchmark.`,
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
