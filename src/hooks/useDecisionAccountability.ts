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

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
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

  // ── Single RPC call: fetches decisions, events, rationales,
  //    asset prices, decision-time snapshots, and accepted-trade
  //    note rollups in ONE round-trip. Replaces the previous
  //    7-chained-query pattern that took ~900ms cold; this typically
  //    lands in ~300ms. The RPC runs SECURITY INVOKER so RLS scopes
  //    every inner SELECT exactly as before.
  const outcomesPayloadQuery = useQuery({
    queryKey: ['outcomes-payload', filters],
    queryFn: async () => {
      const filterPayload: Record<string, any> = {
        showApproved: filters?.showApproved !== false,
        showRejected: !!filters?.showRejected,
        showCancelled: !!filters?.showCancelled,
      }
      if (filters?.dateRange?.start) filterPayload.dateStart = filters.dateRange.start
      else if (!filters?.dateRange) filterPayload.dateStart = subDays(new Date(), 90).toISOString()
      if (filters?.dateRange?.end) filterPayload.dateEnd = filters.dateRange.end
      if (filters?.portfolioIds && filters.portfolioIds.length > 0) {
        filterPayload.portfolioIds = filters.portfolioIds
      }
      if (filters?.ownerUserIds && filters.ownerUserIds.length > 0) {
        filterPayload.ownerUserIds = filters.ownerUserIds
      }

      const { data, error } = await supabase.rpc('outcomes_payload', { p_filters: filterPayload })
      if (error) throw error
      return (data || {}) as {
        decisions?: any[]
        events?: any[]
        rationales?: Array<{ trade_event_id: string; status: string | null; reason_for_action: string | null }>
        prices?: Array<{ id: string; current_price: number | string | null }>
        snapshots?: Array<{ trade_queue_item_id: string; snapshot_price: number | string; snapshot_at: string }>
        acceptedTrades?: Array<{
          id: string; trade_queue_item_id: string; acceptance_note: string | null
          note_count: number | string; latest_note: string | null
        }>
      }
    },
    enabled,
    // The RPC's downstream consumers all explicitly invalidate
    // 'decision-accountability' or this exact key when they mutate,
    // so a 5-minute window is generous and keeps revisits instant.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  })

  // ── Stub query handles for backward-compatible API ────────────
  // The downstream useMemo + the hook return both reference these
  // names. Keeping the same `.data / .isLoading / .isError / .refetch`
  // shape avoids touching ~600 lines of consumer code.
  const decisionsQuery = {
    data: outcomesPayloadQuery.data?.decisions ?? [],
    isLoading: outcomesPayloadQuery.isLoading,
    isError: outcomesPayloadQuery.isError,
    refetch: () => outcomesPayloadQuery.refetch(),
  }
  const eventsQuery = {
    data: outcomesPayloadQuery.data?.events ?? [],
    isLoading: outcomesPayloadQuery.isLoading,
    isError: outcomesPayloadQuery.isError,
    refetch: () => outcomesPayloadQuery.refetch(),
  }

  const decisionData = decisionsQuery.data

  // ── Derive the same shapes the old useQueries returned, but
  //    sliced from the single RPC payload above. Stable references
  //    via useMemo so the downstream rows useMemo (which has these
  //    in its dep list) only recomputes when RPC data actually
  //    changes — same behavior as before, fewer round-trips.
  const eventData = useMemo(
    () => outcomesPayloadQuery.data?.events ?? [],
    [outcomesPayloadQuery.data?.events],
  )

  const rationalesData = useMemo(() => {
    const map = new Map<string, RationaleInfo>()
    for (const r of outcomesPayloadQuery.data?.rationales ?? []) {
      map.set(r.trade_event_id, {
        status: r.status as any,
        summary: r.reason_for_action || null,
      })
    }
    return map
  }, [outcomesPayloadQuery.data?.rationales])
  const rationalesQuery = { data: rationalesData }

  const pricesData = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of outcomesPayloadQuery.data?.prices ?? []) {
      if (a.current_price != null) map.set(a.id, Number(a.current_price))
    }
    return map
  }, [outcomesPayloadQuery.data?.prices])
  const pricesQuery = { data: pricesData }

  const snapshotsData = useMemo(() => {
    const map = new Map<string, { price: number; at: string }>()
    for (const s of outcomesPayloadQuery.data?.snapshots ?? []) {
      map.set(s.trade_queue_item_id, {
        price: Number(s.snapshot_price),
        at: s.snapshot_at,
      })
    }
    return map
  }, [outcomesPayloadQuery.data?.snapshots])
  const snapshotsQuery = { data: snapshotsData }

  const acceptedTradesData = useMemo(() => {
    const byDecisionId = new Map<
      string,
      { id: string; acceptance_note: string | null; latest_note: string | null; note_count: number }
    >()
    for (const at of outcomesPayloadQuery.data?.acceptedTrades ?? []) {
      if (!at.trade_queue_item_id) continue
      byDecisionId.set(at.trade_queue_item_id, {
        id: at.id,
        acceptance_note: at.acceptance_note,
        latest_note: at.latest_note,
        note_count: Number(at.note_count) || 0,
      })
    }
    return { byDecisionId }
  }, [outcomesPayloadQuery.data?.acceptedTrades])
  const acceptedTradesQuery = { data: acceptedTradesData }

  // ── Step 5b: Fetch passed decisions (rejected/deferred) ────────
  const passedDecisionsQuery = useQuery({
    queryKey: ['decision-accountability', 'passed', filters?.portfolioIds, filters?.dateRange],
    queryFn: async () => {
      let q = supabase
        .from('decision_requests')
        .select(`
          id, status, decision_note, urgency, requested_action,
          reviewed_by, reviewed_at, created_at, deferred_until,
          portfolio_id,
          portfolios:portfolio_id ( id, name ),
          trade_idea:trade_queue_items!inner (
            id, rationale, thesis_text, asset_id, origin_metadata,
            assets:asset_id ( id, symbol, company_name ),
            created_by_user:created_by ( id, email, first_name, last_name )
          ),
          reviewer:reviewed_by ( id, email, first_name, last_name )
        `)
        .in('status', ['rejected', 'deferred'])

      // Date filter
      const dateStart = filters?.dateRange?.start
      if (dateStart) {
        q = q.gte('created_at', dateStart)
      } else if (!filters?.dateRange) {
        q = q.gte('created_at', subDays(new Date(), 90).toISOString())
      }
      if (filters?.dateRange?.end) {
        q = q.lte('created_at', filters.dateRange.end)
      }

      // Portfolio filter
      if (filters?.portfolioIds && filters.portfolioIds.length > 0) {
        q = q.in('portfolio_id', filters.portfolioIds)
      }

      q = q.order('created_at', { ascending: false }).limit(200)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    enabled: enabled && (filters?.showRejected !== false),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  })

  const passedData = passedDecisionsQuery.data || []

  // ── Step 6: Match decisions to executions + enrich with impact ─
  const rows: AccountabilityRow[] = useMemo(() => {
    const events = eventData
    const rationaleMap = rationalesQuery.data || new Map<string, RationaleInfo>()
    const priceMap = pricesQuery.data || new Map<string, number>()
    const snapshotMap = snapshotsQuery.data || new Map<string, { price: number; at: string }>()
    const acceptedByDecision = acceptedTradesQuery.data?.byDecisionId
      || new Map<string, { id: string; acceptance_note: string | null; latest_note: string | null; note_count: number }>()
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

    const decisionRows = decisionData.map((item: any): AccountabilityRow => {
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

      // Derive effective stage:
      // - 'executed' legacy status → treat as approved
      // - visibility_tier='archive' or deleted_at set on an approved item → cancelled
      // - otherwise use status directly
      let effectiveStage = item.status as string
      if (effectiveStage === 'executed') effectiveStage = 'approved'
      if (
        effectiveStage === 'approved' &&
        (item.visibility_tier === 'archive' || item.visibility_tier === 'trash' || item.deleted_at)
      ) {
        effectiveStage = 'cancelled'
      }

      const isApproved = effectiveStage === 'approved'

      // Non-approved decisions don't need execution matching
      if (!isApproved) {
        // For rejected/cancelled decisions with a snapshot, still compute move since decision
        const moveSinceDecision = computeDirectionalMove(direction, decisionPrice, currentPrice)
        const resultDir = computeResultDirection(moveSinceDecision, null)

        return {
          decision_id: item.id,
          created_at: item.created_at,
          approved_at: item.approved_at,
          source: 'decision' as const,
          category: 'passed' as const,
          direction,
          stage: effectiveStage as any,
          rationale_text: item.rationale || null,
          decision_note: null,
          deferred_until: null,
          asset_id: item.asset_id,
          asset_symbol: item.assets?.symbol || null,
          asset_name: item.assets?.company_name || null,
          portfolio_id: item.portfolio_id,
          portfolio_name: item.portfolios?.name || null,
          owner_name: (item as any).origin_metadata?.pilot_seed ? 'Pilot' : formatUserName(item.created_by_user),
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

      // Merge in the accepted_trade's canonical rationale — it lives on
      // `accepted_trades.acceptance_note` (+ accepted_trade_comments for
      // follow-on notes) and is the same surface the Trade Book shows.
      // Without this the Decisions view only read from the legacy
      // `trade_event_rationales` table and missed every rationale set
      // at commit time or added via the "Add note" button.
      //
      // Precedence for the displayed summary (newest / most-trade-specific
      // context first):
      //   1. Latest user-added note (from accepted_trade_comments)
      //   2. acceptance_note if it wasn't inherited from the batch
      //   3. acceptance_note inherited from the batch (last resort)
      const acceptedForDecision = acceptedByDecision.get(item.id)
      if (acceptedForDecision) {
        const trimmedNote = (acceptedForDecision.acceptance_note || '').trim()
        const latestFollowOn = (acceptedForDecision.latest_note || '').trim()
        const followOnCount = acceptedForDecision.note_count
        const hasAnyRationale = trimmedNote.length > 0 || followOnCount > 0
        const preferredSummary = latestFollowOn || trimmedNote
        if (hasAnyRationale) {
          for (const m of matched) {
            if (!m.has_rationale) {
              m.has_rationale = true
            }
            // Stamp `complete` so downstream `getReviewState` classifies
            // the row as 'captured' — otherwise the UI still shows a
            // "Capture rationale" action chip even though the PM has
            // already written a rationale on the accepted_trade.
            if (!m.rationale_status || m.rationale_status === 'in_progress') {
              m.rationale_status = 'complete'
            }
            // Always prefer the accepted_trade rationale — the legacy
            // `trade_event_rationales` summary rarely stays in sync with
            // what a PM sees in the Trade Book panel.
            if (preferredSummary) {
              m.execution_rationale_summary = preferredSummary
            }
          }
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
        source: 'decision' as const,
        category: 'acted' as const,
        direction,
        stage: effectiveStage as any,
        rationale_text: item.rationale || null,
        decision_note: null,
        deferred_until: null,
        asset_id: item.asset_id,
        asset_symbol: item.assets?.symbol || null,
        asset_name: item.assets?.company_name || null,
        portfolio_id: item.portfolio_id,
        portfolio_name: item.portfolios?.name || null,
        owner_name: (item as any).origin_metadata?.pilot_seed ? 'Pilot' : formatUserName(item.created_by_user),
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

    // Merge in discretionary trade events (no linked decision) as their own rows
    const claimedIds = new Set<string>()
    for (const row of decisionRows) {
      for (const m of row.matched_executions) claimedIds.add(m.event_id)
    }

    const discretionaryRows: AccountabilityRow[] = eventData
      .filter((evt: any) => !claimedIds.has(evt.id) && !evt.linked_trade_idea_id)
      .map((evt: any): AccountabilityRow => {
        const action = evt.action_type || 'other'
        const direction = (['initiate', 'add', 'increase'].includes(action) ? 'buy'
          : ['exit', 'trim', 'reduce'].includes(action) ? 'sell'
          : 'unknown') as any

        const currentPrice = evt.asset_id ? (priceMap.get(evt.asset_id) ?? null) : null
        const execPrice = deriveExecutionPrice(
          evt.market_value_before, evt.market_value_after,
          evt.quantity_before, evt.quantity_after,
        )
        const moveSinceExec = computeDirectionalMove(direction, execPrice, currentPrice)
        const resultDir = computeResultDirection(null, moveSinceExec)
        const { notional, basis } = computeTradeNotional({
          market_value_before: evt.market_value_before ?? null,
          market_value_after: evt.market_value_after ?? null,
          quantity_delta: evt.quantity_delta ?? null,
          execution_price: execPrice,
          weight_delta: evt.weight_delta ?? null,
        } as any)

        return {
          decision_id: evt.id,
          created_at: evt.created_at || evt.event_date,
          approved_at: null,
          source: 'discretionary',
          category: 'acted' as const,
          direction,
          stage: 'approved' as any, // treat as "happened"
          rationale_text: null,
          decision_note: null,
          deferred_until: null,
          asset_id: evt.asset_id,
          asset_symbol: evt.assets?.symbol || null,
          asset_name: evt.assets?.company_name || null,
          portfolio_id: evt.portfolio_id,
          portfolio_name: evt.portfolios?.name || null,
          owner_name: null,
          approver_name: null,
          execution_status: 'executed',
          matched_executions: [{
            event_id: evt.id,
            event_date: evt.event_date,
            action_type: action,
            source_type: evt.source_type,
            quantity_delta: evt.quantity_delta,
            weight_delta: evt.weight_delta,
            match_method: 'explicit_link' as const,
            rationale_status: null,
            has_rationale: false,
            execution_rationale_summary: null,
            lag_days: null,
            market_value_before: evt.market_value_before ?? null,
            market_value_after: evt.market_value_after ?? null,
            quantity_before: evt.quantity_before ?? null,
            quantity_after: evt.quantity_after ?? null,
            execution_price: execPrice,
            weight_before: evt.weight_before ?? null,
            weight_after: evt.weight_after ?? null,
          }],
          execution_lag_days: null,
          days_since_decision: null,
          decision_price: null,
          decision_price_at: null,
          has_decision_price: false,
          current_price: currentPrice,
          execution_price: execPrice,
          move_since_decision_pct: null,
          move_since_execution_pct: moveSinceExec,
          result_direction: resultDir,
          delay_cost_pct: null,
          trade_notional: notional,
          size_basis: basis,
          weight_impact: evt.weight_delta ?? null,
          impact_proxy: notional != null && moveSinceExec != null ? (notional * moveSinceExec) / 100 : null,
          weighted_delay_cost: null,
        }
      })

    // ── Passed decisions (rejected/deferred) ──
    const passedRows: AccountabilityRow[] = passedData.map((d: any) => {
      const ti = d.trade_idea
      const assetId = ti?.asset_id || null
      const currentPrice = assetId ? (priceMap.get(assetId) ?? null) : null
      const direction = mapActionToDirection(d.requested_action || 'unknown')
      const decidedAt = d.reviewed_at || d.created_at
      const daysSince = decidedAt ? differenceInDays(now, parseISO(decidedAt)) : null

      // For passed decisions, compute what would have happened (move since decision)
      const snapshotForIdea = ti?.id ? (snapshotMap.get(ti.id) ?? null) : null
      const decisionPrice = snapshotForIdea?.price ?? null
      const moveSinceDecision = computeDirectionalMove(direction, decisionPrice, currentPrice)
      const resultDir = computeResultDirection(moveSinceDecision, null)

      return {
        decision_id: d.id,
        created_at: d.created_at,
        approved_at: decidedAt,
        source: 'decision' as const,
        category: 'passed' as const,
        direction,
        stage: (d.status === 'deferred' ? 'rejected' : d.status) as any,
        rationale_text: ti?.rationale || ti?.thesis_text || null,
        decision_note: d.decision_note || null,
        deferred_until: d.deferred_until || null,
        asset_id: assetId,
        asset_symbol: ti?.assets?.symbol || null,
        asset_name: ti?.assets?.company_name || null,
        portfolio_id: d.portfolio_id,
        portfolio_name: d.portfolios?.name || null,
        owner_name: (ti as any)?.origin_metadata?.pilot_seed ? 'Pilot' : formatUserName(ti?.created_by_user),
        approver_name: formatUserName(d.reviewer),
        execution_status: 'not_applicable' as const,
        matched_executions: [],
        execution_lag_days: null,
        days_since_decision: daysSince,
        decision_price: decisionPrice,
        decision_price_at: snapshotForIdea?.at ?? null,
        has_decision_price: decisionPrice != null,
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
    })

    return [...decisionRows, ...discretionaryRows, ...passedRows]
  }, [decisionData, eventData, passedData, rationalesQuery.data, pricesQuery.data, snapshotsQuery.data, acceptedTradesQuery.data])

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
    isLoading: outcomesPayloadQuery.isLoading,
    isError: outcomesPayloadQuery.isError,
    refetch: () => {
      outcomesPayloadQuery.refetch()
      passedDecisionsQuery.refetch()
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

// Standalone fetcher reused by both the hook and the page-level
// prefetch effect. One RPC round-trip replaces the prior 6 parallel
// supabase reads — the right pane can paint as soon as the click
// resolves, instead of waiting on the slowest of six.
export async function fetchDecisionStory(
  decisionId: string,
  executionEventId?: string | null,
): Promise<DecisionStory> {
  const { data, error } = await supabase.rpc('decision_story_payload', {
    p_decision_id: decisionId,
    p_execution_event_id: executionEventId ?? null,
  })
  if (error) throw error
  const payload = (data || {}) as any
  return {
    theses: payload.theses || [],
    decisionRequest: payload.decisionRequest ?? null,
    acceptedTrade: payload.acceptedTrade
      ? {
          ...payload.acceptedTrade,
          price_at_acceptance:
            payload.acceptedTrade.price_at_acceptance != null
              ? Number(payload.acceptedTrade.price_at_acceptance)
              : null,
        }
      : null,
    executionRationale: payload.executionRationale ?? null,
    linkedResearchCount: payload.linkedResearchCount ?? 0,
    ideaExtras: payload.ideaExtras ?? null,
  }
}

export function useDecisionStory(decisionId: string | null, executionEventId?: string | null) {
  return useQuery<DecisionStory | null>({
    queryKey: ['decision-story', decisionId, executionEventId],
    enabled: !!decisionId,
    staleTime: 60_000,
    queryFn: () => decisionId ? fetchDecisionStory(decisionId, executionEventId) : Promise.resolve(null),
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

// ============================================================
// Manual Execution Matching
// ============================================================

export interface CandidateTradeEvent {
  id: string
  event_date: string
  action_type: string
  source_type: string
  quantity_delta: number | null
  weight_delta: number | null
  asset_id: string
  asset_symbol: string | null
  asset_name: string | null
  portfolio_id: string
  portfolio_name: string | null
  linked_trade_idea_id: string | null
}

/**
 * Fetch candidate trade events that could match a decision.
 * Filters by same asset + portfolio, within a reasonable window.
 */
export function useCandidateTradeEvents(row: AccountabilityRow | null) {
  return useQuery({
    queryKey: ['candidate-trade-events', row?.decision_id],
    queryFn: async (): Promise<CandidateTradeEvent[]> => {
      if (!row?.asset_id || !row?.portfolio_id) return []

      const { data, error } = await supabase
        .from('portfolio_trade_events')
        .select(`
          id, event_date, action_type, source_type,
          quantity_delta, weight_delta,
          asset_id, portfolio_id,
          linked_trade_idea_id,
          assets:asset_id(symbol, company_name),
          portfolios:portfolio_id(name)
        `)
        .eq('asset_id', row.asset_id)
        .eq('portfolio_id', row.portfolio_id)
        .order('event_date', { ascending: false })
        .limit(20)

      if (error) throw error

      return (data || []).map((evt: any) => ({
        id: evt.id,
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
        linked_trade_idea_id: evt.linked_trade_idea_id,
      }))
    },
    enabled: !!row?.asset_id && !!row?.portfolio_id,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Link a trade event to a decision (manual matching).
 * Sets portfolio_trade_events.linked_trade_idea_id = decision_id.
 */
export function useManualMatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ eventId, decisionId }: { eventId: string; decisionId: string }) => {
      const { error } = await supabase
        .from('portfolio_trade_events')
        .update({ linked_trade_idea_id: decisionId })
        .eq('id', eventId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-accountability'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-trade-events'] })
    },
  })
}

/**
 * Unlink a trade event from a decision (undo manual matching).
 */
export function useUnlinkMatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ eventId }: { eventId: string }) => {
      const { error } = await supabase
        .from('portfolio_trade_events')
        .update({ linked_trade_idea_id: null })
        .eq('id', eventId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-accountability'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-trade-events'] })
    },
  })
}

/**
 * Mark an approved decision as intentionally not executed.
 * Archives the decision with an explanation.
 */
export function useMarkDecisionSkipped() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ decisionId, reason }: { decisionId: string; reason: string }) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({
          outcome_note: `Intentionally skipped: ${reason}`,
          visibility_tier: 'archive' as any,
          archived_at: new Date().toISOString(),
        })
        .eq('id', decisionId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-accountability'] })
    },
  })
}

