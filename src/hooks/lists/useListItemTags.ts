import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

/**
 * Mutation-only hook for attaching/detaching tags on list items.
 * The current tag assignments per item are fetched as part of the
 * asset-list-items query in ListTab, so this hook only handles writes.
 */
export function useListItemTags(listId: string) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    queryClient.invalidateQueries({ queryKey: ['asset-list-activity', listId] })
  }

  const addTag = useMutation({
    mutationFn: async ({ listItemId, tagId }: { listItemId: string; tagId: string }) => {
      const { error } = await supabase
        .from('list_item_tags')
        .insert({ list_item_id: listItemId, tag_id: tagId })
      if (error) throw error
    },
    onSuccess: invalidate
  })

  const removeTag = useMutation({
    mutationFn: async ({ listItemId, tagId }: { listItemId: string; tagId: string }) => {
      const { error } = await supabase
        .from('list_item_tags')
        .delete()
        .eq('list_item_id', listItemId)
        .eq('tag_id', tagId)
      if (error) throw error
    },
    onSuccess: invalidate
  })

  return {
    addTag: addTag.mutate,
    addTagAsync: addTag.mutateAsync,
    removeTag: removeTag.mutate,
    removeTagAsync: removeTag.mutateAsync,
    isAdding: addTag.isPending,
    isRemoving: removeTag.isPending
  }
}
