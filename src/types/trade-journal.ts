/**
 * Trade Journal Types
 *
 * Data contracts for the portfolio-level Trade Journal system.
 * Separates factual trade events from structured rationale capture.
 *
 * Tables: portfolio_trade_events, trade_event_rationales
 */

// ============================================================
// Enums (mirror DB enums)
// ============================================================

export type TradeEventSource = 'holdings_diff' | 'execution_import' | 'manual' | 'reconciliation'

export type TradeEventAction =
  | 'initiate'
  | 'add'
  | 'trim'
  | 'exit'
  | 'reduce'
  | 'cover'
  | 'short_initiate'
  | 'rebalance'
  | 'hedge'
  | 'other'

export type TradeEventStatus =
  | 'pending_rationale'
  | 'draft_rationale'
  | 'complete'
  | 'reviewed'
  | 'ignored'

export type RationaleStatus = 'draft' | 'complete' | 'reviewed'

export type RationaleType =
  | 'planned'
  | 'reactive'
  | 'execution_adjustment'
  | 'risk_management'
  | 'thesis_update'
  | 'other'

// ============================================================
// Portfolio Trade Event
// ============================================================

export interface PortfolioTradeEvent {
  id: string
  portfolio_id: string
  asset_id: string

  source_type: TradeEventSource
  action_type: TradeEventAction
  detected_by_system: boolean

  event_date: string
  detected_at: string

  quantity_before: number | null
  quantity_after: number | null
  quantity_delta: number | null
  weight_before: number | null
  weight_after: number | null
  weight_delta: number | null
  market_value_before: number | null
  market_value_after: number | null

  status: TradeEventStatus

  linked_trade_idea_id: string | null
  linked_proposal_id: string | null
  linked_decision_id: string | null
  linked_trade_sheet_id: string | null

  metadata: Record<string, unknown>

  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

// With joined data for UI
export interface TradeEventWithDetails extends PortfolioTradeEvent {
  asset?: {
    id: string
    symbol: string
    company_name: string
    sector?: string
  } | null
  created_by_user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  } | null
  latest_rationale?: TradeEventRationale | null
  linked_trade_idea?: {
    id: string
    rationale: string | null
    action: string | null
  } | null
}

// ============================================================
// Trade Event Rationale
// ============================================================

export interface TradeEventRationale {
  id: string
  trade_event_id: string
  version_number: number

  status: RationaleStatus
  rationale_type: RationaleType

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

  linked_object_refs: LinkedObjectRef[]

  authored_by: string | null
  authored_at: string
  reviewed_by: string | null
  reviewed_at: string | null

  created_at: string
  updated_at: string
}

export interface LinkedObjectRef {
  type: 'note' | 'trade_idea' | 'trade_sheet' | 'proposal' | 'decision'
  id: string
  label: string
}

// ============================================================
// Create / Update params
// ============================================================

export interface CreateTradeEventParams {
  portfolio_id: string
  asset_id: string
  source_type?: TradeEventSource
  action_type: TradeEventAction
  event_date?: string
  quantity_before?: number | null
  quantity_after?: number | null
  quantity_delta?: number | null
  weight_before?: number | null
  weight_after?: number | null
  weight_delta?: number | null
  market_value_before?: number | null
  market_value_after?: number | null
  detected_by_system?: boolean
  linked_trade_idea_id?: string | null
  linked_trade_sheet_id?: string | null
  metadata?: Record<string, unknown>
}

export interface SaveRationaleParams {
  trade_event_id: string
  rationale_type?: RationaleType
  reason_for_action?: string | null
  why_now?: string | null
  what_changed?: string | null
  thesis_context?: string | null
  catalyst_trigger?: string | null
  sizing_logic?: string | null
  risk_context?: string | null
  execution_context?: string | null
  divergence_from_plan?: boolean
  divergence_explanation?: string | null
  linked_object_refs?: LinkedObjectRef[]
  status?: RationaleStatus
}

// ============================================================
// Journal Summary Stats
// ============================================================

export interface TradeJournalSummary {
  totalEvents: number
  pendingRationale: number
  draftRationale: number
  complete: number
  reviewed: number
  ignored: number
  recentTradesCount: number // last 30 days
}

// ============================================================
// Action display config
// ============================================================

export const ACTION_CONFIG: Record<TradeEventAction, { label: string; color: string; bgColor: string }> = {
  initiate:       { label: 'Initiate',       color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  add:            { label: 'Add',            color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  trim:           { label: 'Trim',           color: 'text-red-700',     bgColor: 'bg-red-50' },
  exit:           { label: 'Exit',           color: 'text-red-700',     bgColor: 'bg-red-50' },
  reduce:         { label: 'Reduce',         color: 'text-red-700',     bgColor: 'bg-red-50' },
  cover:          { label: 'Cover',          color: 'text-blue-700',    bgColor: 'bg-blue-50' },
  short_initiate: { label: 'Short',          color: 'text-violet-700',  bgColor: 'bg-violet-50' },
  rebalance:      { label: 'Rebalance',      color: 'text-gray-700',    bgColor: 'bg-gray-100' },
  hedge:          { label: 'Hedge',          color: 'text-amber-700',   bgColor: 'bg-amber-50' },
  other:          { label: 'Other',          color: 'text-gray-700',    bgColor: 'bg-gray-100' },
}

export const STATUS_CONFIG: Record<TradeEventStatus, { label: string; color: string; bgColor: string }> = {
  pending_rationale: { label: 'Pending',  color: 'text-amber-700',   bgColor: 'bg-amber-50' },
  draft_rationale:   { label: 'Draft',    color: 'text-blue-700',    bgColor: 'bg-blue-50' },
  complete:          { label: 'Complete', color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  reviewed:          { label: 'Reviewed', color: 'text-violet-700',  bgColor: 'bg-violet-50' },
  ignored:           { label: 'Ignored',  color: 'text-gray-500',    bgColor: 'bg-gray-100' },
}

export const SOURCE_LABELS: Record<TradeEventSource, string> = {
  holdings_diff: 'Holdings Diff',
  execution_import: 'Execution',
  manual: 'Manual',
  reconciliation: 'Reconciliation',
}
