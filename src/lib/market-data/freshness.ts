/**
 * Where a number came from, when it was true, and whether it still is.
 *
 * ── The defect class this exists to make impossible ───────────────────────
 *
 * `src/lib/signals/price-snapshot.ts` documents one instance in full: a GOOGL
 * card drew a chart ending at $348.06 and, two swipes away, a target editor
 * headed CURRENT PRICE $142.80. Two correct numbers from two tables, one of
 * them wearing the other's label. `contract.ts` had already named the shape —
 * `snapshot_vs_live` — and the call site did it anyway, because nothing in the
 * type of a number says which table it came off or how old it is.
 *
 * `price-snapshot.ts` solved that for one surface, for prices, with a `source`
 * and a `label` on a `PriceSnapshot`. This is the same idea generalised to any
 * externally sourced value, so a market cap, a sector, a benchmark weight and a
 * close all answer the question the same way.
 *
 * ── The one non-obvious decision ──────────────────────────────────────────
 *
 * Freshness is measured from `effectiveAt`, NOT `observedAt`.
 *
 * They are different questions and conflating them is how staleness hides. A
 * fetch performed thirty seconds ago that returned a close from March is a
 * fresh REQUEST carrying a stale FACT, and it is the fact a reader is about to
 * price a trade against. `browser-client.ts` already gets half of this right in
 * prose — "`timestamp` is the moment the price was true, not the moment we
 * fetched it" — and then has nowhere to record the other moment at all, so the
 * distinction survives as a comment and not as data.
 *
 * `observedAt` is kept because it answers a different and equally real
 * question: is our PIPELINE working. A value whose `effectiveAt` has not moved
 * in a week might be a quiet market or a dead feed, and only `observedAt` can
 * tell those apart.
 *
 * ── Absence ───────────────────────────────────────────────────────────────
 *
 * A missing value is `null`. It is never 0, never a default, and never an
 * `Observed` with a made-up timestamp. This module exists so that Tile Engine
 * and the AI layer can distinguish a fresh fact from a stale or missing one
 * without reverse-engineering a provider's timestamp format, and a zero
 * standing in for unknown defeats that before it starts.
 */

/**
 * What was done to a price before we saw it.
 *
 * `unknown` is load-bearing for the same reason `AssetType.unknown` is: a
 * provider that does not say must not be recorded as saying "raw". Comparing a
 * raw close from before a 4-for-1 split against an adjusted one after it is a
 * 4x error that looks like a price move.
 */
export type Adjustment = 'raw' | 'split_adjusted' | 'split_and_dividend_adjusted' | 'unknown'

/** Where a value entered Tesseract. */
export interface ValueSource {
  /**
   * The provider, in OUR vocabulary, not theirs. `yahoo`, not
   * `yahoo_chart_v8` — the endpoint is an implementation detail of the adapter
   * and belongs in `feed`.
   */
  provider: string
  /** The specific feed or endpoint within that provider, if it matters. */
  feed?: string
  /**
   * How the value reached this consumer. A cached value is not less true, but
   * it is a different failure mode: `cache` with a distant `observedAt` means
   * the pipeline stopped, `live` means it is running.
   */
  via: 'live' | 'cache' | 'derived' | 'manual'
}

/**
 * A value with its provenance attached.
 *
 * Deliberately a wrapper rather than sibling fields. A bare
 * `{ price, priceAsOf }` pair can be destructured apart, and the moment one
 * half crosses a function boundary without the other the label is gone — which
 * is exactly how a holdings mark came to be called "Current price".
 */
export interface Observed<T> {
  value: T
  source: ValueSource
  /** When we obtained it. ISO 8601. */
  observedAt: string
  /**
   * When it was TRUE. ISO 8601. For a daily close, the close date.
   *
   * Never "now" as a convenience. If a provider does not say, the adapter must
   * decide honestly what instant the value describes, and record that.
   */
  effectiveAt: string
  /** Only meaningful for prices. Omitted elsewhere rather than defaulted. */
  adjustment?: Adjustment
  /** ISO 4217. A price without one is a number with no unit. */
  currency?: string
}

