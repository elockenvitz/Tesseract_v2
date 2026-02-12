import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

/**
 * Returns counts for the "Direct" section of the Quick Ideas pane:
 * - openPromptCount: prompts created by or assigned to the current user that are still open
 * - pendingProposalCount: active proposals owned by the current user
 *
 * Both queries are lightweight (count-only) and cached for 60s.
 */
export function useDirectCounts() {
  const { user } = useAuth()

  const { data: openPromptCount = 0 } = useQuery({
    queryKey: ['direct-open-prompt-count', user?.id],
    queryFn: () => getOpenPromptCount(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  })

  const { data: pendingProposalCount = 0 } = useQuery({
    queryKey: ['direct-pending-proposal-count', user?.id],
    queryFn: () => getPendingProposalCount(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  })

  return { openPromptCount, pendingProposalCount }
}

/**
 * Count open prompts created by the given user.
 * Prompts are stored as quick_thoughts with idea_type='prompt'.
 * "Open" = not archived (no explicit closed flag exists, so we count all).
 */
export async function getOpenPromptCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('quick_thoughts')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
    .eq('idea_type', 'prompt')

  if (error) {
    console.error('Failed to fetch open prompt count:', error)
    return 0
  }
  return count ?? 0
}

/**
 * Count active proposals owned by the given user.
 * Uses trade_proposals.is_active = true as the "pending" filter.
 */
export async function getPendingProposalCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('trade_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)

  if (error) {
    console.error('Failed to fetch pending proposal count:', error)
    return 0
  }
  return count ?? 0
}
