import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

/**
 * Returns counts for the "Direct" section of the Quick Ideas pane:
 * - openPromptCount: prompts created by or assigned to the current user that are still open
 * - pendingRecommendationCount: active decision requests owned by the current user
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

  const { data: pendingRecommendationCount = 0 } = useQuery({
    queryKey: ['direct-pending-recommendation-count', user?.id],
    queryFn: () => getPendingRecommendationCount(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  })

  return { openPromptCount, pendingRecommendationCount }
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
 * Count active decision requests (pending recommendations) for the given user.
 * Reads from decision_requests instead of trade_proposals.
 */
export async function getPendingRecommendationCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('decision_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by', userId)
    .in('status', ['pending', 'under_review', 'needs_discussion'])

  if (error) {
    console.error('Failed to fetch pending recommendation count:', error)
    return 0
  }
  return count ?? 0
}
