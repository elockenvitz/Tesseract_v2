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
 * Count open prompts relevant to the given user.
 * Includes prompts created by the user AND prompts assigned to them.
 * "Open" = not archived.
 */
export async function getOpenPromptCount(userId: string): Promise<number> {
  // Prompts created by user (exclude resolved)
  const { count: createdCount, error: err1 } = await supabase
    .from('quick_thoughts')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
    .eq('idea_type', 'prompt')
    .eq('is_archived', false)
    .not('tags', 'cs', '{"status:closed"}')

  // Prompts assigned to user (exclude resolved)
  const { count: assignedCount, error: err2 } = await supabase
    .from('quick_thoughts')
    .select('id', { count: 'exact', head: true })
    .eq('idea_type', 'prompt')
    .eq('is_archived', false)
    .neq('created_by', userId)
    .contains('tags', [`assignee:${userId}`])
    .not('tags', 'cs', '{"status:closed"}')

  if (err1) console.error('Failed to fetch created prompt count:', err1)
  if (err2) console.error('Failed to fetch assigned prompt count:', err2)

  return (createdCount ?? 0) + (assignedCount ?? 0)
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
