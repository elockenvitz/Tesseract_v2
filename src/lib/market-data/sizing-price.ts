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
 *   GATED         usable only where the caller passes `allowStaleBasis`, and
 *                 recorded as gated when it is. Two things land here: a
 *                 dated, sourced price older than the policy allows; and a
 *                 `book_mark`, ALWAYS, because nothing in the schema records
 *                 when a mark was last a market price. That is how the
 *                 book-basis rule in `accept-sizing` survives: that path
 *                 sizes against the book's own carrying price on purpose,
 *                 because `target = current + delta` only closes when both
 *                 sides are measured in the same money.
 *
 * The four kinds of price this separates, which is the distinction the rest
 * of the system was missing:
 *
 *   a dated, valid market price      ok, ungated
 *   a dated market price, too old    stale, gated
 *   an undated or unsourced number   refused outright
 *   the book's own carrying price    gated, always, never called current
 *
 * A trade whose TRANSACTION date is in the past is a different matter and is
 * not blocked here: this judges the price's own effective date, not the
 * trade's. A correction that re-books a June fill at June's close is a
 * dated, sourced price being used exactly as intended.
 *
 * ── What `sourced` does and does not mean ───────────────────────────────
 *
 * `basis: 'stored_close'` says the number came out of `price_history_cache`
 * on a stated date. It does NOT say the row itself is trustworthy, and on
 * this project it currently is not, which is worth stating where the
 * guarantee is made rather than leaving it implied.
 *
 * Measured against production on 2026-11-07. `price_history_cache` has RLS
 * enabled with exactly two policies:
 *
 *   INSERT  "Users can insert price history"   WITH CHECK (auth.uid() IS NOT NULL)
 *   SELECT  "Users can view price history cache"    USING (auth.uid() IS NOT NULL)
 *
 * The table has no `organization_id` and is global reference data by design.
 * No UPDATE or DELETE policy exists, so RLS denies both, and
 * `price_history_cache_symbol_date_key` is unique on (symbol, date) -- so an
 * existing close cannot be overwritten or removed by a client. What ANY
 * authenticated user of ANY organization can do is INSERT a row for a
 * (symbol, date) pair that does not exist yet. Today the newest close is
 * 2026-11-06, so every later date is available, and a fabricated close
 * inserted there would reach this module as a dated, sourced, in-policy
 * price and be judged `ok`.
 *
 * No client code writes this table: the only writers are the nightly
 * ingestion job and the backfill script, both using the service-role key,
 * which bypasses RLS. The INSERT policy therefore grants a capability
 * nothing uses.
 *
 * The smallest fix is one statement, and it is deliberately NOT included in
 * this change -- production RLS is not altered without approval:
 *
 *   DROP POLICY "Users can insert price history" ON public.price_history_cache;
 *
 * Server-side ingestion is unaffected. Until that lands, treat the gate as
 * verifying that a price is dated and came from our own store, not that
 * nobody could have planted it.
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
 *   live_quote    observed now, by a provider, for this symbol. Dated by the
 *                 observation.
 *   stored_close  a dated daily close out of `price_history_cache`. Dated by
 *                 the trading day it closed on.
 *   book_mark     the portfolio's own carrying price for the position. UNDATED
 *                 BY CONSTRUCTION, so never a verified market price. See
 *                 `assessSizingPrice`.
 *
 * There is no `unknown` member. A price whose basis nobody recorded is not a
 * fourth kind of price, it is a price we cannot vouch for, and the verdict
 * says so instead of inventing a label for it.
 *
 * ── There is no `manual` member, and that is a correction ────────────────
 *
 * This type used to declare `'manual'`, and `describePriceBasis` labelled it
 * "Entered by hand". Nothing in the codebase ever produced it. A price that
 * really was typed by a person would therefore have arrived here with a null
 * basis and been refused as `unsourced`, so the label advertised a workflow
 * that did not exist and would not have worked if used.
 *
 * A disconnected second vocabulary does exist and is equally inert:
 * `decision-snapshot-service` declares
 * `PriceSource = 'db_cached' | 'live_quote' | 'manual' | 'backfill'` and
 * defaults an override to `'manual'`, but its `overridePrice` parameter has
 * zero callers and its `price_source` output is never read back anywhere, so
 * no manual price reaches a trade write from there either.
 *
 * Implementing it properly needs three things this codebase does not have: a
 * surface that collects the price, a record of WHO entered it and WHEN, and
 * somewhere on the trade to persist that. A hand-entered price is the one
 * basis whose trustworthiness rests entirely on a person, so it cannot be a
 * bare label. When that work happens, add the member back together with its
 * provenance and treat it the way `book_mark` is treated here: always gated,
 * never silently `ok`.
 */
