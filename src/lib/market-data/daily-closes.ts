/**
 * Dated daily closes for MANY symbols at once, without the silent truncation.
 *
 * ── The bug this exists to make unrepeatable ──────────────────────────────
 *
 * PostgREST answers at most 1000 rows. A surface that asks for every name's
 * history in one `.in('symbol', symbols)` query ordered by date ASCENDING
 * hits that cap as soon as it holds a handful of names -- and because the
 * sort is ascending, the rows it drops are the NEWEST ones. Nothing fails.
 * The surface simply draws, and does arithmetic on, a price from weeks ago.
 *
 * Measured against production on 2026-10-27, Today's own version of this
 * query: five symbols x 258 closes = 1290 rows available, 1000 returned, so
 * the last close it could see was 2026-07-10 while the real last close was
 * 2026-10-01. TSLA read +7.1% on Today and -7.0% on the asset page, about
 * the same name on the same day, because the asset page queries one symbol
 * at a time and never reached the cap.
 *
 * ── The discipline ────────────────────────────────────────────────────────
 *
 * Make the cap unreachable BY CONSTRUCTION rather than raise a limit and
 * hope: ask for at most `chunkFor(days)` symbols per request, sized so that a
 * close on every single calendar day of the window still cannot fill the
 * response. Then CHECK the invariant held -- a response at the cap throws
 * rather than quietly shaving the recent end off every chart again.
 *
 * ── Why this is a lib and not a hook's helper ─────────────────────────────
 *
 * It was a private function inside `useTodayEnrichment`. When the Ideas
 * gallery needed the same thing, the choices were to import a Today hook
 * from an Ideas component, or to write the query again -- and writing it
 * again is precisely how the cap bug would have spread to a third surface.
 * Window length is the caller's (Today needs 400 days to reach a review
 * anchor; a tile sparkline needs far less), the SAFETY is not.
 *
 * RLS posture: unchanged. `price_history_cache` is market data keyed by
 * symbol, read under its existing policy. It carries no org column by
 * design -- a close is not one desk's -- which is the documented global
 * reference-data exception to the tenant rule.
 */

import { supabase } from '../supabase'

/** What PostgREST will return at most, whatever we ask for. */
export const ROW_CAP = 1000

/** A dated close, as stored. */
export interface DailyClose {
  symbol: string
  date: string
  close: number
}

/**
 * How many symbols may share one request for a window of `days`.
 *
 * One close per calendar day is the worst case the table can hold, so
 * `days * chunk < ROW_CAP` guarantees the response cannot be truncated.
 */
export function chunkFor(days: number): number {
  return Math.max(1, Math.floor(ROW_CAP / Math.max(1, days)))
}

