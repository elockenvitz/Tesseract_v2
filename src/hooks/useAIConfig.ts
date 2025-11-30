import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Types
// Available providers
export const AI_PROVIDERS = [
  { id: 'anthropic' as const, name: 'Anthropic', description: 'Claude models', color: 'from-orange-400 to-orange-600' },
  { id: 'openai' as const, name: 'OpenAI', description: 'GPT models', color: 'from-green-400 to-teal-600' },
  { id: 'google' as const, name: 'Google', description: 'Gemini models', color: 'from-blue-400 to-blue-600' },
  { id: 'perplexity' as const, name: 'Perplexity', description: 'Online models with search', color: 'from-purple-400 to-indigo-600' },
] as const

export type AIProvider = typeof AI_PROVIDERS[number]['id']

export interface PlatformAIConfig {
  id: string
  platform_ai_enabled: boolean
  platform_provider: AIProvider
  platform_model: string
  allow_byok: boolean
  daily_request_limit: number
  monthly_request_limit: number
}

export interface UserAIConfig {
  id: string
  user_id: string
  byok_provider: AIProvider
  byok_api_key: string | null
  byok_model: string
  byok_enabled: boolean
  include_thesis: boolean
  include_outcomes: boolean
  include_notes: boolean
  include_discussions: boolean
  include_price_history: boolean
  last_used_at: string | null
}

export interface EffectiveAIConfig {
  mode: 'platform' | 'byok' | 'disabled'
  provider: AIProvider | null
  model: string | null
  isConfigured: boolean
  isPlatformEnabled: boolean
  allowByok: boolean
  // Context preferences (defaults applied internally)
  includeThesis: boolean
  includeOutcomes: boolean
  includeNotes: boolean
  includeDiscussions: boolean
}

export interface AIConfigUpdate {
  byok_provider?: AIProvider
  byok_api_key?: string
  byok_model?: string
  byok_enabled?: boolean
}

// Available models by provider
export const AI_MODELS: Record<AIProvider, Array<{ id: string; name: string; description: string; recommended?: boolean }>> = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Latest and most capable', recommended: true },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Great balance of speed and capability' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast and cost-effective' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Previous most capable model' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Latest multimodal model', recommended: true },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Fast GPT-4 with vision' },
    { id: 'gpt-4', name: 'GPT-4', description: 'Original GPT-4 model' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and cost-effective' },
    { id: 'o1-preview', name: 'o1 Preview', description: 'Advanced reasoning model' },
    { id: 'o1-mini', name: 'o1 Mini', description: 'Faster reasoning model' },
  ],
  google: [
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable Gemini', recommended: true },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and efficient' },
    { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', description: 'Latest experimental' },
  ],
  perplexity: [
    { id: 'llama-3.1-sonar-large-128k-online', name: 'Sonar Large Online', description: 'Best for research with search', recommended: true },
    { id: 'llama-3.1-sonar-small-128k-online', name: 'Sonar Small Online', description: 'Faster with search' },
    { id: 'llama-3.1-sonar-huge-128k-online', name: 'Sonar Huge Online', description: 'Most capable with search' },
  ],
}

export function useAIConfig() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch platform config
  const { data: platformConfig, isLoading: isPlatformLoading } = useQuery({
    queryKey: ['platform-ai-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_ai_config')
        .select('*')
        .single()

      if (error) throw error
      return data as PlatformAIConfig
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Fetch user config
  const { data: userConfig, isLoading: isUserLoading } = useQuery({
    queryKey: ['user-ai-config', user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from('user_ai_config')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') throw error // PGRST116 = no rows
      return data as UserAIConfig | null
    },
    enabled: !!user?.id,
  })

  // Compute effective config
  const effectiveConfig: EffectiveAIConfig = (() => {
    const preferences = {
      includeThesis: userConfig?.include_thesis ?? true,
      includeOutcomes: userConfig?.include_outcomes ?? true,
      includeNotes: userConfig?.include_notes ?? true,
      includeDiscussions: userConfig?.include_discussions ?? false,
    }

    // Platform AI enabled
    if (platformConfig?.platform_ai_enabled) {
      return {
        mode: 'platform' as const,
        provider: platformConfig.platform_provider,
        model: platformConfig.platform_model,
        isConfigured: true, // Assume platform has keys configured
        isPlatformEnabled: true,
        allowByok: platformConfig.allow_byok,
        ...preferences,
      }
    }

    // BYOK allowed and configured
    if (platformConfig?.allow_byok && userConfig?.byok_enabled && userConfig?.byok_api_key) {
      return {
        mode: 'byok' as const,
        provider: userConfig.byok_provider,
        model: userConfig.byok_model,
        isConfigured: true,
        isPlatformEnabled: false,
        allowByok: true,
        ...preferences,
      }
    }

    // BYOK allowed but not configured
    if (platformConfig?.allow_byok !== false) {
      return {
        mode: 'byok' as const,
        provider: userConfig?.byok_provider || null,
        model: userConfig?.byok_model || null,
        isConfigured: false,
        isPlatformEnabled: false,
        allowByok: true,
        ...preferences,
      }
    }

    // AI disabled
    return {
      mode: 'disabled' as const,
      provider: null,
      model: null,
      isConfigured: false,
      isPlatformEnabled: false,
      allowByok: false,
      ...preferences,
    }
  })()

  // Update user config mutation
  const updateConfigMutation = useMutation({
    mutationFn: async (updates: AIConfigUpdate) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Check if config exists
      const { data: existing } = await supabase
        .from('user_ai_config')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('user_ai_config')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .select()
          .single()

        if (error) throw error
        return data
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('user_ai_config')
          .insert({
            user_id: user.id,
            ...updates,
          })
          .select()
          .single()

        if (error) throw error
        return data
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-ai-config'] })
    },
  })

  // Test API key
  const testApiKeyMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: AIProvider; apiKey: string }) => {
      // Simple test call to verify the key works
      if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error?.message || 'Invalid API key')
        }

        return { success: true }
      }

      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error?.message || 'Invalid API key')
        }

        return { success: true }
      }

      if (provider === 'google') {
        // Google AI Studio API test
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Hi' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error?.message || 'Invalid API key')
        }

        return { success: true }
      }

      if (provider === 'perplexity') {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.1-sonar-small-128k-online',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error?.message || 'Invalid API key')
        }

        return { success: true }
      }

      throw new Error('Unsupported provider')
    },
  })

  // Clear API key
  const clearApiKeyMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('user_ai_config')
        .update({
          byok_api_key: null,
          byok_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-ai-config'] })
    },
  })

  return {
    // Data
    platformConfig,
    userConfig,
    effectiveConfig,

    // Loading states
    isLoading: isPlatformLoading || isUserLoading,

    // Mutations
    updateConfig: updateConfigMutation.mutate,
    updateConfigAsync: updateConfigMutation.mutateAsync,
    isUpdating: updateConfigMutation.isPending,
    updateError: updateConfigMutation.error,

    testApiKey: testApiKeyMutation.mutate,
    testApiKeyAsync: testApiKeyMutation.mutateAsync,
    isTesting: testApiKeyMutation.isPending,
    testError: testApiKeyMutation.error,
    testSuccess: testApiKeyMutation.isSuccess,

    clearApiKey: clearApiKeyMutation.mutate,
    isClearing: clearApiKeyMutation.isPending,

    // Helpers
    getModelsForProvider: (provider: AIProvider) => AI_MODELS[provider] || [],
  }
}
