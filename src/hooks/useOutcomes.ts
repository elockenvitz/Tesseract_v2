/**
 * Outcomes Hooks
 *
 * Unified view of all deliberate decisions:
 * - Acted: Trades committed via accepted_trades
 * - Passed: Ideas explicitly rejected or deferred via decision_requests
 *
 * Each decision can have reflection comments (post-mortems) added at any time.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { subDays, differenceInDays, parseISO } from 'date-fns'

// ============================================================
// Types
// ============================================================

export type DecisionCategory = 'acted' | 'passed'
export type DecisionDirection = 'buy' | 'sell' | 'add' | 'trim' | 'unknown'
export type ExecutionStatus = 'executed' | 'pending' | 'partial' | 'missed' | 'unknown'
export type PassedReason = 'rejected' | 'deferred' | null

export interface Reflection {
  id: string
  content: string
  user_id: string
  user_name?: string
  created_at: string
}

export interface OutcomeDecision {
  id: string
  category: DecisionCategory
  // What
  asset_symbol: string | null
  asset_name: string | null
  asset_id: string | null
  direction: DecisionDirection
  sizing_input: string | null
  // Who & When
  decided_by_name: string | null
  decided_by_id: string | null
  decided_at: string
  // Where
  portfolio_id: string | null
  portfolio_name: string | null
  // Why
  rationale: string | null
  decision_note: string | null
  // Outcome context
  execution_status: ExecutionStatus
  passed_reason: PassedReason
  deferred_until: string | null
  source: string | null
  // Reflections
  reflections: Reflection[]
  // Source record IDs for writing reflections
  _accepted_trade_id: string | null
  _decision_request_id: string | null
}

export interface OutcomeFilters {
  dateRange: { start: string | null; end: string | null }
  portfolioIds: string[]
  ownerUserIds: string[]
  assetSearch: string
  category: 'all' | 'acted' | 'passed'
}

export interface OutcomeSummary {
  total: number
  acted: number
  passed: number
  executed: number
  pending: number
  rejected: number
  deferred: number
}

// ============================================================
// useOutcomeDecisions — unified query
// ============================================================

export function useOutcomeDecisions(filters: Partial<OutcomeFilters> = {}) {
  const queryKey = [
    'outcome-decisions',
    filters.dateRange?.start ?? null,
    filters.dateRange?.end ?? null,
    filters.portfolioIds ?? [],
    filters.ownerUserIds ?? [],
    filters.assetSearch ?? '',
    filters.category ?? 'all',
  ]

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const dateStart = filters.dateRange?.start || subDays(new Date(), 90).toISOString()
      const dateEnd = filters.dateRange?.end || null
      const category = filters.category || 'all'

      const results: OutcomeDecision[] = []

      // ── 1. Acted: accepted_trades ─────────────────────────────
      if (category === 'all' || category === 'acted') {
        let atQuery = supabase
          .from('accepted_trades')
          .select(`
            id, created_at, portfolio_id, asset_id, action,
            sizing_input, source, acceptance_note, accepted_by,
            execution_status,
            asset:assets!inner ( id, symbol, company_name ),
            portfolio:portfolios!inner ( id, name ),
            acceptor:accepted_by ( id, email, raw_user_meta_data ),
            trade_idea:trade_queue_items ( rationale, thesis_text ),
            reflections:accepted_trade_comments (
              id, content, user_id, created_at,
              commenter:user_id ( id, email, raw_user_meta_data )
            )
          `)
          .eq('is_active', true)
          .gte('created_at', dateStart)
          .order('created_at', { ascending: false })
          .limit(200)

        if (dateEnd) atQuery = atQuery.lte('created_at', dateEnd)
        if (filters.portfolioIds?.length) atQuery = atQuery.in('portfolio_id', filters.portfolioIds)
        if (filters.ownerUserIds?.length) atQuery = atQuery.in('accepted_by', filters.ownerUserIds)

        const { data: trades, error: atErr } = await atQuery
        if (atErr) throw atErr

        for (const t of (trades || []) as any[]) {
          const acceptorMeta = t.acceptor?.raw_user_meta_data
          results.push({
            id: `at-${t.id}`,
            category: 'acted',
            asset_symbol: t.asset?.symbol,
            asset_name: t.asset?.company_name,
            asset_id: t.asset_id,
            direction: mapAction(t.action),
            sizing_input: t.sizing_input,
            decided_by_name: acceptorMeta?.full_name || t.acceptor?.email?.split('@')[0] || null,
            decided_by_id: t.accepted_by,
            decided_at: t.created_at,
            portfolio_id: t.portfolio_id,
            portfolio_name: t.portfolio?.name,
            rationale: t.trade_idea?.rationale || t.trade_idea?.thesis_text || null,
            decision_note: t.acceptance_note,
            execution_status: mapExecStatus(t.execution_status),
            passed_reason: null,
            deferred_until: null,
            source: t.source,
            reflections: (t.reflections || [])
              .filter((r: any) => r.content)
              .map((r: any) => ({
                id: r.id,
                content: r.content,
                user_id: r.user_id,
                user_name: r.commenter?.raw_user_meta_data?.full_name || r.commenter?.email?.split('@')[0] || 'Unknown',
                created_at: r.created_at,
              })),
            _accepted_trade_id: t.id,
            _decision_request_id: null,
          })
        }
      }

      // ── 2. Passed: rejected/deferred decision_requests ────────
      if (category === 'all' || category === 'passed') {
        let drQuery = supabase
          .from('decision_requests')
          .select(`
            id, status, decision_note, urgency, requested_action,
            reviewed_by, reviewed_at, created_at, deferred_until,
            portfolio_id,
            portfolio:portfolios!inner ( id, name ),
            trade_idea:trade_queue_items!inner (
              id, rationale, thesis_text, asset_id,
              asset:assets ( id, symbol, company_name )
            ),
            reviewer:reviewed_by ( id, email, raw_user_meta_data ),
            reflections:decision_request_comments (
              id, content, user_id, created_at,
              commenter:user_id ( id, email, raw_user_meta_data )
            )
          `)
          .in('status', ['rejected', 'deferred'])
          .gte('created_at', dateStart)
          .order('created_at', { ascending: false })
          .limit(200)

        if (dateEnd) drQuery = drQuery.lte('created_at', dateEnd)
        if (filters.portfolioIds?.length) drQuery = drQuery.in('portfolio_id', filters.portfolioIds)
        if (filters.ownerUserIds?.length) drQuery = drQuery.in('reviewed_by', filters.ownerUserIds)

        const { data: passed, error: drErr } = await drQuery
        if (drErr) throw drErr

        for (const d of (passed || []) as any[]) {
          const reviewerMeta = d.reviewer?.raw_user_meta_data
          const ti = d.trade_idea
          results.push({
            id: `dr-${d.id}`,
            category: 'passed',
            asset_symbol: ti?.asset?.symbol || null,
            asset_name: ti?.asset?.company_name || null,
            asset_id: ti?.asset_id || null,
            direction: mapAction(d.requested_action || ti?.action),
            sizing_input: null,
            decided_by_name: reviewerMeta?.full_name || d.reviewer?.email?.split('@')[0] || null,
            decided_by_id: d.reviewed_by,
            decided_at: d.reviewed_at || d.created_at,
            portfolio_id: d.portfolio_id,
            portfolio_name: d.portfolio?.name,
            rationale: ti?.rationale || ti?.thesis_text || null,
            decision_note: d.decision_note,
            execution_status: 'unknown',
            passed_reason: d.status as PassedReason,
            deferred_until: d.deferred_until,
            source: null,
            reflections: (d.reflections || [])
              .filter((r: any) => r.content)
              .map((r: any) => ({
                id: r.id,
                content: r.content,
                user_id: r.user_id,
                user_name: r.commenter?.raw_user_meta_data?.full_name || r.commenter?.email?.split('@')[0] || 'Unknown',
                created_at: r.created_at,
              })),
            _accepted_trade_id: null,
            _decision_request_id: d.id,
          })
        }
      }

      // Sort unified list by decided_at desc
      results.sort((a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime())

      // Client-side asset search
      if (filters.assetSearch) {
        const s = filters.assetSearch.toLowerCase()
        return results.filter(r =>
          r.asset_symbol?.toLowerCase().includes(s) ||
          r.asset_name?.toLowerCase().includes(s)
        )
      }

      return results
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  return {
    decisions: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ============================================================
// useOutcomeSummary
// ============================================================

export function useOutcomeSummary(decisions: OutcomeDecision[]): OutcomeSummary {
  return useMemo(() => ({
    total: decisions.length,
    acted: decisions.filter(d => d.category === 'acted').length,
    passed: decisions.filter(d => d.category === 'passed').length,
    executed: decisions.filter(d => d.execution_status === 'executed').length,
    pending: decisions.filter(d => d.execution_status === 'pending').length,
    rejected: decisions.filter(d => d.passed_reason === 'rejected').length,
    deferred: decisions.filter(d => d.passed_reason === 'deferred').length,
  }), [decisions])
}

// ============================================================
// useAddReflection — add a post-mortem comment
// ============================================================

export function useAddReflection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ decision, content, userId }: {
      decision: OutcomeDecision
      content: string
      userId: string
    }) => {
      if (decision._accepted_trade_id) {
        const { error } = await supabase
          .from('accepted_trade_comments')
          .insert({
            accepted_trade_id: decision._accepted_trade_id,
            user_id: userId,
            content,
            comment_type: 'reflection',
          })
        if (error) throw error
      } else if (decision._decision_request_id) {
        const { error } = await supabase
          .from('decision_request_comments')
          .insert({
            decision_request_id: decision._decision_request_id,
            user_id: userId,
            content,
            comment_type: 'reflection',
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outcome-decisions'] })
    },
  })
}

// ============================================================
// Filter helpers
// ============================================================

export function usePortfoliosForFilter() {
  return useQuery({
    queryKey: ['portfolios-for-filter'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data || []
    },
  })
}

export function useUsersForFilter() {
  return useQuery({
    queryKey: ['users-for-filter'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, raw_user_meta_data')
        .order('email')
      if (error) throw error
      return (data || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        name: u.raw_user_meta_data?.full_name || u.email.split('@')[0],
      }))
    },
  })
}

// ============================================================
// Internal helpers
// ============================================================

function mapAction(action: string | null): DecisionDirection {
  switch (action) {
    case 'buy': return 'buy'
    case 'sell': return 'sell'
    case 'add': return 'add'
    case 'trim': return 'trim'
    default: return 'unknown'
  }
}

function mapExecStatus(status: string): ExecutionStatus {
  switch (status) {
    case 'complete': return 'executed'
    case 'partial': return 'partial'
    case 'failed': return 'missed'
    case 'not_started': return 'pending'
    default: return 'pending'
  }
}
