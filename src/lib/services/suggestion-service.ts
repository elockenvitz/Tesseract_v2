/**
 * Suggestion Service
 *
 * Handles simulation suggestions submitted by users with "suggest" access level.
 * Suggestions are pending trade ideas that the simulation owner can accept or reject.
 */

import { supabase } from '../supabase'
import { createVariant, type CreateVariantParams } from './intent-variant-service'
import type { ActionContext, TradeAction, AssetPrice, RoundingConfig, ActiveWeightConfig } from '../../types/trading'

// ============================================================
// Types
// ============================================================

export interface SimulationSuggestion {
  id: string
  simulation_id: string
  asset_id: string
  suggested_by: string
  share_id: string
  portfolio_id: string
  sizing_input: string
  notes: string | null
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
  resolved_by: string | null
  resolved_at: string | null
  resolution_notes: string | null
  resulting_variant_id: string | null
  created_at: string
  updated_at: string
  // Joined
  asset?: { id: string; symbol: string; company_name: string; sector: string | null }
  suggested_by_user?: { id: string; full_name: string; email: string }
}

export interface CreateSuggestionParams {
  simulationId: string
  assetId: string
  shareId: string
  portfolioId: string
  sizingInput: string
  notes?: string
  suggestedBy: string
}

export interface AcceptSuggestionParams {
  suggestionId: string
  actorId: string
  labId: string
  portfolioId: string
  currentPosition?: {
    shares: number
    weight: number
    cost_basis: number | null
    active_weight: number | null
  } | null
  price: AssetPrice
  portfolioTotalValue: number
  roundingConfig: RoundingConfig
  activeWeightConfig?: ActiveWeightConfig | null
  hasBenchmark: boolean
  context: ActionContext
}

// ============================================================
// Core Functions
// ============================================================

export async function createSuggestion(params: CreateSuggestionParams): Promise<SimulationSuggestion> {
  const { data, error } = await supabase
    .from('simulation_suggestions')
    .insert({
      simulation_id: params.simulationId,
      asset_id: params.assetId,
      share_id: params.shareId,
      portfolio_id: params.portfolioId,
      sizing_input: params.sizingInput,
      notes: params.notes ?? null,
      suggested_by: params.suggestedBy,
    })
    .select(`
      *,
      asset:assets(id, symbol, company_name, sector),
      suggested_by_user:suggested_by(id, full_name, email)
    `)
    .single()

  if (error) {
    throw new Error(`Failed to create suggestion: ${error.message}`)
  }

  return data as unknown as SimulationSuggestion
}

export async function getSuggestionsForSimulation(
  simulationId: string
): Promise<SimulationSuggestion[]> {
  const { data, error } = await supabase
    .from('simulation_suggestions')
    .select(`
      *,
      asset:assets(id, symbol, company_name, sector),
      suggested_by_user:suggested_by(id, full_name, email)
    `)
    .eq('simulation_id', simulationId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch suggestions: ${error.message}`)
  }

  return data as unknown as SimulationSuggestion[]
}

export async function acceptSuggestion(params: AcceptSuggestionParams): Promise<SimulationSuggestion> {
  // Fetch the suggestion
  const { data: suggestion, error: fetchError } = await supabase
    .from('simulation_suggestions')
    .select('*')
    .eq('id', params.suggestionId)
    .single()

  if (fetchError || !suggestion) {
    throw new Error(`Suggestion not found: ${params.suggestionId}`)
  }

  if (suggestion.status !== 'pending') {
    throw new Error(`Suggestion is not pending (status: ${suggestion.status})`)
  }

  // Determine action from sizing
  const isNewPosition = !params.currentPosition
  const sizingInput = suggestion.sizing_input
  const isNegative = sizingInput.startsWith('-') || sizingInput.startsWith('#-')
  let action: TradeAction = isNewPosition ? 'buy' : (isNegative ? 'trim' : 'add')

  // Create variant via the normalization pipeline
  const variant = await createVariant({
    input: {
      lab_id: params.labId,
      asset_id: suggestion.asset_id,
      action,
      sizing_input: sizingInput,
      view_id: null,
    },
    portfolioId: params.portfolioId,
    currentPosition: params.currentPosition,
    price: params.price,
    portfolioTotalValue: params.portfolioTotalValue,
    roundingConfig: params.roundingConfig,
    activeWeightConfig: params.activeWeightConfig,
    hasBenchmark: params.hasBenchmark,
    context: params.context,
  })

  // Upsert simulation_trade for dual-write
  await supabase
    .from('simulation_trades')
    .upsert({
      simulation_id: suggestion.simulation_id,
      asset_id: suggestion.asset_id,
      action,
      price: params.price.price,
      sort_order: 0,
    }, { onConflict: 'simulation_id,asset_id' })

  // Update suggestion status
  const { data: updated, error: updateError } = await supabase
    .from('simulation_suggestions')
    .update({
      status: 'accepted',
      resolved_by: params.actorId,
      resolved_at: new Date().toISOString(),
      resulting_variant_id: variant.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.suggestionId)
    .select(`
      *,
      asset:assets(id, symbol, company_name, sector),
      suggested_by_user:suggested_by(id, full_name, email)
    `)
    .single()

  if (updateError) {
    throw new Error(`Failed to accept suggestion: ${updateError.message}`)
  }

  return updated as unknown as SimulationSuggestion
}

export async function rejectSuggestion(
  suggestionId: string,
  actorId: string,
  notes?: string
): Promise<SimulationSuggestion> {
  const { data, error } = await supabase
    .from('simulation_suggestions')
    .update({
      status: 'rejected',
      resolved_by: actorId,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .select(`
      *,
      asset:assets(id, symbol, company_name, sector),
      suggested_by_user:suggested_by(id, full_name, email)
    `)
    .single()

  if (error) {
    throw new Error(`Failed to reject suggestion: ${error.message}`)
  }

  return data as unknown as SimulationSuggestion
}

export async function withdrawSuggestion(
  suggestionId: string,
  actorId: string
): Promise<SimulationSuggestion> {
  const { data, error } = await supabase
    .from('simulation_suggestions')
    .update({
      status: 'withdrawn',
      resolved_by: actorId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .select(`
      *,
      asset:assets(id, symbol, company_name, sector),
      suggested_by_user:suggested_by(id, full_name, email)
    `)
    .single()

  if (error) {
    throw new Error(`Failed to withdraw suggestion: ${error.message}`)
  }

  return data as unknown as SimulationSuggestion
}
