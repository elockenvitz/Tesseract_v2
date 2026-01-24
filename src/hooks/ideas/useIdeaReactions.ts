import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import type { ItemType, ReactionType, Reaction } from './types'

export function useIdeaReactions(itemId: string, itemType: ItemType) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch reactions for this item
  const { data: reactions = [], isLoading } = useQuery({
    queryKey: ['idea-reactions', itemId, itemType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('idea_reactions')
        .select('*')
        .eq('item_id', itemId)
        .eq('item_type', itemType)

      if (error) throw error
      return data as Reaction[]
    },
    staleTime: 30000
  })

  // Toggle reaction mutation
  const toggleReaction = useMutation({
    mutationFn: async (reaction: ReactionType) => {
      if (!user?.id) throw new Error('User not authenticated')

      // Check if user already has this reaction
      const existing = reactions.find(
        r => r.user_id === user.id && r.reaction === reaction
      )

      if (existing) {
        // Remove reaction
        const { error } = await supabase
          .from('idea_reactions')
          .delete()
          .eq('id', existing.id)

        if (error) throw error
        return { action: 'removed', reaction }
      } else {
        // Add reaction
        const { error } = await supabase
          .from('idea_reactions')
          .insert({
            item_id: itemId,
            item_type: itemType,
            user_id: user.id,
            reaction
          })

        if (error) throw error
        return { action: 'added', reaction }
      }
    },
    onMutate: async (reaction) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['idea-reactions', itemId, itemType] })

      const previousReactions = queryClient.getQueryData<Reaction[]>(
        ['idea-reactions', itemId, itemType]
      )

      const existing = previousReactions?.find(
        r => r.user_id === user?.id && r.reaction === reaction
      )

      if (existing) {
        // Optimistically remove
        queryClient.setQueryData<Reaction[]>(
          ['idea-reactions', itemId, itemType],
          old => old?.filter(r => r.id !== existing.id) || []
        )
      } else {
        // Optimistically add
        const newReaction: Reaction = {
          id: `temp-${Date.now()}`,
          item_id: itemId,
          item_type: itemType,
          user_id: user?.id || '',
          reaction,
          created_at: new Date().toISOString()
        }
        queryClient.setQueryData<Reaction[]>(
          ['idea-reactions', itemId, itemType],
          old => [...(old || []), newReaction]
        )
      }

      return { previousReactions }
    },
    onError: (_error, _variables, context) => {
      // Rollback on error
      if (context?.previousReactions) {
        queryClient.setQueryData(
          ['idea-reactions', itemId, itemType],
          context.previousReactions
        )
      }
    },
    onSettled: () => {
      // Invalidate to refetch
      queryClient.invalidateQueries({ queryKey: ['idea-reactions', itemId, itemType] })
      queryClient.invalidateQueries({ queryKey: ['content-aggregation'] })
    }
  })

  // Computed reaction counts
  const reactionCounts = reactions.reduce((acc, r) => {
    if (!acc[r.reaction]) {
      acc[r.reaction] = { count: 0, hasReacted: false }
    }
    acc[r.reaction].count++
    if (r.user_id === user?.id) {
      acc[r.reaction].hasReacted = true
    }
    return acc
  }, {} as Record<ReactionType, { count: number; hasReacted: boolean }>)

  return {
    reactions,
    reactionCounts,
    isLoading,
    toggleReaction: toggleReaction.mutate,
    isToggling: toggleReaction.isPending
  }
}

// Bulk reactions hook for feed performance
export function useBulkReactions(itemIds: string[], itemType: ItemType) {
  const { user } = useAuth()

  const { data: reactionsMap = new Map(), isLoading } = useQuery({
    queryKey: ['bulk-reactions', itemType, itemIds.join(',')],
    queryFn: async () => {
      if (itemIds.length === 0) return new Map()

      const { data, error } = await supabase
        .from('idea_reactions')
        .select('*')
        .eq('item_type', itemType)
        .in('item_id', itemIds)

      if (error) throw error

      const map = new Map<string, Reaction[]>()
      for (const reaction of (data || [])) {
        if (!map.has(reaction.item_id)) {
          map.set(reaction.item_id, [])
        }
        map.get(reaction.item_id)!.push(reaction)
      }

      return map
    },
    enabled: itemIds.length > 0,
    staleTime: 30000
  })

  return { reactionsMap, isLoading }
}
