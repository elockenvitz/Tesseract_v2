import {
  emit,
  suppress,
  type CardResult,
  type Severity,
  type SignalCard,
} from '../contract'
import { gate, isDisplayableNumber, isQuoteFresh } from '../suppression'
import { actions, assetHref, dayKey, pct, TRIAGE } from './shared'

/**
 * The price against the analyst's own scenario ladder.
 *
 * `analyst_price_targets` stores one row per scenario with a probability, so a
 * name carries a bear/base/bull spread and a probability-weighted expected
 * value. Every other surface in the product reduces that to a single number —
 * "official first, then most recent" — which picks one row arbitrarily and
 * discards the shape. On TSLA that means showing 400 and hiding the fact that
 * the price is below the bear case of 325.
 *
 * This card exists because the spread answers a question a single target
 * cannot: not "is there upside" but "is the market price still inside the range I
 * modelled". Three claims come out of that, and they are genuinely different
 * decisions:
 *
 *   below_bear   the price is under the worst case you wrote down. Either the
 *                thesis is broken or this is the best entry you have modelled,
 *                and both need a person
 *   above_bull   the price has passed your best case. The position has no
 *                stated upside left and nobody has said so
 *   at_expected  the price sits at the probability-weighted expected value.
 *                Fairly valued against your own work — a hold, stated
 *
 * The comparison needs a live price, and a live price only. Comparing a target
 * to a `portfolio_holdings` mark would be `snapshot_vs_live`: those marks are
 * carried forward nightly from an upload and are not prices.
 */

export interface ScenarioCase {
  /** "Bear", "Base", "Bull", "Uber Bull" — whatever the analyst named it. */
  name: string
  price: number
  /** Percent, 0-100. Null when the analyst did not assign one. */
  probability: number | null
  timeframe: string | null
}

export interface ScenarioGapInput {
  assetId: string
  symbol: string
  companyName?: string | null
  /** Live quote. NOT a holdings mark. */
  price: number
  /** ISO. When the price was true. */
  priceAsOf: string
  cases: ScenarioCase[]
  /** Portfolios holding it, for the stake line. */
  heldIn?: string[]
  /** Most recent time any case was written. ISO. */
  statedAt: string
}

/**
 * Beyond this multiple, a gap is a data fault rather than a finding.
 *
 * GOOGL in production: price 142.80 against targets of 800 and 1605. That is
 * not 460% of upside, it is a split-adjusted price meeting unadjusted targets,
 * or a typo. A card claiming the upside would be the most confident wrong
 * thing on the surface, and the reader has no way to check it.
 *
 * 3x because a real thesis can plausibly carry a 2x, and nothing legitimate
 * puts the entire modelled range more than three times away from the tape.
 */
const IMPLAUSIBLE_MULTIPLE = 3

/** Within this of expected value, the price is "at" it rather than near it. */
const AT_EXPECTED_BAND = 0.03

export type ScenarioClaim = 'below_bear' | 'above_bull' | 'at_expected'

