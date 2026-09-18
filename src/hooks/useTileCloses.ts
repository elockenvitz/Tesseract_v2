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
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/** A dated close, in the shape the tile charts consume. */
export interface TileClose {
  date: Date
  value: number
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
