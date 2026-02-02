/**
 * Outcomes Hooks
 *
 * Data fetching hooks for the Outcomes tab.
 *
 * MVP (Implemented):
 * - useOutcomeDecisions: Fetches approved decisions from trade_queue_items
 *
 * Framework (Placeholder):
 * - useExecutionObservations: Returns empty + "not implemented"
 * - useDecisionOutcomeLinks: Returns empty + "not implemented"
 * - useAnalystScorecard: Returns empty + "not implemented"
 * - useProcessSlippage: Returns empty + "not implemented"
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { subDays, differenceInDays, parseISO } from 'date-fns'
import type {
  OutcomeDecision,
  ExecutionObservation,
  DecisionOutcomeLink,
  AnalystScorecard,
  ProcessSlippageEvent,
  OutcomeFilters,
  OutcomeHookResult,
  OutcomeSummaryStats,
  DecisionDirection,
} from '../types/outcomes'

// ============================================================
// useOutcomeDecisions (MVP: Implemented)
// ============================================================

interface UseOutcomeDecisionsOptions {
  filters?: Partial<OutcomeFilters>
  enabled?: boolean
}

export function useOutcomeDecisions(options: UseOutcomeDecisionsOptions = {}): OutcomeHookResult<OutcomeDecision[]> {
  const { filters, enabled = true } = options

  const query = useQuery({
    queryKey: ['outcome-decisions', filters],
    queryFn: async () => {
      // Build query for approved trade ideas
      let query = supabase
        .from('trade_queue_items')
        .select(`
          id,
          created_at,
          approved_at,
          approved_by,
          portfolio_id,
          asset_id,
          action,
          urgency,
          status,
          rationale,
          proposed_shares,
          proposed_weight,
          target_price,
          assets:asset_id (
            id,
            symbol,
            company_name
          ),
          portfolios:portfolio_id (
            id,
            name
          ),
          approved_by_user:approved_by (
            id,
            email,
            first_name,
            last_name
          ),
          created_by_user:created_by (
            id,
            email,
            first_name,
            last_name
          )
        `)

      // Apply status filters
      const statuses: string[] = []
      if (filters?.showApproved !== false) statuses.push('approved')
      if (filters?.showRejected) statuses.push('rejected')
      if (filters?.showArchived) statuses.push('cancelled')

      if (statuses.length > 0) {
        query = query.in('status', statuses)
      } else {
        // Default to approved only
        query = query.eq('status', 'approved')
      }

      // Apply date range filter
      if (filters?.dateRange?.start) {
        query = query.gte('approved_at', filters.dateRange.start)
      } else {
        // Default to last 90 days
        const ninetyDaysAgo = subDays(new Date(), 90).toISOString()
        query = query.gte('created_at', ninetyDaysAgo)
      }

      if (filters?.dateRange?.end) {
        query = query.lte('approved_at', filters.dateRange.end)
      }

      // Apply portfolio filter
      if (filters?.portfolioIds && filters.portfolioIds.length > 0) {
        query = query.in('portfolio_id', filters.portfolioIds)
      }

      // Apply asset search
      if (filters?.assetSearch) {
        // This will be handled client-side for now
      }

      // Apply urgency filter
      if (filters?.urgencies && filters.urgencies.length > 0) {
        query = query.in('urgency', filters.urgencies)
      }

      // Order by approved_at desc, then created_at desc
      query = query.order('approved_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      const { data, error } = await query

      if (error) throw error

      // Transform to OutcomeDecision format
      const decisions: OutcomeDecision[] = (data || []).map((item: any) => {
        const direction = mapActionToDirection(item.action)
        const hasRationale = !!item.rationale
        const approvedAt = item.approved_at ? parseISO(item.approved_at) : null
        const daysSinceApproved = approvedAt
          ? differenceInDays(new Date(), approvedAt)
          : undefined

        return {
          decision_id: item.id,
          created_at: item.created_at,
          approved_at: item.approved_at,
          approved_by_user_id: item.approved_by,
          approved_by_user: item.approved_by_user,
          portfolio_id: item.portfolio_id,
          portfolio_name: item.portfolios?.name,
          asset_id: item.asset_id,
          asset_symbol: item.assets?.symbol,
          asset_name: item.assets?.company_name,
          direction,
          urgency: item.urgency,
          stage: item.status,
          rationale_snapshot: hasRationale ? {
            thesis: item.rationale,
          } : null,
          linked_forecast_snapshot: null, // TODO: Snapshot price targets at approval
          owner_user_ids: item.created_by ? [item.created_by] : [],
          owner_users: item.created_by_user ? [item.created_by_user] : [],
          source_url: `/trade-queue?id=${item.id}`,
          has_rationale: hasRationale,
          days_since_approved: daysSinceApproved,
          execution_status: 'pending', // TODO: Derive from execution observations
        }
      })

      // Apply client-side asset search filter
      if (filters?.assetSearch) {
        const search = filters.assetSearch.toLowerCase()
        return decisions.filter(d =>
          d.asset_symbol?.toLowerCase().includes(search) ||
          d.asset_name?.toLowerCase().includes(search)
        )
      }

      return decisions
    },
    enabled,
  })

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    isImplemented: true,
  }
}

function mapActionToDirection(action: string): DecisionDirection {
  switch (action) {
    case 'buy':
      return 'buy'
    case 'sell':
      return 'sell'
    case 'add':
      return 'add'
    case 'trim':
      return 'trim'
    default:
      return 'unknown'
  }
}

// ============================================================
// useOutcomeSummary (MVP: Computed from decisions)
// ============================================================

export function useOutcomeSummary(decisions: OutcomeDecision[]): OutcomeSummaryStats {
  return useMemo(() => {
    const approvedCount = decisions.filter(d => d.stage === 'approved').length
    const rejectedCount = decisions.filter(d => d.stage === 'rejected').length
    const archivedCount = decisions.filter(d => d.stage === 'cancelled').length

    // Execution status counts (all pending until we have execution data)
    const pendingExecutionCount = decisions.filter(d => d.execution_status === 'pending').length
    const executedCount = decisions.filter(d => d.execution_status === 'executed').length
    const missedCount = decisions.filter(d => d.execution_status === 'missed').length

    return {
      totalDecisions: decisions.length,
      approvedCount,
      rejectedCount,
      archivedCount,
      pendingExecutionCount,
      executedCount,
      missedCount,
      discretionaryCount: 0, // TODO: From execution observations
      avgLagDays: null, // TODO: From execution observations
      directionalHitRate: null, // TODO: From scoring engine
    }
  }, [decisions])
}

// ============================================================
// useExecutionObservations (Framework: Placeholder)
// ============================================================

interface UseExecutionObservationsOptions {
  portfolioId?: string
  dateRange?: { start: string; end: string }
  enabled?: boolean
}

export function useExecutionObservations(
  _options: UseExecutionObservationsOptions = {}
): OutcomeHookResult<ExecutionObservation[]> {
  /**
   * TODO: Implement execution observations from holdings diffs
   *
   * Future implementation will:
   * 1. Query holdings_snapshots table for the date range
   * 2. Compute diffs between consecutive snapshots
   * 3. Transform changes into ExecutionObservation objects
   * 4. Attempt to match with approved decisions
   *
   * For now, return empty placeholder.
   */

  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isImplemented: false,
  }
}

