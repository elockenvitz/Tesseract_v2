import { displayMoney, resolveDisplayUnit } from './currency'
import type { RoutedQuote } from './routed-quote'

/**
 * What a header may say about a price, and what it may not.
 *
 * ── The defect this exists to stop ───────────────────────────────────────
 *
 * `AssetWorkspaceHeader` rendered its price through a local
 *
 *     const money = (n: number) => '$' + n.toLocaleString(...)
 *
 * while the quote it was handed already carried `currency`, `currencyUnit`,
 * `delivery`, `effectiveAt` and `observedAt`, and `assets` carries a
 * `currency` column. So a London line printed a pence figure with a dollar
 * sign in front of it: wrong symbol, wrong magnitude by 100, on the most
 * prominent number on the page. `displayMoney` has existed for this the
 * whole time; the header simply was not calling it.
 *
 * ── Why a change can be refused ──────────────────────────────────────────
 *
 * The recurring failure in this codebase is absence rendered as a value. A
 * quote whose `previousClose` is 0 does not mean the stock was free
 * yesterday; it means the provider said nothing. Arithmetic against it
 * produces a precise, confident, meaningless percentage — which is the same
 * shape of error as the +35.8% return computed from an undated
 * `assets.current_price`.
 *
 * So `change` is presented ONLY when the provider supplied a usable
 * previous close. Otherwise the price stands alone. A missing day change is
 * a small gap; a fabricated one is a reason not to trust the screen.
 *
 * ── Why staleness is stated and not styled away ───────────────────────────
 *
 * The provider says how it delivers (`realtime` / `delayed` / `eod`) and
 * when the price was true. Both are reported verbatim. Nothing here infers
 * "live" from the absence of a delivery term: an unlabelled quote is
 * labelled unlabelled. `STALE_AFTER_MS` is a display threshold only — it
 * decides whether to draw attention to the age, never whether to show the
 * number.
 */

/** Beyond this, the as-of is called out rather than merely printed. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000

export interface QuotePresentation {
  /** Formatted, in major units, with the currency the provider stated. */
  priceText: string | null
  /** ISO 4217 after any minor-unit conversion. Absent when unknown. */
  currencyCode?: string
  /** True when a minor unit (e.g. GBX pence) was converted to major. */
  converted: boolean
  /** Absolute day change, same unit as `priceText`. Null when not usable. */
  changeText: string | null
  /** Day change percent, already parenthesised. Null when not usable. */
  changePercentText: string | null
  direction: 'up' | 'down' | 'flat' | null
  /** 'Real time' / 'Delayed' / 'End of day', or null when unstated. */
  deliveryLabel: string | null
  /** The provider, for attribution. */
  providerLabel: string | null
  /** When the price was true, as a short local string. */
  asOfText: string | null
  asOfISO: string | null
  /** The as-of is older than STALE_AFTER_MS. */
  isStale: boolean
  /** Set when there is no price to show. The caller renders this, not a 0. */
  unavailable: string | null
}

const EMPTY: QuotePresentation = {
  priceText: null,
  converted: false,
  changeText: null,
  changePercentText: null,
  direction: null,
  deliveryLabel: null,
  providerLabel: null,
  asOfText: null,
  asOfISO: null,
  isStale: false,
  unavailable: 'No price observation',
}

/**
 * Only the three terms a provider actually states.
 *
 * An unrecognised term returns null rather than being passed through as a
 * label, because a raw provider token in a header reads as a claim the
 * reader cannot check.
 */
function deliveryLabelFor(delivery?: string): string | null {
  switch (delivery) {
    case 'realtime': return 'Real time'
    case 'delayed': return 'Delayed'
    case 'eod': return 'End of day'
    default: return null
  }
}

