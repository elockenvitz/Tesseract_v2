/**
 * useScorecards
 *
 * Hooks for the Scorecards sub-tab of Decision Outcomes.
 *
 * 1. useScorecardVisibility — org setting + current user's role → what they can see
 * 2. useAnalystScorecard — expanded scorecard: price targets + ratings + decisions
 * 3. usePMScorecard — PM-specific: sizing quality, timing, portfolio contribution
 * 4. useTeamMembers — list of org members with PM/analyst classification
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// ─── Types ────────────────────────────────────────────────────

export type ScorecardVisibility = 'open' | 'role_scoped' | 'private'

export type MemberRole = 'pm' | 'analyst' | 'both'

export interface TeamMember {
  userId: string
  firstName: string | null
  lastName: string | null
  email: string
  fullName: string
  role: MemberRole
  portfolioIds: string[] // portfolios where they're PM
}

export interface ScorecardAccess {
  visibility: ScorecardVisibility
  currentUserRole: MemberRole
  /** Can the current user see this specific analyst/PM's scorecard? */
  canViewUser: (targetUserId: string, targetRole: MemberRole) => boolean
  /** Can the current user see the leaderboard? */
  canViewLeaderboard: boolean
  /** Should names be anonymized? */
  anonymize: boolean
  isLoading: boolean
}

export interface AnalystScorecardData {
  userId: string
  userName: string
  // Price target metrics (from analyst_performance_snapshots / price_target_outcomes)
  priceTargets: {
    total: number
    hit: number
    missed: number
    pending: number
    hitRate: number | null
    avgAccuracy: number | null
    avgDaysToHit: number | null
    bullishBias: number | null
    scenarioBreakdown: Record<string, { hit_rate: number | null; count: number; avg_accuracy: number | null }> | null
    overallScore: number | null
  }
  // Rating accuracy (from analyst_ratings + price movement)
  ratings: {
    totalRated: number
    directionalCorrect: number
    directionalHitRate: number | null
    avgHoldingPeriodReturn: number | null
  }
  // Decision outcomes (from trade_queue_items approved/rejected)
  decisions: {
    totalProposed: number
    approved: number
    rejected: number
    approvalRate: number | null
    // Of approved decisions that were executed, how many went the right way?
    executedCorrect: number
    executedTotal: number
    executedHitRate: number | null
  }
  // Composite score
  compositeScore: number | null
}

export interface PMScorecardData {
  userId: string
  userName: string
  portfolioId: string | null
  portfolioName: string | null
  // Decision execution
  totalDecisions: number
  decisionsExecuted: number
  decisionsPending: number
  decisionsMissed: number
  executionRate: number | null
  // Sizing quality
  sizingQualityScore: number | null
  // Timing
  avgExecutionLagDays: number | null
  totalDelayCostBps: number | null
  // Results
  decisionsPositive: number
  decisionsNegative: number
  directionalHitRate: number | null
  // Portfolio contribution
  estimatedAlphaBps: number | null
}

// ─── 1. useScorecardVisibility ────────────────────────────────

