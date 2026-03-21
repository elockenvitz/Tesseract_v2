/**
 * Trade Event Service
 *
 * Service layer for portfolio trade events and rationale capture.
 * Provides CRUD, detection/ingestion, and query operations.
 */

import { supabase } from '../supabase'
import type {
  PortfolioTradeEvent,
  TradeEventWithDetails,
  TradeEventRationale,
  CreateTradeEventParams,
  SaveRationaleParams,
  TradeEventAction,
  TradeJournalSummary,
} from '../../types/trade-journal'

// ============================================================
// Trade Event CRUD
// ============================================================

export async function getTradeEvents(
  portfolioId: string,
  options?: {
    limit?: number
    status?: string[]
    dateFrom?: string
    dateTo?: string
  }
): Promise<TradeEventWithDetails[]> {
  let query = supabase
    .from('portfolio_trade_events')
    .select(`
      *,
      asset:assets!inner(id, symbol, company_name, sector),
      created_by_user:users!portfolio_trade_events_created_by_fkey(id, email, first_name, last_name),
      linked_trade_idea:trade_queue_items!portfolio_trade_events_linked_trade_idea_id_fkey(id, rationale, action)
    `)
    .eq('portfolio_id', portfolioId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (options?.status && options.status.length > 0) {
    query = query.in('status', options.status)
  }

  if (options?.dateFrom) {
    query = query.gte('event_date', options.dateFrom)
  }

  if (options?.dateTo) {
    query = query.lte('event_date', options.dateTo)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) throw error

  // Fetch latest rationale for each event
  const eventIds = (data || []).map((e: any) => e.id)
  let rationaleMap = new Map<string, TradeEventRationale>()

  if (eventIds.length > 0) {
    const { data: rationales } = await supabase
      .from('trade_event_rationales')
      .select('*')
      .in('trade_event_id', eventIds)
      .order('version_number', { ascending: false })

    if (rationales) {
      for (const r of rationales) {
        // Keep only the latest version per event
        if (!rationaleMap.has(r.trade_event_id)) {
          rationaleMap.set(r.trade_event_id, r as TradeEventRationale)
        }
      }
    }
  }

  return (data || []).map((e: any) => ({
    ...e,
    latest_rationale: rationaleMap.get(e.id) || null,
  })) as TradeEventWithDetails[]
}

export async function createTradeEvent(
  params: CreateTradeEventParams,
  userId?: string
): Promise<PortfolioTradeEvent> {
  const { data, error } = await supabase
    .from('portfolio_trade_events')
    .insert({
      portfolio_id: params.portfolio_id,
      asset_id: params.asset_id,
      source_type: params.source_type || 'manual',
      action_type: params.action_type,
      event_date: params.event_date || new Date().toISOString().split('T')[0],
      quantity_before: params.quantity_before ?? null,
      quantity_after: params.quantity_after ?? null,
      quantity_delta: params.quantity_delta ?? null,
      weight_before: params.weight_before ?? null,
      weight_after: params.weight_after ?? null,
      weight_delta: params.weight_delta ?? null,
      market_value_before: params.market_value_before ?? null,
      market_value_after: params.market_value_after ?? null,
      detected_by_system: params.detected_by_system ?? false,
      linked_trade_idea_id: params.linked_trade_idea_id ?? null,
      linked_trade_sheet_id: params.linked_trade_sheet_id ?? null,
      metadata: params.metadata ?? {},
      status: 'pending_rationale',
      created_by: userId ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data as PortfolioTradeEvent
}

export async function updateTradeEventStatus(
  eventId: string,
  status: string,
  userId?: string
): Promise<void> {
  const { error } = await supabase
    .from('portfolio_trade_events')
    .update({
      status,
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)

  if (error) throw error
}

export async function deleteTradeEvent(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('portfolio_trade_events')
    .delete()
    .eq('id', eventId)

  if (error) throw error
}

// ============================================================
// Rationale CRUD
// ============================================================

export async function getRationalesForEvent(
  tradeEventId: string
): Promise<TradeEventRationale[]> {
  const { data, error } = await supabase
    .from('trade_event_rationales')
    .select('*')
    .eq('trade_event_id', tradeEventId)
    .order('version_number', { ascending: false })

  if (error) throw error
  return (data || []) as TradeEventRationale[]
}

export async function saveRationale(
  params: SaveRationaleParams,
  userId?: string
): Promise<TradeEventRationale> {
  // Check for existing rationale
  const { data: existing } = await supabase
    .from('trade_event_rationales')
    .select('id, version_number')
    .eq('trade_event_id', params.trade_event_id)
    .order('version_number', { ascending: false })
    .limit(1)

  const latestVersion = existing?.[0]

  if (latestVersion) {
    // Update existing rationale
    const { data, error } = await supabase
      .from('trade_event_rationales')
      .update({
        rationale_type: params.rationale_type,
        reason_for_action: params.reason_for_action,
        why_now: params.why_now,
        what_changed: params.what_changed,
        thesis_context: params.thesis_context,
        catalyst_trigger: params.catalyst_trigger,
        sizing_logic: params.sizing_logic,
        risk_context: params.risk_context,
        execution_context: params.execution_context,
        divergence_from_plan: params.divergence_from_plan ?? false,
        divergence_explanation: params.divergence_explanation,
        linked_object_refs: params.linked_object_refs ?? [],
        status: params.status || 'draft',
        authored_by: userId ?? null,
        authored_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', latestVersion.id)
      .select()
      .single()

    if (error) throw error

    // Sync parent event status
    await syncEventStatus(params.trade_event_id, params.status || 'draft')

    return data as TradeEventRationale
  } else {
    // Create new rationale
    const { data, error } = await supabase
      .from('trade_event_rationales')
      .insert({
        trade_event_id: params.trade_event_id,
        version_number: 1,
        rationale_type: params.rationale_type || 'other',
        reason_for_action: params.reason_for_action,
        why_now: params.why_now,
        what_changed: params.what_changed,
        thesis_context: params.thesis_context,
        catalyst_trigger: params.catalyst_trigger,
        sizing_logic: params.sizing_logic,
        risk_context: params.risk_context,
        execution_context: params.execution_context,
        divergence_from_plan: params.divergence_from_plan ?? false,
        divergence_explanation: params.divergence_explanation,
        linked_object_refs: params.linked_object_refs ?? [],
        status: params.status || 'draft',
        authored_by: userId ?? null,
      })
      .select()
      .single()

    if (error) throw error

    // Sync parent event status
    await syncEventStatus(params.trade_event_id, params.status || 'draft')

    return data as TradeEventRationale
  }
}

/**
 * Mark the latest rationale for a trade event as reviewed.
 * Sets status → 'reviewed', reviewed_by → current user, reviewed_at → now.
 * Syncs parent trade event status.
 */
export async function markRationaleAsReviewed(tradeEventId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: latest, error: fetchErr } = await supabase
    .from('trade_event_rationales')
    .select('id, status')
    .eq('trade_event_id', tradeEventId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single()

  if (fetchErr || !latest) throw new Error('No rationale found for this event')
  if (latest.status !== 'complete') throw new Error(`Cannot mark as reviewed: current status is "${latest.status}"`)

  const { error: updateErr } = await supabase
    .from('trade_event_rationales')
    .update({
      status: 'reviewed',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', latest.id)

  if (updateErr) throw updateErr

  await syncEventStatus(tradeEventId, 'reviewed')
}

async function syncEventStatus(tradeEventId: string, rationaleStatus: string): Promise<void> {
  const eventStatus =
    rationaleStatus === 'reviewed' ? 'reviewed' :
    rationaleStatus === 'complete' ? 'complete' :
    'draft_rationale'

  await supabase
    .from('portfolio_trade_events')
    .update({ status: eventStatus, updated_at: new Date().toISOString() })
    .eq('id', tradeEventId)
}

// ============================================================
// Summary / Aggregation
// ============================================================

export async function getTradeJournalSummary(
  portfolioId: string
): Promise<TradeJournalSummary> {
  const { data, error } = await supabase
    .from('portfolio_trade_events')
    .select('id, status, event_date')
    .eq('portfolio_id', portfolioId)

  if (error) throw error

  const events = data || []
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  return {
    totalEvents: events.length,
    pendingRationale: events.filter(e => e.status === 'pending_rationale').length,
    draftRationale: events.filter(e => e.status === 'draft_rationale').length,
    complete: events.filter(e => e.status === 'complete').length,
    reviewed: events.filter(e => e.status === 'reviewed').length,
    ignored: events.filter(e => e.status === 'ignored').length,
    recentTradesCount: events.filter(e =>
      new Date(e.event_date) >= thirtyDaysAgo
    ).length,
  }
}

export async function getPendingRationaleCount(
  portfolioId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('portfolio_trade_events')
    .select('id', { count: 'exact', head: true })
    .eq('portfolio_id', portfolioId)
    .eq('status', 'pending_rationale')

  if (error) throw error
  return count || 0
}

// ============================================================
// Detection / Ingestion Helpers
// ============================================================

/**
 * Derive action type from position change deltas.
 * Used by automated holdings diff detection.
 */
export function deriveActionFromDelta(
  quantityBefore: number | null,
  quantityAfter: number | null
): TradeEventAction {
  const before = quantityBefore ?? 0
  const after = quantityAfter ?? 0

  if (before === 0 && after > 0) return 'initiate'
  if (before === 0 && after < 0) return 'short_initiate'
  if (before > 0 && after === 0) return 'exit'
  if (before < 0 && after === 0) return 'cover'
  if (after > before && before > 0) return 'add'
  if (after < before && before > 0) return 'trim'
  if (after < before && before < 0) return 'add' // adding to short
  if (after > before && before < 0) return 'reduce' // reducing short
  return 'other'
}

/**
 * Generate trade events from a holdings diff.
 * Call this when a new holdings file is processed.
 *
 * @param portfolioId - The portfolio to generate events for
 * @param changes - Array of { asset_id, quantity_before, quantity_after, weight_before, weight_after, mv_before, mv_after }
 * @param eventDate - The date of the holdings snapshot
 * @param userId - The user who triggered detection (or system)
 */
export async function generateEventsFromHoldingsDiff(
  portfolioId: string,
  changes: Array<{
    asset_id: string
    quantity_before: number | null
    quantity_after: number | null
    weight_before?: number | null
    weight_after?: number | null
    mv_before?: number | null
    mv_after?: number | null
  }>,
  eventDate: string,
  userId?: string
): Promise<PortfolioTradeEvent[]> {
  const events: PortfolioTradeEvent[] = []

  for (const change of changes) {
    const qBefore = change.quantity_before ?? 0
    const qAfter = change.quantity_after ?? 0
    const delta = qAfter - qBefore

    // Skip unchanged positions
    if (delta === 0) continue

    const actionType = deriveActionFromDelta(change.quantity_before, change.quantity_after)

    const event = await createTradeEvent({
      portfolio_id: portfolioId,
      asset_id: change.asset_id,
      source_type: 'holdings_diff',
      action_type: actionType,
      event_date: eventDate,
      quantity_before: change.quantity_before,
      quantity_after: change.quantity_after,
      quantity_delta: delta,
      weight_before: change.weight_before ?? null,
      weight_after: change.weight_after ?? null,
      weight_delta: (change.weight_after ?? 0) - (change.weight_before ?? 0) || null,
      market_value_before: change.mv_before ?? null,
      market_value_after: change.mv_after ?? null,
      detected_by_system: true,
    }, userId)

    events.push(event)
  }

  return events
}
