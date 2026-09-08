/**
 * Which instrument is this, stated once.
 *
 * ── The problem this closes ───────────────────────────────────────────────
 *
 * `symbol` is the de-facto identity of an asset everywhere in this product,
 * and the schema already records why that is unsafe. `20260818141000` added
 * `isin`, `figi` and `mic` precisely because a ticker is ambiguous across
 * venues and asset classes; `20260818150000` added `current_symbol` and
 * `lifecycle_status` because a ticker is also ambiguous across TIME — Square
 * became Block became XYZ, and the row still says SQ.
 *
 * Both migrations are applied. What was missing is any provider-neutral place
 * that reads them. Today the mapping lives in exactly one hook,
 * `useTickerAliases`, whose own doc comment records that it had briefly
 * existed in two places and the two had disagreed. Every other consumer —
 * search, the universe filters, the note backfill, `holdings-api` — matches a
 * raw string and takes the first row it gets.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A lookup that is genuinely ambiguous returns `ambiguous`, not a best guess.
 * That is the same discipline `AssetType.unknown` and `lifecycle_status`
 * `unresolved` already encode: absence and doubt are first-class values, never
 * rendered as a plausible answer. Picking the first `TSLA` from a list that
 * contains a Nasdaq listing and a Frankfurt one is how a US position quietly
 * becomes a euro-denominated one, and `resolve-instrument-lifecycle.mjs`
 * already refused to do it for exactly that reason.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * Not a security master, not a migration, and not a replacement for `assets`.
 * It is a pure module over rows the caller already fetched, so it can be tested
 * against thousands of instruments without a database and without a provider.
 */

/** What the row IS. Mirrors the `assets.asset_type` CHECK and `AssetType`. */
export type SecurityClass =
  | 'stock' | 'etf' | 'mutual_fund' | 'crypto' | 'forex' | 'commodity' | 'index'
  | 'bond' | 'warrant' | 'preferred' | 'unknown'

/** Mirrors the `assets.lifecycle_status` CHECK. NULL still means nobody looked. */
export type LifecycleStatus = 'active' | 'renamed' | 'delisted' | 'unresolved'

/**
 * The subset of an `assets` row that establishes identity.
 *
 * Deliberately a structural type rather than a class: every caller already has
 * these fields from `ASSET_REFERENCE_COLUMNS`, and requiring a constructor
 * would mean a conversion step at 100+ call sites, which is how the mapping
 * ends up living in two places again.
 */
export interface SecurityRow {
  id: string
  /** What the source said when the row was created. Never rewritten. */
  symbol: string | null
  /** The ticker it trades under NOW, when that differs. */
  current_symbol?: string | null
  company_name?: string | null
  exchange?: string | null
  /** ISO 10383 venue code. */
  mic?: string | null
  currency?: string | null
  isin?: string | null
  figi?: string | null
  asset_type?: SecurityClass | null
  lifecycle_status?: LifecycleStatus | null
}

/** The canonical in-app handle for an instrument. */
export interface SecurityRef {
  /** `assets.id`. The only identifier that is stable by construction. */
  assetId: string
  /** As recorded. What a card should say, and what provenance keeps. */
  recordedSymbol: string
  /** What to ask a price series for. `coalesce(current_symbol, symbol)`. */
  pricingSymbol: string
  mic: string | null
  currency: string | null
  isin: string | null
  figi: string | null
  securityClass: SecurityClass | null
  lifecycle: LifecycleStatus | null
}

/**
 * How the canonical key was derived, weakest last.
 *
 * Carried on the key so a consumer can tell a globally unique identity from a
 * ticker we are hoping is unique. A `symbol` key is not wrong, it is
 * unverified, and a consumer joining two datasets on one should know that.
 */
export type IdentityBasis = 'figi' | 'isin_mic' | 'mic_symbol' | 'symbol'

export interface SecurityKey {
  key: string
  basis: IdentityBasis
  /** True for `symbol` alone: unique only by assumption. */
  ambiguousByConstruction: boolean
}

const upper = (s: string | null | undefined): string =>
  typeof s === 'string' ? s.trim().toUpperCase() : ''

/**
 * The ticker a price series is keyed by.
 *
 * `price_history_cache` is keyed by what the instrument trades as today, while
 * cards say what the holdings file said. Both are correct; they answer
 * different questions. Resolving in one function means no call site has to
 * know that, which is the mistake `useTickerAliases` was written to stop
 * repeating.
 *
 * Idempotent: a traded ticker is never itself a rename source, so applying
 * this twice is applying it once.
 */
