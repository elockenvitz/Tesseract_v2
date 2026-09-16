/**
 * What "current price" means when a decision is measured against today.
 *
 * ── The defect this exists to close ───────────────────────────────────────
 *
 * Outcomes measured every decision against `assets.current_price`. That column
 * has no timestamp anywhere in the schema and is written by whatever last
 * touched the asset row -- on this project it was last written on 2026-08-18,
 * a month before the closes it sits beside, and it is null for names nobody has
 * touched at all. Bogey Cap's MSFT trade, executed at 501.11 against a 497.12
 * close, was reported as -23.1% and -$19K because the comparison price was
 * 385.20 from a month earlier.
 *
 * `price_history_cache` is the product's canonical stored market price: dated
 * daily closes, backfilled nightly, and already what Research, Today, Ideas and
 * the decision detail pane measure against. So that is what a decision is
 * measured against too, and the date comes with it.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 *   1. the newest cached close for the name, with its date;
 *   2. failing that -- no close cached at all -- `assets.current_price`, which
 *      is a real price but carries no date, so it is returned undated and
 *      flagged;
 *   3. failing that, nothing, and every number measured from a current price
 *      is unavailable rather than computed from a value nobody can date.
 *
 * A close older than `DAILY_CLOSE_POLICY` is still used -- it is dated, and a
 * dated old price the reader can see the age of beats an undated one they
 * cannot -- but it is flagged stale so the surface can say how current it is.
 * Nothing here fetches: it decides between values the caller already read.
 */

import { DAILY_CLOSE_POLICY } from '../market-data/freshness'

export interface CurrentPrice {
  price: number
  /** The close's date, or null where the value carries no date at all. */
  asOf: string | null
  /** Older than the daily-close policy allows, or undated. Say so in the UI. */
  stale: boolean
}

/** A cached daily close, as `price_history_cache` stores it. */
export interface CachedClose {
  close: number | string | null
  date: string
}

/**
 * The price a decision should be measured against today.
 *
 * `assetPrice` is `assets.current_price` -- the undated fallback, used only
 * when nothing is cached for the name.
 */
export function currentPriceFor(
  latestClose: CachedClose | null | undefined,
  assetPrice: number | string | null | undefined,
  now: number = Date.now(),
): CurrentPrice | null {
  const close = num(latestClose?.close)
  if (close != null && latestClose?.date) {
    const at = Date.parse(`${latestClose.date}T00:00:00Z`)
    const stale = !Number.isFinite(at) || now - at > DAILY_CLOSE_POLICY.maxAgeMs
    return { price: close, asOf: latestClose.date, stale }
  }

  const asset = num(assetPrice)
  // Undated by construction: the column has no `as of` anywhere in the schema.
  if (asset != null) return { price: asset, asOf: null, stale: true }

  return null
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