export type FreshnessState = 'fresh' | 'stale' | 'missing'

/**
 * What kind of value this is.
 *
 * Present so that "fresh" cannot become one number for the whole product. A
 * five-day window is right for a daily close and absurd for an intraday quote,
 * roughly meaningless for a sector label, and wrong in the other direction for
 * a quarterly estimate that is perfectly current at eighty days old. Stage 1
 * shipped three constants with no way to tell which applied where; this makes
 * the class part of the policy so a consumer reads a verdict rather than
 * choosing a constant.
 */
export type DataClass =
  | 'intraday_quote'
  | 'daily_close'
  | 'reference'
  | 'fundamental'
  | 'estimate'

/**
 * How the age was judged.
 *
 * `calendar` is wall-clock arithmetic: cheap, provider-independent, and
 * deliberately conservative, because it has to allow for every weekend and
 * holiday it cannot see. `session` would consult an exchange calendar and say
 * "this is the most recent close that exists" rather than "this is less than N
 * days old".
 *
 * Only `calendar` is implemented. The value is carried on the policy and
 * echoed on the verdict now, rather than added later, so that a surface can
 * already distinguish a conservative fallback from a real answer — and so that
 * adding `session` is a new policy rather than a change to every call site.
 * Building an exchange calendar is explicitly out of scope for this stage.
 */
export type FreshnessBasis = 'calendar' | 'session'

export interface FreshnessPolicy {
  dataClass: DataClass
  /** Always `calendar` today. See `FreshnessBasis`. */
  basis: FreshnessBasis
  /**
   * How old the FACT may be before it is stale, in milliseconds.
   *
   * Calendar time, not trading time. A close from Friday read on a Monday is
   * three days old and must still count as fresh, so a daily policy has to be
   * wider than a day; that slack is deliberate rather than a rounding, and it
   * is the price of not having a session calendar.
   */
  maxAgeMs: number
  /**
   * How long the PIPELINE may be silent before that alone is a problem, in
   * milliseconds. Optional: only feeds with a schedule have an answer.
   */
  maxObservationAgeMs?: number
}

/**
 * Five calendar days.
 *
 * Derived from the worst legitimate gap rather than picked round, and the
 * derivation matters because a window one day too narrow reports every long
 * weekend as a data outage:
 *
 *   A daily close carries a DATE, so `effectiveAt` parses as midnight UTC
 *   while the close itself happened around 20:00 UTC — the age is
 *   systematically ~20 hours ahead of the truth before anything else.
 *   Friday's close is the latest available until the nightly job runs at
 *   22:00 UTC. With Monday a public holiday, that is Tuesday 22:00, and a
 *   reader at 21:59 that day is looking at a close 4 days and 22 hours old.
 *
 * Five days clears that with room and still catches a series a full week
 * behind, which is a missed scheduled run rather than a market closure.
 *
 * `maxObservationAgeMs` matches it rather than being tighter. The nightly job
 * runs Mon-Fri, but on a day with no new close it upserts nothing, so
 * `observedAt` does not advance on a holiday either — a narrower window here
 * would flag a working pipeline.
 */
export const DAILY_CLOSE_POLICY: FreshnessPolicy = {
  dataClass: 'daily_close',
  basis: 'calendar',
  maxAgeMs: 5 * 24 * 60 * 60 * 1000,
  maxObservationAgeMs: 5 * 24 * 60 * 60 * 1000,
}

/** Fifteen minutes. A delayed quote that has not moved in longer is not live. */
export const INTRADAY_QUOTE_POLICY: FreshnessPolicy = {
  dataClass: 'intraday_quote',
  basis: 'calendar',
  maxAgeMs: 15 * 60 * 1000,
  maxObservationAgeMs: 15 * 60 * 1000,
}

