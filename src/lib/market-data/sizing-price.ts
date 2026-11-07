/**
 * Whether a price may be used to size, book or apply a trade.
 *
 * ── The defect class ─────────────────────────────────────────────────────
 *
 * A price reaches `normalize-sizing` as a bare number. The normalizer divides
 * the portfolio value by it to get a share count, the count is persisted as
 * `accepted_trades.price_at_acceptance`, and `apply_trade_to_holdings` then
 * writes that same number into `portfolio_holdings.price`, `.cost` and the
 * portfolio's CASH line. Nothing between those steps can tell a close that is
 * one day old from one that is forty, or either from a number nobody observed.
 *
 * Production carries both failure modes:
 *
 *   - Eleven accepted trades were sized at the literal 100. ABT booked 16,550
 *     shares at 100 against a real close of 90.62 and left that portfolio's
 *     cash at -$310,763.
 *   - One trade on 2026-10-05 was sized at 228.50 because the BOOK was marked
 *     at 228.50, while AAPL actually closed at 332.89 that day. The 50bp
 *     instruction bought 743 shares where the same instruction at the real
 *     close is ~510, and cash moved $169,776 instead of $247,337.
 *
 * `price_history_cache` being 37 days stale during the October ingestion
 * outage turned the second failure mode from an edge case into the default:
 * with no close inside `LATEST_CLOSE_WINDOW_DAYS`, every price fell through to
 * the undated `assets.current_price`.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * A price that is going to move shares, cash or a holdings mark must say
 * three things: what it is, when it was true, and where it came from. A price
 * that cannot say all three is refused rather than used, and a price that says
 * them but is outside policy is used only where the caller has explicitly
 * accepted that basis and the basis is recorded on the trade.
 *
 * So there are two outcomes, not one:
 *
 *   FAIL CLOSED   absent, non-positive, undated, or carrying no recorded
 *                 basis. These cannot be sized against at all.
 *   GATED         dated and sourced, but older than the policy allows. Usable
 *                 only where the caller passes `allowStaleBasis`, which is
 *                 how the book-basis rule in `accept-sizing` survives: that
 *                 path sizes against the book's own carrying price on purpose,
 *                 because `target = current + delta` only closes when both
 *                 sides are measured in the same money.
 *
 * ── Provider independence ────────────────────────────────────────────────
 *
 * Nothing here names a provider, an endpoint or a vendor field. The freshness
 * arithmetic is `assessFreshness` against `DAILY_CLOSE_POLICY`, the same
 * policy every other surface judges a close by, so a new market-data provider
 * changes which adapter fills `SizingPriceInput` and changes nothing in this
 * file. `basis` describes OUR ladder — a live quote, a stored close, the
 * book's own mark, a hand-entered number — which is a property of how the
 * price reached the trade, not of who supplied it.
 *
 * RLS posture: unchanged. This module is pure arithmetic over values the
 * caller already holds; it reads no table and issues no query.
 */

import { assessFreshness, DAILY_CLOSE_POLICY, type FreshnessPolicy, type Adjustment } from './freshness'

/**
 * How a sizing price reached the trade.
 *
 * Deliberately about our ladder rather than the vendor. The three rungs
 * behave differently and the difference is the whole point:
 *
 *   live_quote    observed now, by a provider, for this symbol
 *   stored_close  a dated daily close out of `price_history_cache`
 *   book_mark     the portfolio's own carrying price for the position, which
 *                 is as of the holdings snapshot and may be far from market
 *   manual        a person typed it
 *
 * There is no `unknown` member. A price whose basis nobody recorded is not a
 * fourth kind of price, it is a price we cannot vouch for, and the verdict
 * says so instead of inventing a label for it.
 */
export type PriceBasis = 'live_quote' | 'stored_close' | 'book_mark' | 'manual'

/** A price offered up for sizing, with the provenance it must carry. */
export interface SizingPriceInput {
  price: number | string | null | undefined
  /**
   * When the price was TRUE. A date (`YYYY-MM-DD`) for a close, an instant for
   * a quote. Null means undated, which is a refusal and never a default to
   * now: `assets.current_price` has no `as of` anywhere in the schema, and
   * stamping it with the current time is what made a month-old number read as
   * a live one.
   */
  asOf: string | null | undefined
  basis: PriceBasis | null | undefined
  /** ISO 4217. A price without one is a number with no unit. */
  currency?: string | null
  adjustment?: Adjustment
}

export type PriceVerdictCode =
  | 'ok'
  /** Dated and sourced, but older than the policy. Usable only when gated. */
  | 'stale'
  | 'absent'
  | 'nonpositive'
  | 'undated'
  | 'unsourced'

export interface SizingPriceVerdict {
  /** May this price be used at all, given the caller's gating choice. */
  usable: boolean
  code: PriceVerdictCode
  /**
   * True when the price was accepted only because the caller allowed a stale
   * basis. Callers must record this on whatever they write, so that a trade
   * sized off a four-week-old book mark can be found later.
   */
  gated: boolean
  /** One phrase naming what is wrong, for a refusal message or a UI flag. */
  reason: string | null
  asOf: string | null
  ageDays: number | null
  basis: PriceBasis | null
  /** The price itself, normalized to a number, when there is a usable one. */
  price: number | null
}

