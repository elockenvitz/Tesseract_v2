/**
 * The recents list, re-checked against live authorization before it is shown.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * `lib/charting/recent-instruments` persists the list to disk, scoped
 * `userId:orgId`. That scoping stops another ACCOUNT reading it. It does not
 * stop the SAME account seeing an instrument it has since lost access to:
 * the row was authorized when it was written, and localStorage has no idea
 * that anything changed afterwards.
 *
 * Access can be withdrawn between one visit and the next -- the asset is
 * deleted, the person is removed from the organization that could see it, or
 * a policy is narrowed. The stored copy of the ticker and company name would
 * go on being offered regardless, and the only thing standing between the
 * reader and it would be a cache they control.
 *
 * So the ids are read back through `assets` on every mount. RLS answers the
 * question -- rows the caller may no longer select simply do not come back
 * -- and anything absent from the answer is dropped from both the list and
 * storage. The names are refreshed from the same response, so a renamed
 * company stops showing its old name too.
 *
 * ── It fails CLOSED ──────────────────────────────────────────────────────
 *
 * If the validation query ERRORS, this returns an empty list rather than the
 * cached one. That is deliberate and it is the less convenient choice: the
 * picker is empty when the network is down, even though the entries were
 * legitimately authorized when written.
 *
 * It is the right one here because the alternative is a list whose
 * authorization check can be defeated by making the check fail. Storage is
 * left INTACT on error, so a later successful validation restores the list
 * in full -- the failure is a blank panel, not data loss.
 *
 * An error and an empty result are kept distinct for exactly this reason: a
 * query that failed is not a firm with no instruments.
 *
 * RLS posture: this is the enforcement point, not a bypass of one. It reads
 * `assets` through the same policy the symbol search uses, selecting the
 * same three columns, filtered to ids the caller already holds. It can
 * return no row that the policy would not already have returned.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  readRecentInstruments,
  writeRecentInstruments,
  type RecentInstrument,
} from '../lib/charting/recent-instruments'

export interface RecentInstrumentsState {
  /** Authorized entries only. Empty while loading, and empty on error. */
  recents: RecentInstrument[]
  isLoading: boolean
  /** True when the check could not be completed, so nothing is shown. */
  isError: boolean
}

/**
 * Validate a stored list against what the caller may currently read.
 *
 * Exported for the test, which needs to drive it without a renderer.
 */
export async function authorizeRecents(
  stored: RecentInstrument[],
): Promise<RecentInstrument[]> {
  if (stored.length === 0) return []

  /*
   * Annotated explicitly: the generated Supabase types do not describe
   * `assets`, so an unannotated destructure infers `never` and every field
   * read below becomes an error. This names the three columns the select
   * actually asks for rather than widening to `any`.
   */
  const { data, error } = (await supabase
    .from('assets')
    .select('id, symbol, company_name')
    .in('id', stored.map(r => r.id))) as {
      data: Array<{ id: string; symbol: string | null; company_name: string | null }> | null
      error: { message: string } | null
    }

  /* Thrown, not swallowed into `[]`. The caller distinguishes "you may see
     nothing" from "the question could not be answered", and `data || []`
     here is precisely how those two became one elsewhere in this codebase. */
  if (error) throw error

  const live = new Map((data ?? []).map(row => [row.id, row]))

  /* Rebuilt in the STORED order, so re-authorizing does not reshuffle a list
     whose whole value is that the most recent is first. */
  return stored
    .filter(entry => live.has(entry.id))
    .map(entry => {
      const row = live.get(entry.id)!
      return {
        id: entry.id,
        /* Refreshed from the server: a ticker change or a rename shows the
           current value rather than the one captured at selection. */
        symbol: row.symbol ?? entry.symbol,
        companyName: row.company_name ?? null,
      }
    })
}

export function useRecentInstruments(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): RecentInstrumentsState {
  const { data, isLoading, isError } = useQuery({
    /*
     * Keyed on the principal, so an organization switch re-validates rather
     * than serving the previous organization's answer from the React Query
     * cache -- the cache-shaped version of the same leak.
     */
    queryKey: ['charting-recents', userId ?? null, orgId ?? null],
    queryFn: async () => {
      const stored = readRecentInstruments(userId, orgId)
      const authorized = await authorizeRecents(stored)
      /* Persist the pruned list so a revoked entry does not sit on disk
         waiting for the next validation to fail open. Only on SUCCESS --
         an error must not be able to delete the list. */
      if (authorized.length !== stored.length) {
        writeRecentInstruments(userId, orgId, authorized)
      }
      return authorized
    },
    enabled: !!userId,
    staleTime: 60_000,
    retry: false,
  })

  return {
    recents: isError ? [] : (data ?? []),
    isLoading,
    isError,
  }
}