export function useScorecardVisibility(): ScorecardAccess {
  const { user } = useAuth()

  // Fetch org visibility setting
  const { data: visibility, isLoading: visLoading } = useQuery({
    queryKey: ['scorecard-visibility', user?.current_organization_id],
    queryFn: async () => {
      if (!user?.current_organization_id) return 'role_scoped' as ScorecardVisibility
      const { data, error } = await supabase
        .from('organization_governance')
        .select('scorecard_visibility')
        .eq('organization_id', user.current_organization_id)
        .maybeSingle()

      if (error || !data) return 'role_scoped' as ScorecardVisibility
      return (data.scorecard_visibility || 'role_scoped') as ScorecardVisibility
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  // Determine if current user is PM on any portfolio
  const { data: currentUserRole, isLoading: roleLoading } = useQuery({
    queryKey: ['current-user-pm-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return 'analyst' as MemberRole
      const { data, error } = await supabase
        .from('portfolio_memberships')
        .select('portfolio_id, is_portfolio_manager')
        .eq('user_id', user.id)

      if (error || !data) return 'analyst' as MemberRole
      const isPM = data.some(m => m.is_portfolio_manager)
      // If they're a PM but also have analyst coverage, they're "both"
      // For simplicity, anyone who is PM on any portfolio gets the PM view
      return isPM ? 'pm' as MemberRole : 'analyst' as MemberRole
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  const vis = visibility || 'role_scoped'
  const role = currentUserRole || 'analyst'

  const canViewUser = (targetUserId: string, _targetRole: MemberRole): boolean => {
    if (!user) return false
    // Always can see your own
    if (targetUserId === user.id) return true

    switch (vis) {
      case 'open':
        return true
      case 'role_scoped':
        // PMs can see all analyst scorecards
        if (role === 'pm') return true
        // Analysts can only see their own
        return false
      case 'private':
        return false
      default:
        return false
    }
  }

  return {
    visibility: vis,
    currentUserRole: role,
    canViewUser,
    canViewLeaderboard: vis === 'open' || (vis === 'role_scoped' && role === 'pm'),
    anonymize: vis === 'role_scoped' && role === 'analyst',
    isLoading: visLoading || roleLoading,
  }
}

// ─── 2. useTeamMembers ────────────────────────────────────────

export function useTeamMembers() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['scorecard-team-members', user?.current_organization_id],
    queryFn: async (): Promise<TeamMember[]> => {
      if (!user?.current_organization_id) return []

      // Get org members
      const { data: members, error: mErr } = await supabase
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', user.current_organization_id)
        .eq('status', 'active')

      if (mErr || !members) return []

      const userIds = members.map(m => m.user_id)
      if (userIds.length === 0) return []

      // Get user details
      const { data: users } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', userIds)

      // Get PM memberships
      const { data: pmMemberships } = await supabase
        .from('portfolio_memberships')
        .select('user_id, portfolio_id, is_portfolio_manager')
        .in('user_id', userIds)
        .eq('is_portfolio_manager', true)

      const pmMap = new Map<string, string[]>()
      for (const pm of pmMemberships || []) {
        const list = pmMap.get(pm.user_id) || []
        list.push(pm.portfolio_id)
        pmMap.set(pm.user_id, list)
      }

      return (users || []).map(u => {
        const portfolioIds = pmMap.get(u.id) || []
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email.split('@')[0]
        return {
          userId: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          email: u.email,
          fullName,
          role: portfolioIds.length > 0 ? 'pm' as MemberRole : 'analyst' as MemberRole,
          portfolioIds,
        }
      })
    },
    enabled: !!user?.current_organization_id,
    staleTime: 5 * 60 * 1000,
  })
}

// ─── 3. useAnalystScorecard ───────────────────────────────────

interface UseAnalystScorecardOptions {
  userId: string
  periodType?: 'monthly' | 'quarterly' | 'yearly' | 'all_time'
}

export function useAnalystScorecard({ userId, periodType = 'all_time' }: UseAnalystScorecardOptions) {
  return useQuery({
    queryKey: ['analyst-scorecard', userId, periodType],
    queryFn: async (): Promise<AnalystScorecardData | null> => {
      // Fetch user info
      const { data: userData } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('id', userId)
        .single()

      const userName = userData
        ? [userData.first_name, userData.last_name].filter(Boolean).join(' ') || userData.email.split('@')[0]
        : 'Unknown'

      // ── Price targets ──
      const { data: ptOutcomes } = await supabase
        .from('price_target_outcomes')
        .select('status, accuracy_pct, days_to_hit, overshoot_pct, scenario_type')
        .eq('user_id', userId)

      const outcomes = ptOutcomes || []
      const ptTotal = outcomes.length
      const ptHit = outcomes.filter(o => o.status === 'hit').length
      const ptMissed = outcomes.filter(o => o.status === 'missed').length
      const ptPending = outcomes.filter(o => o.status === 'pending').length
      const ptResolved = ptHit + ptMissed
      const ptHitRate = ptResolved > 0 ? (ptHit / ptResolved) * 100 : null

      const accuracies = outcomes.filter(o => o.accuracy_pct != null).map(o => Number(o.accuracy_pct))
      const ptAvgAccuracy = accuracies.length > 0 ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null

      const daysToHit = outcomes.filter(o => o.days_to_hit != null).map(o => Number(o.days_to_hit))
      const ptAvgDays = daysToHit.length > 0 ? daysToHit.reduce((a, b) => a + b, 0) / daysToHit.length : null

      const overshoots = outcomes.filter(o => o.overshoot_pct != null).map(o => Number(o.overshoot_pct))
      const ptBias = overshoots.length > 0 ? overshoots.reduce((a, b) => a + b, 0) / overshoots.length : null

      // Scenario breakdown
      const scenarioBreakdown: Record<string, { hit_rate: number | null; count: number; avg_accuracy: number | null }> = {}
      const byScenario = new Map<string, typeof outcomes>()
      for (const o of outcomes) {
        const s = o.scenario_type || 'Unknown'
        const list = byScenario.get(s) || []
        list.push(o)
        byScenario.set(s, list)
      }
      for (const [scenario, items] of byScenario) {
        const sHit = items.filter(o => o.status === 'hit').length
        const sMissed = items.filter(o => o.status === 'missed').length
        const sResolved = sHit + sMissed
        const sAccuracies = items.filter(o => o.accuracy_pct != null).map(o => Number(o.accuracy_pct))
        scenarioBreakdown[scenario] = {
          hit_rate: sResolved > 0 ? (sHit / sResolved) * 100 : null,
          count: items.length,
          avg_accuracy: sAccuracies.length > 0 ? sAccuracies.reduce((a, b) => a + b, 0) / sAccuracies.length : null,
        }
      }

      const ptScore = ptHitRate != null && ptAvgAccuracy != null
        ? ptHitRate * 0.6 + ptAvgAccuracy * 0.4
        : null

      // ── Ratings accuracy ──
      // Get their ratings and compare to subsequent price movement
      const { data: ratings } = await supabase
        .from('analyst_ratings')
        .select('id, asset_id, rating_value, rating_scale_id, created_at, updated_at')
        .eq('user_id', userId)

      let rTotalRated = 0
      let rDirectionalCorrect = 0

      if (ratings && ratings.length > 0) {
        rTotalRated = ratings.length

        // For each rating, check if the asset moved in the expected direction
        // We need the rating scale values to determine bullish/bearish
        const scaleIds = [...new Set(ratings.map(r => r.rating_scale_id))]
        const { data: scales } = await supabase
          .from('rating_scales')
          .select('id, values')
          .in('id', scaleIds)

        const scaleMap = new Map<string, any[]>()
        for (const s of scales || []) {
          scaleMap.set(s.id, s.values || [])
        }

        // Get current prices for rated assets
        const assetIds = [...new Set(ratings.map(r => r.asset_id))]
        const { data: assets } = await supabase
          .from('assets')
          .select('id, current_price')
          .in('id', assetIds)

        const priceMap = new Map<string, number>()
        for (const a of assets || []) {
          if (a.current_price != null) priceMap.set(a.id, Number(a.current_price))
        }

        // Get price at time of rating from price_history_cache
        // This is approximate — we compare rating-time price to current price
        const { data: priceSnapshots } = await supabase
          .from('decision_price_snapshots')
          .select('asset_id, snapshot_price, snapshot_at')
          .in('asset_id', assetIds)
          .order('snapshot_at', { ascending: false })

        const ratingPriceMap = new Map<string, number>()
        for (const ps of priceSnapshots || []) {
          if (!ratingPriceMap.has(ps.asset_id)) {
            ratingPriceMap.set(ps.asset_id, Number(ps.snapshot_price))
          }
        }

        for (const rating of ratings) {
          const scaleValues = scaleMap.get(rating.rating_scale_id) || []
          const ratingDef = scaleValues.find((v: any) => v.value === rating.rating_value)
          if (!ratingDef) continue

          // Determine if bullish or bearish based on sort order
          // Lower sort = more bullish in most scales
          const sortOrder = ratingDef.sort ?? 0
          const midpoint = Math.floor(scaleValues.length / 2)
          const isBullish = sortOrder <= midpoint

          const currentPrice = priceMap.get(rating.asset_id)
          const ratingPrice = ratingPriceMap.get(rating.asset_id)

          if (currentPrice != null && ratingPrice != null && ratingPrice > 0) {
            const priceChange = (currentPrice - ratingPrice) / ratingPrice
            if ((isBullish && priceChange > 0) || (!isBullish && priceChange < 0)) {
              rDirectionalCorrect++
            }
          }
        }
      }

      const rHitRate = rTotalRated > 0 ? (rDirectionalCorrect / rTotalRated) * 100 : null

      // ── Decision outcomes ──
      const { data: decisions } = await supabase
        .from('trade_queue_items')
        .select('id, status, action, asset_id, approved_at, created_by')
        .eq('created_by', userId)
        .in('status', ['approved', 'rejected', 'cancelled'])

      const allDecisions = decisions || []
      const dTotal = allDecisions.length
      const dApproved = allDecisions.filter(d => d.status === 'approved').length
      const dRejected = allDecisions.filter(d => d.status === 'rejected').length
      const dApprovalRate = dTotal > 0 ? (dApproved / dTotal) * 100 : null

      // For approved decisions, check if the price moved in the right direction
      const approvedDecisions = allDecisions.filter(d => d.status === 'approved')
      let dExecutedCorrect = 0
      let dExecutedTotal = 0

      if (approvedDecisions.length > 0) {
        const decisionAssetIds = [...new Set(approvedDecisions.map(d => d.asset_id).filter(Boolean))]
        const { data: decAssets } = await supabase
          .from('assets')
          .select('id, current_price')
          .in('id', decisionAssetIds)

        const decPriceMap = new Map<string, number>()
        for (const a of decAssets || []) {
          if (a.current_price != null) decPriceMap.set(a.id, Number(a.current_price))
        }

        // Get decision-time prices
        const decisionIds = approvedDecisions.map(d => d.id)
        const { data: decSnapshots } = await supabase
          .from('decision_price_snapshots')
          .select('trade_queue_item_id, snapshot_price')
          .in('trade_queue_item_id', decisionIds)
          .eq('snapshot_type', 'approval')

        const decSnapshotMap = new Map<string, number>()
        for (const s of decSnapshots || []) {
          decSnapshotMap.set(s.trade_queue_item_id, Number(s.snapshot_price))
        }

        for (const d of approvedDecisions) {
          if (!d.asset_id) continue
          const currentPrice = decPriceMap.get(d.asset_id)
          const decisionPrice = decSnapshotMap.get(d.id)

          if (currentPrice != null && decisionPrice != null && decisionPrice > 0) {
            dExecutedTotal++
            const priceChange = (currentPrice - decisionPrice) / decisionPrice
            const isBullish = d.action === 'buy' || d.action === 'add'
            if ((isBullish && priceChange > 0) || (!isBullish && priceChange < 0)) {
              dExecutedCorrect++
            }
          }
        }
      }

      const dExecHitRate = dExecutedTotal > 0 ? (dExecutedCorrect / dExecutedTotal) * 100 : null

      // ── Composite score ──
      // Weighted: 40% price targets, 30% ratings, 30% decisions
      const components: { score: number; weight: number }[] = []
      if (ptScore != null) components.push({ score: ptScore, weight: 0.4 })
      if (rHitRate != null) components.push({ score: rHitRate, weight: 0.3 })
      if (dExecHitRate != null) components.push({ score: dExecHitRate, weight: 0.3 })

      let compositeScore: number | null = null
      if (components.length > 0) {
        const totalWeight = components.reduce((s, c) => s + c.weight, 0)
        compositeScore = components.reduce((s, c) => s + c.score * (c.weight / totalWeight), 0)
      }

      // If we have literally no data, return null
      if (ptTotal === 0 && rTotalRated === 0 && dTotal === 0) return null

      return {
        userId,
        userName,
        priceTargets: {
          total: ptTotal,
          hit: ptHit,
          missed: ptMissed,
          pending: ptPending,
          hitRate: ptHitRate,
          avgAccuracy: ptAvgAccuracy,
          avgDaysToHit: ptAvgDays,
          bullishBias: ptBias,
          scenarioBreakdown: Object.keys(scenarioBreakdown).length > 0 ? scenarioBreakdown : null,
          overallScore: ptScore,
        },
        ratings: {
          totalRated: rTotalRated,
          directionalCorrect: rDirectionalCorrect,
          directionalHitRate: rHitRate,
          avgHoldingPeriodReturn: null, // future: compute from holdings
        },
        decisions: {
          totalProposed: dTotal,
          approved: dApproved,
          rejected: dRejected,
          approvalRate: dApprovalRate,
          executedCorrect: dExecutedCorrect,
          executedTotal: dExecutedTotal,
          executedHitRate: dExecHitRate,
        },
        compositeScore,
      }
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  })
}

// ─── 4. usePMScorecard ────────────────────────────────────────

interface UsePMScorecardOptions {
  userId: string
  portfolioId?: string // null = across all portfolios
}

export function usePMScorecard({ userId, portfolioId }: UsePMScorecardOptions) {
  return useQuery({
    queryKey: ['pm-scorecard', userId, portfolioId],
    queryFn: async (): Promise<PMScorecardData | null> => {
      // User info
      const { data: userData } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('id', userId)
        .single()

      const userName = userData
        ? [userData.first_name, userData.last_name].filter(Boolean).join(' ') || userData.email.split('@')[0]
        : 'Unknown'

      // Portfolio info
      let portfolioName: string | null = null
      if (portfolioId) {
        const { data: p } = await supabase
          .from('portfolios')
          .select('name')
          .eq('id', portfolioId)
          .single()
        portfolioName = p?.name || null
      }

      // ── Decisions made by this PM (approved_by = userId) ──
      let decQuery = supabase
        .from('trade_queue_items')
        .select('id, status, action, asset_id, approved_at, portfolio_id')
        .eq('outcome_by', userId)
        .in('status', ['approved', 'rejected'])

      if (portfolioId) {
        decQuery = decQuery.eq('portfolio_id', portfolioId)
      }

      const { data: pmDecisions } = await decQuery
      const allDec = pmDecisions || []

      const totalDecisions = allDec.filter(d => d.status === 'approved').length
      if (totalDecisions === 0) {
        // Try alternate: decisions where approved_by = userId
        let altQuery = supabase
          .from('trade_queue_items')
          .select('id, status, action, asset_id, approved_at, portfolio_id')
          .eq('approved_by', userId)
          .eq('status', 'approved')

        if (portfolioId) {
          altQuery = altQuery.eq('portfolio_id', portfolioId)
        }

        const { data: altDec } = await altQuery
        if (!altDec || altDec.length === 0) return null
        allDec.push(...altDec)
      }

      const approvedDecs = allDec.filter(d => d.status === 'approved')
      const decisionIds = approvedDecs.map(d => d.id)

      // ── Execution matching ──
      // Check which approved decisions got executed via accepted_trades
      const { data: acceptedTrades } = await supabase
        .from('accepted_trades')
        .select('id, trade_queue_item_id, asset_id, portfolio_id, price_at_acceptance, execution_status, created_at')
        .in('trade_queue_item_id', decisionIds.length > 0 ? decisionIds : ['__none__'])

      const executedSet = new Set((acceptedTrades || []).map(t => t.trade_queue_item_id).filter(Boolean))
      const decisionsExecuted = executedSet.size
      const decisionsPending = approvedDecs.length - decisionsExecuted
      const executionRate = approvedDecs.length > 0 ? (decisionsExecuted / approvedDecs.length) * 100 : null

      // ── Timing: execution lag ──
      const { data: decSnapshots } = await supabase
        .from('decision_price_snapshots')
        .select('trade_queue_item_id, snapshot_price, snapshot_at')
        .in('trade_queue_item_id', decisionIds.length > 0 ? decisionIds : ['__none__'])
        .eq('snapshot_type', 'approval')

      const snapshotMap = new Map<string, { price: number; at: string }>()
      for (const s of decSnapshots || []) {
        snapshotMap.set(s.trade_queue_item_id, { price: Number(s.snapshot_price), at: s.snapshot_at })
      }

      const lags: number[] = []
      let totalDelayCost = 0

      for (const trade of acceptedTrades || []) {
        if (!trade.trade_queue_item_id) continue
        const snapshot = snapshotMap.get(trade.trade_queue_item_id)
        if (!snapshot) continue

        const decisionDate = new Date(snapshot.at)
        const execDate = new Date(trade.created_at)
        const lagDays = (execDate.getTime() - decisionDate.getTime()) / (1000 * 60 * 60 * 24)
        if (lagDays >= 0) lags.push(lagDays)

        // Delay cost: price difference between decision and execution
        if (trade.price_at_acceptance != null && snapshot.price > 0) {
          const pctMove = (Number(trade.price_at_acceptance) - snapshot.price) / snapshot.price * 100
          // For buys, positive move = cost (price went up). For sells, negative move = cost.
          const dec = approvedDecs.find(d => d.id === trade.trade_queue_item_id)
          const isBuy = dec?.action === 'buy' || dec?.action === 'add'
          totalDelayCost += isBuy ? pctMove : -pctMove
        }
      }

      const avgLag = lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : null
      const avgDelayCostBps = lags.length > 0 ? (totalDelayCost / lags.length) * 100 : null

      // ── Result quality ──
      const assetIds = [...new Set(approvedDecs.map(d => d.asset_id).filter(Boolean))]
      const { data: assetPrices } = await supabase
        .from('assets')
        .select('id, current_price')
        .in('id', assetIds.length > 0 ? assetIds : ['__none__'])

      const currentPriceMap = new Map<string, number>()
      for (const a of assetPrices || []) {
        if (a.current_price != null) currentPriceMap.set(a.id, Number(a.current_price))
      }

      let positive = 0
      let negative = 0

      for (const dec of approvedDecs) {
        if (!dec.asset_id) continue
        const snapshot = snapshotMap.get(dec.id)
        const currentPrice = currentPriceMap.get(dec.asset_id)

        if (!snapshot || currentPrice == null) continue

        const pctChange = (currentPrice - snapshot.price) / snapshot.price
        const isBuy = dec.action === 'buy' || dec.action === 'add'
        if ((isBuy && pctChange > 0) || (!isBuy && pctChange < 0)) {
          positive++
        } else if (pctChange !== 0) {
          negative++
        }
      }

      const resolved = positive + negative
      const dirHitRate = resolved > 0 ? (positive / resolved) * 100 : null

      return {
        userId,
        userName,
        portfolioId: portfolioId || null,
        portfolioName,
        totalDecisions: approvedDecs.length,
        decisionsExecuted,
        decisionsPending,
        decisionsMissed: 0, // future: detect via time threshold
        executionRate,
        sizingQualityScore: null, // future: correlation analysis
        avgExecutionLagDays: avgLag,
        totalDelayCostBps: avgDelayCostBps,
        decisionsPositive: positive,
        decisionsNegative: negative,
        directionalHitRate: dirHitRate,
        estimatedAlphaBps: null, // future: full attribution
      }
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  })
}
