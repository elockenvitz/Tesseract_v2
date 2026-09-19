/**
 * The boundary a provider is allowed to reach, and no further.
 *
 * ── Why this is not `src/lib/financial-data` ──────────────────────────────
 *
 * That module already models providers well — `AssetType`, `SearchResult`,
 * `IFinancialDataProvider`, a `ProviderManager` with health checks and
 * fallback. It has zero consumers. Every one of the eighteen components that
 * wants a price imports `browser-client.ts` instead, which is a SECOND
 * provider stack with its own `Quote` shape, its own Alpha Vantage / Yahoo /
 * Finnhub ladder, and no currency, no venue and no adjustment basis on
 * anything it returns.
 *
 * So the product has three market-data paths that share no types:
 * `browser-client` for quotes, direct `price_history_cache` reads for history,
 * and the designed-but-unused `ProviderManager`. Adding a fourth stack would
 * be the same mistake. This file is deliberately only the CONTRACT — the
 * shapes a provider adapter must produce and the capability it must declare —
 * so the existing stacks can be brought to it one at a time instead of being
 * replaced at once.
 *
 * ── The rule the contract enforces ────────────────────────────────────────
 *
 * A vendor's field names stop here. `chart.result[0].meta.regularMarketPrice`,
 * `Global Quote.05. price` and `latestPrice` are three spellings of one idea,
 * and all three currently appear inside application code. Nothing downstream of
 * an adapter may name a provider's schema, and `__tests__/vendor-leak.test.ts`
 * checks that rather than trusting it.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 *
 * No fundamentals beyond what the product already renders, no estimates, no
 * corporate-action feed, no options chain. Each would be a speculative schema
 * with no consumer, and this codebase has one of those already — a fully
 * implemented `search()` that nothing calls, whose real cost was 26 orphaned
 * positions worth $13.6m that nobody could see. Seams get added when a consumer
 * exists.
 */

import type { Observed } from './freshness'
import type { SecurityClass } from './identity'

/**
 * A security as a provider describes it, in our vocabulary.
 *
 * Every field except the identifier is optional because no provider returns
 * all of them, and a provider that omits one is saying "I do not know", which
 * must not be storable as a value.
 */
export interface ReferenceRecord {
  /** The ticker the provider was asked about or answered with. */
  symbol: string
  name?: string
  /** ISO 10383. Free-text exchange names go in `exchangeLabel`, not here. */
  mic?: string
  /**
   * Whatever the provider called the venue.
   *
   * Kept separate from `mic` and explicitly untrusted for identity: `assets
   * .exchange` is free text today and "NASDAQ", "NasdaqGS" and "XNAS" all
   * appear for one venue. Useful to show a person, useless to join on.
   */
  exchangeLabel?: string
  /** ISO 4217. */
  currency?: string
  country?: string
  securityClass?: SecurityClass
  isin?: string
  figi?: string
  /** Provider-assigned classification, already mapped into our words. */
  sector?: string
  industry?: string
  /**
   * Whether the provider still lists it.
   *
   * Not `lifecycle_status`: a provider can say "I have no such symbol", which
   * is evidence toward `delisted` and is not the verdict. Converting evidence
   * into a verdict is a decision with a human in it, and
   * `resolve-instrument-lifecycle.mjs` already owns that decision.
   */
  listedByProvider?: boolean
}

/** One daily bar. */
export interface PriceBar {
  /** Trading date, `YYYY-MM-DD`. The date the bar describes, not a fetch time. */
  date: string
  open: number | null
  high: number | null
  low: number | null
  /** The only field that is not nullable. A bar with no close is not a bar. */
  close: number
  volume: number | null
}

/** A series, with one provenance for the whole series rather than per bar. */
export type PriceSeries = Observed<PriceBar[]>

/** A single price. Always wrapped, so its currency and its instant travel with it. */
export type PriceQuote = Observed<number>

/**
 * What an adapter can actually do.
 *
 * Declared rather than discovered. `ProviderManager` today probes health at
 * runtime and falls back on failure, which cannot distinguish "this provider
 * is down" from "this provider has never supported international venues" —
 * and the second one should not trigger a retry ladder at all.
 */
export interface AdapterCapabilities {
  /** Venues, as MICs. Empty means the adapter does not say, not "all". */
  venues: readonly string[]
  securityClasses: readonly SecurityClass[]
  referenceData: boolean
  spotQuote: boolean
  dailyBars: boolean
  /**
   * Whether daily bars come back adjusted, and for what.
   *
   * Declared here because it is a property of the FEED, not of a response, and
   * a consumer comparing two series has to know before it asks.
   */
  barAdjustment: 'raw' | 'split_adjusted' | 'split_and_dividend_adjusted' | 'unknown'
  /** Identifiers the adapter can return. Drives what `securityKey` can use. */
  identifiers: readonly ('isin' | 'figi')[]
  /** Sustained request budget, for a scheduler to pace against. Null if unmetered. */
  requestsPerMinute: number | null
}

/**
 * Why a request produced nothing.
 *
 * A discriminated failure rather than a thrown error or a null, because the
 * three cases need three different responses and today they are indistinguish-
 * able. `backfill-price-history.mjs` records the concrete version of this:
 * Yahoo returns HTTP 200 with an HTML body when it blocks us, so "no data" and
 * "we are being throttled" arrive identically and only one of them should be
 * retried.
 */
export type AdapterFailure =
  | { kind: 'unknown_symbol'; symbol: string }
  | { kind: 'not_supported'; detail: string }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'unavailable'; detail: string }

export type AdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: AdapterFailure }

export interface BarsRequest {
  symbol: string
  /** Inclusive, `YYYY-MM-DD`. */
  from: string
  /** Inclusive, `YYYY-MM-DD`. */
  to: string
}

/**
 * The whole surface a provider is reached through.
 *
 * Four methods. An adapter that cannot do one declares so in `capabilities`
 * and returns `not_supported`; it does not omit the method, because an optional
 * method makes every call site write the same guard.
 */
export interface ProviderAdapter {
  /** Stable, lowercase, ours. Appears in `ValueSource.provider`. */
  readonly name: string
  readonly capabilities: AdapterCapabilities

  /**
   * Candidates for a free-text or ticker query, best first.
   *
   * Returns a LIST, never a single result, and never picks. Searching "Zoom
   * Video Communications" returns three German venues before any US listing,
   * and the caller — which knows whether it is reconciling a US book or
   * browsing — is the only thing that can choose safely.
   */
  resolve(query: string, limit?: number): Promise<AdapterResult<ReferenceRecord[]>>

  /** Reference data for one exact symbol. */
  reference(symbol: string): Promise<AdapterResult<Observed<ReferenceRecord>>>

  /** The most recent price, with the instant it was true. */
  latest(symbol: string): Promise<AdapterResult<PriceQuote>>

  /** Daily bars over an inclusive date range, ascending by date. */
  bars(request: BarsRequest): Promise<AdapterResult<PriceSeries>>
}

/** Failures worth trying again, and the ones that will never change. */
export function isRetryable(failure: AdapterFailure): boolean {
  return failure.kind === 'rate_limited' || failure.kind === 'unavailable'
}
