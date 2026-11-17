/**
 * One quote fetch, routed to whichever provider this session may use.
 *
 * The three chart/quote surfaces all asked `financialDataService.getQuote`
 * directly. They now ask this, so the provider decision is made in one place
 * and the provenance travels with the figure instead of being inferred from
 * which component you happen to be reading.
 *
 * ── What this does NOT do ─────────────────────────────────────────────────
 *
 * There is no fallback. If EODHD declines, the result is a refusal with a
 * reason, not a quietly substituted Yahoo price: a surface that silently
 * changes data source changes data quality without telling anyone, and the
 * delayed/EOD badge beside it would then be describing the wrong feed.
 *
 * It writes nothing. No table, no shared cache, no `price_history_cache`.
 */
import { financialDataService, type Quote } from '../financial-data/browser-client'
import type { AdapterFailure, CurrencyUnit, MarketDataProviderId, ReferenceRecord } from './contracts'
import { eodhdLatest, eodhdReference } from './eodhd-client'
import { resolveEodhdSymbol } from './eodhd-symbol'

/**
 * A quote plus the provenance a reader needs to judge it.
 *
 * `price` is in the unit named by `currencyUnit` when one is present, NOT in
 * major units. Conversion is the display layer's explicit decision (see
 * `displayPrice`), because a number silently divided by 100 somewhere in a
 * fetch layer is exactly how a pence price becomes a pound price nobody
 * noticed.
 */
export interface RoutedQuote extends Quote {
  provider: MarketDataProviderId
  /** `delayed` / `eod` / `realtime`, where the provider stated it. */
  delivery?: string
  /** The instant the price was true — for EODHD, the last trade. */
  effectiveAt?: string
  /** When we asked. */
  observedAt?: string
  /** ISO 4217, from reference data only. Absent when unknown. */
  currency?: string
  /** Present when `price` is quoted in a minor unit, e.g. GBX pence. */
  currencyUnit?: CurrencyUnit
  /** The venue as the provider labels it. Untrusted for identity. */
  exchangeLabel?: string
}

export interface RoutedQuoteResult {
  quote: RoutedQuote | null
  failure?: AdapterFailure
}

/**
 * Reference lookups are cached for the session.
 *
 * A trading currency does not change, and asking for it on every quote poll
 * would double the request count against a metered single-seat plan. This
 * cache is per browser tab, keyed by symbol, and holds nothing but
 * instrument metadata — no prices, no user data. It is cleared when the
 * principal changes so an unentitled session cannot read an entitled one's
 * entry after a user switch in the same tab.
 *
 * Exported so `__tests__/provider-isolation.test.ts` can observe that the
 * clear actually empties it. A source-text assertion that the clear is
 * *called* passes just as happily when the call is dead, which is how a
 * previous version of that guard went green with the clear disabled.
 */
export const referenceCache = new Map<
  string,
  Pick<ReferenceRecord, 'currency' | 'currencyUnit' | 'exchangeLabel'>
>()

export function clearReferenceCache() {
  referenceCache.clear()
}

/**
 * Reference data for a provider-format symbol, cached for the session.
 *
 * Exported because the history path needs the same answer: the series and
 * the quote beside it must be labelled in the same currency, and fetching
 * the unit twice from two call sites is how they end up disagreeing.
 */
export async function referenceFor(symbol: string) {
  const key = symbol.toUpperCase()
  const hit = referenceCache.get(key)
  if (hit) return hit

  const res = await eodhdReference(symbol)
  if (!res.ok) return null
  const record = res.data?.value
  if (!record) return null
  const slim = {
    currency: record.currency,
    currencyUnit: record.currencyUnit,
    exchangeLabel: record.exchangeLabel,
  }
  referenceCache.set(key, slim)
  return slim
}

export async function fetchRoutedQuote(
  symbol: string,
  provider: MarketDataProviderId,
): Promise<RoutedQuoteResult> {
  if (provider !== 'eodhd') {
    const quote = await financialDataService.getQuote(symbol)
    if (!quote) {
      return {
        quote: null,
        failure: { kind: 'unavailable', detail: 'No quote available for this symbol.' },
      }
    }
    return { quote: { ...quote, provider: 'yahoo' } }
  }

  /*
   * `AAPL` is not an EODHD symbol. The suffix comes from the provider's own
   * search, cached for the session, never from `assets.exchange`.
   */
  const resolved = await resolveEodhdSymbol(symbol)
  if (!resolved.ok) return { quote: null, failure: resolved.failure }
  const providerSymbol = resolved.symbol

  const latest = await eodhdLatest(providerSymbol)
  if (!latest.ok) return { quote: null, failure: latest.failure }

  const price = latest.data?.value
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    // The server already refuses a non-positive price; this is the second
    // line, because a zero that reaches a chart is indistinguishable from a
    // real collapse.
    return {
      quote: null,
      failure: { kind: 'unavailable', detail: 'Provider returned no usable price.' },
    }
  }

  /*
   * The unit comes from reference data or not at all. The quote endpoint
   * states no currency, and the caller is not a source for one.
   *
   * Symbol resolution may already have handed us the reference record, in
   * which case this costs nothing.
   */
  const reference = resolved.reference
    ? {
      currency: resolved.reference.currency,
      currencyUnit: resolved.reference.currencyUnit,
      exchangeLabel: resolved.reference.exchangeLabel,
    }
    : await referenceFor(providerSymbol)

  return {
    quote: {
      // The symbol the PROVIDER answered about, so a reader comparing this
      // against the diagnostic sees the same identifier in both places.
      symbol: providerSymbol.toUpperCase(),
      price,
      /*
       * Null, not zero, and not derived.
       *
       * EODHD's real-time payload carries a `previousClose`, and this
       * adapter deliberately does not read it: the server refuses to
       * substitute it for a missing price, and using it to manufacture a
       * change here would reintroduce the same figure by the back door.
       * A null change renders as "no change known", which is true.
       */
      change: null,
      changePercent: null,
      previousClose: null,
      // Session OHLC is not what `real-time` describes — its open/high/low
      // cover the session so far, which is not a bar. Reported as the price
      // itself rather than invented.
      open: price,
      high: price,
      low: price,
      dayHigh: price,
      dayLow: price,
      volume: 0,
      timestamp: latest.data.observedAt ?? new Date().toISOString(),
      provider: 'eodhd',
      delivery: latest.data.source?.delivery,
      effectiveAt: latest.data.effectiveAt,
      observedAt: latest.data.observedAt,
      currency: reference?.currency,
      currencyUnit: reference?.currencyUnit,
      exchangeLabel: reference?.exchangeLabel,
    },
  }
}
