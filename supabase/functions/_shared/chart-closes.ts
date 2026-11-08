/**
 * Which rows of a Yahoo chart response may be written to
 * `price_history_cache`, and as what.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 *
 * `price_history_cache` is the product's canonical stored market price, and
 * the trust anchor for the trade-price gate: a price whose basis is
 * `stored_close` is accepted as dated and sourced precisely because it came
 * from this table. Until now the rows for an uncached symbol were written by
 * the BROWSER -- two upserts in `src/hooks/usePositionLifecycle.ts` -- under
 * the RLS policy "Users can insert price history", whose entire check was
 * `auth.uid() IS NOT NULL`. Measured against production on 2026-11-07: any
 * logged-in user of any organisation could insert any (symbol, date) that did
 * not already exist, and the newest real close was 2026-11-06, so every later
 * date was free.
 *
 * The data itself was never the problem -- it already comes from Yahoo through
 * this function, server-side. Only the authority to write it was in the wrong
 * place. So the write moves here, behind the same verified-user gate
 * `market-events` and `market-news` use, and the client policy goes away.
 *
 * ── Why the filtering is strict, and here ────────────────────────────────
 *
 * Moving a write server-side does not make its contents true. This function
 * forwards whatever `query1.finance.yahoo.com` returns, and that response is
 * untrusted input: the symbol is caller-chosen, and a wrong or hostile
 * upstream payload must not be able to produce a row the gate would trust.
 *
 * The rules below are each one test case in `chart-closes.test.ts`:
 *
 *   - DAILY ONLY. An intraday bar is not a daily close, and a 1m bar's
 *     timestamp truncated to a date would overwrite nothing but would claim
 *     to be that day's close. Anything but `interval === '1d'` yields no rows.
 *   - NEVER A FUTURE DATE. This is the shape of the hole being closed: a close
 *     dated after every real one reads as the most current price in the table.
 *     A bar dated after `today` is dropped even though Yahoo sent it.
 *   - A CLOSE MUST BE A POSITIVE FINITE NUMBER. Yahoo pads its arrays with
 *     nulls for non-trading slots, and `null` would become a row the gate
 *     reads as a price.
 *   - ONE ROW PER DATE, and a bounded number of rows.
 *
 * Deliberately free of Deno, network and createClient APIs, like
 * `verified-user.ts` and `publishable-key.ts`: the caller passes the payload
 * and the clock, so this is exercised directly from vitest.
 */

/** A row as `price_history_cache` stores it. */
export interface DailyClose {
  symbol: string
  date: string
  close: number
  source: string
}

/**
 * Distinguishable from the nightly job's `yahoo_chart_v8` and from the legacy
 * browser writes' `yahoo_finance`, so a row's provenance stays answerable
 * after the fact. CLAUDE.md: any figure surfaced to a user must be traceable
 * to its source.
 */
export const CHART_PROXY_SOURCE = 'yahoo_chart_v8_edge'

/** A single response is one symbol's history; a year of daily bars is ~252. */
export const MAX_ROWS = 4000

/** `YYYY-MM-DD` in UTC, which is how `price_history_cache.date` is keyed. */
const toIsoDate = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10)

/**
 * Extract the daily closes that may be persisted from a Yahoo chart payload.
 *
 * @param symbol   the symbol requested, which is what the cache is keyed on
 * @param interval the interval requested; only `1d` yields rows
 * @param payload  the raw Yahoo response, treated as untrusted
 * @param today    `YYYY-MM-DD`; no row may be dated after it
 */
export function dailyClosesFromYahooChart(
  symbol: string,
  interval: string,
  payload: unknown,
  today: string,
): DailyClose[] {
  if (interval !== '1d') return []

  const normalizedSymbol = (symbol ?? '').trim().toUpperCase()
  if (!normalizedSymbol) return []

  const result = (payload as {
    chart?: { result?: Array<{
      timestamp?: unknown
      indicators?: { quote?: Array<{ close?: unknown }> }
    }> }
  } | null)?.chart?.result?.[0]

  const timestamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return []

  // Last value wins per date, which matches the order Yahoo returns bars in
  // and keeps the newest reading of a day that appears twice.
  const byDate = new Map<string, number>()

  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    const close = closes[i]
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue

    const date = toIsoDate(ts)
    // String comparison is correct for YYYY-MM-DD and avoids a timezone
    // round-trip through Date for the one comparison that matters most.
    if (date > today) continue

    byDate.set(date, close)
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_ROWS)
    .map(([date, close]) => ({
      symbol: normalizedSymbol,
      date,
      close,
      source: CHART_PROXY_SOURCE,
    }))
}
