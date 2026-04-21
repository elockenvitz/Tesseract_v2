import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

/**
 * Subscribes to all list-scoped tables via Supabase Realtime and invalidates
 * the relevant React Query caches so activity, table rows, and taxonomies
 * stay live without manual refetches.
 *
 * Tables watched:
 *   asset_list_activity  (list_id filter)  → activity feeds + per-item activity
 *   asset_list_items     (list_id filter)  → table rows, progress strip, cells
 *   list_statuses        (list_id filter)  → status picker + group-by columns
 *   list_tags            (list_id filter)  → tag picker
 *   list_item_tags       (no filter; small table, filter on client)
 */
export function useListRealtime(listId: string | null | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!listId) return

    const invalidateActivity = () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-activity', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-activity-feed', listId] })
      queryClient.invalidateQueries({ queryKey: ['list-activity', listId] })
    }

    const invalidateItems = () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-list', listId] })
      invalidateActivity()
    }

    const channel = supabase
      .channel(`list-realtime-${listId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'asset_list_activity', filter: `list_id=eq.${listId}` },
        invalidateActivity
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'asset_list_items', filter: `list_id=eq.${listId}` },
        invalidateItems
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'list_statuses', filter: `list_id=eq.${listId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['list-statuses', listId] })
          invalidateItems()
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'list_tags', filter: `list_id=eq.${listId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['list-tags', listId] })
          invalidateItems()
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'list_item_tags' },
        // No list_id on join table; broad invalidate is cheap and correct
        invalidateItems
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [listId, queryClient])
}