/**
 * Ninety days.
 *
 * Reference data — a name, a sector, a venue — changes on corporate-action
 * timescales, so a short window would report every stable instrument as stale
 * and train readers to ignore the flag.
 */
export const REFERENCE_POLICY: FreshnessPolicy = {
  dataClass: 'reference',
  basis: 'calendar',
  maxAgeMs: 90 * 24 * 60 * 60 * 1000,
}

/**
 * A hundred and thirty days.
 *
 * A reported fundamental is current until the next report supersedes it, which
 * for a US filer is about ninety days plus filing lag. Judging it on the
 * daily-close window would mark every company's own last filed number stale
 * five days after we fetched it, which is not what stale means here.
 */
export const FUNDAMENTAL_POLICY: FreshnessPolicy = {
  dataClass: 'fundamental',
  basis: 'calendar',
  maxAgeMs: 130 * 24 * 60 * 60 * 1000,
}

/**
 * Fourteen days.
 *
 * An estimate is a live opinion, not a reported fact: it moves on revisions
 * between reports, so it goes stale much faster than the fundamental it
 * forecasts even though both arrive quarterly.
 */
export const ESTIMATE_POLICY: FreshnessPolicy = {
  dataClass: 'estimate',
  basis: 'calendar',
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
}

const POLICIES: Record<DataClass, FreshnessPolicy> = {
  intraday_quote: INTRADAY_QUOTE_POLICY,
  daily_close: DAILY_CLOSE_POLICY,
  reference: REFERENCE_POLICY,
  fundamental: FUNDAMENTAL_POLICY,
  estimate: ESTIMATE_POLICY,
}

/**
 * The policy for a class of data.
 *
 * The point of the lookup is that a caller names WHAT it is holding rather
 * than choosing a duration. Naming a duration is how one class's window
 * becomes every class's window — and the daily-close five days is a
 * conservative fallback for one specific feed, not a definition of "recent".
 */
export function policyFor(dataClass: DataClass): FreshnessPolicy {
  return POLICIES[dataClass]
}

/**
 * Whether this verdict rests on wall-clock arithmetic rather than a real
 * market calendar.
 *
 * True for everything today. A surface that wants to say "as of Friday's
 * close" rather than "4 days old" needs a `session` policy and should check
 * this rather than assume.
 */
export function isCalendarFallback(policy: FreshnessPolicy): boolean {
  return policy.basis === 'calendar'
}

export interface FreshnessVerdict {
  state: FreshnessState
  /**
   * The class and basis the verdict was reached under.
   *
   * Echoed rather than left implicit so a surface can render "stale" honestly:
   * a `calendar` verdict on a `daily_close` means "older than the conservative
   * window", not "the exchange has published something newer". Those are
   * different claims and only one of them is currently provable.
   */
  dataClass: DataClass
  basis: FreshnessBasis
  /** Age of the FACT in ms, from `effectiveAt`. Null when missing. */
  ageMs: number | null
  /** Age of the fact in whole days, for display. Null when missing. */
  ageDays: number | null
  /** Age of the OBSERVATION in ms, from `observedAt`. Null when missing. */
  observationAgeMs: number | null
  /**
   * Why, in one phrase, when the verdict is not `fresh`.
   *
   * Present so a surface can SAY what is wrong rather than grey a tile out.
   * A reader who is told "last close is 41 days old" can act; one shown an
   * empty space assumes the app is broken, which is the reading
   * `useTickerAliases` records people actually reaching.
   */
  reason: string | null
}

const missing = (policy: FreshnessPolicy, reason: string): FreshnessVerdict => ({
  state: 'missing',
  dataClass: policy.dataClass,
  basis: policy.basis,
  ageMs: null,
  ageDays: null,
  observationAgeMs: null,
  reason,
})

const parse = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Is this value still usable, and if not, why not.
 *
 * A malformed or absent `effectiveAt` is `missing`, not `fresh`. An
 * unparseable timestamp is the one case where guessing is most tempting and
 * most dangerous: it would make every value from a broken adapter look current.
 */
