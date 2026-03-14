/**
 * Thesis Service
 *
 * CRUD for bull/bear theses on trade ideas.
 * Each thesis represents a directional position with rationale,
 * allowing structured debate on a single trade idea card.
 */

import { supabase } from '../supabase'
import type {
  ThesisDirection,
  ThesisConviction,
  ThesisWithUser,
  ThesisCounts,
} from '../../types/trading'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateThesisInput {
  tradeQueueItemId: string
  direction: ThesisDirection
  rationale: string
  conviction?: ThesisConviction
}

export interface UpdateThesisInput {
  rationale?: string
  conviction?: ThesisConviction | null
}

const THESIS_SELECT = `
  *,
  users:created_by (id, email, first_name, last_name)
`

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getThesesForIdea(tradeQueueItemId: string): Promise<ThesisWithUser[]> {
  const { data, error } = await supabase
    .from('trade_idea_theses')
    .select(THESIS_SELECT)
    .eq('trade_queue_item_id', tradeQueueItemId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch theses: ${error.message}`)
  return (data || []) as ThesisWithUser[]
}

export async function getThesisCounts(tradeQueueItemId: string): Promise<ThesisCounts> {
  const { data, error } = await supabase
    .from('trade_idea_theses')
    .select('direction')
    .eq('trade_queue_item_id', tradeQueueItemId)

  if (error) return { bull: 0, bear: 0 }

  let bull = 0
  let bear = 0
  for (const row of data || []) {
    if (row.direction === 'bull') bull++
    else bear++
  }
  return { bull, bear }
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
      result[row.trade_queue_item_id] = { bull: 0, bear: 0 }
    }
    result[row.trade_queue_item_id][row.direction as ThesisDirection]++
  }
  return result
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createThesis(input: CreateThesisInput): Promise<ThesisWithUser> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('trade_idea_theses')
    .upsert(
      {
        trade_queue_item_id: input.tradeQueueItemId,
        direction: input.direction,
        rationale: input.rationale,
        conviction: input.conviction || null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'trade_queue_item_id,created_by,direction' }
    )
    .select(THESIS_SELECT)
    .single()

  if (error) throw new Error(`Failed to create thesis: ${error.message}`)
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
  return data as ThesisWithUser
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteThesis(thesisId: string): Promise<void> {
  const { error } = await supabase
    .from('trade_idea_theses')
    .delete()
    .eq('id', thesisId)

  if (error) throw new Error(`Failed to delete thesis: ${error.message}`)
}
