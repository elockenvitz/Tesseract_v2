/**
 * useGenerateAIColumn — runs an AI column prompt against a single asset.
 *
 * Routes through the ai-chat edge function with context: { type: 'asset', id }
 * so the server-side can enrich with asset-scoped context (thesis, outcomes,
 * notes) based on the column's context_config flags.
 *
 * Designed for per-cell generation. Callers are responsible for:
 *   - Tracking per-cell loading state (this is a shared mutation object)
 *   - Saving the returned text into ai_column_cache (via useAIColumnCacheBulk)
 */

import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAIConfig } from './useAIConfig'
import type { AIColumnContextConfig } from './useAIColumns'

interface GenerateParams {
  columnId: string
  assetId: string
  prompt: string
  contextConfig?: AIColumnContextConfig
}

export function useGenerateAIColumn() {
  const { effectiveConfig } = useAIConfig()

  return useMutation({
    mutationFn: async ({ assetId, prompt, contextConfig }: GenerateParams) => {
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Open Settings → AI to finish setup.')
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No active session')

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
            context: {
              type: 'asset',
              id: assetId,
              includeThesis:       contextConfig?.includeThesis       ?? true,
              includeOutcomes:     contextConfig?.includePriceTargets ?? false,
              includeNotes:        contextConfig?.includeNotes        ?? false,
              includeContributions: contextConfig?.includeContributions ?? false,
              includeDiscussions: false,
            },
          }),
        }
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'AI request failed' }))
        throw new Error(err.error || `AI request failed (${response.status})`)
      }

      const data = await response.json()
      return (data.response ?? '') as string
    }
  })
}
