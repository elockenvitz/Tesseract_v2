/**
 * One way to ask "what is this instrument worth, and how much should I trust
 * that number".
 *
 * ── The three paths this sits above ───────────────────────────────────────
 *
 * Stage 1 found three market-data paths that share no types:
 *
 *   `browser-client.ts`      Alpha Vantage → Yahoo → Finnhub, 18 components.
 *                            Its `Quote` has no currency, no venue and no
 *                            adjustment basis, so a number that crosses into
 *                            the app has no unit.
 *   `price_history_cache`    read directly by ~25 modules, keyed by raw
 *                            ticker text. Rows DO carry `source` and
 *                            `fetched_at`; nothing reads either.
 *   `ProviderManager`        zero callers.
 *
 * This does not replace any of them. It is the read seam they can be brought
 * to one at a time: it takes a `SecurityRef` rather than a string, asks the
 * cache under the traded ticker, and returns `Observed<…>` so the currency,
 * the two timestamps, the source and the adjustment basis arrive with the
 * number instead of being reconstructed at each call site.
 *
 * ── Why a `SecurityRef` and not a symbol ──────────────────────────────────
 *
 * `price_history_cache` is keyed by what an instrument trades as TODAY, while
 * a card says what the holdings file said. Block is `SQ` on the card and `XYZ`
 * in the cache. Every surface except the mobile chart asks under the display
 * ticker, gets nothing, and draws no chart — indistinguishable from missing
 * data, and reported as missing data more than once.
 *
 * Taking a ref makes that impossible to get wrong: `pricingSymbol` is the
 * cache key and `recordedSymbol` is what the reader is shown, and the caller
 * cannot accidentally pass one where the other belongs.
 *
 * ── What is deliberately NOT resolved here ────────────────────────────────
 *
 * `adjustment` comes back `unknown` for every row, because the table does not
 * record it. That is honest and it is a finding, not an omission: two closes
 * spanning a split are silently incomparable today and `areComparable` will
 * correctly refuse to compare them. Adding the column is listed in
 * `docs/tickets/data-platform-foundation.md` §5; inventing a value here would
 * hide the gap behind a plausible default, which is the failure mode this
 * whole module exists to prevent.
 */

import type { PriceBar } from './contracts'
import {
  DAILY_CLOSE_POLICY,
  assessFreshness,
  type FreshnessVerdict,
  type Observed,
} from './freshness'
import type { SecurityRef } from './identity'

/** A row of `price_history_cache`, as stored. */
export interface PriceCacheRow {
  symbol: string
  date: string
  open?: number | null
  high?: number | null
  low?: number | null
  close: number | null
  volume?: number | null
  /** Free text, e.g. `yahoo_chart_v8`. Split into provider and feed below. */
  source?: string | null
  fetched_at?: string | null
}

export interface PriceQuerySpec {
  /** The ticker the cache is keyed by. Already resolved; never a display one. */
  tradedSymbol: string
  /** Newest-first row budget. */
  limit: number
}

/** Runs one spec against the cache. Must not page; must not resolve aliases. */
export type PriceRowSource = (spec: PriceQuerySpec) => Promise<PriceCacheRow[]>

/** A full trading year, which is about what the table holds per symbol. */
export const DEFAULT_SERIES_POINTS = 260

/**
 * Split a stored `source` string into provider and feed.
 *
 * The column holds one flat token like `yahoo_chart_v8`, which mixes a vendor
 * with an endpoint. `ValueSource` keeps them apart because only the first is
 * meaningful to a reader and only the second changes when an adapter is
 * rewritten. A value with no source is `unknown`, never assumed to be Yahoo —
 * the rows predate the nightly job and some were seeded by hand.
 */
export function splitSource(source: string | null | undefined): { provider: string; feed?: string } {
  const raw = typeof source === 'string' ? source.trim().toLowerCase() : ''
  if (!raw) return { provider: 'unknown' }
  const cut = raw.indexOf('_')
  if (cut <= 0) return { provider: raw }
  return { provider: raw.slice(0, cut), feed: raw.slice(cut + 1) }
}

export interface PriceReadResult {
  /** Null when the cache holds nothing usable for this instrument. */
  observed: Observed<number> | null
  verdict: FreshnessVerdict
  /**
   * What a surface should call this number.
   *
   * `Last close` and never `Current price`, because it is a close. The GOOGL
   * defect was a holdings mark carrying the second label; the fix is that the
   * label is produced next to the number rather than typed at the call site.
   */
  label: string
  /** The ticker to SHOW. Not the one the cache was asked for. */
  displaySymbol: string
}

