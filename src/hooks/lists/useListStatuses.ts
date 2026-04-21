import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface ListStatus {
  id: string
  list_id: string
  name: string
  color: string
  sort_order: number
  is_default_taxonomy: boolean
  created_at: string
  created_by: string | null
}

const STATUS_QUERY_KEY = (listId: string) => ['list-statuses', listId]

export function useListStatuses(listId: string | null | undefined) {
  const queryClient = useQueryClient()

  const query = useQuery<ListStatus[]>({
    queryKey: STATUS_QUERY_KEY(listId ?? ''),
    queryFn: async () => {
      if (!listId) return []
      const { data, error } = await supabase
        .from('list_statuses')
        .select('*')
        .eq('list_id', listId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as ListStatus[]
    },
    enabled: !!listId
  })

  const createStatus = useMutation({
    mutationFn: async ({ name, color, sort_order }: { name: string; color?: string; sort_order?: number }) => {
      if (!listId) throw new Error('No listId')
      const { data, error } = await supabase
        .from('list_statuses')
        .insert({ list_id: listId, name, color: color ?? '#6b7280', sort_order: sort_order ?? 0 })
        .select()
        .single()
      if (error) throw error
      return data as ListStatus
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY(listId ?? '') })
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Pick<ListStatus, 'name' | 'color' | 'sort_order'>> }) => {
      const { error } = await supabase.from('list_statuses').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY(listId ?? '') })
  })

  const deleteStatus = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('list_statuses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY(listId ?? '') })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  return {
    statuses: query.data ?? [],
    isLoading: query.isLoading,
    createStatus: createStatus.mutate,
    createStatusAsync: createStatus.mutateAsync,
    updateStatus: updateStatus.mutate,
    deleteStatus: deleteStatus.mutate,
    isCreating: createStatus.isPending,
    isUpdating: updateStatus.isPending,
    isDeleting: deleteStatus.isPending
  }
}
