import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface ListTag {
  id: string
  list_id: string
  name: string
  color: string
  created_at: string
  created_by: string | null
}

const TAG_QUERY_KEY = (listId: string) => ['list-tags', listId]

export function useListTags(listId: string | null | undefined) {
  const queryClient = useQueryClient()

  const query = useQuery<ListTag[]>({
    queryKey: TAG_QUERY_KEY(listId ?? ''),
    queryFn: async () => {
      if (!listId) return []
      const { data, error } = await supabase
        .from('list_tags')
        .select('*')
        .eq('list_id', listId)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as ListTag[]
    },
    enabled: !!listId
  })

  const createTag = useMutation({
    mutationFn: async ({ name, color }: { name: string; color?: string }) => {
      if (!listId) throw new Error('No listId')
      const { data, error } = await supabase
        .from('list_tags')
        .insert({ list_id: listId, name, color: color ?? '#6b7280' })
        .select()
        .single()
      if (error) throw error
      return data as ListTag
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TAG_QUERY_KEY(listId ?? '') })
  })

  const updateTag = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Pick<ListTag, 'name' | 'color'>> }) => {
      const { error } = await supabase.from('list_tags').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TAG_QUERY_KEY(listId ?? '') })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  const deleteTag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('list_tags').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TAG_QUERY_KEY(listId ?? '') })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  return {
    tags: query.data ?? [],
    isLoading: query.isLoading,
    createTag: createTag.mutate,
    createTagAsync: createTag.mutateAsync,
    updateTag: updateTag.mutate,
    deleteTag: deleteTag.mutate,
    isCreating: createTag.isPending,
    isUpdating: updateTag.isPending,
    isDeleting: deleteTag.isPending
  }
}
