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