// ============================================================
// useDecisionOutcomeLinks (Framework: Placeholder)
// ============================================================

interface UseDecisionOutcomeLinksOptions {
  decisionId?: string
  execId?: string
  enabled?: boolean
}

export function useDecisionOutcomeLinks(
  _options: UseDecisionOutcomeLinksOptions = {}
): OutcomeHookResult<DecisionOutcomeLink[]> {
  /**
   * TODO: Implement decision-to-execution matching
   *
   * Future implementation will:
   * 1. Query decision_outcome_links table
   * 2. Include match confidence and explanation
   * 3. Support filtering by decision or execution
   *
   * Matching algorithm will consider:
   * - Asset match
   * - Direction match
   * - Timing proximity (decision date vs execution date)
   * - Portfolio match
   * - Magnitude similarity
   *
   * For now, return empty placeholder.
   */

  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isImplemented: false,
  }
}

// ============================================================
// useAnalystScorecards (Framework: Placeholder)
// ============================================================

interface UseAnalystScorecardsOptions {
  userIds?: string[]
  periodStart?: string
  periodEnd?: string
  enabled?: boolean
}

export function useAnalystScorecards(
  _options: UseAnalystScorecardsOptions = {}
): OutcomeHookResult<AnalystScorecard[]> {
  /**
   * TODO: Implement analyst scorecards from scoring engine
   *
   * Future implementation will:
   * 1. Aggregate decisions by analyst for the period
   * 2. Compute directional hit rate from matched executions
   * 3. Compute calibration score from probability estimates vs outcomes
   * 4. Compute price target accuracy
   * 5. Compute average decision-to-execution lag
   * 6. Compute discretionary rate (unmatched executions / total)
   *
   * For now, return empty placeholder.
   */

  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isImplemented: false,
  }
}