export interface SeriesReadResult {
  observed: Observed<PriceBar[]> | null
  verdict: FreshnessVerdict
  displaySymbol: string
}

export interface MarketDataReader {
  latestClose(ref: SecurityRef, now?: number): Promise<PriceReadResult>
  closeSeries(ref: SecurityRef, opts?: { points?: number; now?: number }): Promise<SeriesReadResult>
}

/**
 * A close is a number. Zero, negative, or non-finite is not a price.
 *
 * Dropped here rather than at each chart, so the "0 standing in for unknown"
 * case cannot reach a deviation calculation and render as a -100% move.
 */
function usableClose(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function usableOptional(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function createMarketDataReader(source: PriceRowSource): MarketDataReader {
  async function fetchBars(ref: SecurityRef, points: number) {
    const key = ref.pricingSymbol
    if (!key) return { bars: [] as PriceBar[], rows: [] as PriceCacheRow[] }
    const rows = await source({ tradedSymbol: key, limit: points })

    const bars: PriceBar[] = []
    const kept: PriceCacheRow[] = []
    for (const row of rows) {
      const close = usableClose(row.close)
      if (close == null || !row.date) continue
      kept.push(row)
      bars.push({
        date: String(row.date),
        open: usableOptional(row.open),
        high: usableOptional(row.high),
        low: usableOptional(row.low),
        close,
        volume: Number.isFinite(Number(row.volume)) ? Number(row.volume) : null,
      })
    }
    // Ascending, which is how a chart draws and how `resolvePriceSnapshot`
    // documents its input. The source returns newest-first so a short read
    // keeps the RECENT end of the series rather than a year-old head.
    bars.sort((a, b) => a.date.localeCompare(b.date))
    return { bars, rows: kept }
  }

  return {
    async latestClose(ref, now = Date.now()) {
      const { bars, rows } = await fetchBars(ref, 1)
      const display = ref.recordedSymbol || ref.pricingSymbol

      if (bars.length === 0) {
        return {
          observed: null,
          verdict: assessFreshness(null, DAILY_CLOSE_POLICY, now),
          label: 'No price',
          displaySymbol: display,
        }
      }

      const bar = bars[bars.length - 1]
      const row = rows.find(r => String(r.date) === bar.date)
      const { provider, feed } = splitSource(row?.source)

      const observed: Observed<number> = {
        value: bar.close,
        source: { provider, feed, via: 'cache' },
        // The row's own fetch time when it has one. Falling back to the close
        // date would claim we observed it the day it happened, which is the
        // conflation the whole module refuses.
        observedAt: row?.fetched_at ?? bar.date,
        effectiveAt: bar.date,
        adjustment: 'unknown',
        currency: ref.currency ?? undefined,
      }

      return {
        observed,
        verdict: assessFreshness(observed, DAILY_CLOSE_POLICY, now),
        label: 'Last close',
        displaySymbol: display,
      }
    },

    async closeSeries(ref, opts = {}) {
      const points = Math.max(1, opts.points ?? DEFAULT_SERIES_POINTS)
      const now = opts.now ?? Date.now()
      const { bars, rows } = await fetchBars(ref, points)
      const display = ref.recordedSymbol || ref.pricingSymbol

      if (bars.length === 0) {
        return {
          observed: null,
          verdict: assessFreshness(null, DAILY_CLOSE_POLICY, now),
          displaySymbol: display,
        }
      }

      const newest = bars[bars.length - 1]
      const newestRow = rows.find(r => String(r.date) === newest.date)
      const { provider, feed } = splitSource(newestRow?.source)

      /**
       * One provenance for the series, taken from its NEWEST bar.
       *
       * A series spans months, so a single `effectiveAt` is a simplification —
       * and the newest bar is the right one, because the question a reader
       * asks of a chart is "how current is this", not "when did it start".
       * Freshness of the series is freshness of its latest point.
       */
      const observed: Observed<PriceBar[]> = {
        value: bars,
        source: { provider, feed, via: 'cache' },
        observedAt: newestRow?.fetched_at ?? newest.date,
        effectiveAt: newest.date,
        adjustment: 'unknown',
        currency: ref.currency ?? undefined,
      }

      return {
        observed,
        verdict: assessFreshness(observed, DAILY_CLOSE_POLICY, now),
        displaySymbol: display,
      }
    },
  }
}
