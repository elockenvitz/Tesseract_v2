import { supabase } from './supabase'

const MAX_SESSION_WINDOW_MS = 30 * 60 * 1000 // 30 minutes
const INACTIVITY_CUTOFF_MS = 10 * 60 * 1000  // 10 minutes

export type RevisionViewScope = 'firm' | 'user'
export type RevisionEventCategory =
  | 'thesis'
  | 'where_different'
  | 'risks_to_thesis'
  | 'valuation_targets'
  | 'supporting'

export interface RevisionEvent {
  category: RevisionEventCategory
  field_key: string
  before_value?: string | null
  after_value?: string | null
  significance_tier: 1 | 2 | 3
}

/**
 * Finds or creates a revision session for the given context.
 * Grouping rules:
 * - Same asset_id, actor, view scope
 * - Within 30min max session window from created_at
 * - Within 10min inactivity cutoff from last_activity_at
 */
export async function findOrCreateRevision({
  assetId,
  actorUserId,
  viewScopeType = 'firm',
  viewScopeUserId,
}: {
  assetId: string
  actorUserId: string
  viewScopeType?: RevisionViewScope
  viewScopeUserId?: string | null
}): Promise<string> {
  const now = new Date()
  const sessionWindowCutoff = new Date(now.getTime() - MAX_SESSION_WINDOW_MS)
  const inactivityCutoff = new Date(now.getTime() - INACTIVITY_CUTOFF_MS)

  // Look for an active session
  let query = supabase
    .from('asset_revisions')
    .select('id, created_at, last_activity_at')
    .eq('asset_id', assetId)
    .eq('actor_user_id', actorUserId)
    .eq('view_scope_type', viewScopeType)
    .gte('created_at', sessionWindowCutoff.toISOString())
    .gte('last_activity_at', inactivityCutoff.toISOString())
    .order('last_activity_at', { ascending: false })
    .limit(1)

  if (viewScopeType === 'user' && viewScopeUserId) {
    query = query.eq('view_scope_user_id', viewScopeUserId)
  } else {
    query = query.is('view_scope_user_id', null)
  }

  const { data: existing } = await query

  if (existing && existing.length > 0) {
    // Update last_activity_at on the existing session
    await supabase
      .from('asset_revisions')
      .update({ last_activity_at: now.toISOString() })
      .eq('id', existing[0].id)

    return existing[0].id
  }

  // Create a new session
  const { data: newRevision, error } = await supabase
    .from('asset_revisions')
    .insert({
      asset_id: assetId,
      actor_user_id: actorUserId,
      view_scope_type: viewScopeType,
      view_scope_user_id: viewScopeType === 'user' ? viewScopeUserId : null,
      created_at: now.toISOString(),
      last_activity_at: now.toISOString(),
    })
    .select('id')
    .single()

  if (error) throw error
  return newRevision.id
}

/**
 * Attaches one or more events to a revision session.
 */
export async function addRevisionEvents(
  revisionId: string,
  events: RevisionEvent[]
): Promise<void> {
  if (events.length === 0) return

  const rows = events.map(e => ({
    revision_id: revisionId,
    category: e.category,
    field_key: e.field_key,
    before_value: e.before_value ?? null,
    after_value: e.after_value ?? null,
    significance_tier: e.significance_tier,
  }))

  const { error } = await supabase
    .from('asset_revision_events')
    .insert(rows)

  if (error) throw error
}

/**
 * Updates the revision note on a session.
 */
export async function updateRevisionNote(
  revisionId: string,
  note: string | null
): Promise<void> {
  const { error } = await supabase
    .from('asset_revisions')
    .update({ revision_note: note })
    .eq('id', revisionId)

  if (error) throw error
}

/**
 * Maps a contribution section to a revision event category.
 */
export function sectionToCategory(section: string): RevisionEventCategory {
  switch (section) {
    case 'thesis':
      return 'thesis'
    case 'where_different':
      return 'where_different'
    case 'risks_to_thesis':
      return 'risks_to_thesis'
    case 'price_target':
      return 'valuation_targets'
    default:
      return 'supporting'
  }
}

/**
 * Determines significance tier for a contribution publish.
 * - Tier 1: Material structured changes (targets, risk add/remove)
 * - Tier 2: Text content updates (thesis, where different)
 * - Tier 3: Supporting docs
 */
export function getSignificanceTier(
  section: string,
  _oldContent?: string | null,
  _newContent?: string | null
): 1 | 2 | 3 {
  switch (section) {
    case 'price_target':
      return 1
    case 'risks_to_thesis':
      return 1
    case 'thesis':
      return 2
    case 'where_different':
      return 2
    default:
      return 3
  }
}
