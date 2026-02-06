import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'

export type PromoteAction = 'buy' | 'sell'

export interface PromoteToTradeIdeaInput {
  quickThoughtId: string
  quickThoughtContent: string
  action: PromoteAction
  assignedTo: string
  assetId?: string | null
  portfolioId?: string | null
  urgency?: 'low' | 'medium' | 'high' | 'urgent'
  notes?: string
  visibility?: 'private' | 'team' | 'public'
}

export interface PromoteToTradeIdeaResult {
  tradeIdeaId: string
}

/**
 * Shared hook for promoting a Quick Thought to a Trade Idea.
 * Used by both the Ideas tab cards and the sidebar inspector.
 */
export function usePromoteToTradeIdea() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()

  const mutation = useMutation({
    mutationFn: async (input: PromoteToTradeIdeaInput): Promise<PromoteToTradeIdeaResult> => {
      if (!user?.id) {
        throw new Error('Not authenticated')
      }

      // Create trade idea from quick thought
      const { data: tradeIdea, error: createError } = await supabase
        .from('trade_queue_items')
        .insert({
          content: input.notes || input.quickThoughtContent,
          rationale: input.quickThoughtContent,
          asset_id: input.assetId || null,
          portfolio_id: input.portfolioId || null,
          action: input.action,
          urgency: input.urgency || 'medium',
          stage: 'idea',
          status: 'idea',
          visibility_tier: 'active',
          sharing_visibility: input.visibility || 'private',
          created_by: user.id,
          assigned_to: input.assignedTo,
          // Provenance tracking
          origin_type: 'quick_thought',
          origin_id: input.quickThoughtId,
        })
        .select('id')
        .single()

      if (createError) throw createError

      // Update quick thought with promotion link
      const { error: updateError } = await supabase
        .from('quick_thoughts')
        .update({ promoted_to_trade_idea_id: tradeIdea.id })
        .eq('id', input.quickThoughtId)

      if (updateError) throw updateError

      return { tradeIdeaId: tradeIdea.id }
    },
    onSuccess: (_result, input) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['quick-thought', input.quickThoughtId] })
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts-feed'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue'] })
      queryClient.invalidateQueries({ queryKey: ['ideas-feed'] })
    },
    onError: (err: Error) => {
      showError('Failed to promote', err.message)
    },
  })

  return {
    promote: mutation.mutateAsync,
    isPromoting: mutation.isPending,
    error: mutation.error,
  }
}
