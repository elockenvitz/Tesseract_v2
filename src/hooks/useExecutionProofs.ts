/**
 * Execution evidence for a set of committed trades.
 *
 * One read for the whole list, cached, so the Trade Book can qualify every
 * execution claim it renders without a query per row. The grade comes from
 * `portfolio_trade_events` through the caller's own Supabase client, so the
 * RLS already on that table decides what comes back and this adds no new
 * authorization path.
 *
 * ── The failure contract ────────────────────────────────────────────────
 *
 * `unavailable` is true while the read is in flight and after it fails, and
 * it is the whole reason this hook returns more than a Map. An absent entry
 * means two different things:
 *
 *   read succeeded, no entry  → the trade has no execution evidence
 *   read failed, no entry     → we do not know
 *
 * The Trade Book renders those differently, and it has to: a trade whose
 * evidence could not be loaded must not be shown as a trade with no
 * evidence, and neither may be shown as a confirmed fill. The table itself
 * never blocks on this — the phase pill renders from the trade's own columns
 * as it always did, and the evidence badge is additive.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { readExecutionProofs } from '../lib/asset-decisions/execution-evidence'
import type { ExecutionProof } from '../types/decision-timeline'

export interface UseExecutionProofsResult {
  proofs: Map<string, ExecutionProof>
  /** True while loading, and true if the read could not be completed. */
  unavailable: boolean
}

const EMPTY: Map<string, ExecutionProof> = new Map()

export function useExecutionProofs(tradeIds: string[]): UseExecutionProofsResult {
  /*
   * Sorted and de-duplicated, so the cache key is the SET of trades rather
   * than the order the table happens to have them in. Re-sorting the Trade
   * Book must not refetch.
   */
  const ids = useMemo(
    () => Array.from(new Set(tradeIds.filter(Boolean))).sort(),
    [tradeIds],
  )

  const query = useQuery({
    queryKey: ['execution-proofs', ids],
    queryFn: () => readExecutionProofs(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  })

  return {
    proofs: query.data?.proofs ?? EMPTY,
    /*
     * `readExecutionProofs` resolves rather than throwing, so a failure
     * arrives as `data.failed` and not as `query.isError`. Both are checked:
     * the first is the real path, the second covers anything that throws
     * before the reader is reached.
     *
     * An empty id list is NOT unavailable. There is nothing to look up, and
     * reporting a nonexistent problem would badge an empty table.
     */
    unavailable: ids.length > 0
      && (query.isLoading || query.isError || query.data?.failed === true),
  }
}
