import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganizationOptional } from '../contexts/OrganizationContext'
import { currentBook, type CurrentBook, type HoldingRow } from '../lib/holdings/portfolio-context'

/**
 * The one current book every decision surface reads.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * "What do we hold right now" was being answered from a different source on
 * every surface: a snapshot frozen on the decision request, a JSONB baseline
 * stored on the simulation, a `current_position` frozen on the lab variant,
 * `portfolio_holdings`, and `portfolio_holdings_positions`. The PM's Decision
 * Inbox read a field nothing writes and fell back to `?? 0`, so 16 of 30
 * pending recommendations told the PM the book held none of the name.
 *
 * A stale baseline is not a cosmetic problem. Every delta framework computes
 * `target = current + delta`, so a wrong `current` produces a wrong target and
 * a wrong share count — and `assertSizingAgreesWithInput` cannot catch it,
 * because for a delta input the computed delta IS the input and agrees with
 * itself no matter what baseline it was added to.
 *
 * ── Why a shared query key ───────────────────────────────────────────────
 *
 * One org-scoped fetch, cached under one key, reused by every caller. Giving
 * each surface its own holdings query is how this table produced 33x read
 * amplification before; `staleTime` plus a single key means N surfaces cost
 * one request, not N.
 *
 * ── Three states, and only one of them is zero ───────────────────────────
 *
 * `weightOf` returns:
 *
 *   number  measured, and the book can support the claim
 *   0       the asset is ABSENT from the book — we genuinely hold none
 *   null    held, but its share is not knowable (no price, or too few
 *           positions for a percentage to mean anything)
 *
 * The defect this replaces collapsed the third case into the second. Callers
 * must render null as "unknown", never as 0.0%.
 */
export function useCurrentBook(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<CurrentBook>({
    queryKey: ['current-book', currentOrgId],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, date, assets(symbol, company_name), portfolios!inner(name, organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
        // Newest first, so a truncating limit drops the OLDEST rows rather
        // than an arbitrary slice. Unordered, `limit` cut a nondeterministic
        // set and the "latest snapshot" became whichever rows survived.
        .order('date', { ascending: false, nullsFirst: false })
        .limit(5000)

      // The date rule is applied inside `currentBook`, not here. Trusting the
      // caller to pre-filter is what produced 22 of 27 drifted query sites.
      return currentBook((data ?? []) as unknown as HoldingRow[])
    },
  })
}

/**
 * Current weight for one (portfolio, asset) pair, preserving all three states.
 *
 * Returns `undefined` while the book has not loaded — distinct from both null
 * and 0, so a surface can show a skeleton rather than asserting "we hold
 * none" before it knows anything.
 */
export function weightOf(
  book: CurrentBook | undefined,
  portfolioId: string | null | undefined,
  assetId: string | null | undefined,
): number | null | undefined {
  if (!book) return undefined
  if (!portfolioId || !assetId) return null
  const position = book.byKey.get(`${portfolioId}:${assetId}`)
  // Absence IS the not-held answer. `portfolio-context` deliberately emits no
  // `held: false` record, because a falsy record is what the next reader
  // renders as 0.0% — which is exactly how a missing lookup became a factual
  // claim about the book.
  if (!position) return 0
  return position.weightPct
}
