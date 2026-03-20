/**
 * Thesis Service
 *
 * CRUD for bull/bear theses on trade ideas.
 * Each thesis represents a directional position with rationale,
 * allowing structured debate on a single trade idea card.
 *
 * Theses can be shared (portfolio_id = null) or portfolio-scoped.
 */

import { supabase } from '../supabase'
import { emitAuditEvent } from '../audit'
import type {
  ThesisDirection,
  ThesisConviction,
  ThesisWithUser,
  ThesisCounts,
} from '../../types/trading'

// ---------------------------------------------------------------------------
// Debate direction → human-readable label for audit events
// ---------------------------------------------------------------------------

const DIRECTION_LABELS: Record<string, string> = {
  bull: 'bullish argument',
  bear: 'bearish argument',
  catalyst: 'catalyst context',
  risk: 'risk context',
  context: 'context note',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateThesisInput {
  tradeQueueItemId: string
  direction: ThesisDirection
  rationale: string
  conviction?: ThesisConviction
  portfolioId?: string | null
}

export interface UpdateThesisInput {
  rationale?: string
  conviction?: ThesisConviction | null
}

const THESIS_SELECT = `
  *,
  users:created_by (id, email, first_name, last_name),
  portfolio:portfolio_id (id, name)
`

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getThesesForIdea(
  tradeQueueItemId: string,
  /** Filter by scope: undefined = all, null = shared only, string = portfolio-specific */
  scopePortfolioId?: string | null
): Promise<ThesisWithUser[]> {
  let query = supabase
    .from('trade_idea_theses')
    .select(THESIS_SELECT)
    .eq('trade_queue_item_id', tradeQueueItemId)
    .order('created_at', { ascending: true })

  if (scopePortfolioId === null) {
    query = query.is('portfolio_id', null)
  } else if (scopePortfolioId !== undefined) {
    query = query.eq('portfolio_id', scopePortfolioId)
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to fetch theses: ${error.message}`)
  return (data || []) as ThesisWithUser[]
}

export async function getThesisCounts(
  tradeQueueItemId: string,
  scopePortfolioId?: string | null
): Promise<ThesisCounts> {
  let query = supabase
    .from('trade_idea_theses')
    .select('direction, portfolio_id')
    .eq('trade_queue_item_id', tradeQueueItemId)

  if (scopePortfolioId === null) {
    query = query.is('portfolio_id', null)
  } else if (scopePortfolioId !== undefined) {
    query = query.eq('portfolio_id', scopePortfolioId)
  }

  const { data, error } = await query

  if (error) return { bull: 0, bear: 0, context: 0 }

  let bull = 0
  let bear = 0
  let context = 0
  for (const row of data || []) {
    if (row.direction === 'bull') bull++
    else if (row.direction === 'bear') bear++
    else context++
  }
  return { bull, bear, context }
}

export async function getThesisCountsBatch(
  tradeQueueItemIds: string[]
): Promise<Record<string, ThesisCounts>> {
  if (tradeQueueItemIds.length === 0) return {}

  const { data, error } = await supabase
    .from('trade_idea_theses')
    .select('trade_queue_item_id, direction')
    .in('trade_queue_item_id', tradeQueueItemIds)

  if (error) return {}

  const result: Record<string, ThesisCounts> = {}
  for (const row of data || []) {
    if (!result[row.trade_queue_item_id]) {
      result[row.trade_queue_item_id] = { bull: 0, bear: 0, context: 0 }
    }
    const dir = row.direction as ThesisDirection
    if (dir === 'bull') result[row.trade_queue_item_id].bull++
    else if (dir === 'bear') result[row.trade_queue_item_id].bear++
    else result[row.trade_queue_item_id].context++
  }
  return result
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createThesis(input: CreateThesisInput): Promise<ThesisWithUser> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Use insert instead of upsert since the unique index uses COALESCE
  // and Supabase upsert doesn't support function-based conflict targets.
  const { data, error } = await supabase
    .from('trade_idea_theses')
    .insert({
      trade_queue_item_id: input.tradeQueueItemId,
      direction: input.direction,
      rationale: input.rationale,
      conviction: input.conviction || null,
      portfolio_id: input.portfolioId ?? null,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .select(THESIS_SELECT)
    .single()

  if (error) throw new Error(`Failed to create thesis: ${error.message}`)

  // Emit audit event for activity timeline (fire-and-forget)
  const dirLabel = DIRECTION_LABELS[input.direction] || input.direction
  emitAuditEvent({
    actor: { id: user.id, type: 'user' },
    entity: { type: 'trade_idea', id: input.tradeQueueItemId },
    action: { type: 'update_field', category: 'field_edit' },
    state: { to: { direction: input.direction, conviction: input.conviction || null } },
    changedFields: [`debate:${input.direction}`],
    metadata: {
      debate_action: 'add',
      debate_direction: input.direction,
      debate_label: dirLabel,
      thesis_id: data.id,
      portfolio_id: input.portfolioId || null,
    },
    orgId: undefined,
    actorEmail: user.email || undefined,
    actorName: user.user_metadata?.first_name
      ? `${user.user_metadata.first_name} ${user.user_metadata.last_name || ''}`.trim()
      : undefined,
  }).catch(() => {})

  return data as ThesisWithUser
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateThesis(
  thesisId: string,
  input: UpdateThesisInput
): Promise<ThesisWithUser> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.rationale !== undefined) updates.rationale = input.rationale
  if (input.conviction !== undefined) updates.conviction = input.conviction

  const { data, error } = await supabase
    .from('trade_idea_theses')
    .update(updates)
    .eq('id', thesisId)
    .select(THESIS_SELECT)
    .single()

  if (error) throw new Error(`Failed to update thesis: ${error.message}`)

  // Emit audit event (fire-and-forget)
  const { data: { user } } = await supabase.auth.getUser()
  if (user && data) {
    const direction = (data as any).direction as string
    const dirLabel = DIRECTION_LABELS[direction] || direction
    emitAuditEvent({
      actor: { id: user.id, type: 'user' },
      entity: { type: 'trade_idea', id: (data as any).trade_queue_item_id },
      action: { type: 'update_field', category: 'field_edit' },
      changedFields: [`debate:${direction}`],
      metadata: {
        debate_action: 'update',
        debate_direction: direction,
        debate_label: dirLabel,
        thesis_id: thesisId,
      },
      orgId: undefined,
      actorEmail: user.email || undefined,
      actorName: user.user_metadata?.first_name
        ? `${user.user_metadata.first_name} ${user.user_metadata.last_name || ''}`.trim()
        : undefined,
    }).catch(() => {})
  }

  return data as ThesisWithUser
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteThesis(thesisId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch thesis before deleting for audit context
  const { data: thesis } = await supabase
    .from('trade_idea_theses')
    .select('trade_queue_item_id, direction')
    .eq('id', thesisId)
    .single()

  const { error } = await supabase
    .from('trade_idea_theses')
    .delete()
    .eq('id', thesisId)

  if (error) throw new Error(`Failed to delete thesis: ${error.message}`)

  // Emit audit event (fire-and-forget)
  if (user && thesis) {
    const dirLabel = DIRECTION_LABELS[thesis.direction] || thesis.direction
    emitAuditEvent({
      actor: { id: user.id, type: 'user' },
      entity: { type: 'trade_idea', id: thesis.trade_queue_item_id },
      action: { type: 'delete', category: 'lifecycle' },
      changedFields: [`debate:${thesis.direction}`],
      metadata: {
        debate_action: 'remove',
        debate_direction: thesis.direction,
        debate_label: dirLabel,
        thesis_id: thesisId,
      },
      orgId: undefined,
      actorEmail: user.email || undefined,
      actorName: user.user_metadata?.first_name
        ? `${user.user_metadata.first_name} ${user.user_metadata.last_name || ''}`.trim()
        : undefined,
    }).catch(() => {})
  }
}