export function buildScenarioGapCard(input: ScenarioGapInput): CardResult {
  return gate('scenario_gap', () => {
    const { assetId, symbol, price, priceAsOf, cases, heldIn = [], statedAt } = input
    const entity = symbol || assetId

    if (!isDisplayableNumber(price) || price < 0) {
      return suppress('quote_unavailable', entity, `price: ${price}`)
    }
    // The whole card is a comparison against the tape. A stale quote makes
    // every claim on it unfalsifiable.
    if (!isQuoteFresh(priceAsOf)) {
      return suppress('quote_stale', entity, `priceAsOf: ${priceAsOf}`)
    }

    const usable = cases
      .filter(c => isDisplayableNumber(c.price) && c.price > 0 && c.name?.trim())
      .sort((a, b) => a.price - b.price)

    if (usable.length < 2) {
      // One target is not a ladder. A single number belongs on a target card,
      // and claiming a "range" from it would invent the shape this card is
      // about.
      return suppress('insufficient_coverage', entity, `${usable.length} usable scenario(s)`)
    }

    const low = usable[0]
    const high = usable[usable.length - 1]

    // Data-fault gate. Measured against the nearer end of the range, so a wide
    // but plausible spread is not rejected for being wide.
    const nearest = price < low.price ? low.price : price > high.price ? high.price : price
    const ratio = nearest > 0 && price > 0 ? Math.max(nearest / price, price / nearest) : Infinity
    if (ratio > IMPLAUSIBLE_MULTIPLE) {
      return suppress(
        'inconsistent_numbers',
        entity,
        `price ${price} vs nearest case ${nearest} — ${ratio.toFixed(1)}x apart, beyond ${IMPLAUSIBLE_MULTIPLE}x`,
      )
    }

    // Probability-weighted expected value, only when every case carries one.
    // A partial set would silently weight the unlabelled cases at zero.
    const allWeighted = usable.every(c => isDisplayableNumber(c.probability, { allowZero: true }))
    const weightSum = allWeighted ? usable.reduce((n, c) => n + (c.probability ?? 0), 0) : 0
    const expected = allWeighted && weightSum > 0
      ? usable.reduce((n, c) => n + c.price * (c.probability ?? 0), 0) / weightSum
      : null

    let claim: ScenarioClaim
    let headline: string
    let body: string
    let severity: Severity
    let metricValue: string
    let metricLabel: string
    let direction: 'good' | 'bad' | 'neutral'

    const gapTo = (target: number) => (price - target) / target

    if (price < low.price) {
      claim = 'below_bear'
      const gap = Math.abs(gapTo(low.price))
      severity = gap >= 0.15 ? 'critical' : 'attention'
      headline = `${symbol} is trading below your ${low.name.toLowerCase()} case`
      metricValue = `${(gap * 100).toFixed(0)}%`
      metricLabel = `Below ${low.name.toLowerCase()} case of $${low.price.toFixed(0)}`
      direction = 'bad'
      body = `At $${price.toFixed(2)} the price sits under the worst outcome you modelled${
        low.timeframe ? ` on a ${low.timeframe} view` : ''
      }. Either something has changed that the ladder does not reflect, or this is the best entry your own work describes — and nobody has written down which.`
    } else if (price > high.price) {
      claim = 'above_bull'
      const gap = gapTo(high.price)
      severity = gap >= 0.15 ? 'critical' : 'attention'
      headline = `${symbol} has passed your ${high.name.toLowerCase()} case`
      metricValue = `+${(gap * 100).toFixed(0)}%`
      metricLabel = `Above ${high.name.toLowerCase()} case of $${high.price.toFixed(0)}`
      direction = 'good'
      body = `At $${price.toFixed(2)} the price is beyond the best case on your ladder. The position has no stated upside left, which makes holding it a new decision rather than a continuing one.`
    } else if (expected != null && Math.abs((price - expected) / expected) <= AT_EXPECTED_BAND) {
      claim = 'at_expected'
      severity = 'informational'
      headline = `${symbol} is priced at your expected value`
      metricValue = `$${expected.toFixed(0)}`
      metricLabel = `Probability-weighted, ${usable.length} cases`
      direction = 'neutral'
      body = `The market is within ${(AT_EXPECTED_BAND * 100).toFixed(0)}% of the probability-weighted outcome across your ${usable.length} scenarios. Your own work says this is fairly valued — which is a position to hold deliberately, not by default.`
    } else {
      // Inside the range and not at expected value. True, and not worth a
      // card: the price being somewhere between the bear and bull cases is the
      // normal state of every position, and a card that fires on it fires on
      // everything.
      return suppress('resolved', entity, 'price is inside the modelled range')
    }

    const ladder = usable
      .map(c => `${c.name} $${c.price.toFixed(0)}${c.probability != null ? ` (${c.probability.toFixed(0)}%)` : ''}`)
      .join(' · ')

    const card: SignalCard = {
      id: `scenario_gap:${assetId}`,
      type: 'scenario_gap',
      surface: 'research',
      severity,
      headline,
      metric: {
        value: metricValue,
        label: metricLabel,
        direction,
        // The claim rests on the live quote, so the quote's time is the
        // number's time — not when the scenarios were written.
        source: 'quote',
        asOf: priceAsOf,
      },
      body,
      entity: { kind: 'asset', id: assetId, name: input.companyName || symbol, ticker: symbol },
      context: [
        ...(heldIn.length ? [{ label: `Held · ${heldIn.length}` }] : [{ label: 'Not held' }]),
        { label: `${usable.length} cases` },
        ...(expected != null ? [{ label: `EV $${expected.toFixed(0)}` }] : []),
      ],
      // The one card where a chart earns its place: the spread is the
      // argument, not decoration for it.
      evidence: {
        kind: 'scenario_ladder',
        data: { price, cases: usable, expected },
        annotations: usable.map(c => ({
          date: statedAt,
          label: c.name,
          kind: 'target' as const,
        })),
      },
      actions: actions(
        // The move is always the same: the ladder no longer describes the
        // price, so somebody has to say whether the ladder or the position
        // changes.
        { id: 'log_view', label: 'Log view', inline: true },
        { label: `Open ${symbol}`, href: assetHref(assetId) },
        TRIAGE,
      ),
      provenance: {
        occurredAt: priceAsOf,
        reason: `Your scenarios for ${symbol} — ${ladder} — were last updated ${dayKey(statedAt)}, and the price has moved ${
          claim === 'below_bear' ? 'below the lowest' : claim === 'above_bull' ? 'above the highest' : 'to the middle'
        } of them.`,
      },
      expiry: {
        // A price can re-enter the range on any day, so the claim is short
        // lived by nature.
        staleAfterDays: 3,
      },
      // The claim is part of the key: a name that falls below its bear case,
      // recovers, then falls again is making the statement a second time and
      // should surface again.
      dedupeKey: `scenario_gap:${assetId}:${claim}:${dayKey(priceAsOf)}`,
    }

    return emit(card)
  })
}
