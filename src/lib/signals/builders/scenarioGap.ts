import {
  emit,
  suppress,
  type CardResult,
  type Severity,
  type SignalCard,
} from '../contract'
import { gate, isDisplayableNumber, isQuoteFresh } from '../suppression'
import { actions, assetHref, dayKey } from './shared'
import { deriveScenarioState, scenarioLanguage } from '../scenario-state'

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
  /**
   * `analyst_price_targets.id`. Carried so a card can offer to edit the case
   * it is describing instead of sending the reader to the asset page.
   */
  id?: string
  /**
   * Who wrote it. The feed compares this to the signed-in user to decide
   * whether the case is editable — RLS allows UPDATE only where
   * `auth.uid() = user_id`, and it fails SILENTLY, matching zero rows and
   * returning success, so the check has to happen before the control renders.
   */
  userId?: string | null
  /** "Bear", "Base", "Bull", "Uber Bull" — whatever the analyst named it. */
  name: string
  price: number
  /** Percent, 0-100. Null when the analyst did not assign one. */
  probability: number | null
  timeframe: string | null
  /** What the analyst typed when they set this case. Shown verbatim in the
   *  in-card detail — it is the reason opening the detail is worth doing, and
   *  the only place this text has ever been visible outside a desktop panel. */
  reasoning?: string | null
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

/**
 * How old a quote may be before it stops being "the last close".
 *
 * Four days covers a Friday close read on a Monday evening, plus a public
 * holiday. Beyond that the market has traded since and the number is stale in
 * the sense the suppression means.
 */
const STALE_QUOTE_LIMIT_MS = 4 * 24 * 60 * 60 * 1000

export type ScenarioClaim = 'below_bear' | 'above_bull' | 'at_expected'

/**
 * "12 Mar 2026". Not `dayKey`, which is an ISO day for dedupe keys.
 *
 * UTC, because the date belongs to when the analyst wrote the case rather than
 * to the reader's timezone — the same rule the card's eyebrow follows.
 */
