import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'

/**
 * Display ticker → the ticker the instrument trades under now.
 *
 * ── Why this exists as its own thing ──────────────────────────────────────
 *
 * `price_history_cache` is keyed by what the instrument trades as TODAY, while
 * cards say what the holdings file said — rewriting that would make old uploads
 * unreconcilable. So Block is `SQ` on the card and `XYZ` in the cache, and Zoom
 * is `ZOOM` on the card and `ZM` in the cache. Both are correct; they are
 * answers to different questions.
 *
 * The mapping was already in the database and already right: eight assets carry
 * a `current_symbol` that differs from `symbol`, with `lifecycle_status`
 * `renamed`. What was missing was any code path that used it outside the
 * active-risk lens, which is the only one that selected the column. Everything
 * else — the Explore tiles, the case cards, the ladder — asked the cache for
 * the display ticker and got nothing back, and an empty series renders as no
 * chart. It reads exactly like missing data, which is what I first took it for.
 *
 * ── Why here and not at each call site ────────────────────────────────────
 *
 * There was already one resolver, built against a single lens's rows, and the
 * comment above it records that the mapping had briefly existed in two places
 * and the two had disagreed. Threading a `tradedSymbol` through every lens,
 * adapter and card is the same shape of mistake with more copies.
 *
 * `useSymbolHistory` is the single door to the cache. Resolving there fixes
 * every caller at once and leaves nothing to thread.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * Eight rows, one request, deduplicated by React Query across every chart on
 * the screen and effectively permanent — a ticker rename is a corporate action,
 * not a data refresh.
 */

/** A day. Renames are corporate actions; nothing here changes hourly. */
const STALE_MS = 24 * 60 * 60 * 1000

export type TickerAliases = Map<string, string>

export function useTickerAliases() {
  return useQuery<TickerAliases>({
    queryKey: ['ticker-aliases'],
    staleTime: STALE_MS,
    gcTime: STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('symbol, current_symbol')
        .not('current_symbol', 'is', null)
      /**
       * Logged, not thrown.
       *
       * A failure here means renamed instruments show no chart, which is what
       * happens today anyway. Rejecting would take every OTHER chart down with
       * it, since this gates the series query — a strictly worse outcome than
       * the one it is fixing.
       */
      if (error) {
        console.warn('[prices] ticker aliases unavailable', error)
        return new Map()
      }
      const out: TickerAliases = new Map()
      for (const row of (data ?? []) as { symbol: string | null; current_symbol: string | null }[]) {
        const from = row.symbol?.trim().toUpperCase()
        const to = row.current_symbol?.trim().toUpperCase()
        // Only a genuine rename. A `current_symbol` equal to `symbol` is the
        // common case and mapping it would be a no-op entry in every lookup.
        if (from && to && from !== to) out.set(from, to)
      }
      return out
    },
  })
}

/**
 * The ticker to ask the cache for.
 *
 * Idempotent: the traded ticker is never itself a key, so resolving twice is
 * the same as resolving once. That matters because one call site already
 * resolves before calling, and this must not undo or double-apply it.
 */
export function tradedSymbol(
  symbol: string | null | undefined,
  aliases: TickerAliases | undefined,
): string {
  const up = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  if (!up || !aliases) return up
  return aliases.get(up) ?? up
}
