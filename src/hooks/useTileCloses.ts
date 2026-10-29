/**
 * The stored daily closes a tile draws its price against.
 *
 * ── Why not `usePriceHistory` ─────────────────────────────────────────────
 *
 * That hook calls the `yahoo-chart-proxy` edge function -- a live network
 * fetch. It is unreachable in local development ("quote function unreachable:
 * network refused" in the console), so it returned an empty series and a
 * tile's whole price column rendered blank.
 *
 * `price_history_cache` is the product's canonical STORED market price: dated
 * daily closes, backfilled nightly, and already what Research, Today, Ideas
 * and `lib/outcomes/current-price` measure against. A plain table read works
 * wherever the app works, and every point carries the date a chart needs to
 * name it.
 *
 * ── Shared on purpose ─────────────────────────────────────────────────────
 *
 * This began life in the Decisions lens. It is keyed by symbol alone with a
 * five-minute staleTime, so a gallery of tiles on the same name shares one
 * request, and so do two lenses asking at once. Every lens that wants a
 * sparkline reads it from here rather than growing its own fetch -- a second
 * price source is how two surfaces end up disagreeing about the same trade.
 *
 * RLS posture: unchanged. `price_history_cache` is market data keyed by
 * symbol, read under its existing policy; nothing here is org-scoped because
 * a close is not.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  bySymbol, chunkFor, fetchDailyCloses, fetchYearRange, type YearRange,
} from '../lib/market-data/daily-closes'

export type { YearRange }

/** A dated close, in the shape the tile charts consume. */
export interface TileClose {
  date: Date
  value: number
}

/**
 * How much history a TILE chart is drawn from.
 *
 * Half a year, not the whole table. `useTileCloses` asked for every stored
 * close with no lower bound, which on a long-listed name is years of daily
 * rows fetched to draw a 92px sparkline -- and, with no bound, a request
 * that will one day cross the 1000-row cap and start silently dropping its
 * most recent closes, which is the defect `daily-closes` exists to prevent.
 *
 * Six months is what a tile-sized plot can actually resolve, and it keeps
 * the per-request symbol count high enough for the gallery to load in a
 * dozen parallel requests rather than one per tile.
 */
export const TILE_HISTORY_DAYS = 180

const toTileCloses = (rows: readonly { date: string; close: number }[]): TileClose[] =>
  rows
    .map(r => ({ date: new Date(r.date), value: Number(r.close) }))
    // A null close and an unparseable date are both unusable, and a chart
    // that silently treats them as zero draws a cliff.
    .filter(p => Number.isFinite(p.value) && !Number.isNaN(p.date.getTime()))

/**
 * Every symbol in a gallery, in ONE batched read.
 *
 * ── The loading this replaces ─────────────────────────────────────────────
 *
 * The Ideas gallery called `useTileCloses` per tile. Measured at 1920x889
 * with 56 tiles, that is 56 separate round trips, each asking for a whole
 * symbol's history, each resolving on its own schedule -- and each arrival
 * turning that tile from one panel into two, which CHANGES ITS HEIGHT and
 * moves every tile below it in the column. The reader watched the grid
 * reassemble under the cursor for several seconds.
 *
 * One query set, one `status`, so the field can wait and paint once --
 * which is the same answer Today reached for the same symptom.
 */
export function useGalleryCloses(symbols: readonly (string | null | undefined)[]) {
  const wanted = useMemo(
    () => [...new Set(symbols.filter((s): s is string => !!s))].sort(),
    [symbols],
  )
  const key = wanted.join('|')

  const { data, status } = useQuery<Map<string, TileClose[]>>({
    queryKey: ['gallery-closes', key],
    enabled: wanted.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = await fetchDailyCloses(wanted, {
        days: TILE_HISTORY_DAYS,
        chunk: chunkFor(TILE_HISTORY_DAYS),
      })
      const out = new Map<string, TileClose[]>()
      for (const [symbol, list] of bySymbol(rows)) out.set(symbol, toTileCloses(list))
      return out
    },
  })

  return {
    map: data ?? new Map<string, TileClose[]>(),
    /* False the moment the query resolves OR fails, and false immediately
       when there is nothing to fetch -- a bounded term, so a field gated on
       it cannot hang on a market-data outage. */
    pending: wanted.length > 0 && status === 'pending',
  }
}

/**
 * The trailing-year high and low, for the few cards that draw a range.
 *
 * Separate from `useGalleryCloses` on purpose: a year is twice the window the
 * sparklines need, and the chunk size is `floor(1000 / days)` by
 * construction, so widening the field's own fetch would take it from ~12
 * requests to ~28 for a figure five tiles use. The caller passes only the
 * symbols that actually draw a scenario axis.
 *
 * NOT gated on by the field's skeleton. The scenario card is complete without
 * these marks -- they are context on an axis that already states the finding
 * -- so they arrive when they arrive rather than holding fifty-six tiles
 * shut on a second request.
 *
 * RLS posture: unchanged, and identical to the hook above. Same table, same
 * existing read policy, no org scope, no new grant.
 */
export function useYearRanges(symbols: readonly (string | null | undefined)[]) {
  const wanted = useMemo(
    () => [...new Set(symbols.filter((s): s is string => !!s))].sort(),
    [symbols],
  )
  const key = wanted.join('|')

  const { data } = useQuery<Map<string, YearRange>>({
    queryKey: ['gallery-year-range', key],
    enabled: wanted.length > 0,
    // An extreme over a year does not move the way a last price does.
    staleTime: 30 * 60_000,
    queryFn: () => fetchYearRange(wanted),
  })

  return data ?? new Map<string, YearRange>()
}

export function useTileCloses(symbol: string | null | undefined) {
  return useQuery<TileClose[]>({
    queryKey: ['tile-closes', symbol],
    enabled: !!symbol,
    // Closes move once a day; this is a gallery of tiles asking at once.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_history_cache')
        .select('date, close')
        .eq('symbol', symbol!)
        .order('date', { ascending: true })
      if (error) throw new Error(error.message)

      return (data ?? [])
        .map((r: { date: string; close: number | string | null }) => ({
          date: new Date(r.date),
          value: Number(r.close),
        }))
        // A null close and an unparseable date are both unusable, and a
        // chart that silently treats them as zero draws a cliff.
        .filter(p => Number.isFinite(p.value) && !Number.isNaN(p.date.getTime()))
    },
  })
}

/**
 * The name the Decisions lens has used since this hook was introduced.
 * Kept so that lens, and the test that mocks it, need not change in the same
 * pass that generalises the hook.
 */
export const useDecisionTileCloses = useTileCloses
