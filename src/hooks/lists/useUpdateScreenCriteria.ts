import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { ScreenCriteria } from '../../lib/lists/screen-types'

export function useUpdateScreenCriteria(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (criteria: ScreenCriteria | null) => {
      const { error } = await supabase
        .from('asset_lists')
        .update({ screen_criteria: criteria, updated_at: new Date().toISOString() })
        .eq('id', listId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-list', listId] })
      qc.invalidateQueries({ queryKey: ['list-surfaces'] })
    }
  })
}