export function assessFreshness<T>(
  observed: Observed<T> | null | undefined,
  policy: FreshnessPolicy,
  now: number = Date.now(),
): FreshnessVerdict {
  if (!observed) return missing(policy, 'no value')

  const effective = parse(observed.effectiveAt)
  if (effective == null) {
    return missing(policy, 'value carries no usable effective date')
  }

  // Clamped at zero. A clock skew that puts `effectiveAt` slightly ahead of now
  // is ordinary; reporting a negative age would make the arithmetic downstream
  // read as a value from the future.
  const ageMs = Math.max(0, now - effective)
  const ageDays = Math.floor(ageMs / 86_400_000)

  const observedTs = parse(observed.observedAt)
  const observationAgeMs = observedTs == null ? null : Math.max(0, now - observedTs)

  if (ageMs > policy.maxAgeMs) {
    return {
      state: 'stale',
      dataClass: policy.dataClass,
      basis: policy.basis,
      ageMs,
      ageDays,
      observationAgeMs,
      reason: `value is ${ageDays} day${ageDays === 1 ? '' : 's'} old`,
    }
  }

  // The fact is current but nothing has refreshed it on schedule. Reported
  // separately because the fix is different: the value may be used, and the
  // pipeline needs looking at.
  if (
    policy.maxObservationAgeMs != null &&
    observationAgeMs != null &&
    observationAgeMs > policy.maxObservationAgeMs
  ) {
    return {
      state: 'stale',
      dataClass: policy.dataClass,
      basis: policy.basis,
      ageMs,
      ageDays,
      observationAgeMs,
      reason: 'not refreshed on schedule',
    }
  }

  return {
    state: 'fresh',
    dataClass: policy.dataClass,
    basis: policy.basis,
    ageMs,
    ageDays,
    observationAgeMs,
    reason: null,
  }
}

/** The value, but only if it is fresh. Null otherwise, never a default. */
export function freshValue<T>(
  observed: Observed<T> | null | undefined,
  policy: FreshnessPolicy,
  now: number = Date.now(),
): T | null {
  return assessFreshness(observed, policy, now).state === 'fresh' ? (observed as Observed<T>).value : null
}

/**
 * Two values are comparable when they describe the same instant, the same
 * currency and the same adjustment basis.
 *
 * The three ways a comparison silently lies, in one predicate. A close against
 * a book mark from a different month is the `snapshot_vs_live` bug; a USD price
 * against a EUR one is a currency error; a raw close against an adjusted one
 * spans a corporate action. Callers that compute a deviation, an upside or a
 * P&L should check this rather than each rediscovering one of the three.
 */
export function areComparable<A, B>(
  a: Observed<A> | null | undefined,
  b: Observed<B> | null | undefined,
  toleranceMs: number = 24 * 60 * 60 * 1000,
): boolean {
  if (!a || !b) return false
  if ((a.currency ?? null) !== (b.currency ?? null)) return false
  // `unknown` on either side is not a match, including against another
  // `unknown`. Two values we cannot describe are not thereby the same.
  if (a.adjustment != null || b.adjustment != null) {
    if (a.adjustment !== b.adjustment) return false
    if (a.adjustment === 'unknown') return false
  }
  const ta = parse(a.effectiveAt)
  const tb = parse(b.effectiveAt)
  if (ta == null || tb == null) return false
  return Math.abs(ta - tb) <= toleranceMs
}

/**
 * A phrase naming what a number is, for a surface to render beside it.
 *
 * Exists so no call site invents its own. "Current price" for anything that is
 * not the latest observation is the label that caused the GOOGL defect, and a
 * shared vocabulary is the only thing that stops it being retyped.
 */
export function describeSource<T>(observed: Observed<T> | null | undefined): string {
  if (!observed) return 'No value'
  const { via, provider } = observed.source
  if (via === 'manual') return 'Entered by hand'
  if (via === 'derived') return 'Derived'
  return `${provider}${observed.source.feed ? ` (${observed.source.feed})` : ''}`
}