export function pricingSymbolOf(row: SecurityRow): string {
  const now = upper(row.current_symbol)
  return now || upper(row.symbol)
}

/** Narrow an `assets` row to the identity it establishes. */
export function toSecurityRef(row: SecurityRow): SecurityRef {
  return {
    assetId: row.id,
    recordedSymbol: upper(row.symbol),
    pricingSymbol: pricingSymbolOf(row),
    mic: upper(row.mic) || null,
    currency: upper(row.currency) || null,
    isin: upper(row.isin) || null,
    figi: upper(row.figi) || null,
    securityClass: row.asset_type ?? null,
    lifecycle: row.lifecycle_status ?? null,
  }
}

/**
 * A stable key for joining instrument-level data across datasets.
 *
 * Precedence is by how much of the world the identifier is unique across:
 *
 *   FIGI       globally unique per instrument-venue, and openly licensed
 *   ISIN+MIC   unique per issue at a venue; ISIN alone is not, it spans venues
 *   MIC+symbol unique at a venue at a point in time; survives a cross-listing
 *   symbol     unique nowhere, and marked as such
 *
 * The deliberate omission is ISIN alone. One ISIN covers every venue an issue
 * trades on, so keying by it would merge a Nasdaq line and a Frankfurt line
 * into one instrument with two currencies — the precise failure the venue
 * columns exist to prevent.
 */
export function securityKey(ref: SecurityRef): SecurityKey {
  if (ref.figi) return { key: `figi:${ref.figi}`, basis: 'figi', ambiguousByConstruction: false }
  if (ref.isin && ref.mic) {
    return { key: `isin:${ref.isin}@${ref.mic}`, basis: 'isin_mic', ambiguousByConstruction: false }
  }
  if (ref.mic && ref.pricingSymbol) {
    return { key: `sym:${ref.pricingSymbol}@${ref.mic}`, basis: 'mic_symbol', ambiguousByConstruction: false }
  }
  return { key: `sym:${ref.pricingSymbol}`, basis: 'symbol', ambiguousByConstruction: true }
}

/**
 * Whether an instrument can currently be priced or traded.
 *
 * `delisted` is the only verdict that means no. `unresolved` is NOT a verdict —
 * the provider was asked and the answer was ambiguous — so it is reported
 * separately rather than folded into either side, and NULL means nobody looked.
 */
export function isTradable(ref: SecurityRef): boolean {
  return ref.lifecycle !== 'delisted'
}

/**
 * Comparison form for a ticker whose separator spelling varies by provider.
 *
 * `BRK.B`, `BRK-B` and `BRK/B` are one instrument in three vocabularies, and
 * `backfill-price-history.mjs` already carries a one-way `.` to `-` rewrite for
 * Yahoo specifically. Folding the separator out gives a form that matches all
 * three without teaching every call site one provider's spelling.
 *
 * Used ONLY as a fallback pass after exact matching fails, and a fallback that
 * matches more than one row reports ambiguity rather than choosing. Folding is
 * lossy — it cannot distinguish an instrument genuinely named `ABC-D` from one
 * named `ABCD` — so it must never be the primary key.
 */
export function foldSymbol(symbol: string | null | undefined): string {
  return upper(symbol).replace(/[.\-/_ ]/g, '')
}

export type SecurityLookup =
  | { by: 'figi'; value: string }
  | { by: 'isin'; value: string; mic?: string }
  | { by: 'symbol'; value: string; mic?: string }

export type SecurityResolution =
  | { status: 'resolved'; ref: SecurityRef; viaFold: boolean }
  | { status: 'ambiguous'; candidates: SecurityRef[]; reason: string }
  | { status: 'not_found' }

/**
 * Resolve a lookup against rows the caller already has.
 *
 * ── Why delisted rows are considered rather than filtered ─────────────────
 *
 * A holdings file from 2023 references instruments that no longer trade, and
 * dropping them here would turn a reconcilable historical position into an
 * unresolved symbol. They are kept, and lose only a tie: when one active and
 * one delisted row share a ticker, the active one wins, because a ticker is
 * reissued after a delisting and the live instrument is what a bare lookup
 * means today. That preference breaks an exact tie only; it never picks
 * between two rows that both still trade.
 *
 * ── Why two active venues is an error and not a choice ────────────────────
 *
 * `TSLA` on Nasdaq and `TSLA` on a European venue are different instruments in
 * different currencies. Returning either one is a coin flip that reports itself
 * as success. The caller must supply a `mic`, or handle the ambiguity.
 */
