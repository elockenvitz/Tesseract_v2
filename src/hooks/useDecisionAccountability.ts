/**
 * useDecisionAccountability
 *
 * Core data hook for the Decision Outcomes page.
 *
 * Pipeline:
 * 1. Fetch decisions (terminal-stage trade_queue_items)
 * 2. Fetch trade events scoped to relevant portfolios
 * 3. Fetch rationale statuses + summaries for matched events
 * 4. Fetch current prices from assets table
 * 5. Fetch decision-time price snapshots
 * 6. Match decisions → executions (explicit link, then fuzzy)
 * 7. Enrich rows with decision price, execution price, directional metrics
 * 8. Client-side filters (asset, execution status, result, direction)
 * 9. Compute summary statistics including snapshot-backed metrics
 *
 * METRIC HONESTY:
 * - decision_price: from decision_price_snapshots (DB-cached at approval time)
 * - execution_price: derived from trade event market_value / quantity (proxy)
 * - current_price: from assets table (DB-cached, not real-time)
 * - move_since_decision_pct: directionalized (current - decision) / decision
 * - move_since_execution_pct: directionalized (current - execution) / execution
 * - delay_cost_pct: directionalized (execution - decision) / decision
 * - All are directional proxies, NOT exact P&L attribution
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { subDays, differenceInDays, parseISO } from 'date-fns'
import type {
  AccountabilityRow,
  AccountabilityFilters,
  AccountabilitySummary,
  MatchedExecution,
  ExecutionMatchStatus,
  DecisionDirection,
  ResultDirection,
  UnmatchedExecution,
  SizeBasis,
} from '../types/decision-accountability'

// ============================================================
// Constants
// ============================================================

/** Max days after approval to consider a fuzzy execution match */
const FUZZY_MATCH_WINDOW_DAYS = 60

/** Days after approval with no execution before marking as unmatched */
const UNMATCHED_THRESHOLD_DAYS = 30

/** Minimum absolute move % to count as positive/negative (avoids noise) */
const RESULT_THRESHOLD_PCT = 0.1

// ============================================================
// Direction compatibility for fuzzy matching
// ============================================================

const COMPATIBLE_DIRECTIONS: Record<string, string[]> = {
  buy:  ['initiate', 'add'],
  add:  ['initiate', 'add'],
  long: ['initiate', 'add'],
  sell: ['trim', 'exit', 'reduce'],
  trim: ['trim', 'exit', 'reduce'],
  short: ['short_initiate'],
}

function isDirectionCompatible(decisionDirection: string, executionAction: string): boolean {
  const compatible = COMPATIBLE_DIRECTIONS[decisionDirection]
  return compatible ? compatible.includes(executionAction) : false
}

// ============================================================
// Helpers
// ============================================================

function formatUserName(user: { first_name: string | null; last_name: string | null; email: string } | null): string | null {
  if (!user) return null
  if (user.first_name || user.last_name) {
    return [user.first_name, user.last_name].filter(Boolean).join(' ')
  }
  return user.email.split('@')[0]
}

function mapActionToDirection(action: string): DecisionDirection {
  switch (action) {
    case 'buy': return 'buy'
    case 'sell': return 'sell'
    case 'add': return 'add'
    case 'trim': return 'trim'
    default: return 'unknown'
  }
}

/**
 * Derive approximate execution price from trade event position data.
 * Uses market_value / quantity as a proxy for price per share at execution time.
 */
function deriveExecutionPrice(
  mvBefore: number | null,
  mvAfter: number | null,
  qtyBefore: number | null,
  qtyAfter: number | null,
): number | null {
  // Prefer post-trade position (represents the price environment at execution)
  if (mvAfter != null && qtyAfter != null && qtyAfter > 0) {
    return mvAfter / qtyAfter
  }
  // Fallback to pre-trade (for full exits where quantity_after = 0)
  if (mvBefore != null && qtyBefore != null && qtyBefore > 0) {
    return mvBefore / qtyBefore
  }
  return null
}

// ============================================================
// Centralized Directional Metric Helpers
// ============================================================

/**
 * Whether a decision direction is bullish (expects price to rise).
 */
function isBullishDirection(direction: DecisionDirection): boolean {
  return ['buy', 'add', 'long'].includes(direction)
}

/**
 * Whether a decision direction is bearish (expects price to fall).
 */
function isBearishDirection(direction: DecisionDirection): boolean {
  return ['sell', 'trim', 'short'].includes(direction)
}

/**
 * Compute a directionalized price move percentage.
 *
 * For bullish directions: (toPrice - fromPrice) / fromPrice * 100
 *   → positive means price rose (favorable for buy/add/long)
 * For bearish directions: (fromPrice - toPrice) / fromPrice * 100
 *   → positive means price fell (favorable for sell/trim/short)
 *
 * Returns null if either price is unavailable or fromPrice is zero/negative.
 */
function computeDirectionalMove(
  direction: DecisionDirection,
  fromPrice: number | null,
  toPrice: number | null,
): number | null {
  if (fromPrice == null || toPrice == null || fromPrice <= 0) return null

  const rawPct = ((toPrice - fromPrice) / fromPrice) * 100

  if (isBullishDirection(direction)) return rawPct
  if (isBearishDirection(direction)) return -rawPct
  return null // unknown/pair direction — cannot directionalize
}

