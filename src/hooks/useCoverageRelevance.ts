/**
 * The reader's coverage, as the Ideas pipeline needs it — one hook, both shells.
 *
 * `useMyCoverage` is the write-side hook: it owns declaring and retiring
 * personal coverage and is mounted by CoverageQuickStart. This is the read-side
 * projection the ranking needs, and it exists separately for two reasons.
 *
 * It adds holdings, which are not coverage and must stay a distinct band — the
 * ranking wants to tell "you follow this", "the firm assigned you this" and
 * "it is merely in the book" apart.
 *
 * And it is deliberately cheap to mount anywhere in the feed path: no
 * mutations, no invalidation, nothing that a ranking pass should be able to
 * trigger.
 *
 * Both consumers read THIS. Mobile turns it into `PriorityInput.coverage`;
 * desktop turns it into `scoreFeedItem`'s asset relevance. The two ranking
 * algorithms remain different — see docs/tickets/ideas-ranking-divergence.md —
 * but they no longer disagree about who covers what.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  EMPTY_COVERAGE_INDEX,
  type CoverageIndex,
} from '../lib/signals/coverage-relevance'

interface CoverageRow {
  asset_id: string
  coverage_scope: 'personal' | 'org'
}

export function useCoverageRelevance(): CoverageIndex {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const userId = user?.id ?? null
  const orgId = currentOrgId ?? null

  /**
   * Coverage naming THIS user in THIS organization, both lanes.
   *
   * `user_id = auth.uid()` is what keeps a colleague's coverage out of this
   * reader's relevance — RLS would happily return the whole organization's
   * coverage, because coverage is not secret inside a workspace. The filter is
   * the product decision, not the security boundary.
   *
   * The organization is in the key as well as the filter: a cache entry shared
   * across organizations is the exact shape the org-scope guard exists to
   * catch.
   */
  const coverage = useQuery({
    queryKey: ['coverage-relevance', userId, orgId],
    enabled: !!userId && !!orgId,
    staleTime: 30_000,
    queryFn: async (): Promise<CoverageRow[]> => {
      const { data, error } = await supabase
        .from('coverage')
        .select('asset_id, coverage_scope')
        .eq('user_id', userId!)
        .eq('organization_id', orgId!)
        .eq('is_active', true)
      if (error) throw error
      return (data ?? []) as unknown as CoverageRow[]
    },
  })

  /**
   * Holdings, as a separate and weaker band.
   *
   * Not scoped by organization in the filter because `portfolio_holdings` is
   * reached through portfolios, which RLS already scopes. Mirrors what the
   * desktop feed context does today rather than inventing a second rule.
   */
  const holdings = useQuery({
    queryKey: ['coverage-relevance-holdings', userId, orgId],
    enabled: !!userId && !!orgId,
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        // holdings-audit: safe — builds a Set of asset ids. No sum and no
        // denominator, so a name appearing on several snapshot dates changes
        // nothing.
        .select('asset_id')
      if (error) throw error
      return (data ?? []).map((h: any) => h.asset_id).filter(Boolean)
    },
  })

  return useMemo<CoverageIndex>(() => {
    // Fail safe, not closed: until BOTH queries have answered we report
    // `ready: false`, which `coverageRelevanceFor` turns into `unknown` — a
    // neutral score. A pending query must never look like "you cover nothing".
    if (!userId || !orgId) return EMPTY_COVERAGE_INDEX
    if (coverage.isPending || holdings.isPending) return EMPTY_COVERAGE_INDEX
    if (coverage.isError) return EMPTY_COVERAGE_INDEX

    const direct = new Set<string>()
    const assigned = new Set<string>()
    for (const row of coverage.data ?? []) {
      if (!row.asset_id) continue
      ;(row.coverage_scope === 'personal' ? direct : assigned).add(row.asset_id)
    }

    // Holdings failing is survivable — it only costs the weakest band — so it
    // does not block readiness the way a coverage failure does.
    const held = new Set<string>(holdings.data ?? [])

    return { ready: true, direct, assigned, held }
  }, [userId, orgId, coverage.isPending, coverage.isError, coverage.data, holdings.isPending, holdings.data])
}