export type PriceBasis = 'live_quote' | 'stored_close' | 'book_mark'

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
  /**
   * A book mark, whose age cannot be established at all. Usable only when
   * gated, and ALWAYS gated. See `assessSizingPrice`.
   */
  | 'undated_book_mark'
  /**
   * Dated AFTER today. Never usable, gated or not. See `assessSizingPrice`:
   * this is the shape a fabricated close takes, and a negative age otherwise
   * reads as the freshest price in the book.
   */
  | 'future_dated'
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

  /*
   * ── A book mark is undated by construction ──────────────────────────────
   *
   * `portfolio_holdings` has exactly these columns: id, portfolio_id,
   * asset_id, shares, price, cost, created_at, updated_at, created_by, date.
   * Not one of them records when `price` was TRUE. `date` is the snapshot
   * date -- the day the row is filed under -- and `apply_trade_to_holdings`
   * copies the previous snapshot's `price` and `cost` forward onto today:
   *
   *     INSERT INTO portfolio_holdings (..., shares, price, cost, date)
   *     SELECT portfolio_id, asset_id, shares, price, cost, v_today
   *       FROM portfolio_holdings WHERE ... AND date = v_last;
   *
   * So the first trade in a book re-dates every mark in it to today, without
   * anyone re-marking anything.
   *
   * This path used to pass the snapshot date as the price's effective date.
   * The consequence was not a missing warning, it was an inverted one: an
   * untouched book reported `stale` and warned, and a book that had been
   * traded once reported `ok` with `gated: false` and said nothing -- so the
   * safeguard disarmed itself on exactly the books in active use. Measured
   * against production: 388 marks sit 50% or more from market, and a single
   * trade per book would have made all of that book's marks read fresh.
   *
   * A mark is therefore never `ok` and never dated. It is always GATED, so a
   * caller that wants it must say so and the gating is recorded on the trade.
   * `accept-sizing` does want it, deliberately, because `target = current +
   * delta` only closes when both sides are in the same money. Trade Lab's
   * execute path does not, and now refuses it rather than being handed a
   * number whose age is unknowable.
   *
   * This is not a suppressed warning. It is the opposite: the warning now
   * fires on EVERY book mark, including the ones that previously read clean.
   */
  if (basis === 'book_mark') {
    return {
      ...base,
      usable: allowStaleBasis,
      gated: true,
      code: 'undated_book_mark',
      reason:
        "this is the portfolio's own carrying price, and nothing records when it was last a "
        + 'market price, so its age cannot be judged',
      basis,
      price: allowStaleBasis ? price : null,
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
   * ── A price cannot be dated in the future ───────────────────────────────
   *
   * Found by running this module against production values on 2026-11-07, not
   * by reading it: a close dated 2026-12-31 came back `ok`, `usable: true`,
   * `gated: false`. `assessFreshness` compares an age against a maximum, and a
   * future date gives a NEGATIVE age, which is never greater than the maximum
   * -- so a forward-dated price read as the freshest thing in the book.
   *
   * That is exactly the payload the `price_history_cache` INSERT policy
   * allowed: the newest real close is 2026-11-06, so every later date was
   * unoccupied, and any logged-in user of any organisation could plant a row
   * there. It would arrive here dated, sourced and apparently current.
   *
   * The write side refuses it too now (`_shared/chart-closes.ts` drops any bar
   * dated after today, and the policy that let a browser insert one is
   * dropped). This is the reader's half, and it is the half that has to hold
   * even if a bad row gets in some other way: an unusable price must not
   * become usable by being dated further ahead.
   *
   * Not gateable. There is no caller for whom tomorrow's close is a
   * legitimate basis, unlike a stale close or a book mark.
   */
  const asOfMs = parseAsOf(asOf) as number
  const startOfTomorrow = new Date(now).setUTCHours(24, 0, 0, 0)
  if (asOfMs >= startOfTomorrow) {
    return {
      ...base,
      basis,
      asOf,
      code: 'future_dated',
      reason: `the price is dated ${asOf}, which is in the future, so it cannot be a close`,
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
    case 'book_mark': return "Portfolio's carrying price (undated)"
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
