/**
 * The reader's own CoAnalyst conversations tagged to one asset.
 *
 * One request, inner-joined through `ai_conversation_tags`, owner-filtered
 * explicitly on top of the RLS that already restricts the table. Gated, so
 * it issues nothing until the Work mode is on screen.
 *
 * RLS posture — no new table, no new policy, nothing widened:
 *   ai_conversations      ALL  user_id = auth.uid()
 *   ai_conversation_tags  ALL  EXISTS(conversation owned by auth.uid())
 * Both are strictly private and stay that way. This hook adds no sharing,
 * reads no message content, and never joins across users.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import {
  shapeAssetConversations,
  type AssetConversation,
  type AssetConversationRow,
} from '../../lib/ai/asset-conversations'

export const assetConversationsKey = (
  assetId: string | undefined,
  userId: string | null | undefined,
) => ['asset-ai-conversations', assetId, userId] as const

export function useAssetConversations(assetId: string | undefined, enabled = true) {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: assetConversationsKey(assetId, user?.id),
    queryFn: async (): Promise<AssetConversation[]> => {
      /*
       * `messages` is deliberately NOT selected.
       *
       * The transcript is the private part, it is a single jsonb column that
       * can be large, and nothing on this surface shows it. Selecting it to
       * render a title would ship every word of every thread to the client
       * to display none of them.
       */
      const { data, error } = await supabase
        .from('ai_conversations')
        .select(`
          id, title, last_message_at, updated_at, created_at,
          is_pinned, is_archived, user_id,
          ai_conversation_tags!inner(tag_type, tag_id)
        `)
        .eq('ai_conversation_tags.tag_type', 'asset')
        .eq('ai_conversation_tags.tag_id', assetId!)
        .eq('user_id', user!.id)
        .eq('is_archived', false)

      if (error) throw error
      return shapeAssetConversations(data as unknown as AssetConversationRow[], user?.id)
    },
    enabled: enabled && !!assetId && !!user?.id,
    staleTime: 30_000,
  })

  return {
    conversations: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
