/**
 * The instrument facts a header may state, with the placeholders removed.
 *
 * ── Measured, 2026-11-19 ─────────────────────────────────────────────────
 *
 *     select symbol, exchange from assets where symbol in ('AAPL','CAT','MS','V','MSFT')
 *     AAPL  Unknown
 *     CAT   Unknown
 *     MS    Unknown
 *     V     Unknown
 *     MSFT  Unknown
 *
 * `exchange` holds the literal string `'Unknown'` for every one of them.
 * That is absence wearing the costume of a value — the same defect as a
 * `previousClose` of 0, or an `AssetType` provider code defaulting to
 * `'stock'`. A header that printed the column verbatim would tell a reader
 * "AAPL · Unknown · USD · Equity", which is worse than telling them nothing:
 * it looks like a venue we checked.
 *
 * So placeholders are dropped rather than rendered, and the metadata line
 * gets shorter. A security we have not enriched shows fewer facts. It never
 * shows a fact we do not have.
 */

/**
 * Values that mean "nobody filled this in".
 *
 * Compared case-insensitively after trimming. `n/a`, `--` and `none` are
 * here because they are the other spellings this kind of column collects;
 * none has been observed in `assets` yet, and the point of the list is that
 * the first one to arrive is not rendered as a venue.
 */
const PLACEHOLDERS = new Set([
  'unknown', 'unspecified', 'none', 'null', 'n/a', 'na', '-', '--', 'tbd', 'other',
])

/**
 * A reference value, or null when it is absent or a placeholder.
 *
 * Exported because every surface naming an instrument has to make the same
 * judgement, and a second copy of this list is how one of them starts
 * printing "Unknown" again.
 */
export function referenceFact(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (PLACEHOLDERS.has(trimmed.toLowerCase())) return null
  return trimmed
}

/**
 * Instrument classification in the words a buy-side reader uses.
 *
 * `unknown` is in the `AssetType` union deliberately and maps to null here:
 * a security whose type we failed to map must not read as "Equity".
 */
const SECURITY_TYPE_LABEL: Record<string, string> = {
  stock: 'Equity',
  etf: 'ETF',
  mutual_fund: 'Fund',
  index: 'Index',
  bond: 'Bond',
  warrant: 'Warrant',
  preferred: 'Preferred',
  crypto: 'Crypto',
  forex: 'FX',
  commodity: 'Commodity',
}

export function securityTypeLabel(raw: string | null | undefined): string | null {
  const fact = referenceFact(raw)
  if (!fact) return null
  return SECURITY_TYPE_LABEL[fact.toLowerCase()] ?? null
}

export interface IdentityInput {
  exchange?: string | null
  /** The currency the QUOTE stated, which is the more specific claim. */
  quoteCurrency?: string | null
  /** The `assets.currency` column, used only when the quote is silent. */
  assetCurrency?: string | null
  assetType?: string | null
}

/**
 * The metadata line, in a fixed order: venue, currency, security type.
 *
 * Fixed because a line whose order depends on which facts happened to be
 * present cannot be scanned down a column of securities.
 */
export function identityFacts(input: IdentityInput): string[] {
  return [
    referenceFact(input.exchange),
    referenceFact(input.quoteCurrency) ?? referenceFact(input.assetCurrency),
    securityTypeLabel(input.assetType),
  ].filter((v): v is string => v != null)
}