function asOfOf(quote: RoutedQuote): Date | null {
  // `effectiveAt` is when the price was TRUE. `timestamp` is the base
  // `Quote` field and is the fallback. `observedAt` is when WE asked, which
  // is not the same claim and is never used as the as-of.
  const raw = quote.effectiveAt ?? quote.timestamp
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * `assetCurrency` is the `assets.currency` column — reference data, used
 * only when the quote itself states nothing. `resolveDisplayUnit` prefers
 * the quote because it is the more specific statement, and returns
 * undefined when neither knows, which renders as a bare number.
 */
export function presentQuote(
  quote: RoutedQuote | null | undefined,
  assetCurrency?: string | null,
  now: number = Date.now(),
): QuotePresentation {
  /*
   * A zero is not an observation.
   *
   * `Number.isFinite(0)` is true, so a `price: 0` reached the formatter and
   * rendered as "$0.00" — a confident, precise statement that the security
   * is worthless, produced by a provider that said nothing. This is the
   * same defect as a `previousClose` of 0 below, and as the null benchmark
   * weight that once read as "the index excludes it".
   *
   * `<= 0` rather than `=== 0`: a negative equity price is corruption by
   * the same argument. If this module is ever pointed at an instrument
   * where a negative print is real (a spread, a calendar, 2020-04 WTI),
   * that instrument needs its own presenter, not a loosened guard here.
   */
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return EMPTY

  const unit = resolveDisplayUnit(
    { currency: quote.currency, currencyUnit: quote.currencyUnit },
    assetCurrency ? { currency: assetCurrency } : undefined,
  )

  const price = displayMoney(quote.price, unit)

  /*
   * The refusal.
   *
   * `change` and `previousClose` are `number | null` on purpose — see the
   * note on `Quote` in browser-client, where the same lesson was already
   * paid for: a required `change` made every construction site invent
   * `previousClose || currentPrice`, which produces a change of exactly 0
   * and reported a fabricated session P&L of $0.00.
   *
   * So null is honoured here rather than coalesced, AND a previousClose of 0
   * or less is still rejected even if some other path put one there. A
   * change of 0 with both observations present is a real flat tape and is
   * shown.
   */
  const prev = quote.previousClose
  const chg = quote.change
  const changeUsable =
    chg != null && Number.isFinite(chg) &&
    prev != null && Number.isFinite(prev) && prev > 0

  let changeText: string | null = null
  let changePercentText: string | null = null
  let direction: QuotePresentation['direction'] = null

  if (changeUsable && chg != null) {
    const delta = displayMoney(Math.abs(chg), unit)
    direction = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat'
    const sign = chg > 0 ? '+' : chg < 0 ? '-' : ''
    changeText = `${sign}${delta.text}`
    const pct = quote.changePercent
    if (pct != null && Number.isFinite(pct)) {
      changePercentText = `(${sign}${Math.abs(pct).toFixed(2)}%)`
    }
  }

  const asOf = asOfOf(quote)

  return {
    priceText: price.text,
    currencyCode: price.currency,
    converted: price.converted,
    changeText,
    changePercentText,
    direction,
    deliveryLabel: deliveryLabelFor(quote.delivery),
    providerLabel: quote.provider ?? null,
    asOfText: asOf
      ? asOf.toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
      : null,
    asOfISO: asOf ? asOf.toISOString() : null,
    isStale: asOf ? now - asOf.getTime() > STALE_AFTER_MS : false,
    unavailable: null,
  }
}

/**
 * The one-line provenance caption.
 *
 * Deliberately returns null when there is NOTHING to say rather than a
 * reassuring default. A caption reading "Delayed" when no provider stated a
 * delivery term would be the header inventing the very thing a reader
 * consults it for.
 */
export function provenanceCaption(p: QuotePresentation): string | null {
  const parts: string[] = []
  if (p.deliveryLabel) parts.push(p.deliveryLabel)
  else if (p.priceText) parts.push('Delivery unstated')
  if (p.asOfText) parts.push(p.asOfText)
  if (p.providerLabel) parts.push(p.providerLabel)
  if (p.converted) parts.push('converted to major units')
  return parts.length ? parts.join(' · ') : null
}
