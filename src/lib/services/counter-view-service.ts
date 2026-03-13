/**
 * Counter-View Service
 *
 * Creates and queries opposing trade idea relationships.
 *
 * A counter-view is a separate trade idea that expresses directional
 * disagreement with an existing idea. Both ideas remain first-class
 * objects with their own thesis, workflow, and audit trail.
 *
 * Relationships are stored in the existing object_links table with
 * link_type = 'opposes'. The counter-view is the source; the original
 * idea is the target.
 */

import { supabase } from '../supabase'
import { createTradeIdea, type CreateTradeParams } from './trade-idea-service'
import { emitAuditEvent } from '../audit/audit-service'
import type { ActionContext } from '../../types/trading'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateCounterViewParams {
  /** The original trade idea being opposed */
  originalIdeaId: string
  /** Fields for the new counter-view idea */
  portfolioId: string
  assetId: string
  action: string
  urgency: string
  rationale?: string
  proposedWeight?: number | null
  proposedShares?: number | null
  sharingVisibility?: 'private' | 'portfolio' | 'team' | 'public'
  context: ActionContext
}

export interface CounterViewSummary {
  id: string
  action: string
  asset_symbol: string | null
  asset_name: string | null
  stage: string
  outcome: string | null
  created_by: string | null
  creator_name: string | null
  created_at: string
  rationale: string | null
  /** Which side of the relationship this idea is on */
  relationship: 'opposes' | 'opposed_by'
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a counter-view: a new trade idea that opposes an existing one.
 *
 * 1. Creates a new trade idea via the standard createTradeIdea pipeline
 * 2. Creates an object_link (source = new idea, target = original, type = 'opposes')
 * 3. Emits audit event for the relationship
 *
 * Returns the new idea's ID.
 */
export async function createCounterView(params: CreateCounterViewParams): Promise<{ id: string }> {
  const {
    originalIdeaId,
    portfolioId,
    assetId,
    action,
    urgency,
    rationale,
    proposedWeight,
    proposedShares,
    sharingVisibility,
    context,
  } = params

  // 1. Create the new trade idea
  const createParams: CreateTradeParams = {
    portfolioId,
    assetId,
    action,
    urgency,
    rationale,
    proposedWeight,
    proposedShares,
    sharingVisibility,
    context,
    originType: 'counter_view',
    originEntityType: 'trade_idea',
    originEntityId: originalIdeaId,
    originRoute: context.uiSource || undefined,
    originMetadata: { counter_view_of: originalIdeaId },
  }

  const newIdea = await createTradeIdea(createParams)

  // 2. Create the opposes link (new idea → original idea)
  const { error: linkError } = await supabase
    .from('object_links')
    .insert({
      source_type: 'trade_idea',
      source_id: newIdea.id,
      target_type: 'trade_idea',
      target_id: originalIdeaId,
      link_type: 'opposes',
      is_auto: false,
      context: `Counter-view of trade idea`,
      created_by: context.actorId,
    })

  if (linkError) {
    console.error('[counter-view] Failed to create opposes link:', linkError)
    // Don't throw — the idea was created successfully, the link is supplementary
  }

  // 3. Fetch asset symbol for audit display
  const { data: asset } = await supabase
    .from('assets')
    .select('symbol')
    .eq('id', assetId)
    .single()

  const displayName = `${action.toUpperCase()} ${asset?.symbol || '?'} (counter-view)`

  await emitAuditEvent({
    actor: { id: context.actorId, type: 'user', role: context.actorRole },
    entity: { type: 'trade_idea', id: newIdea.id, displayName },
    action: { type: 'create', category: 'lifecycle' },
    state: {
      from: null,
      to: {
        stage: 'idea',
        outcome: null,
        relationship: 'opposes',
        original_idea_id: originalIdeaId,
      },
    },
    changedFields: ['stage', 'action', 'relationship'],
    metadata: {
      request_id: context.requestId,
      ui_source: context.uiSource,
      counter_view_of: originalIdeaId,
      asset_symbol: asset?.symbol,
    },
    orgId: undefined,
    teamId: undefined,
    actorName: context.actorName,
    actorEmail: context.actorEmail,
    assetSymbol: asset?.symbol,
  })

  return newIdea
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Fetch all counter-views (opposing ideas) for a given trade idea.
 * Checks both directions of the opposes link.
 */
export async function getCounterViews(tradeIdeaId: string): Promise<CounterViewSummary[]> {
  // Fetch links where this idea is either the source or target of an 'opposes' link
  const { data: links, error: linkError } = await supabase
    .from('object_links')
    .select('source_id, target_id')
    .eq('link_type', 'opposes')
    .or(`and(source_type.eq.trade_idea,source_id.eq.${tradeIdeaId}),and(target_type.eq.trade_idea,target_id.eq.${tradeIdeaId})`)

  if (linkError || !links || links.length === 0) return []

  // Collect the IDs of the opposing ideas + their relationship direction
  const opposingMap = new Map<string, 'opposes' | 'opposed_by'>()
  for (const link of links) {
    if (link.source_id === tradeIdeaId) {
      // This idea opposes the target
      opposingMap.set(link.target_id, 'opposes')
    } else {
      // This idea is opposed by the source
      opposingMap.set(link.source_id, 'opposed_by')
    }
  }

  const opposingIds = Array.from(opposingMap.keys())
  if (opposingIds.length === 0) return []

  // Fetch the opposing trade ideas (exclude deleted)
  const { data: ideas, error: ideaError } = await supabase
    .from('trade_queue_items')
    .select(`
      id, action, stage, outcome, created_by, created_at, rationale,
      assets:asset_id (symbol, company_name),
      users:created_by (first_name, last_name, email)
    `)
    .in('id', opposingIds)
    .eq('visibility_tier', 'active')

  if (ideaError || !ideas) return []

  return ideas.map((idea: any) => {
    const user = idea.users
    const creatorName = user
      ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email?.split('@')[0]
      : null

    return {
      id: idea.id,
      action: idea.action,
      asset_symbol: idea.assets?.symbol || null,
      asset_name: idea.assets?.company_name || null,
      stage: idea.stage,
      outcome: idea.outcome,
      created_by: idea.created_by,
      creator_name: creatorName,
      created_at: idea.created_at,
      rationale: idea.rationale,
      relationship: opposingMap.get(idea.id) || 'opposed_by',
    }
  })
}

/**
 * Count counter-views for a trade idea (lightweight, for badges).
 * Excludes deleted ideas so the count stays accurate.
 */
export async function countCounterViews(tradeIdeaId: string): Promise<number> {
  // Must resolve links → idea IDs → filter deleted, since object_links
  // doesn't know about the linked idea's visibility_tier.
  const { data: links, error: linkError } = await supabase
    .from('object_links')
    .select('source_id, target_id')
    .eq('link_type', 'opposes')
    .or(`and(source_type.eq.trade_idea,source_id.eq.${tradeIdeaId}),and(target_type.eq.trade_idea,target_id.eq.${tradeIdeaId})`)

  if (linkError || !links || links.length === 0) return 0

  const opposingIds = links.map(l => l.source_id === tradeIdeaId ? l.target_id : l.source_id)
  if (opposingIds.length === 0) return 0

  const { count, error } = await supabase
    .from('trade_queue_items')
    .select('id', { count: 'exact', head: true })
    .in('id', opposingIds)
    .eq('visibility_tier', 'active')

  if (error) return 0
  return count || 0
}
