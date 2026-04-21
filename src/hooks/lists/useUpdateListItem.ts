import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface ListItemUpdates {
  assignee_id?: string | null
  status_id?: string | null
  due_date?: string | null
  is_flagged?: boolean
  notes?: string | null
}

/**
 * Updates list-specific fields on a list item. Activity events for
 * status_changed / assignee_changed / due_date_changed / flagged / unflagged
 * are fired by the DB trigger — no need to log them here.
 */
export function useUpdateListItem(listId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ itemId, updates }: { itemId: string; updates: ListItemUpdates }) => {
      const { error } = await supabase
        .from('asset_list_items')
        .update(updates)
        .eq('id', itemId)
      if (error) throw error
    },
    onMutate: async ({ itemId, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['asset-list-items', listId] })
      const prev = queryClient.getQueryData<any[]>(['asset-list-items', listId])
      if (prev) {
        queryClient.setQueryData<any[]>(
          ['asset-list-items', listId],
          prev.map(item => item.id === itemId ? { ...item, ...updates } : item)
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['asset-list-items', listId], ctx.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-activity', listId] })
    }
  })
}
