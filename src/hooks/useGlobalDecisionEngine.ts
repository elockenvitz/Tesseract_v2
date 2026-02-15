/**
 * useGlobalDecisionEngine — Data hook for the dashboard.
 *
 * Fetches all data needed by the engine, scoped to the current user's
 * coverage (portfolio membership + asset holdings), runs the pure engine,
 * and returns results for the Action Queue and Intelligence Radar.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import {
  runGlobalDecisionEngine,
  type GlobalDecisionEngineResult,
} from '../engine/decisionEngine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseGlobalDecisionEngineResult {
  result: GlobalDecisionEngineResult | null
  isLoading: boolean
  isError: boolean
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGlobalDecisionEngine(): UseGlobalDecisionEngineResult {
  const { user } = useAuth()
  const userId = user?.id

  // ---- 1. Fetch user's portfolio coverage ----
  const { data: coverage, isLoading: coverageLoading } = useQuery({
    queryKey: ['decision-engine-coverage', userId],
    queryFn: async () => {
      if (!userId) return { portfolioIds: [], assetIds: [] }

      // Portfolios where user is owner or team member
      const [ownedRes, teamRes] = await Promise.all([
        supabase
          .from('portfolios')
          .select('id')
          .eq('created_by', userId),
        supabase
          .from('portfolio_team')
          .select('portfolio_id')
          .eq('user_id', userId),
      ])

      const portfolioIds = [
        ...(ownedRes.data?.map(p => p.id) ?? []),
        ...(teamRes.data?.map(t => t.portfolio_id) ?? []),
      ]
      const uniquePortfolioIds = [...new Set(portfolioIds)]

      // Assets held in those portfolios
      let assetIds: string[] = []
      if (uniquePortfolioIds.length > 0) {
        const { data: holdings } = await supabase
          .from('portfolio_holdings')
          .select('asset_id')
          .in('portfolio_id', uniquePortfolioIds)
        assetIds = [...new Set(holdings?.map(h => h.asset_id) ?? [])]
      }

      return { portfolioIds: uniquePortfolioIds, assetIds }
    },
    enabled: !!userId,
    staleTime: 300_000, // 5 min
  })

  // ---- 2. Fetch trade ideas (scoped to user's portfolios) ----
  const { data: tradeIdeas, isLoading: ideasLoading } = useQuery({
    queryKey: ['decision-engine-ideas', userId, coverage?.portfolioIds],
    queryFn: async () => {
      if (!coverage?.portfolioIds?.length) return []

      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          id, asset_id, portfolio_id, action, stage, rationale,
          decision_outcome, decided_at, outcome, outcome_at,
          visibility_tier, created_by, created_at, updated_at,
          assets:asset_id (id, symbol, company_name),
          portfolios:portfolio_id (id, name)
        `)
        .in('portfolio_id', coverage.portfolioIds)
        .eq('visibility_tier', 'active')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      return (data || []).map((d: any) => ({
        ...d,
        asset_symbol: d.assets?.symbol,
        portfolio_name: d.portfolios?.name,
      }))
    },
    enabled: !!coverage?.portfolioIds?.length,
    staleTime: 60_000,
  })

  // ---- 3. Fetch proposals (lab variants + trade proposals) ----
  const { data: proposals, isLoading: proposalsLoading } = useQuery({
    queryKey: ['decision-engine-proposals', userId, coverage?.portfolioIds],
    queryFn: async () => {
      if (!coverage?.portfolioIds?.length) return []

      const { data, error } = await supabase
        .from('lab_variants')
        .select('id, trade_queue_item_id, asset_id')
        .not('trade_queue_item_id', 'is', null)
        .limit(200)

      if (error) throw error
      return data || []
    },
    enabled: !!coverage?.portfolioIds?.length,
    staleTime: 120_000,
  })

  // ---- 4. Fetch rating changes ----
  const { data: ratingChanges, isLoading: ratingsLoading } = useQuery({
    queryKey: ['decision-engine-ratings', userId, coverage?.assetIds],
    queryFn: async () => {
      if (!coverage?.assetIds?.length) return []

      // Get user's ratings
      const { data: ratings } = await supabase
        .from('analyst_ratings')
        .select('id, asset_id, user_id, updated_at')
        .in('asset_id', coverage.assetIds.slice(0, 50)) // limit to avoid huge IN clause

      if (!ratings?.length) return []

      // Get recent history
      const ratingIds = ratings.map(r => r.id)
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

      const { data: history } = await supabase
        .from('analyst_rating_history')
        .select(`
          id, rating_id, field_name, old_value, new_value,
          changed_by, changed_at
        `)
        .in('rating_id', ratingIds)
        .eq('field_name', 'rating_value')
        .gte('changed_at', sevenDaysAgo)
        .order('changed_at', { ascending: false })
        .limit(20)

      if (!history?.length) return []

      // Enrich with asset info
      const ratingMap = new Map(ratings.map(r => [r.id, r]))
      return history.map(h => {
        const rating = ratingMap.get(h.rating_id)
        return {
          ...h,
          asset_id: rating?.asset_id,
          asset_symbol: '', // will be enriched below
        }
      })
    },
    enabled: !!coverage?.assetIds?.length,
    staleTime: 120_000,
  })

  // ---- 5. Fetch thesis staleness ----
  const { data: thesisUpdates, isLoading: thesisLoading } = useQuery({
    queryKey: ['decision-engine-thesis', userId, coverage?.assetIds],
    queryFn: async () => {
      if (!coverage?.assetIds?.length) return []

      const { data, error } = await supabase
        .from('asset_contributions')
        .select(`
          asset_id, section, updated_at, created_by,
          assets:asset_id (id, symbol)
        `)
        .in('asset_id', coverage.assetIds.slice(0, 50))
        .eq('section', 'thesis')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })

      if (error) throw error

      // Deduplicate: keep most recent per asset
      const byAsset = new Map<string, any>()
      for (const row of data || []) {
        if (!byAsset.has(row.asset_id)) {
          byAsset.set(row.asset_id, {
            ...row,
            asset_symbol: (row as any).assets?.symbol,
          })
        }
      }
      return Array.from(byAsset.values())
    },
    enabled: !!coverage?.assetIds?.length,
    staleTime: 300_000,
  })

  // ---- 6. Fetch projects with deliverables ----
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['decision-engine-projects', userId],
    queryFn: async () => {
      if (!userId) return []

      // Get projects assigned to user
      const { data: assignments } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('assigned_to', userId)

      if (!assignments?.length) return []

      const projectIds = assignments.map(a => a.project_id)
      const { data: projectData } = await supabase
        .from('projects')
        .select('id, name, status, priority')
        .in('id', projectIds)
        .in('status', ['planning', 'in_progress', 'blocked'])

      if (!projectData?.length) return []

      // Get deliverables for those projects
      const { data: deliverables } = await supabase
        .from('project_deliverables')
        .select('id, project_id, title, due_date, completed, status, created_at')
        .in('project_id', projectData.map(p => p.id))
        .eq('completed', false)

      // Attach deliverables to projects
      const deliverablesByProject = new Map<string, any[]>()
      for (const d of deliverables || []) {
        const list = deliverablesByProject.get(d.project_id) || []
        list.push(d)
        deliverablesByProject.set(d.project_id, list)
      }

      return projectData.map(p => ({
        ...p,
        deliverables: deliverablesByProject.get(p.id) || [],
      }))
    },
    enabled: !!userId,
    staleTime: 120_000,
  })

  // ---- 7. Run engine ----
  const result = useMemo<GlobalDecisionEngineResult | null>(() => {
    if (!userId || coverageLoading) return null

    return runGlobalDecisionEngine({
      userId,
      role: 'analyst', // default; extend if role data available
      coverage: {
        assetIds: coverage?.assetIds ?? [],
        portfolioIds: coverage?.portfolioIds ?? [],
      },
      data: {
        tradeIdeas: tradeIdeas ?? [],
        proposals: proposals ?? [],
        ratingChanges: ratingChanges ?? [],
        thesisUpdates: thesisUpdates ?? [],
        projects: projects ?? [],
        // Skip: catalysts, prompts, recurrentWorkflows (not in data model)
      },
    })
  }, [userId, coverage, tradeIdeas, proposals, ratingChanges, thesisUpdates, projects, coverageLoading])

  const isLoading = coverageLoading || ideasLoading || proposalsLoading ||
    ratingsLoading || thesisLoading || projectsLoading

  return {
    result,
    isLoading,
    isError: false,
  }
}