// ============================================================
// useProcessSlippage (Framework: Placeholder)
// ============================================================

interface UseProcessSlippageOptions {
  portfolioId?: string
  dateRange?: { start: string; end: string }
  enabled?: boolean
}

export function useProcessSlippage(
  _options: UseProcessSlippageOptions = {}
): OutcomeHookResult<ProcessSlippageEvent[]> {
  /**
   * TODO: Implement process slippage detection
   *
   * Future implementation will:
   * 1. Identify decisions that took too long (idea → decision lag)
   * 2. Identify executions that were delayed (decision → execution lag)
   * 3. Identify missed executions (approved but never executed)
   * 4. Identify sizing errors (executed different amount than proposed)
   * 5. Compute estimated impact using price at each stage
   *
   * Slippage types:
   * - 'idea': Price moved before idea was formalized
   * - 'decision': Price moved during discussion/simulation
   * - 'execution': Price moved between approval and execution
   * - 'timing': Executed too late after approval
   * - 'sizing': Executed different size than proposed
   *
   * For now, return empty placeholder.
   */

  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isImplemented: false,
  }
}

// ============================================================
// useDiscretionaryActions (Framework: Placeholder)
// ============================================================

interface UseDiscretionaryActionsOptions {
  portfolioId?: string
  dateRange?: { start: string; end: string }
  enabled?: boolean
}

export function useDiscretionaryActions(
  _options: UseDiscretionaryActionsOptions = {}
): OutcomeHookResult<ExecutionObservation[]> {
  /**
   * TODO: Identify discretionary/unplanned actions
   *
   * Future implementation will:
   * 1. Query execution observations
   * 2. Filter to those with no matched decision
   * 3. These represent trades made outside the formal process
   *
   * For now, return empty placeholder.
   */

  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isImplemented: false,
  }
}

// ============================================================
// useForecastQuality (Framework: Placeholder)
// ============================================================

interface ForecastQualityMetrics {
  directionalCorrect: number
  directionalTotal: number
  directionalHitRate: number | null
  calibrationScore: number | null
  avgTargetErrorPct: number | null
  medianTargetErrorPct: number | null
}

interface UseForecastQualityOptions {
  userIds?: string[]
  portfolioIds?: string[]
  dateRange?: { start: string; end: string }
  enabled?: boolean
}

export function useForecastQuality(
  _options: UseForecastQualityOptions = {}
): OutcomeHookResult<ForecastQualityMetrics> {
  /**
   * TODO: Implement forecast quality metrics
   *
   * Future implementation will:
   * 1. Compare directional calls (bullish/bearish) to actual price movement
   * 2. Compare probability estimates to actual outcome frequencies
   * 3. Compare price targets to actual prices achieved
   *
   * For now, return empty placeholder.
   */

  const emptyMetrics: ForecastQualityMetrics = {
    directionalCorrect: 0,
    directionalTotal: 0,
    directionalHitRate: null,
    calibrationScore: null,
    avgTargetErrorPct: null,
    medianTargetErrorPct: null,
  }

  return {
    data: emptyMetrics,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isImplemented: false,
  }
}

// ============================================================
// usePortfoliosForFilter (Helper: For filter dropdowns)
// ============================================================

export function usePortfoliosForFilter() {
  return useQuery({
    queryKey: ['portfolios-for-filter'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')

      if (error) throw error
      return data || []
    },
  })
}

// ============================================================
// useUsersForFilter (Helper: For filter dropdowns)
// ============================================================

export function useUsersForFilter() {
  return useQuery({
    queryKey: ['users-for-filter'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')

      if (error) throw error
      return data || []
    },
  })
}