/** The ISO date `days` ago, which is what `.gte('date', …)` wants. */
export function floorFor(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

export async function fetchDailyCloses(
  symbols: readonly string[],
  { days, chunk = chunkFor(days) }: { days: number; chunk?: number },
): Promise<DailyClose[]> {
  const unique = [...new Set(symbols)]
  if (unique.length === 0) return []
  const floor = floorFor(days)

  const groups: string[][] = []
  for (let i = 0; i < unique.length; i += chunk) groups.push(unique.slice(i, i + chunk))

  const pages = await Promise.all(groups.map(async group => {
    const { data, error } = await supabase
      .from('price_history_cache')
      .select('symbol, date, close')
      .in('symbol', group)
      .gte('date', floor)
      .order('date', { ascending: true })
    if (error) throw error
    const rows = (data ?? []) as DailyClose[]
    /*
     * The invariant, checked rather than assumed. A full page means the cap
     * was reached, which means this page is missing its most recent closes --
     * the exact silent failure above.
     */
    if (rows.length >= ROW_CAP) {
      throw new Error(
        `price_history_cache truncated at ${rows.length} rows for ${group.join(',')}: `
        + 'the chunk size no longer guarantees a complete window.',
      )
    }
    return rows
  }))

  return pages.flat()
}

/** A trailing-year extreme, with the window it was actually measured over. */
export interface YearRange {
  high: number
  low: number
  /** Oldest close that fed it. The claim is only as old as the data. */
  from: string
  /** Newest. `price_history_cache` is a cache and can be weeks stale. */
  to: string
  /** How many closes were behind it. */
  points: number
}

/** Calendar days in the trailing-year window. */
export const YEAR_DAYS = 365

/**
 * Whether a window may be called "52 week".
 *
 * `price_history_cache` is a CACHE. Queried on 2026-10-28, the deepest
 * symbol held 361 closes ending 2026-10-01 -- four weeks stale -- and most
 * symbols held well under a year. A high taken over eight months of closes
 * ending a month ago is a real number, but it is not the number the words
 * "52-week high" promise, and this codebase does not surface a figure that
 * cannot be traced to what produced it.
 *
 * So the mark is drawn only when the window genuinely covers it:
 *
 *   300 days of span   a year is about 252 sessions; 300 calendar days
 *                      leaves room for holidays and a short tail without
 *                      accepting a half-year
 *   180 points         a window with forty closes in it has gaps wide
 *                      enough to miss the extreme entirely
 *   45 days of lag     the cache may trail, but not by a quarter
 *
 * A card that fails any term draws the axis it drew before. Silence is the
 * correct output for a figure that cannot be stood behind.
 */
export function fitsTheLabel(y: YearRange, now: number = Date.now()): boolean {
  const from = Date.parse(y.from)
  const to = Date.parse(y.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false
  const DAY = 86_400_000
  return (to - from) / DAY >= 300
    && y.points >= 180
    && (now - to) / DAY <= 45
    && y.high > y.low
}

/**
 * The 52-week high and low, from the same cache everything else reads.
 *
 * ── Why this is its own call and not a wider window on the field ──────────
 *
 * The gallery fetches 180 days for its sparklines, and a year is twice that.
 * The chunk size is `floor(1000 / days)` by construction -- the only thing
 * standing between this cache and the silent truncation that bit Today -- so
 * a year drops it from 5 symbols a request to 2, and a 56-name field would go
 * from ~12 requests to ~28 to serve a figure that only the scenario cards
 * draw. Measured on the live field: 5 of 56 tiles.
 *
 * So the year is fetched for THOSE symbols only, which is three requests.
 *
 * ── Provenance ────────────────────────────────────────────────────────────
 *
 * `from`/`to` come back with the number because the cache is a cache: it can
 * be weeks behind, and a "52-week high" computed over eleven months of stale
 * closes is a different claim from the one the label makes. The caller
 * decides whether the window it got is one it is willing to name.
 *
 * These are CLOSES, not intraday extremes. A true 52-week high is the highest
 * price traded; this is the highest price at which a session settled, and it
 * is what the only series this app has can support.
 */
export async function fetchYearRange(
  symbols: readonly string[],
): Promise<Map<string, YearRange>> {
  const rows = await fetchDailyCloses(symbols, { days: YEAR_DAYS })
  const out = new Map<string, YearRange>()
  for (const [symbol, list] of bySymbol(rows)) {
    const closes = list.map(r => Number(r.close)).filter(Number.isFinite)
    if (closes.length < 2) continue
    out.set(symbol, {
      high: Math.max(...closes),
      low: Math.min(...closes),
      // `bySymbol` sorted the list, so the ends are the window.
      from: list[0].date,
      to: list[list.length - 1].date,
      points: closes.length,
    })
  }
  return out
}

/** Closes grouped by symbol, each oldest-first. */
export function bySymbol(rows: readonly DailyClose[]): Map<string, DailyClose[]> {
  const out = new Map<string, DailyClose[]>()
  for (const row of rows) {
    const list = out.get(row.symbol)
    if (list) list.push(row)
    else out.set(row.symbol, [row])
  }
  // Chunked requests come back in whatever order they resolve, so the order
  // within a symbol is only guaranteed once it is sorted here.
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date))
  return out
}
