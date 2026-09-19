/**
 * Every holding of every book that holds one of these assets.
 *
 * ── Why this is one hook and not two ─────────────────────────────────────
 *
 * Ideas and Research each need a weight for the names on screen, and a weight
 * cannot be computed from one position: the denominator is the whole book. So
 * both read `portfolio_holdings` twice -- which books hold these names, then
 * every line in those books -- and both had written that same pair of reads
 * out by hand, under two different query keys.
 *
 * Shape-identical code in two places is the drift this codebase keeps paying
 * for elsewhere (see the execute invalidation lists). Worse, the two could not
 * share a cache entry even when they were asking the identical question,
 * because the keys differed by lens rather than by question.
 *
 * The key here is the question -- the sorted asset ids -- so two lenses asking
 * about the same names get one request, and the lenses are left to derive their
 * own shapes from the same rows. Ideas wants rank and the book's distribution;
 * Research wants a single percentage. Those derivations stay where they are.
 *
 * ── RLS posture ──────────────────────────────────────────────────────────
 *
 * Unchanged. This is the same `portfolio_holdings` read both lenses already
 * made, through the same client and the same policies -- moved, not widened.
 * A reader who cannot see a book still gets none of its rows, and the weight
 * simply does not resolve.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { HoldingRow } from '../lib/portfolio/holdings'

export interface HoldingsForAssets {
  rows: HoldingRow[]
  /** False until the first real answer for the CURRENT id list has landed.
   *  Both lenses gate their final geometry on this, because the weight it
   *  produces is a sort input. */
  settled: boolean
}

/** Sorted and de-duplicated, so the key is the question rather than the order
 *  a particular lens happened to produce its ids in. */
export function assetIdKey(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((x): x is string => !!x))].sort()
}

export function useHoldingsForAssets(assetIds: string[]): HoldingsForAssets {
  const ids = useMemo(() => assetIdKey(assetIds), [assetIds])

  const { data, isFetching } = useQuery<HoldingRow[]>({
    // Canonical: not namespaced to a lens, because the answer is not.
    queryKey: ['portfolio-holdings', 'for-assets', ids.join('|')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    /*
     * A holding does not change because a different name joined the list, so
     * the previous rows stay correct for the books they describe. Dropping
     * them to undefined re-sorted both galleries to a weightless order and
     * back again.
     */
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data: mine, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id')
        .in('asset_id', ids)
      if (error) throw new Error(error.message)

      const books = [...new Set(((mine ?? []) as any[]).map(r => r.portfolio_id))]
      if (!books.length) return []

      const { data: rows, error: e2 } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, cost, date')
        .in('portfolio_id', books)
      if (e2) throw new Error(e2.message)

      return (rows ?? []) as unknown as HoldingRow[]
    },
  })

  return {
    rows: data ?? [],
    settled: ids.length === 0 || (data !== undefined && !isFetching),
  }
}
