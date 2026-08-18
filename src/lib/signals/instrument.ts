/**
 * What a card is allowed to claim about an instrument.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every calculation on the card surface was written when `assets` could only
 * hold equities. `assets.asset_type` now exists and is populated, so the
 * universe can widen to indexes, ETFs, currency pairs and crypto — and the
 * moment it does, most of those calculations become false rather than merely
 * imprecise.
 *
 * An index has no shares outstanding and no market cap. A currency pair has no
 * sector. Neither can be "overweight versus the benchmark" in the sense the
 * active-risk card means, because neither is a constituent of one. Rendering
 * those anyway is the same defect the rest of this library is built against:
 * a number that is structurally meaningless, displayed with the same
 * confidence as one that is not.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * `null` means NOT KNOWN, and is permissive. 911 rows were classified on
 * 2026-08-18 but a new row starts NULL, and refusing to render a card for a
 * name nobody has classified yet would be a worse failure than the one this
 * prevents — it would silently empty the feed. `'unknown'` is different: it
 * means the provider was asked and could not tell, which is a fact, and it is
 * still permissive for weight-based claims because a position IS held whatever
 * the thing turns out to be.
 *
 * So this gates the claims that are structurally wrong for a class, not the
 * ones that are merely unverified.
 */

/** Mirrors `AssetType` in src/lib/financial-data/types.ts, plus null. */
export type InstrumentClass =
  | 'stock' | 'etf' | 'mutual_fund' | 'crypto' | 'forex' | 'commodity'
  | 'index' | 'bond' | 'warrant' | 'preferred' | 'unknown' | null

/**
 * Can this be a position in a book at all?
 *
 * An index cannot. You can hold a fund that tracks it; you cannot hold the
 * index, so "6.2% of the book" is not a statement that can be true of one.
 */
export function isHoldable(cls: InstrumentClass): boolean {
  return cls !== 'index'
}

/**
 * Can it be compared against a benchmark's constituent weights?
 *
 * The active-risk claim is "the book holds X% against the index's Y%". That
 * requires the name to be the KIND of thing an equity index lists. A currency
 * pair, a commodity future and the index itself are not, so their "active
 * weight" would be computed against a benchmark weight of zero and read as a
 * deliberate off-benchmark bet — which is exactly the false claim the
 * `insufficient_coverage` suppression was added to stop in the other
 * direction.
 */
export function hasBenchmarkWeight(cls: InstrumentClass): boolean {
  return cls !== 'index' && cls !== 'forex' && cls !== 'commodity' && cls !== 'crypto'
}

/**
 * Do company fundamentals mean anything for it?
 *
 * Market cap, sector and industry are properties of an issuer. A currency pair
 * has no issuer; an index has no market cap of its own; an ETF's sector is its
 * mandate rather than a fact about a company.
 */
export function hasIssuerFundamentals(cls: InstrumentClass): boolean {
  return cls === 'stock' || cls === 'preferred' || cls === 'warrant' || cls == null || cls === 'unknown'
}

/** Human label for a class, for the one place a card names it. */
export const CLASS_LABEL: Record<Exclude<InstrumentClass, null>, string> = {
  stock: 'Stock',
  etf: 'ETF',
  mutual_fund: 'Fund',
  crypto: 'Crypto',
  forex: 'Currency',
  commodity: 'Commodity',
  index: 'Index',
  bond: 'Bond',
  warrant: 'Warrant',
  preferred: 'Preferred',
  unknown: 'Unclassified',
}
