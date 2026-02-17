import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'

export function useMarkListOpened() {
  const { user } = useAuth()
  const userId = user?.id
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (listId: string) => {
      if (!userId) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('asset_list_user_state')
        .upsert(
          { list_id: listId, user_id: userId, last_opened_at: new Date().toISOString() },
          { onConflict: 'list_id,user_id' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-activity-counts', userId] })
      queryClient.invalidateQueries({ queryKey: ['list-user-states', userId] })
    }
  })
}