/**
 * Compute delay cost: the price move between decision and execution, directionalized.
 *
 * For bullish: (execPrice - decisionPrice) / decisionPrice * 100
 *   → positive = execution was at higher price → delay cost
 *   → negative = execution was at lower price → delay benefit
 * For bearish: (decisionPrice - execPrice) / decisionPrice * 100
 *   → positive = execution was at lower price → delay cost
 *   → negative = execution was at higher price → delay benefit
 */
function computeDelayCost(
  direction: DecisionDirection,
  decisionPrice: number | null,
  executionPrice: number | null,
): number | null {
  if (decisionPrice == null || executionPrice == null || decisionPrice <= 0) return null

  const rawPct = ((executionPrice - decisionPrice) / decisionPrice) * 100

  if (isBullishDirection(direction)) return rawPct
  if (isBearishDirection(direction)) return -rawPct
  return null
}

/**
 * Compute trade notional (dollar size of the trade) and its basis.
 *
 * Primary: |market_value_after - market_value_before| (best quality)
 * Fallback: |quantity_delta * execution_price| (proxy)
 * Last resort: weight_only (only weight_delta available, no dollar sizing)
 */
function computeTradeNotional(
  exec: MatchedExecution,
): { notional: number | null; basis: SizeBasis } {
  // Primary: market value delta
  if (exec.market_value_before != null && exec.market_value_after != null) {
    const delta = Math.abs(exec.market_value_after - exec.market_value_before)
    if (delta > 0) return { notional: delta, basis: 'market_value_delta' }
  }

  // Fallback: quantity × execution price
  if (exec.quantity_delta != null && exec.execution_price != null) {
    const notional = Math.abs(exec.quantity_delta) * exec.execution_price
    if (notional > 0) return { notional, basis: 'qty_times_price' }
  }

  // Last resort: weight only (no dollar sizing possible)
  if (exec.weight_delta != null && Math.abs(exec.weight_delta) > 0) {
    return { notional: null, basis: 'weight_only' }
  }

  return { notional: null, basis: null }
}

/**
 * Compute whether the price move since decision validated the decision direction.
 * Uses move_since_decision if available, falls back to move_since_execution.
 */
function computeResultDirection(
  moveSinceDecision: number | null,
  moveSinceExecution: number | null,
): ResultDirection | null {
  // Prefer move_since_decision (fuller picture), fall back to move_since_execution
  const move = moveSinceDecision ?? moveSinceExecution
  if (move === null) return null
  if (Math.abs(move) < RESULT_THRESHOLD_PCT) return 'neutral'
  return move > 0 ? 'positive' : 'negative'
}

// ============================================================
// Rationale map type
// ============================================================

interface RationaleInfo {
  status: string
  summary: string | null
}

// ============================================================
// Main hook
// ============================================================

interface UseDecisionAccountabilityOptions {
  filters?: Partial<AccountabilityFilters>
  enabled?: boolean
}