function statedOn(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

export function buildScenarioGapCard(input: ScenarioGapInput): CardResult {
  return gate('scenario_gap', () => {
    const { assetId, symbol, price, priceAsOf, cases, heldIn = [], statedAt } = input
    const entity = symbol || assetId

    if (!isDisplayableNumber(price) || price < 0) {
      return suppress('quote_unavailable', entity, `price: ${price}`)
    }
    /**
     * A closed market is not a stale quote.
     *
     * This required a quote under 15 minutes old, which is the right rule for
     * a card claiming to compare a target to the TAPE. Its consequence was
     * never chosen: outside market hours every `scenario_gap` card vanished —
     * evenings, weekends, holidays, most of the week — and silently, because a
     * suppression is logged and not shown. Reported as "where is Case vs
     * price", and answering it took a database query, a live edge-function
     * call and a timestamp comparison.
     *
     * A scenario ladder is a months-long view. Comparing it to Friday's close
     * is a legitimate thing to do; comparing it to Friday's close while
     * IMPLYING a live tape is not. So the card builds, and says which it is —
     * see `atClose` below.
     *
     * Genuinely old quotes are still refused. Beyond a long weekend the number
     * is not the last close, it is a data fault, and no label makes it useful.
     */
    const quoteAgeMs = priceAsOf ? Date.now() - new Date(priceAsOf).getTime() : Infinity
    if (!Number.isFinite(quoteAgeMs) || quoteAgeMs > STALE_QUOTE_LIMIT_MS || quoteAgeMs < 0) {
      return suppress('quote_stale', entity, `priceAsOf: ${priceAsOf}`)
    }
    /**
     * True when the price is a close rather than a live tape.
     *
     * No longer printed — see the `context` row below. Kept because the
     * distinction is real and a specific stale-price state will need it.
     */
    const atClose = !isQuoteFresh(priceAsOf)
    void atClose

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

    /**
     * One derivation, shared with every pane that renders this card.
     *
     * The builder used to answer "which case is nearest", "are these weights a
     * distribution" and "is the horizon single" on its own, and the ladder, the
     * case list and the distribution pane each answered them again. They
     * disagreed in ways that showed — see `scenario-state`.
     */
    const state = deriveScenarioState(price, usable)
    if (!state) return suppress('insufficient_coverage', entity, 'no usable ladder')

    /**
     * Probability-weighted expected value — and only when the weights are
     * actually a distribution.
     *
     * The first version divided by the sum of whatever probabilities were
     * present, which silently normalised them. On AAPL in production those
     * probabilities sum to 125 across six cases, so the card presented a
     * "probability-weighted expected value" derived from a distribution the
     * analyst never wrote. Normalising an inconsistent set makes the
     * fair-value claim unfalsifiable: no number the analyst could enter would
     * ever make the card disagree with them.
     *
     * A distribution has to sum to 100 (±1 for rounding). Anything else is
     * the analyst's own numbers being inconsistent, which is worth saying out
     * loud rather than smoothing over.
     */
    const allWeighted = usable.every(c => isDisplayableNumber(c.probability, { allowZero: true }))
    const weightSum = allWeighted ? usable.reduce((n, c) => n + (c.probability ?? 0), 0) : 0
    const weightsAreDistribution = allWeighted && Math.abs(weightSum - 100) <= 1
    void weightsAreDistribution

    /**
     * A ladder mixing horizons cannot be averaged.
     *
     * AAPL carries a 6-month bear at $205 and a 12-month bull at $285. Those
     * are not competing outcomes of one question, so weighting them together
     * produces a number that describes no point in time. The spread is still
     * worth showing; the expectation is not.
     */
    const horizons = new Set(usable.map(c => (c.timeframe ?? '').trim()).filter(Boolean))
    const singleHorizon = horizons.size <= 1

    void singleHorizon
    const expected = state.expectedValue
    /*
     * `state.expectedBlockedBy` is deliberately not read here any more.
     *
     * It was a context chip saying why there is no expected value, which is a
     * real finding and belonged beside the cases it is about rather than in the
     * row a reader scans for whether any of this is theirs. `ScenarioCaseDetail`
     * renders it from the same derivation, with `Fix probabilities` next to it —
     * see `never leaves a missing expectation unexplained` in the builder tests,
     * which asserts the guarantee survived the move.
     */

    /**
     * How old the framework is — carried BESIDE the ladder, not inside the body.
     *
     * ── Why the card needs it ────────────────────────────────────────────
     *
     * The card asks the reader to choose between "the thesis has changed" and
     * "the cases are stale", and without this it gives them nothing to decide
     * that with. A ladder written three weeks ago and a ladder written in March
     * are completely different situations behind an identical card, and the age
     * is the one fact on the input that distinguishes them — otherwise recorded
     * only in `provenance.reason`, which lives behind the overflow menu.
     *
     * Deliberately NOT phrased as "nothing has been restated since the price
     * moved past them". That is very probably true and this builder cannot know
     * it: `statedAt` is when a case was last written and nothing records when
     * the price left the range, so the two cannot be ordered. The date is a
     * fact; the inference is the reader's.
     *
     * ── Why it is not appended to `body` any more ────────────────────────
     *
     * It was, as " Ladder last updated 5 Feb 2026.", and it broke the one
     * invariant the summaries below are written to hold: SHORT ENOUGH NOT TO
     * TRUNCATE. `SignalCardView` clamps every card body to two lines and, when
     * it overflows, paints a "more" affordance over the end of the second line.
     *
     * Measured in the gallery at a 358px body: with the clause the body ran
     * scrollHeight 68 against clientHeight 45 — three lines of content in a
     * two-line box — so `more` fired on `scenario-above-bull` at 390px and on
     * EVERY scenario_gap fixture at 360px and 320px. What it hid was the tail
     * of this very sentence. The card rendered "Ladder last updated 5 Feb" with
     * a bold "more" pasted over "2026.", which reads as a truncation control
     * that has leaked into the prose, and tapping it opened a drawer to reveal
     * one word.
     *
     * A two-line clamp with a "more" is the right mechanism for prose with more
     * to read. This is a date. It goes on the ladder it describes, in the
     * second line `ladder-readout` already reserves and does not use at rest —
     * so it costs no height anywhere and cannot be clipped by anything.
     */
    const ladderWritten = statedOn(statedAt)

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
      /**
       * Every case, not the lowest one by name.
       *
       * This state IS "below all of them" — the builder only emits it when the
       * price is under the cheapest case — and naming a single one understated
       * that. On a ladder with Bear and Base both at $800 it named whichever
       * sorted first, which is an accident of insertion order, and the reader
       * saw "below your base case" on a card whose bear case was equally
       * breached.
       */
      const lang = scenarioLanguage(price, state, symbol)
      headline = lang.headline
      metricValue = lang.metricValue
      metricLabel = lang.metricLabel
      direction = lang.direction
      /**
       * Short enough not to truncate.
       *
       * The previous sentence ran to 240 characters and the card clamped it
       * mid-word — "Either something…" — so the part that carried the argument
       * was the part nobody read. The panes hold the detail; this states the
       * finding.
       */
      body = lang.summary
    } else if (price > high.price) {
      claim = 'above_bull'
      const gap = gapTo(high.price)
      severity = gap >= 0.15 ? 'critical' : 'attention'
      const lang = scenarioLanguage(price, state, symbol)
      headline = lang.headline
      metricValue = lang.metricValue
      metricLabel = lang.metricLabel
      direction = lang.direction
      body = lang.summary
    } else if (expected != null && Math.abs((price - expected) / expected) <= AT_EXPECTED_BAND) {
      claim = 'at_expected'
      severity = 'informational'
      headline = `${symbol} is priced at your expected value`
      metricValue = `$${expected.toFixed(0)}`
      metricLabel = `Probability-weighted, ${usable.length} cases`
      direction = 'neutral'
      body = `The market is within ${(AT_EXPECTED_BAND * 100).toFixed(0)}% of the probability-weighted outcome across your ${usable.length} scenarios. Your own work says this is fairly valued, which is a position to hold deliberately rather than by default.`
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
      prompt: claim === 'at_expected'
        ? 'Is holding this still a deliberate choice?'
        : 'Has the investment view changed?',
      entity: { kind: 'asset', id: assetId, name: input.companyName || symbol, ticker: symbol },
      /**
       * Three facts at most, and none of them said twice.
       *
       * ── What this row had become ──────────────────────────────────────────
       *
       * "At the last close · In 2 portfolios · 3 cases · EV $146 ·
       * Probabilities sum to 125% · You cover AMZN" — six chips wrapping to
       * three lines on a 390px card, above the band where the evidence lives.
       * The row is scanned for one thing, "is any of this my problem", and at
       * that length it stops being scannable at all.
       *
       * Two of the six were duplicates rather than context. The Cases pane
       * states the expected value under its own label and states the
       * probability problem beside the cases it is about, with the control that
       * repairs it — so `EV $146` and `Probabilities sum to 125%` were the
       * pane's content leaking onto the card face. Both are gone from here and
       * neither is lost.
       *
       * The rest lose their prepositions. "In 2 portfolios" and "2 portfolios"
       * carry the same fact in a row whose separator is already a middot; the
       * preposition was reading as a sentence fragment beside labels that are
       * not sentences.
       */
      context: [
        /**
         * NOT "At last close".
         *
         * It rode on `atClose`, which is true outside market hours — evenings,
         * weekends, holidays, most of the week — so in practice nearly every
         * card carried it and it stopped distinguishing anything. A qualifier
         * that is almost always present is read as boilerplate, and this one
         * was spending the first slot of the row a reader scans for "is any of
         * this mine" on a fact about the clock.
         *
         * The card is a present-tense finding and the ladder already shows the
         * price as `NOW $232.99` against the cases. That is where price
         * context belongs.
         *
         * This is NOT a claim that the price is always live. A genuinely stale
         * quote deserves a specific stale-price state that says how stale and
         * what it means — a real design, not a permanent hedge on every card.
         * `atClose` is still derived above and still available for it.
         */
        ...(heldIn.length
          ? [{ label: heldIn.length === 1 ? '1 portfolio' : `${heldIn.length} portfolios` }]
          : [{ label: 'Not held' }]),
        { label: usable.length === 1 ? '1 case' : `${usable.length} cases` },
      ],
      // The one card where a chart earns its place: the spread is the
      // argument, not decoration for it.
      evidence: {
        kind: 'scenario_ladder',
        // `statedOn` is the ladder's age, formatted, for the pane to print
        // under the axis. It rides in `data` rather than in a second field
        // because `data` is what every composer of this evidence already
        // destructures — the feed and the gallery both.
        data: { price, cases: usable, expected, statedOn: ladderWritten },
        annotations: usable.map(c => ({
          date: statedAt,
          label: c.name,
          kind: 'target' as const,
        })),
      },
      actions: actions(
        // The move is always the same: the ladder no longer describes the
        // price, so somebody has to say whether the ladder or the position
        /**
         * "Review cases" — the spread IS this card's subject, so the case
         * editor is where the next step happens. `MobileCaseTargets` renders
         * Bull / Base / Bear with prices and horizons, all editable.
         *
         * Capture moves to a quick action rather than being removed: it is
         * still the only way to write a free-form thought from the feed.
         */
        { id: 'open_cases', label: 'Review cases', inline: false },
        { label: `Open ${symbol}`, href: assetHref(assetId) },
        [{ id: 'capture', label: 'Capture', inline: true }],
      ),
      provenance: {
        occurredAt: priceAsOf,
        reason: `Your scenarios for ${symbol} (${ladder}) were last updated ${dayKey(statedAt)}, and the price has moved ${
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
