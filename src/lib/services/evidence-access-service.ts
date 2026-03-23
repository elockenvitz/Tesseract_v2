/**
 * evidence-access-service.ts
 *
 * When a note is linked as evidence to a trade idea, all stakeholders of that
 * idea (portfolio members + idea creator) should receive read access so they
 * can view the evidence without needing separate sharing.
 *
 * Called from:
 *   - useCreateResearchLink (LinkedResearchSection "attach existing")
 *   - pendingResearchLinksStore.linkIfPending (newly created notes/thoughts)
 *   - ThesesDebatePanel.linkExistingMutation (argument-level attach)
 */

import { supabase } from '../supabase'
import type { LinkableEntityType } from '../object-links'

/** Note source types that use note_collaborations for access control */
const NOTE_SOURCE_TYPES: LinkableEntityType[] = [
  'asset_note', 'portfolio_note', 'theme_note', 'custom_note',
]

/** Maps LinkableEntityType → note_type value used in note_collaborations */
const NOTE_TYPE_MAP: Record<string, string> = {
  asset_note: 'asset',
  portfolio_note: 'portfolio',
  theme_note: 'theme',
  custom_note: 'custom',
}

/**
 * Grant read access on a piece of evidence (note) to all stakeholders of a
 * trade idea. Stakeholders = portfolio members from linked labs + idea creator.
 *
 * Safe to call for any source type — silently no-ops for non-note types.
 */
export async function grantEvidenceReadAccess({
  sourceType,
  sourceId,
  ideaId,
  currentUserId,
}: {
  sourceType: LinkableEntityType
  sourceId: string
  ideaId: string
  currentUserId: string
}): Promise<void> {
  // Only notes use note_collaborations; quick_thoughts have their own model
  if (!NOTE_SOURCE_TYPES.includes(sourceType)) return

  try {
    // 1. Collect all portfolio IDs associated with this trade idea
    const portfolioIds: string[] = []

    // 1a. Portfolios via trade_lab_idea_links
    const { data: labLinks } = await supabase
      .from('trade_lab_idea_links')
      .select('trade_lab_id, trade_labs:trade_lab_id(portfolio_id)')
      .eq('trade_queue_item_id', ideaId)
    for (const l of labLinks || []) {
      const pid = (l as any).trade_labs?.portfolio_id
      if (pid && !portfolioIds.includes(pid)) portfolioIds.push(pid)
    }

    // 1b. The idea's own portfolio_id
    const { data: idea } = await supabase
      .from('trade_queue_items')
      .select('portfolio_id, created_by')
      .eq('id', ideaId)
      .single()
    if (idea?.portfolio_id && !portfolioIds.includes(idea.portfolio_id)) {
      portfolioIds.push(idea.portfolio_id)
    }

    // 2. Gather all stakeholder user IDs
    const stakeholderIds = new Set<string>()

    // 2a. Portfolio members
    if (portfolioIds.length > 0) {
      const { data: members } = await supabase
        .from('portfolio_memberships')
        .select('user_id')
        .in('portfolio_id', portfolioIds)
      for (const m of members || []) {
        if (m.user_id) stakeholderIds.add(m.user_id)
      }
    }

    // 2b. Idea creator (may not be a portfolio member)
    if (idea?.created_by) {
      stakeholderIds.add(idea.created_by)
    }

    // Remove the current user — they already own or have access
    stakeholderIds.delete(currentUserId)

    if (stakeholderIds.size === 0) return

    // 3. Grant read access via note_collaborations upsert
    const noteType = NOTE_TYPE_MAP[sourceType] || 'research'
    const collabs = [...stakeholderIds].map(uid => ({
      note_id: sourceId,
      note_type: noteType,
      user_id: uid,
      permission: 'read' as const,
      invited_by: currentUserId,
    }))

    await supabase
      .from('note_collaborations')
      .upsert(collabs as any, { onConflict: 'note_id,note_type,user_id' })
  } catch (err) {
    // Don't fail the link creation if access grant fails
    console.warn('[grantEvidenceReadAccess] Failed to grant read access:', err)
  }
}