export function resolveSecurity(
  rows: readonly SecurityRow[],
  lookup: SecurityLookup,
): SecurityResolution {
  const refs = rows.map(toSecurityRef)

  if (lookup.by === 'figi') {
    const want = upper(lookup.value)
    if (!want) return { status: 'not_found' }
    return finish(refs.filter(r => r.figi === want), false, 'more than one row carries this FIGI')
  }

  if (lookup.by === 'isin') {
    const want = upper(lookup.value)
    if (!want) return { status: 'not_found' }
    const mic = upper(lookup.mic)
    let hits = refs.filter(r => r.isin === want)
    if (mic) hits = hits.filter(r => r.mic === mic)
    // With no MIC to narrow by, an ISIN that spans venues is ambiguous by
    // definition rather than by accident. Say so, so the caller can pick one.
    return finish(hits, false, 'this ISIN trades on more than one venue; pass a mic')
  }

  const want = upper(lookup.value)
  if (!want) return { status: 'not_found' }
  const mic = upper(lookup.mic)

  // A rename must resolve under BOTH tickers. The old one is what historical
  // records say; the new one is what a provider says today.
  let hits = refs.filter(r => r.recordedSymbol === want || r.pricingSymbol === want)
  let viaFold = false

  if (hits.length === 0) {
    const folded = foldSymbol(want)
    if (folded) {
      hits = refs.filter(
        r => foldSymbol(r.recordedSymbol) === folded || foldSymbol(r.pricingSymbol) === folded,
      )
      viaFold = hits.length > 0
    }
  }

  if (mic) hits = hits.filter(r => r.mic === mic)

  return finish(hits, viaFold, 'this ticker exists on more than one venue; pass a mic')
}

function finish(hits: SecurityRef[], viaFold: boolean, reason: string): SecurityResolution {
  if (hits.length === 0) return { status: 'not_found' }
  if (hits.length === 1) return { status: 'resolved', ref: hits[0], viaFold }

  // Exactly one still trades: the others are retired lines under a reissued or
  // shared ticker, and a bare lookup means the live instrument.
  const live = hits.filter(isTradable)
  if (live.length === 1) return { status: 'resolved', ref: live[0], viaFold }

  return { status: 'ambiguous', candidates: hits, reason }
}

/**
 * A symbol index over a whole universe, built once and queried many times.
 *
 * `resolveSecurity` is linear in the number of rows, which is right for a
 * one-off lookup and wrong for the pattern this codebase actually has: the
 * note backfill, the holdings ingest and the universe filters each resolve
 * every symbol in a document against every row in the table. At 911 rows that
 * is unnoticeable; at 5,000 rows and 5,000 lookups it is 25m comparisons.
 *
 * The index keeps the same refusal to guess — a ticker with two live venues
 * resolves to `ambiguous` here exactly as it does there.
 */
export interface SymbolIndex {
  lookup(symbol: string, mic?: string): SecurityResolution
  readonly size: number
}

export function buildSymbolIndex(rows: readonly SecurityRow[]): SymbolIndex {
  const exact = new Map<string, SecurityRow[]>()
  const folded = new Map<string, SecurityRow[]>()

  const push = (m: Map<string, SecurityRow[]>, k: string, row: SecurityRow) => {
    if (!k) return
    const bucket = m.get(k)
    if (bucket) {
      // A row that carries the same ticker under both `symbol` and
      // `current_symbol` must not be indexed twice, or a single instrument
      // would look like a two-venue collision.
      if (!bucket.includes(row)) bucket.push(row)
    } else {
      m.set(k, [row])
    }
  }

  for (const row of rows) {
    const recorded = upper(row.symbol)
    const trading = pricingSymbolOf(row)
    push(exact, recorded, row)
    push(exact, trading, row)
    push(folded, foldSymbol(recorded), row)
    push(folded, foldSymbol(trading), row)
  }

  return {
    size: rows.length,
    lookup(symbol: string, mic?: string): SecurityResolution {
      const want = upper(symbol)
      if (!want) return { status: 'not_found' }
      const hit = exact.get(want)
      if (hit) return resolveSecurity(hit, { by: 'symbol', value: want, mic })
      const fold = folded.get(foldSymbol(want))
      if (fold) return resolveSecurity(fold, { by: 'symbol', value: want, mic })
      return { status: 'not_found' }
    },
  }
}
