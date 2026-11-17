/**
 * Turning this product's ticker into EODHD's identifier.
 *
 * ── Why this is not a string concatenation ────────────────────────────────
 *
 * Tesseract stores `AAPL`. EODHD addresses `AAPL.US`. The tempting fix is to
 * append a suffix derived from `assets.exchange` — and `assets.exchange` is
 * free text in which "NASDAQ", "NasdaqGS" and "XNAS" all appear for one
 * venue. A suffix guessed from that is a guess that produces a VALID-LOOKING
 * symbol for a different instrument, which is the worst available outcome:
 * a chart of the wrong company, correctly labelled.
 *
 * So nothing here derives a suffix. A ticker that already carries one is
 * used as given; a bare ticker is resolved through the provider's own symbol
 * search, and if that does not return an unambiguous match the result is a
 * typed refusal naming what it did find. Asking the provider costs one
 * request per symbol per session; being wrong costs a decision.
 */
import type { AdapterFailure, ReferenceRecord } from './contracts'
import { eodhdResolve } from './eodhd-client'

export type SymbolResolution =
  | { ok: true; symbol: string; reference?: ReferenceRecord }
  | { ok: false; failure: AdapterFailure }

/**
 * Resolutions already made in this tab.
 *
 * A ticker's EODHD identifier does not change, so this is cached for the
 * session. It holds instrument identifiers only — no prices and no user
 * data — and `clearProviderCaches` empties it with the others when the
 * principal changes.
 */
export const symbolCache = new Map<string, SymbolResolution>()

export function clearSymbolCache() {
  symbolCache.clear()
}

/**
 * EODHD's exchange suffix for the venues the subscription covers.
 *
 * Used only to RANK candidates the provider itself returned, never to build a
 * symbol. `US` first because this product's books are US-centric, so when a
 * bare ticker matches both a US listing and a foreign cross-listing, the US
 * one is what the user meant — and when it matches neither, the result is a
 * refusal rather than the first row.
 */
const VENUE_PREFERENCE = ['US', 'TO', 'V', 'L', 'XETRA', 'F', 'TSE', 'PA', 'AS', 'MI', 'SW']

const tickerOf = (symbol: string) => symbol.split('.')[0]!.toUpperCase()

/**
 * Pick the one candidate a bare ticker unambiguously means, or refuse.
 *
 * Exported and pure so the choice can be tested against the shapes EODHD
 * actually returns, including the ones where it should refuse.
 */
export function chooseCandidate(
  query: string,
  candidates: readonly ReferenceRecord[],
): SymbolResolution {
  const wanted = query.toUpperCase()

  // Only candidates whose ticker is EXACTLY the one asked for. A fuzzy name
  // match is a different company: searching "SHOP" must not return "SHOPIFY
  // UNSPONSORED ADR" as if it were the same listing.
  const exact = candidates.filter(c => tickerOf(c.symbol) === wanted)
  if (exact.length === 0) {
    return {
      ok: false,
      failure: {
        kind: 'unknown_symbol',
        symbol: query,
      },
    }
  }

  for (const venue of VENUE_PREFERENCE) {
    const hit = exact.find(c => c.symbol.toUpperCase().endsWith(`.${venue}`))
    if (hit) return { ok: true, symbol: hit.symbol, reference: hit }
  }

  // An exact ticker on a venue we have no preference ordering for. One
  // candidate is unambiguous; several are not, and picking among them is the
  // caller's decision to make with more context than this function has.
  if (exact.length === 1) return { ok: true, symbol: exact[0].symbol, reference: exact[0] }

  return {
    ok: false,
    failure: {
      kind: 'not_supported',
      detail:
        `${query} matches ${exact.length} EODHD listings `
        + `(${exact.map(c => c.symbol).join(', ')}) and none on a known venue. `
        + 'Use the full provider symbol, including its exchange suffix.',
    },
  }
}

/**
 * The EODHD symbol for a Tesseract ticker.
 *
 * A ticker containing a dot is passed through untouched — it is already in
 * provider format, and re-resolving it would spend a request to confirm what
 * the caller already stated.
 */
export async function resolveEodhdSymbol(symbol: string): Promise<SymbolResolution> {
  const raw = symbol.trim()
  if (!raw) {
    return { ok: false, failure: { kind: 'unknown_symbol', symbol } }
  }
  if (raw.includes('.')) return { ok: true, symbol: raw }

  const key = raw.toUpperCase()
  const cached = symbolCache.get(key)
  if (cached) return cached

  const res = await eodhdResolve(raw, 20)
  if (!res.ok) {
    // A transport failure is NOT cached. Caching it would pin a chart to an
    // error for the rest of the session over one bad request.
    return { ok: false, failure: res.failure }
  }

  const chosen = chooseCandidate(raw, res.data ?? [])
  symbolCache.set(key, chosen)
  return chosen
}
