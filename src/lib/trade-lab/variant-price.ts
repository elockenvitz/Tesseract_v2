/**
 * One way to build the price a Trade Lab variant is sized against.
 *
 * ── Why a helper rather than sixteen literals ────────────────────────────
 *
 * `SimulationPage` hand-built `{ asset_id, price, timestamp: new Date()
 * .toISOString(), source: 'realtime' }` at sixteen places. Every one of them
 * claimed the price had been observed just now and was a live quote,
 * regardless of which rung of the ladder actually supplied it -- so a close
 * from five weeks ago and a quote from five seconds ago reached
 * `normalizeSizing` wearing the same stamp, and `price_timestamp` landed in
 * `lab_variants.computed` saying the same thing.
 *
 * That is not a tidiness problem. It is why no guard downstream could tell a
 * current price from a stale one: the only date available was manufactured at
 * the call site. During the October ingestion outage every one of those
 * sixteen sites reported "live, as of now" for prices that were 37 days old.
 *
 * So the ladder's rung travels with the number. `priceProvenance` is built in
 * the same query that builds `priceMap`, from what actually answered:
 *
 *   live_quote    a provider returned a quote for the symbol
 *   stored_close  `price_history_cache` had a dated close in the window
 *   book_mark     neither did, and the position's own carrying price was used
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * It does not refuse. A missing price becomes 0, which `normalizeSizing`
 * already rejects, and the fail-closed judgement lives at the write, in
 * `assertVariantPriceIsBookable`. Keeping this function total means a preview
 * can always render something, including the reason it cannot size.
 */

import type { AssetPrice } from '../../types/trading'
import type { PriceBasis } from '../market-data/sizing-price'

/** What the price query recorded about where each asset's price came from. */
export interface PriceProvenance {
  /** When the price was true: a close's date, or the quote's instant. */
  asOf: string | null
  basis: PriceBasis
}

export type PriceProvenanceMap = Record<string, PriceProvenance>

export interface VariantPriceArgs {
  assetId: string
  /** The resolved price per asset. An absent key means "we do not know". */
  priceMap?: Record<string, number> | null
  /** Provenance for the same keys, from the same query. */
  priceProvenance?: PriceProvenanceMap | null
  /** The position's carrying price, used only when the map has no entry. */
  bookPrice?: number | null
  /** The holdings snapshot date that `bookPrice` is as of, if known. */
  bookAsOf?: string | null
}

/**
 * The `AssetPrice` for one asset, with honest provenance.
 *
 * `timestamp` stays "now" because that is what the field means -- when this
 * object was built. `as_of` is the one that answers when the price was true.
 */
export function assetPriceForVariant({
  assetId,
  priceMap,
  priceProvenance,
  bookPrice,
  bookAsOf,
}: VariantPriceArgs): AssetPrice {
  const resolved = priceMap?.[assetId]
  if (resolved != null && Number.isFinite(resolved) && resolved > 0) {
    const prov = priceProvenance?.[assetId]
    return {
      asset_id: assetId,
      price: resolved,
      timestamp: new Date().toISOString(),
      source: prov?.basis === 'stored_close' ? 'close' : 'realtime',
      as_of: prov?.asOf ?? null,
      // No basis recorded means the map was filled by something that did not
      // say. That is reported as absent rather than guessed at, and the
      // booking guard refuses it.
      basis: prov?.basis,
    }
  }

  if (bookPrice != null && Number.isFinite(bookPrice) && bookPrice > 0) {
    return {
      asset_id: assetId,
      price: bookPrice,
      timestamp: new Date().toISOString(),
      source: 'close',
      as_of: bookAsOf ?? null,
      basis: 'book_mark',
    }
  }

  /*
   * Zero, deliberately. `normalizeSizing` refuses a non-positive price and
   * `apply_trade_to_holdings` raises on one, so the trade is blocked and the
   * desk is told. A plausible-looking stand-in is what put
   * `price_at_acceptance = 100` on eleven production trades.
   */
  return {
    asset_id: assetId,
    price: 0,
    timestamp: new Date().toISOString(),
    source: 'realtime',
    as_of: null,
    basis: undefined,
  }
}
