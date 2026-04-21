import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export function useUpdateListBrief(listId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (brief: string) => {
      const { error } = await supabase.rpc('update_list_brief', {
        p_list_id: listId,
        p_brief: brief
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list', listId] })
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-activity', listId] })
    }
  })
}
