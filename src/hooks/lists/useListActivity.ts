import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'

export interface ListActivity {
  id: string
  list_id: string
  actor_id: string | null
  activity_type: 'item_added' | 'item_removed' | 'metadata_updated' | 'collaborator_added' | 'collaborator_removed'
  metadata: Record<string, unknown>
  created_at: string
  actor: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
}

export function useListActivity(
  listId: string | null,
  sinceTimestamp?: string,
  showOwnActivity = false
) {
  const { user } = useAuth()
  const userId = user?.id

  return useQuery({
    queryKey: ['list-activity', listId, sinceTimestamp, showOwnActivity],
    queryFn: async () => {
      if (!listId || !userId) return []
      let query = supabase
        .from('asset_list_activity')
        .select('*, actor:users!asset_list_activity_actor_id_fkey(id, first_name, last_name, email)')
        .eq('list_id', listId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (showOwnActivity) {
        query = query.eq('actor_id', userId)
      } else {
        query = query.neq('actor_id', userId)
      }

      if (sinceTimestamp) {
        query = query.gt('created_at', sinceTimestamp)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as ListActivity[]
    },
    enabled: !!listId && !!userId
  })
}
