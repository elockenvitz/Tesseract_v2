import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface ListActivityEvent {
  id: string
  list_id: string
  actor_id: string | null
  activity_type: string
  metadata: Record<string, any> | null
  created_at: string
  actor: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
}

/**
 * Full list-wide activity feed (all actors, all event types). Used by the
 * right rail. For per-asset activity use useListItemActivity; for the
 * "others' activity for notifications" filter use useListActivity.
 */
export function useListActivityFeed(listId: string | null | undefined, limit = 50) {
  return useQuery<ListActivityEvent[]>({
    queryKey: ['asset-list-activity-feed', listId, limit],
    queryFn: async () => {
      if (!listId) return []
      const { data, error } = await supabase
        .from('asset_list_activity')
        .select('*, actor:users!asset_list_activity_actor_id_fkey(id, first_name, last_name, email)')
        .eq('list_id', listId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as ListActivityEvent[]
    },
    enabled: !!listId
  })
}