export interface AssessOptions {
  /** Defaults to `DAILY_CLOSE_POLICY` — the window every close is judged by. */
  policy?: FreshnessPolicy
  now?: number
  /**
   * Accept a dated, sourced price that is older than the policy.
   *
   * Set only where sizing against an old basis is the deliberate rule rather
   * than an accident. `accept-sizing` sets it because the book's carrying
   * price is the money the approved weight was expressed in; Trade Lab's
   * execute path does not, because there the old number is just the newest
   * one the pipeline managed to store.
   */
  allowStaleBasis?: boolean
}

const toNumber = (v: number | string | null | undefined): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * `YYYY-MM-DD` is midnight UTC; anything else is parsed as given.
 *
 * Spelled out because a bare `Date.parse('2026-11-06')` is UTC midnight while
 * `Date.parse('2026-11-06T00:00:00')` is local, and the two differ by up to a
 * day — enough to flip a verdict at the edge of the window.
 */
const parseAsOf = (asOf: string): number | null => {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? `${asOf}T00:00:00Z` : asOf
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * Is this price fit to size a trade with.
 *
 * Pure. Returns a verdict rather than throwing, so a preview can render the
 * reason beside the number while a commit path turns the same verdict into a
 * refusal.
 */
export function assessSizingPrice(
  input: SizingPriceInput | null | undefined,
  options: AssessOptions = {},
): SizingPriceVerdict {
  const { policy = DAILY_CLOSE_POLICY, now = Date.now(), allowStaleBasis = false } = options

  const base = {
    usable: false,
    gated: false,
    asOf: null as string | null,
    ageDays: null as number | null,
    basis: null as PriceBasis | null,
    price: null as number | null,
  }

  if (!input) {
    return { ...base, code: 'absent', reason: 'no price is available for this instrument' }
  }

  const price = toNumber(input.price)
  if (price == null) {
    return { ...base, code: 'absent', reason: 'no price is available for this instrument' }
  }
  if (price <= 0) {
    return { ...base, code: 'nonpositive', reason: `price ${price} is not a tradable price`, price: null }
  }

  const basis = input.basis ?? null
  if (basis == null) {
    return {
      ...base,
      code: 'unsourced',
      reason: 'the price carries no recorded source, so it cannot be verified',
    }
  }

  const asOf = typeof input.asOf === 'string' && input.asOf.length > 0 ? input.asOf : null
  if (asOf == null || parseAsOf(asOf) == null) {
    return {
      ...base,
      basis,
      code: 'undated',
      reason: 'the price carries no date, so its age cannot be judged',
    }
  }

  /*
   * Freshness is measured from `effectiveAt`, which is `asOf`. `observedAt` is
   * set to the same instant on purpose: this module is handed a value, not a
   * fetch, and claiming to know when it was fetched would be the same
   * fabrication the `timestamp: new Date()` call sites were making.
   */
  const verdict = assessFreshness(
    { value: price, source: { provider: 'tesseract', via: 'derived' }, observedAt: asOf, effectiveAt: asOf },
    { ...policy, maxObservationAgeMs: undefined },
    now,
  )

  if (verdict.state === 'stale') {
    const reason = `the price is ${verdict.ageDays} day${verdict.ageDays === 1 ? '' : 's'} old (as of ${asOf})`
    return {
      usable: allowStaleBasis,
      gated: allowStaleBasis,
      code: 'stale',
      reason,
      asOf,
      ageDays: verdict.ageDays,
      basis,
      price: allowStaleBasis ? price : null,
    }
  }

  return {
    usable: true,
    gated: false,
    code: 'ok',
    reason: null,
    asOf,
    ageDays: verdict.ageDays,
    basis,
    price,
  }
}

/** A phrase for a surface to render beside a sizing price. */
export function describePriceBasis(basis: PriceBasis | null | undefined): string {
  switch (basis) {
    case 'live_quote': return 'Live quote'
    case 'stored_close': return 'Last close'
    case 'book_mark': return "Portfolio's carrying price"
    case 'manual': return 'Entered by hand'
    default: return 'Source not recorded'
  }
}

/** Raised where a trade would otherwise be booked against an unusable price. */
export class UnusablePriceError extends Error {
  readonly verdict: SizingPriceVerdict
  constructor(subject: string, verdict: SizingPriceVerdict) {
    super(
      `Refusing to book ${subject}: ${verdict.reason ?? 'the price cannot be verified'}. ` +
      'Re-size the trade once a current price is available.',
    )
    this.name = 'UnusablePriceError'
    this.verdict = verdict
  }
}

/**
 * The last line before a price moves shares, cash or a holdings mark.
 *
 * Throws rather than returning, because every caller is at the point of
 * writing and there is no sensible way to continue with a price that cannot be
 * verified. `subject` is what the message names, e.g. `AAPL`.
 */
export function assertBookablePrice(
  subject: string,
  input: SizingPriceInput | null | undefined,
  options: AssessOptions = {},
): SizingPriceVerdict {
  const verdict = assessSizingPrice(input, options)
  if (!verdict.usable) throw new UnusablePriceError(subject, verdict)
  return verdict
}