// ============================================================
// Reflections — lightweight post-mortem comments on any decision
// ============================================================

export interface Reflection {
  id: string
  content: string
  user_id: string
  user_name: string
  created_at: string
}

/**
 * Load reflections for a decision (trade_queue_item_id).
 * Checks both accepted_trade_comments and decision_request_comments
 * via the trade_queue_item_id foreign key.
 */
export function useDecisionReflections(decisionId: string | null) {
  return useQuery({
    queryKey: ['decision-reflections', decisionId],
    queryFn: async (): Promise<{ reflections: Reflection[]; acceptedTradeId: string | null; decisionRequestId: string | null }> => {
      if (!decisionId) return { reflections: [], acceptedTradeId: null, decisionRequestId: null }

      // Single RPC: links + merged comments + resolved display names
      // in one round-trip. Replaces the previous 5-Supabase-call
      // sequence (link lookups → comments × 2 → users) which was the
      // dominant source of the "reflections is hanging" feel.
      const { data, error } = await supabase.rpc('decision_reflections_payload', {
        p_decision_id: decisionId,
      })
      if (error) throw error

      const payload = (data || {}) as {
        reflections?: Reflection[]
        acceptedTradeId?: string | null
        decisionRequestId?: string | null
      }
      return {
        reflections: payload.reflections || [],
        acceptedTradeId: payload.acceptedTradeId ?? null,
        decisionRequestId: payload.decisionRequestId ?? null,
      }
    },
    enabled: !!decisionId,
    // Reflections rarely change outside of the user's own posts (which
    // invalidate this key explicitly via useAddReflection.onSettled), so
    // 5 minutes is plenty and avoids re-fetching on every Outcomes
    // re-render.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    // Fail-fast: a single retry instead of React Query's default 3.
    // Default retries with exponential backoff add up to ~7s of
    // visible "hang" when an inner call is slow or RLS-blocked.
    retry: 1,
  })
}