export function useDecisionAccountability(options: UseDecisionAccountabilityOptions = {}) {
  const { filters, enabled = true } = options

  // ── Step 1: Fetch decisions ──────────────────────────────────
  const decisionsQuery = useQuery({
    queryKey: ['decision-accountability', 'decisions', filters],
    queryFn: async () => {
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
          assets:asset_id (id, symbol, company_name),
          portfolios:portfolio_id (id, name),
          approved_by_user:approved_by (id, email, first_name, last_name),
          created_by_user:created_by (id, email, first_name, last_name)
        `)

      // Status filters — 'executed' is the legacy status for inbox-accepted decisions
      const statuses: string[] = []
      if (filters?.showApproved !== false) statuses.push('approved', 'executed')
      if (filters?.showRejected) statuses.push('rejected')
      if (filters?.showCancelled) statuses.push('cancelled')

      if (statuses.length > 0) {
        query = query.in('status', statuses)
      } else {
        query = query.in('status', ['approved', 'executed'])
      }

      // Date range
      if (filters?.dateRange?.start) {
        query = query.gte('approved_at', filters.dateRange.start)
      } else {
        query = query.gte('created_at', subDays(new Date(), 90).toISOString())
      }
      if (filters?.dateRange?.end) {
        query = query.lte('approved_at', filters.dateRange.end)
      }

      // Portfolio filter
      if (filters?.portfolioIds && filters.portfolioIds.length > 0) {
        query = query.in('portfolio_id', filters.portfolioIds)
      }

      // Owner filter (created_by = the analyst who created the trade idea)
      if (filters?.ownerUserIds && filters.ownerUserIds.length > 0) {
        query = query.in('created_by', filters.ownerUserIds)
      }

      query = query
        .order('approved_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    enabled,
    staleTime: 30_000,
  })

  // ── Step 2: Fetch trade events for matching ──────────────────
  const decisionData = decisionsQuery.data || []

  const portfolioIdsForEvents = useMemo(() => {
    const ids = new Set<string>()
    decisionData.forEach((d: any) => { if (d.portfolio_id) ids.add(d.portfolio_id) })
    return Array.from(ids)
  }, [decisionData])

  const eventsQuery = useQuery({
    queryKey: ['decision-accountability', 'events', portfolioIdsForEvents],
    queryFn: async () => {
      if (portfolioIdsForEvents.length === 0) return []

      const lookbackDate = subDays(new Date(), 180).toISOString()

      const { data, error } = await supabase
        .from('portfolio_trade_events')
        .select(`
          id,
          portfolio_id,
          asset_id,
          event_date,
          action_type,
          source_type,
          quantity_delta,
          weight_delta,
          quantity_before,
          quantity_after,
          market_value_before,
          market_value_after,
          weight_before,
          weight_after,
          status,
          linked_trade_idea_id,
          linked_trade_sheet_id,
          assets:asset_id (id, symbol, company_name),
          portfolios:portfolio_id (id, name)
        `)
        .in('portfolio_id', portfolioIdsForEvents)
        .gte('event_date', lookbackDate)
        .neq('status', 'ignored')
        .order('event_date', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: enabled && portfolioIdsForEvents.length > 0,
    staleTime: 30_000,
  })

  // ── Step 3: Fetch rationale status + content for matched events ─
  const eventData = eventsQuery.data || []
  const eventIds = useMemo(() => eventData.map((e: any) => e.id), [eventData])

  const rationalesQuery = useQuery({
    queryKey: ['decision-accountability', 'rationales', eventIds.length],
    queryFn: async () => {
      if (eventIds.length === 0) return new Map<string, RationaleInfo>()

      const { data, error } = await supabase
        .from('trade_event_rationales')
        .select('trade_event_id, status, reason_for_action')
        .in('trade_event_id', eventIds)
        .order('version_number', { ascending: false })

      if (error) throw error

      // Keep only latest rationale per event
      const map = new Map<string, RationaleInfo>()
      for (const r of data || []) {
        if (!map.has(r.trade_event_id)) {
          map.set(r.trade_event_id, {
            status: r.status,
            summary: r.reason_for_action || null,
          })
        }
      }
      return map
    },
    enabled: enabled && eventIds.length > 0,
    staleTime: 30_000,
  })

  // ── Step 4: Fetch current prices for assets in decisions ─────
  const assetIdsForPrices = useMemo(() => {
    const ids = new Set<string>()
    decisionData.forEach((d: any) => { if (d.asset_id) ids.add(d.asset_id) })
    return Array.from(ids)
  }, [decisionData])

  const pricesQuery = useQuery({
    queryKey: ['decision-accountability', 'asset-prices', assetIdsForPrices],
    queryFn: async () => {
      if (assetIdsForPrices.length === 0) return new Map<string, number>()

      const { data, error } = await supabase
        .from('assets')
        .select('id, current_price')
        .in('id', assetIdsForPrices)

      if (error) throw error

      const map = new Map<string, number>()
      for (const a of data || []) {
        if (a.current_price != null) {
          map.set(a.id, Number(a.current_price))
        }
      }
      return map
    },
    enabled: enabled && assetIdsForPrices.length > 0,
    staleTime: 120_000,
  })

  // ── Step 5: Fetch decision-time price snapshots ─────────────
  const decisionIds = useMemo(
    () => decisionData.map((d: any) => d.id as string),
    [decisionData],
  )

  const snapshotsQuery = useQuery({
    queryKey: ['decision-accountability', 'snapshots', decisionIds.length],
    queryFn: async () => {
      if (decisionIds.length === 0) return new Map<string, { price: number; at: string }>()

      const { data, error } = await supabase
        .from('decision_price_snapshots')
        .select('trade_queue_item_id, snapshot_price, snapshot_at')
        .in('trade_queue_item_id', decisionIds)
        .eq('snapshot_type', 'approval')

      if (error) {
        console.error('[decision-accountability] Failed to fetch snapshots:', error)
        return new Map<string, { price: number; at: string }>()
      }

      const map = new Map<string, { price: number; at: string }>()
      for (const s of data || []) {
        map.set(s.trade_queue_item_id, {
          price: Number(s.snapshot_price),
          at: s.snapshot_at,
        })
      }
      return map
    },
    enabled: enabled && decisionIds.length > 0,
    staleTime: 120_000,
  })

  // ── Step 6: Match decisions to executions + enrich with impact ─
  const rows: AccountabilityRow[] = useMemo(() => {
    const events = eventData
    const rationaleMap = rationalesQuery.data || new Map<string, RationaleInfo>()
    const priceMap = pricesQuery.data || new Map<string, number>()
    const snapshotMap = snapshotsQuery.data || new Map<string, { price: number; at: string }>()
    const now = new Date()

    // Index events by linked_trade_idea_id for explicit matching
    const eventsByLinkedIdea = new Map<string, any[]>()
    // Index events by portfolio+asset for fuzzy matching
    const eventsByPortfolioAsset = new Map<string, any[]>()
    // Track which events are explicitly claimed
    const claimedEventIds = new Set<string>()

    for (const evt of events) {
      if (evt.linked_trade_idea_id) {
        const arr = eventsByLinkedIdea.get(evt.linked_trade_idea_id) || []
        arr.push(evt)
        eventsByLinkedIdea.set(evt.linked_trade_idea_id, arr)
      }

      const key = `${evt.portfolio_id}:${evt.asset_id}`
      const arr = eventsByPortfolioAsset.get(key) || []
      arr.push(evt)
      eventsByPortfolioAsset.set(key, arr)
    }

    // Helper to build a MatchedExecution from an event
    const buildMatchedExecution = (
      evt: any,
      matchMethod: 'explicit_link' | 'fuzzy_match',
      lagDays: number | null,
    ): MatchedExecution => {
      const rationale = rationaleMap.get(evt.id)
      const execPrice = deriveExecutionPrice(
        evt.market_value_before, evt.market_value_after,
        evt.quantity_before, evt.quantity_after,
      )
      return {
        event_id: evt.id,
        event_date: evt.event_date,
        action_type: evt.action_type,
        source_type: evt.source_type,
        quantity_delta: evt.quantity_delta,
        weight_delta: evt.weight_delta,
        asset_symbol: evt.assets?.symbol,
        portfolio_name: evt.portfolios?.name,
        match_method: matchMethod,
        rationale_status: rationale?.status || null,
        has_rationale: !!rationale,
        execution_rationale_summary: rationale?.summary || null,
        lag_days: lagDays,
        market_value_before: evt.market_value_before ?? null,
        market_value_after: evt.market_value_after ?? null,
        quantity_before: evt.quantity_before ?? null,
        quantity_after: evt.quantity_after ?? null,
        execution_price: execPrice,
        weight_before: evt.weight_before ?? null,
        weight_after: evt.weight_after ?? null,
      }
    }

    return decisionData.map((item: any): AccountabilityRow => {
      const direction = mapActionToDirection(item.action)
      const approvedAt = item.approved_at ? parseISO(item.approved_at) : null
      const daysSinceDecision = approvedAt
        ? differenceInDays(now, approvedAt)
        : item.created_at
          ? differenceInDays(now, parseISO(item.created_at))
          : null

      const currentPrice = item.asset_id ? (priceMap.get(item.asset_id) ?? null) : null

      // Decision-time price snapshot
      const snapshot = snapshotMap.get(item.id)
      const decisionPrice = snapshot?.price ?? null
      const decisionPriceAt = snapshot?.at ?? null
      const hasDecisionPrice = snapshot != null

      // Non-approved decisions don't need execution matching
      if (item.status !== 'approved') {
        // For rejected/cancelled decisions with a snapshot, still compute move since decision
        const moveSinceDecision = computeDirectionalMove(direction, decisionPrice, currentPrice)
        const resultDir = computeResultDirection(moveSinceDecision, null)

        return {
          decision_id: item.id,
          created_at: item.created_at,
          approved_at: item.approved_at,
          direction,
          stage: (item.status === 'executed' ? 'approved' : item.status) as any,
          rationale_text: item.rationale || null,
          asset_id: item.asset_id,
          asset_symbol: item.assets?.symbol || null,
          asset_name: item.assets?.company_name || null,
          portfolio_id: item.portfolio_id,
          portfolio_name: item.portfolios?.name || null,
          owner_name: formatUserName(item.created_by_user),
          approver_name: formatUserName(item.approved_by_user),
          execution_status: 'not_applicable',
          matched_executions: [],
          execution_lag_days: null,
          days_since_decision: daysSinceDecision,
          decision_price: decisionPrice,
          decision_price_at: decisionPriceAt,
          has_decision_price: hasDecisionPrice,
          current_price: currentPrice,
          execution_price: null,
          move_since_decision_pct: moveSinceDecision,
          move_since_execution_pct: null,
          result_direction: resultDir,
          delay_cost_pct: null,
          trade_notional: null,
          size_basis: null,
          weight_impact: null,
          impact_proxy: null,
          weighted_delay_cost: null,
        }
      }

      // ── Execution matching for approved decisions ──

      const matched: MatchedExecution[] = []

      // 1. Explicit match via linked_trade_idea_id
      const explicitMatches = eventsByLinkedIdea.get(item.id) || []
      for (const evt of explicitMatches) {
        claimedEventIds.add(evt.id)
        const evtDate = parseISO(evt.event_date)
        const lagDays = approvedAt ? differenceInDays(evtDate, approvedAt) : null
        matched.push(buildMatchedExecution(evt, 'explicit_link', lagDays))
      }

      // 2. Fuzzy match: same portfolio + asset, compatible direction, within window
      if (matched.length === 0 && approvedAt && item.portfolio_id && item.asset_id) {
        const key = `${item.portfolio_id}:${item.asset_id}`
        const candidates = eventsByPortfolioAsset.get(key) || []

        for (const evt of candidates) {
          if (claimedEventIds.has(evt.id)) continue
          if (evt.linked_trade_idea_id) continue

          const evtDate = parseISO(evt.event_date)
          const daysAfterApproval = differenceInDays(evtDate, approvedAt)

          if (daysAfterApproval < -1 || daysAfterApproval > FUZZY_MATCH_WINDOW_DAYS) continue
          if (!isDirectionCompatible(direction, evt.action_type)) continue

          claimedEventIds.add(evt.id)
          matched.push(buildMatchedExecution(evt, 'fuzzy_match', daysAfterApproval))
          break // Take first fuzzy match only
        }
      }

      // Derive execution status
      let executionStatus: ExecutionMatchStatus
      if (matched.length > 0) {
        const hasExplicit = matched.some(m => m.match_method === 'explicit_link')
        executionStatus = hasExplicit ? 'executed' : 'possible_match'
      } else if (daysSinceDecision !== null && daysSinceDecision > UNMATCHED_THRESHOLD_DAYS) {
        executionStatus = 'unmatched'
      } else {
        executionStatus = 'pending'
      }

      const firstLag = matched.length > 0 ? matched[0].lag_days : null

      // ── Derive impact metrics using centralized helpers ──
      const executionPrice = matched.length > 0 ? matched[0].execution_price : null

      const moveSinceDecision = computeDirectionalMove(direction, decisionPrice, currentPrice)
      const moveSinceExecution = computeDirectionalMove(direction, executionPrice, currentPrice)
      const delayCost = computeDelayCost(direction, decisionPrice, executionPrice)
      const resultDir = computeResultDirection(moveSinceDecision, moveSinceExecution)

      // ── Size-aware impact (from first matched execution) ──
      const firstExec = matched.length > 0 ? matched[0] : null
      const { notional: tradeNotional, basis: sizeBasis } = firstExec
        ? computeTradeNotional(firstExec)
        : { notional: null as number | null, basis: null as SizeBasis }
      const weightImpact = firstExec?.weight_delta ?? null

      // Impact proxy = trade_notional × best available directionalized move / 100
      const bestMove = moveSinceDecision ?? moveSinceExecution
      const impactProxy = tradeNotional != null && bestMove != null
        ? (tradeNotional * bestMove) / 100
        : null

      // Weighted delay cost = trade_notional × delay_cost_pct / 100
      const weightedDelayCost = tradeNotional != null && delayCost != null
        ? (tradeNotional * delayCost) / 100
        : null

      return {
        decision_id: item.id,
        created_at: item.created_at,
        approved_at: item.approved_at,
        direction,
        stage: (item.status === 'executed' ? 'approved' : item.status) as any,
        rationale_text: item.rationale || null,
        asset_id: item.asset_id,
        asset_symbol: item.assets?.symbol || null,
        asset_name: item.assets?.company_name || null,
        portfolio_id: item.portfolio_id,
        portfolio_name: item.portfolios?.name || null,
        owner_name: formatUserName(item.created_by_user),
        approver_name: formatUserName(item.approved_by_user),
        execution_status: executionStatus,
        matched_executions: matched,
        execution_lag_days: firstLag,
        days_since_decision: daysSinceDecision,
        decision_price: decisionPrice,
        decision_price_at: decisionPriceAt,
        has_decision_price: hasDecisionPrice,
        current_price: currentPrice,
        execution_price: executionPrice,
        move_since_decision_pct: moveSinceDecision,
        move_since_execution_pct: moveSinceExecution,
        result_direction: resultDir,
        delay_cost_pct: delayCost,
        trade_notional: tradeNotional,
        size_basis: sizeBasis,
        weight_impact: weightImpact,
        impact_proxy: impactProxy,
        weighted_delay_cost: weightedDelayCost,
      }
    })
  }, [decisionData, eventData, rationalesQuery.data, pricesQuery.data, snapshotsQuery.data])

  // ── Step 7: Apply client-side filters ─────────────────────────
  const filteredRows = useMemo(() => {
    let result = rows

    // Asset search
    if (filters?.assetSearch) {
      const q = filters.assetSearch.toLowerCase()
      result = result.filter(r =>
        r.asset_symbol?.toLowerCase().includes(q) ||
        r.asset_name?.toLowerCase().includes(q)
      )
    }

    // Execution status filter
    if (filters?.executionStatus && filters.executionStatus.length > 0) {
      result = result.filter(r => filters.executionStatus!.includes(r.execution_status))
    }

    // Result direction filter
    if (filters?.resultFilter && filters.resultFilter !== 'all') {
      result = result.filter(r => r.result_direction === filters.resultFilter)
    }

    // Direction filter
    if (filters?.directionFilter && filters.directionFilter.length > 0) {
      result = result.filter(r => filters.directionFilter!.includes(r.direction))
    }

    // Review status filter
    if (filters?.reviewFilter && filters.reviewFilter !== 'all') {
      result = result.filter(r => {
        const isExecuted = r.execution_status === 'executed'
        const hasAny = r.matched_executions.some(e => e.has_rationale)
        const hasComplete = r.matched_executions.some(e => e.rationale_status === 'complete' || e.rationale_status === 'reviewed')
        const hasReviewed = r.matched_executions.some(e => e.rationale_status === 'reviewed')
        if (filters.reviewFilter === 'needs_review') return isExecuted && !hasAny
        if (filters.reviewFilter === 'in_progress') return isExecuted && hasAny && !hasComplete
        if (filters.reviewFilter === 'captured') return isExecuted && hasComplete && !hasReviewed
        if (filters.reviewFilter === 'reviewed') return isExecuted && hasReviewed
        return true
      })
    }

    return result
  }, [rows, filters?.assetSearch, filters?.executionStatus, filters?.resultFilter, filters?.directionFilter, filters?.reviewFilter])

  // ── Step 8: Compute unmatched executions ──────────────────────
  const unmatchedExecutions: UnmatchedExecution[] = useMemo(() => {
    const claimedIds = new Set<string>()
    for (const row of rows) {
      for (const m of row.matched_executions) {
        claimedIds.add(m.event_id)
      }
    }

    return eventData
      .filter((evt: any) =>
        !claimedIds.has(evt.id) &&
        !evt.linked_trade_idea_id
      )
      .map((evt: any): UnmatchedExecution => ({
        event_id: evt.id,
        event_date: evt.event_date,
        action_type: evt.action_type,
        source_type: evt.source_type,
        quantity_delta: evt.quantity_delta,
        weight_delta: evt.weight_delta,
        asset_id: evt.asset_id,
        asset_symbol: evt.assets?.symbol || null,
        asset_name: evt.assets?.company_name || null,
        portfolio_id: evt.portfolio_id,
        portfolio_name: evt.portfolios?.name || null,
        status: evt.status,
        has_rationale: false,
      }))
  }, [rows, eventData])

  // ── Step 9: Summary stats (operational + snapshot-backed impact) ─
  const summary: AccountabilitySummary = useMemo(() => {
    const approved = filteredRows.filter(r => r.stage === 'approved')
    const executed = approved.filter(r => r.execution_status === 'executed')
    const pending = approved.filter(r => r.execution_status === 'pending')
    const possibleMatch = approved.filter(r => r.execution_status === 'possible_match')
    const unmatched = approved.filter(r => r.execution_status === 'unmatched')

    // Avg lag
    const lags = filteredRows
      .filter(r => r.execution_lag_days !== null && r.execution_lag_days >= 0)
      .map(r => r.execution_lag_days!)
    const avgLag = lags.length > 0
      ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length)
      : null

    // Impact metrics — move since decision (where snapshot exists)
    const withDecisionMoves = filteredRows.filter(r => r.move_since_decision_pct !== null)
    const avgMoveDecision = withDecisionMoves.length > 0
      ? withDecisionMoves.reduce((sum, r) => sum + r.move_since_decision_pct!, 0) / withDecisionMoves.length
      : null

    // Impact metrics — move since execution (executed with price data)
    const withExecMoves = filteredRows.filter(r =>
      r.move_since_execution_pct !== null &&
      (r.execution_status === 'executed' || r.execution_status === 'possible_match')
    )
    const avgMoveExec = withExecMoves.length > 0
      ? withExecMoves.reduce((sum, r) => sum + r.move_since_execution_pct!, 0) / withExecMoves.length
      : null

    // Impact metrics — delay cost (where both prices available)
    const withDelayCost = filteredRows.filter(r => r.delay_cost_pct !== null)
    const avgDelay = withDelayCost.length > 0
      ? withDelayCost.reduce((sum, r) => sum + r.delay_cost_pct!, 0) / withDelayCost.length
      : null

    const positiveCount = filteredRows.filter(r => r.result_direction === 'positive').length
    const negativeCount = filteredRows.filter(r => r.result_direction === 'negative').length

    // Execution rate
    const execRate = approved.length > 0
      ? Math.round((executed.length + possibleMatch.length) / approved.length * 100)
      : null

    // Snapshot coverage
    const snapshotCoverage = filteredRows.filter(r => r.has_decision_price).length

    // ── Size-aware impact metrics ──
    const withImpact = filteredRows.filter(r => r.impact_proxy !== null)
    const netImpactProxy = withImpact.length > 0
      ? withImpact.reduce((sum, r) => sum + r.impact_proxy!, 0)
      : null

    const withWeightedDelay = filteredRows.filter(r => r.weighted_delay_cost !== null)
    const totalWeightedDelayCost = withWeightedDelay.length > 0
      ? withWeightedDelay.reduce((sum, r) => sum + Math.abs(r.weighted_delay_cost!), 0)
      : null

    const sizedDecisionCount = filteredRows.filter(r => r.trade_notional !== null).length

    // Top positive / negative impact symbols
    let topPositiveSymbol: string | null = null
    let topNegativeSymbol: string | null = null
    if (withImpact.length > 0) {
      const sorted = [...withImpact].sort((a, b) => (b.impact_proxy ?? 0) - (a.impact_proxy ?? 0))
      const top = sorted[0]
      const bottom = sorted[sorted.length - 1]
      if (top.impact_proxy != null && top.impact_proxy > 0) topPositiveSymbol = top.asset_symbol
      if (bottom.impact_proxy != null && bottom.impact_proxy < 0) topNegativeSymbol = bottom.asset_symbol
    }

    return {
      totalDecisions: filteredRows.length,
      approvedCount: approved.length,
      rejectedCount: filteredRows.filter(r => r.stage === 'rejected').length,
      cancelledCount: filteredRows.filter(r => r.stage === 'cancelled').length,
      executedCount: executed.length,
      pendingCount: pending.length,
      possibleMatchCount: possibleMatch.length,
      unmatchedCount: unmatched.length,
      avgLagDays: avgLag,
      unmatchedExecutionCount: unmatchedExecutions.length,
      avgMoveSinceDecision: avgMoveDecision !== null ? Math.round(avgMoveDecision * 100) / 100 : null,
      avgMoveSinceExecution: avgMoveExec !== null ? Math.round(avgMoveExec * 100) / 100 : null,
      avgDelayCost: avgDelay !== null ? Math.round(avgDelay * 100) / 100 : null,
      positiveResultCount: positiveCount,
      negativeResultCount: negativeCount,
      executionRate: execRate,
      snapshotCoverage,
      netImpactProxy: netImpactProxy !== null ? Math.round(netImpactProxy) : null,
      totalWeightedDelayCost: totalWeightedDelayCost !== null ? Math.round(totalWeightedDelayCost) : null,
      sizedDecisionCount,
      topPositiveSymbol,
      topNegativeSymbol,
      // Review workflow counts (rationale_status-aware)
      needsReviewCount: executed.filter(r => !r.matched_executions.some(e => e.has_rationale)).length,
      reviewInProgressCount: executed.filter(r =>
        r.matched_executions.some(e => e.has_rationale) &&
        !r.matched_executions.some(e => e.rationale_status === 'complete' || e.rationale_status === 'reviewed')
      ).length,
      reviewCapturedCount: executed.filter(r =>
        r.matched_executions.some(e => e.rationale_status === 'complete' || e.rationale_status === 'reviewed')
      ).length,
    }
  }, [filteredRows, unmatchedExecutions])

  return {
    rows: filteredRows,
    unmatchedExecutions,
    summary,
    isLoading: decisionsQuery.isLoading || eventsQuery.isLoading,
    isError: decisionsQuery.isError || eventsQuery.isError,
    refetch: () => {
      decisionsQuery.refetch()
      eventsQuery.refetch()
      rationalesQuery.refetch()
      pricesQuery.refetch()
      snapshotsQuery.refetch()
    },
  }
}

// ============================================================
// Filter helpers (re-exported for the page)
// ============================================================

export function usePortfoliosForFilter() {
  return useQuery({
    queryKey: ['portfolios-for-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('portfolios').select('id, name').order('name')
      if (error) throw error
      return data || []
    },
  })
}

export function useUsersForFilter() {
  return useQuery({
    queryKey: ['users-for-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, email, first_name, last_name').order('first_name')
      if (error) throw error
      return data || []
    },
  })
}

// =============================================================================
// Decision Story — full upstream/downstream context for post-mortem review.
// Fetches data not available on the main AccountabilityRow: theses, analyst
// recommendation, PM decision note, acceptance context, full execution
// rationale, and linked research.
// =============================================================================

export interface DecisionStory {
  // Theses (bull/bear/catalyst)
  theses: Array<{
    id: string
    direction: string
    rationale: string
    conviction: string | null
    created_by_name: string | null
    created_at: string
  }>

  // Decision request (analyst recommendation → PM decision)
  decisionRequest: {
    id: string
    urgency: string | null
    context_note: string | null
    decision_note: string | null
    status: string
    submission_snapshot: Record<string, unknown> | null
    requester_name: string | null
    reviewed_by_name: string | null
    reviewed_at: string | null
    created_at: string
  } | null

  // Accepted trade (Trade Book commitment)
  acceptedTrade: {
    id: string
    acceptance_note: string | null
    price_at_acceptance: number | null
    execution_status: string
    execution_note: string | null
    source: string
    created_at: string
  } | null

  // Full execution rationale (from trade_event_rationales)
  executionRationale: {
    id: string
    reason_for_action: string | null
    why_now: string | null
    what_changed: string | null
    thesis_context: string | null
    catalyst_trigger: string | null
    sizing_logic: string | null
    risk_context: string | null
    execution_context: string | null
    divergence_from_plan: boolean
    divergence_explanation: string | null
    rationale_type: string | null
    status: string
    authored_by_name: string | null
    reviewed_by_name: string | null
    created_at: string
  } | null

  // Linked research count
  linkedResearchCount: number

  // Trade idea extra fields
  ideaExtras: {
    conviction: string | null
    time_horizon: string | null
    urgency: string | null
    thesis_text: string | null
  } | null
}

export function useDecisionStory(decisionId: string | null, executionEventId?: string | null) {
  return useQuery<DecisionStory | null>({
    queryKey: ['decision-story', decisionId, executionEventId],
    enabled: !!decisionId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!decisionId) return null

      // Run all queries in parallel
      const [thesesRes, drRes, atRes, ratRes, linksRes, ideaRes] = await Promise.all([
        // 1. Theses for this idea
        supabase
          .from('trade_idea_theses')
          .select('id, direction, rationale, conviction, created_at, users:created_by(first_name, last_name, email)')
          .eq('trade_queue_item_id', decisionId)
          .order('created_at', { ascending: true }),

        // 2. Decision request (latest for this idea)
        supabase
          .from('decision_requests')
          .select('id, urgency, context_note, decision_note, status, submission_snapshot, created_at, reviewed_at, requester:requested_by(first_name, last_name, email), reviewer:reviewed_by(first_name, last_name, email)')
          .eq('trade_queue_item_id', decisionId)
          .in('status', ['accepted', 'accepted_with_modification', 'rejected', 'deferred'])
          .order('created_at', { ascending: false })
          .limit(1),

        // 3. Accepted trade (latest active for this idea)
        supabase
          .from('accepted_trades')
          .select('id, acceptance_note, price_at_acceptance, execution_status, execution_note, source, created_at')
          .eq('trade_queue_item_id', decisionId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1),

        // 4. Execution rationale (for the matched execution event, if any)
        executionEventId
          ? supabase
              .from('trade_event_rationales')
              .select('id, reason_for_action, why_now, what_changed, thesis_context, catalyst_trigger, sizing_logic, risk_context, execution_context, divergence_from_plan, divergence_explanation, rationale_type, status, created_at, author:authored_by(first_name, last_name, email), reviewer:reviewed_by(first_name, last_name, email)')
              .eq('trade_event_id', executionEventId)
              .order('version_number', { ascending: false })
              .limit(1)
          : Promise.resolve({ data: null, error: null }),

        // 5. Linked research count
        supabase
          .from('object_links')
          .select('id', { count: 'exact', head: true })
          .eq('target_type', 'trade_idea')
          .eq('target_id', decisionId),

        // 6. Trade idea extra fields
        supabase
          .from('trade_queue_items')
          .select('conviction, time_horizon, urgency, thesis_text')
          .eq('id', decisionId)
          .single(),
      ])

      // Format user names
      const userName = (u: any) => u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || null : null

      return {
        theses: (thesesRes.data || []).map((t: any) => ({
          id: t.id,
          direction: t.direction,
          rationale: t.rationale,
          conviction: t.conviction,
          created_by_name: userName(t.users),
          created_at: t.created_at,
        })),

        decisionRequest: drRes.data?.[0] ? {
          id: drRes.data[0].id,
          urgency: drRes.data[0].urgency,
          context_note: drRes.data[0].context_note,
          decision_note: drRes.data[0].decision_note,
          status: drRes.data[0].status,
          submission_snapshot: drRes.data[0].submission_snapshot as Record<string, unknown> | null,
          requester_name: userName(drRes.data[0].requester),
          reviewed_by_name: userName(drRes.data[0].reviewer),
          reviewed_at: drRes.data[0].reviewed_at,
          created_at: drRes.data[0].created_at,
        } : null,

        acceptedTrade: atRes.data?.[0] ? {
          id: atRes.data[0].id,
          acceptance_note: atRes.data[0].acceptance_note,
          price_at_acceptance: atRes.data[0].price_at_acceptance ? Number(atRes.data[0].price_at_acceptance) : null,
          execution_status: atRes.data[0].execution_status,
          execution_note: atRes.data[0].execution_note,
          source: atRes.data[0].source,
          created_at: atRes.data[0].created_at,
        } : null,

        executionRationale: ratRes.data?.[0] ? {
          id: ratRes.data[0].id,
          reason_for_action: ratRes.data[0].reason_for_action,
          why_now: ratRes.data[0].why_now,
          what_changed: ratRes.data[0].what_changed,
          thesis_context: ratRes.data[0].thesis_context,
          catalyst_trigger: ratRes.data[0].catalyst_trigger,
          sizing_logic: ratRes.data[0].sizing_logic,
          risk_context: ratRes.data[0].risk_context,
          execution_context: ratRes.data[0].execution_context,
          divergence_from_plan: ratRes.data[0].divergence_from_plan ?? false,
          divergence_explanation: ratRes.data[0].divergence_explanation,
          rationale_type: ratRes.data[0].rationale_type,
          status: ratRes.data[0].status,
          authored_by_name: userName(ratRes.data[0].author),
          reviewed_by_name: userName(ratRes.data[0].reviewer),
          created_at: ratRes.data[0].created_at,
        } : null,

        linkedResearchCount: linksRes.count ?? 0,

        ideaExtras: ideaRes.data ? {
          conviction: ideaRes.data.conviction,
          time_horizon: ideaRes.data.time_horizon,
          urgency: ideaRes.data.urgency,
          thesis_text: ideaRes.data.thesis_text,
        } : null,
      }
    },
  })
}

// =============================================================================
// Save post-mortem rationale from Outcomes (canonical post-mortem authoring path).
// Reuses trade_event_rationales via saveRationale() from trade-event-service.
// =============================================================================

import { saveRationale, markRationaleAsReviewed } from '../lib/services/trade-event-service'
import type { SaveRationaleParams } from '../types/trade-journal'

export function useSavePostMortem(decisionId: string | null, executionEventId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (fields: Omit<SaveRationaleParams, 'trade_event_id'>) => {
      if (!executionEventId) throw new Error('No execution event to attach rationale to')
      return saveRationale({ ...fields, trade_event_id: executionEventId }, undefined)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-story', decisionId, executionEventId] })
      queryClient.invalidateQueries({ queryKey: ['decision-accountability'] })
    },
  })
}

/**
 * Mark a completed post-mortem as reviewed.
 * Promotes status: complete → reviewed, sets reviewed_by/reviewed_at.
 * Editing a reviewed post-mortem naturally demotes via useSavePostMortem (draft or complete).
 */
export function useMarkAsReviewed(decisionId: string | null, executionEventId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!executionEventId) throw new Error('No execution event')
      return markRationaleAsReviewed(executionEventId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-story', decisionId, executionEventId] })
      queryClient.invalidateQueries({ queryKey: ['decision-accountability'] })
    },
  })
}
