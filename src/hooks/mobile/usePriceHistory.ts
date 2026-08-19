import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { PricePoint } from '../../components/signals/PriceContext'

/**
 * Cached daily closes for the names on screen.
 *
 * ── What is actually in this table ────────────────────────────────────────
 *
 * Re-measured against production 2026-08-18: **34,364 rows across 135 symbols**,
 * roughly a trading year each, and 133 of the 135 are one day behind the
 * current date. `ingest.yml` backfills it nightly at 22:00 UTC on weekdays from
 * `scripts/backfill-price-history.mjs`, whose symbol list is a live query over
 * `portfolio_holdings ⋈ assets` rather than anything hardcoded.
 *
 * ── The stale comment that used to live here, and what it cost ────────────
 *
 * This block previously described the table as 2,008 rows for eight symbols
 * (AAPL, CAT, CVX, GOOGL, META, MSFT, ORCL, TSLA) with windows ending anywhere
 * from 24 Apr to 10 Aug. That was true when it was written and false the moment
 * the nightly backfill landed. Every constant below had been sized against it,
 * and it was quoted downstream as the reason charts were missing — a diagnosis
 * that sent the search to the ingestion side when the cause was the twelve-symbol
 * cap right here.
 *
 * A measurement in a comment is only as good as its date. If this block matters
 * to a decision, re-run the count before trusting it:
 *
 *     select count(*), count(distinct symbol), max(date) from price_history_cache
 *
 * ── What has NOT changed ──────────────────────────────────────────────────
 *
 * It is still a cache of closes, not a quote feed. The last close is a close,
 * not a live price, and nothing here or downstream may compare one to a quote
 * or a target. `PriceContext` still labels its own window's end date and still
 * refuses to draw an axis running to "now". Fresher data makes that discipline
 * easier to forget, not less necessary.
 *
 * `price_history_cache` carries no `organization_id` and is not org-scoped: it
 * is market data keyed by symbol. A closing price is not tenant data, and
 * filtering on a column that does not exist would be cargo-culting the tenant
 * rule rather than applying it.
 */

/**
 * A full trading year, which is about what the table holds per symbol.
 *
 * Was 180 (roughly nine months), which quietly capped every series below the
 * ~251 closes actually cached and made the chart's "1Y" range indistinguishable
 * from "MAX", so the widest control on the chart did nothing.
 */
const MAX_POINTS = 260

/**
 * How many names can carry a chart in one pass down the feed.
 *
 * Was 12, on the reasoning that "the feed shows at most a dozen names at once".
 * That is true of the viewport and false of the session: the feed is an
 * effectively endless snap scroller, so the thirteenth card onward silently
 * lost its evidence band. With eight symbols cached the cap was invisible
 * because the data ran out first; at 135 symbols it became the binding
 * constraint and the single largest cause of missing charts.
 *
 * 36 covers a realistic scroll depth. The cost is bounded and paid once an
 * hour: these rows are three short columns of highly repetitive numbers, so
 * ~9,400 of them compress to tens of kilobytes on the wire, and `staleTime`
 * keeps it to one request per hour per symbol set.
 *
 * It is a cap rather than "everything" on purpose. Fetching all 135 would tie
 * the request size to the size of the book, which is the shape of query that
 * works in development and falls over on the largest tenant.
 */
const MAX_SYMBOLS = 36

export function usePriceHistory(symbols: string[], options?: { enabled?: boolean }) {
  const wanted = Array.from(new Set(symbols.map(s => s.toUpperCase()).filter(Boolean)))
    .slice(0, MAX_SYMBOLS)
    .sort()

  return useQuery({
    // Sorted and de-duplicated above, so a re-render that reorders the feed
    // does not look like a new query.
    queryKey: ['feed-price-history', wanted.join(',')],
    enabled: (options?.enabled ?? true) && wanted.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Map<string, PricePoint[]>> => {
      const out = new Map<string, PricePoint[]>()
      if (!wanted.length) return out

      const { data, error } = await supabase
        .from('price_history_cache')
        .select('symbol, date, close')
        .in('symbol', wanted)
        // Newest first so the row cap keeps the RECENT end of each series.
        // Ascending with a limit would return a year-old head and no trend.
        .order('date', { ascending: false })
        .limit(MAX_POINTS * wanted.length)

      if (error) throw error

      for (const r of (data ?? []) as any[]) {
        const close = Number(r.close)
        // A zero or missing close is not a price. Dropping it here keeps the
        // "0 standing in for unknown" case out of every chart downstream.
        if (!Number.isFinite(close) || close <= 0 || !r.date) continue
        const sym = String(r.symbol).toUpperCase()
        const list = out.get(sym) ?? []
        if (list.length >= MAX_POINTS) continue
        list.push({ date: String(r.date), close })
        out.set(sym, list)
      }

      // Fetched descending, drawn ascending.
      for (const [, list] of out) list.reverse()

      // A single close cannot be a line. Drop those series rather than letting
      // each consumer decide, so "no chart" means the same thing everywhere.
      for (const [sym, list] of [...out]) if (list.length < 2) out.delete(sym)

      return out
    },
  })
}
