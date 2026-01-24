import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'

export interface ListSuggestion {
  id: string
  list_id: string
  asset_id: string
  suggestion_type: 'add' | 'remove'
  suggested_by: string
  target_user_id: string
  status: 'pending' | 'accepted' | 'rejected'
  notes: string | null
  created_at: string
  responded_at: string | null
  response_notes: string | null
  // Joined data
  asset?: {
    id: string
    symbol: string
    company_name: string
    sector: string | null
  }
  suggester?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
  target_user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

interface UseListSuggestionsOptions {
  listId: string
  enabled?: boolean
}

export function useListSuggestions({ listId, enabled = true }: UseListSuggestionsOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all suggestions for this list (both incoming and outgoing)
  const {
    data: suggestions,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['list-suggestions', listId],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('asset_list_suggestions')
        .select(`
          *,
          asset:assets(id, symbol, company_name, sector),
          suggester:users!asset_list_suggestions_suggested_by_fkey(id, email, first_name, last_name),
          target_user:users!asset_list_suggestions_target_user_id_fkey(id, email, first_name, last_name)
        `)
        .eq('list_id', listId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as ListSuggestion[]
    },
    enabled: enabled && !!listId && !!user?.id
  })

  // Real-time subscription for suggestions
  useEffect(() => {
    if (!enabled || !listId || !user?.id) return

    const channel = supabase
      .channel(`list-suggestions-${listId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'asset_list_suggestions',
          filter: `list_id=eq.${listId}`
        },
        () => {
          // Refetch suggestions when any change occurs
          queryClient.invalidateQueries({ queryKey: ['list-suggestions', listId] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [listId, enabled, user?.id, queryClient])

  // Filter suggestions
  const pendingSuggestions = suggestions?.filter(s => s.status === 'pending') || []
  const incomingSuggestions = pendingSuggestions.filter(s => s.target_user_id === user?.id)
  const outgoingSuggestions = pendingSuggestions.filter(s => s.suggested_by === user?.id)

  // Create suggestion mutation
  const createSuggestionMutation = useMutation({
    mutationFn: async ({
      assetId,
      suggestionType,
      targetUserId,
      notes
    }: {
      assetId: string
      suggestionType: 'add' | 'remove'
      targetUserId: string
      notes?: string
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('asset_list_suggestions')
        .insert({
          list_id: listId,
          asset_id: assetId,
          suggestion_type: suggestionType,
          suggested_by: user.id,
          target_user_id: targetUserId,
          notes: notes || null
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-suggestions', listId] })
    }
  })

  // Accept suggestion mutation
  const acceptSuggestionMutation = useMutation({
    mutationFn: async ({
      suggestionId,
      responseNotes
    }: {
      suggestionId: string
      responseNotes?: string
    }) => {
      // First, update the suggestion status
      const { data: suggestion, error: updateError } = await supabase
        .from('asset_list_suggestions')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString(),
          response_notes: responseNotes || null
        })
        .eq('id', suggestionId)
        .select()
        .single()

      if (updateError) throw updateError

      // Then, perform the actual action based on suggestion type
      if (suggestion.suggestion_type === 'add') {
        // Add asset to list
        const { error: addError } = await supabase
          .from('asset_list_items')
          .insert({
            list_id: suggestion.list_id,
            asset_id: suggestion.asset_id,
            added_by: suggestion.target_user_id
          })

        if (addError) throw addError
      } else if (suggestion.suggestion_type === 'remove') {
        // Remove asset from list (only if owned by target user)
        const { error: removeError } = await supabase
          .from('asset_list_items')
          .delete()
          .eq('list_id', suggestion.list_id)
          .eq('asset_id', suggestion.asset_id)
          .eq('added_by', suggestion.target_user_id)

        if (removeError) throw removeError
      }

      return suggestion
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-suggestions', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  // Reject suggestion mutation
  const rejectSuggestionMutation = useMutation({
    mutationFn: async ({
      suggestionId,
      responseNotes
    }: {
      suggestionId: string
      responseNotes?: string
    }) => {
      const { data, error } = await supabase
        .from('asset_list_suggestions')
        .update({
          status: 'rejected',
          responded_at: new Date().toISOString(),
          response_notes: responseNotes || null
        })
        .eq('id', suggestionId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-suggestions', listId] })
    }
  })

  // Cancel (delete) a pending suggestion you created
  const cancelSuggestionMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await supabase
        .from('asset_list_suggestions')
        .delete()
        .eq('id', suggestionId)
        .eq('suggested_by', user?.id)
        .eq('status', 'pending')

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['list-suggestions', listId] })
    }
  })

  // Check if a suggestion already exists
  const hasPendingSuggestion = (
    assetId: string,
    suggestionType: 'add' | 'remove',
    targetUserId: string
  ): boolean => {
    return pendingSuggestions.some(
      s =>
        s.asset_id === assetId &&
        s.suggestion_type === suggestionType &&
        s.target_user_id === targetUserId
    )
  }

  return {
    // Data
    suggestions: suggestions || [],
    pendingSuggestions,
    incomingSuggestions,
    outgoingSuggestions,
    incomingCount: incomingSuggestions.length,

    // State
    isLoading,
    error,

    // Mutations
    createSuggestion: createSuggestionMutation.mutate,
    acceptSuggestion: acceptSuggestionMutation.mutate,
    rejectSuggestion: rejectSuggestionMutation.mutate,
    cancelSuggestion: cancelSuggestionMutation.mutate,

    // Mutation states
    isCreating: createSuggestionMutation.isPending,
    isAccepting: acceptSuggestionMutation.isPending,
    isRejecting: rejectSuggestionMutation.isPending,
    isCanceling: cancelSuggestionMutation.isPending,

    // Helpers
    hasPendingSuggestion,
    refetch
  }
}

export default useListSuggestions
