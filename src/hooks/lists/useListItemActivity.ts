import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface ListItemActivity {
  id: string
  list_id: string
  actor_id: string | null
  activity_type: string
  metadata: Record<string, any>
  created_at: string
  actor: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
}

/**
 * Fetches activity for a specific asset inside a list. Unlike useListActivity
 * (which excludes your own activity), this returns everything — owner + you +
 * collaborators — since per-row expansion shows the full trail for that asset.
 */
export function useListItemActivity(listId: string, assetId: string | null | undefined) {
  return useQuery<ListItemActivity[]>({
    queryKey: ['asset-list-activity', listId, assetId],
    queryFn: async () => {
      if (!assetId) return []
      const { data, error } = await supabase
        .from('asset_list_activity')
        .select('*, actor:users!asset_list_activity_actor_id_fkey(id, first_name, last_name, email)')
        .eq('list_id', listId)
        .eq('metadata->>asset_id', assetId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as ListItemActivity[]
    },
    enabled: !!listId && !!assetId
  })
}
