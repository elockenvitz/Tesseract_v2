import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import type { ItemType, Bookmark } from './types'

export function useIdeaBookmarks(itemId?: string, itemType?: ItemType) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Check if item is bookmarked
  const { data: isBookmarked = false, isLoading } = useQuery({
    queryKey: ['idea-bookmark', itemId, itemType, user?.id],
    queryFn: async () => {
      if (!itemId || !itemType || !user?.id) return false

      const { data, error } = await supabase
        .from('idea_bookmarks')
        .select('id')
        .eq('item_id', itemId)
        .eq('item_type', itemType)
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) throw error
      return !!data
    },
    enabled: !!itemId && !!itemType && !!user?.id,
    staleTime: 60000
  })

  // Toggle bookmark mutation
  const toggleBookmark = useMutation({
    mutationFn: async ({ itemId, itemType }: { itemId: string; itemType: ItemType }) => {
      if (!user?.id) throw new Error('User not authenticated')

      // Check if already bookmarked
      const { data: existing } = await supabase
        .from('idea_bookmarks')
        .select('id')
        .eq('item_id', itemId)
        .eq('item_type', itemType)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existing) {
        // Remove bookmark
        const { error } = await supabase
          .from('idea_bookmarks')
          .delete()
          .eq('id', existing.id)

        if (error) throw error
        return { action: 'removed' }
      } else {
        // Add bookmark
        const { error } = await supabase
          .from('idea_bookmarks')
          .insert({
            item_id: itemId,
            item_type: itemType,
            user_id: user.id
          })

        if (error) throw error
        return { action: 'added' }
      }
    },
    onMutate: async ({ itemId, itemType }) => {
      // Optimistic update
      await queryClient.cancelQueries({
        queryKey: ['idea-bookmark', itemId, itemType, user?.id]
      })

      const previousValue = queryClient.getQueryData<boolean>(
        ['idea-bookmark', itemId, itemType, user?.id]
      )

      queryClient.setQueryData(
        ['idea-bookmark', itemId, itemType, user?.id],
        !previousValue
      )

      return { previousValue }
    },
    onError: (_error, { itemId, itemType }, context) => {
      // Rollback on error
      if (context?.previousValue !== undefined) {
        queryClient.setQueryData(
          ['idea-bookmark', itemId, itemType, user?.id],
          context.previousValue
        )
      }
    },
    onSettled: () => {
      // Invalidate all bookmark queries
      queryClient.invalidateQueries({ queryKey: ['idea-bookmark'] })
      queryClient.invalidateQueries({ queryKey: ['user-bookmarks'] })
    }
  })

  return {
    isBookmarked,
    isLoading,
    toggleBookmark: (id: string, type: ItemType) =>
      toggleBookmark.mutate({ itemId: id, itemType: type }),
    isToggling: toggleBookmark.isPending
  }
}

// Fetch all user bookmarks
export function useUserBookmarks() {
  const { user } = useAuth()

  const { data: bookmarks = [], isLoading, refetch } = useQuery({
    queryKey: ['user-bookmarks', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('idea_bookmarks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as Bookmark[]
    },
    enabled: !!user?.id,
    staleTime: 60000
  })

  // Create a lookup set for quick checking
  const bookmarkedItems = new Set(
    bookmarks.map(b => `${b.item_type}:${b.item_id}`)
  )

  const isBookmarked = (itemId: string, itemType: ItemType) =>
    bookmarkedItems.has(`${itemType}:${itemId}`)

  return {
    bookmarks,
    isLoading,
    refetch,
    isBookmarked
  }
}

// Bulk bookmark check for feed performance
export function useBulkBookmarks(itemIds: string[], itemType: ItemType) {
  const { user } = useAuth()

  const { data: bookmarkedSet = new Set(), isLoading } = useQuery({
    queryKey: ['bulk-bookmarks', itemType, itemIds.join(','), user?.id],
    queryFn: async () => {
      if (itemIds.length === 0 || !user?.id) return new Set()

      const { data, error } = await supabase
        .from('idea_bookmarks')
        .select('item_id')
        .eq('item_type', itemType)
        .eq('user_id', user.id)
        .in('item_id', itemIds)

      if (error) throw error

      return new Set((data || []).map(b => b.item_id))
    },
    enabled: itemIds.length > 0 && !!user?.id,
    staleTime: 60000
  })

  return { bookmarkedSet, isLoading }
}