/**
 * Add a reflection comment to a decision.
 * Routes to accepted_trade_comments or decision_request_comments.
 */
export function useAddReflection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ acceptedTradeId, decisionRequestId, userId, content }: {
      acceptedTradeId: string | null
      decisionRequestId: string | null
      userId: string
      content: string
    }) => {
      if (acceptedTradeId) {
        const { error } = await supabase
          .from('accepted_trade_comments')
          .insert({
            accepted_trade_id: acceptedTradeId,
            user_id: userId,
            content,
            comment_type: 'reflection',
          })
        if (error) throw error
      } else if (decisionRequestId) {
        const { error } = await supabase
          .from('decision_request_comments')
          .insert({
            decision_request_id: decisionRequestId,
            user_id: userId,
            content,
            comment_type: 'reflection',
          })
        if (error) throw error
      } else {
        throw new Error('No linked accepted_trade or decision_request found')
      }
    },
    // Optimistic insert so the new note shows up in the feed immediately.
    // Without this, the user has to wait for the insert + invalidation +
    // refetch round-trip before their reflection appears, which feels
    // broken on a comment-style surface.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['decision-reflections'] })
      const snapshots = queryClient.getQueriesData<{
        reflections: Reflection[]
        acceptedTradeId: string | null
        decisionRequestId: string | null
      }>({ queryKey: ['decision-reflections'] })

      const tempReflection: Reflection = {
        id: `temp-${Date.now()}`,
        content: vars.content,
        user_id: vars.userId,
        user_name: 'You',
        created_at: new Date().toISOString(),
      }

      queryClient.setQueriesData<{
        reflections: Reflection[]
        acceptedTradeId: string | null
        decisionRequestId: string | null
      }>(
        { queryKey: ['decision-reflections'] },
        (old) => {
          if (!old) return old
          // Only add to caches that match the linked decision so other
          // decisions' feeds aren't polluted.
          const matches =
            (vars.acceptedTradeId && old.acceptedTradeId === vars.acceptedTradeId) ||
            (vars.decisionRequestId && old.decisionRequestId === vars.decisionRequestId)
          if (!matches) return old
          return { ...old, reflections: [...old.reflections, tempReflection] }
        },
      )

      return { snapshots }
    },
    onError: (_err, _vars, context) => {
      if (!context?.snapshots) return
      for (const [key, value] of context.snapshots) {
        queryClient.setQueryData(key, value)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-reflections'] })
    },
  })
}

// =============================================================================
// Thesis capture — lets a PM attach a thesis to any idea after the fact.
// Useful for discretionary Trade Lab commits where no formal recommendation
// existed, so the "Idea & Thesis" section is otherwise empty.
// =============================================================================

export function useAddThesis() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      decisionId,
      userId,
      direction,
      rationale,
      conviction,
    }: {
      decisionId: string
      userId: string
      direction: 'bull' | 'bear' | 'neutral'
      rationale: string
      conviction?: 'low' | 'medium' | 'high' | null
    }) => {
      const { error } = await supabase
        .from('trade_idea_theses')
        .insert({
          trade_queue_item_id: decisionId,
          created_by: userId,
          direction,
          rationale,
          conviction: conviction ?? null,
        })
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      // Refresh the decision-story query so the new thesis shows up
      // without a manual reload.
      queryClient.invalidateQueries({ queryKey: ['decision-story', vars.decisionId] })
      queryClient.invalidateQueries({ queryKey: ['decision-story'] })
    },
  })
}
