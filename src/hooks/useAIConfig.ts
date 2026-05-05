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

// Per-user AI config — context preferences, personal limit overrides, and
// per-user model preference (overrides org default at request time).
// BYOK key/provider fields moved to OrgAIConfig (org-scoped, admin-only).
export interface UserAIConfig {
  id: string
  user_id: string
  include_thesis: boolean
  include_outcomes: boolean
  include_notes: boolean
  include_discussions: boolean
  include_price_history: boolean
  preferred_model: string | null
  last_used_at: string | null
}

// Per-organization BYOK config — SAFE summary view. Returned by the
// `get_org_ai_config_summary` RPC, which omits the api_key. The actual
// key value lives only in the DB and the ai-chat edge function — never
// shipped to the browser, even for admins (we only need to know "is it
// configured" to render the UI).
export interface OrgAIConfig {
  organization_id: string | null
  byok_provider: AIProvider | null
  byok_model: string | null
  byok_enabled: boolean
  is_configured: boolean
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

// Available models by provider. Kept in sync with the edge function's
// PRICING table (supabase/functions/ai-chat/index.ts) — adding a model
// here without a pricing entry there will cause cost estimates to fall
// back to the provider's default rates.
export const AI_MODELS: Record<AIProvider, Array<{ id: string; name: string; description: string; recommended?: boolean }>> = {
  anthropic: [
    { id: 'claude-sonnet-4-6',          name: 'Claude Sonnet 4.6',  description: 'Best balance of speed and capability', recommended: true },
    { id: 'claude-opus-4-7',            name: 'Claude Opus 4.7',    description: 'Most capable model — premium pricing' },
    { id: 'claude-haiku-4-5-20251001',  name: 'Claude Haiku 4.5',   description: 'Fast and cost-effective' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet',  description: 'Legacy — previous generation' },
    { id: 'claude-3-5-haiku-20241022',  name: 'Claude 3.5 Haiku',   description: 'Legacy — previous generation' },
  ],
  openai: [
    { id: 'gpt-4o',         name: 'GPT-4o',      description: 'Multimodal, fast', recommended: true },
    { id: 'gpt-4o-mini',    name: 'GPT-4o mini', description: 'Cheap and fast' },
    { id: 'gpt-4-turbo',    name: 'GPT-4 Turbo', description: 'High-quality, slower' },
  ],
  google: [
    { id: 'gemini-1.5-pro',   name: 'Gemini 1.5 Pro',   description: 'Most capable Gemini', recommended: true },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and cheap' },
  ],
  perplexity: [
    { id: 'llama-3.1-sonar-large-128k-online', name: 'Sonar Large Online', description: 'Best for live web research', recommended: true },
    { id: 'llama-3.1-sonar-small-128k-online', name: 'Sonar Small Online', description: 'Faster, lower cost' },
  ],
}

// Default model for a provider — first `recommended` entry, else first model.
// Used when saving BYOK config so byok_model is never NULL on initial save.
export function getDefaultModel(provider: AIProvider): string {
  const list = AI_MODELS[provider] || []
  return (list.find(m => m.recommended) || list[0])?.id || ''
}

// Strip non-ASCII characters (smart quotes, zero-width spaces, BOMs, etc.)
// and trim whitespace. Returns the cleaned key — the caller compares to the
// original to detect that something was changed and surface a clear error.
function sanitizeApiKey(key: string): string {
  // eslint-disable-next-line no-control-regex
  return key.trim().replace(/[^\x20-\x7E]/g, '')
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

  // Fetch user config (context preferences only now)
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

  // Fetch org BYOK config via the SECURITY DEFINER summary RPC. The RPC
  // returns provider/model/enabled/is_configured but NEVER the api_key —
  // only the edge function ever sees the raw key. Even admins use this
  // path for display; the key only matters for the write mutation, which
  // sends a new value rather than reading one.
  const { data: orgConfig, isLoading: isOrgLoading } = useQuery({
    queryKey: ['org-ai-config'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_org_ai_config_summary')
      if (error) throw error
      // RPC returns SETOF — pick first row (org has 0 or 1 config)
      const rows = (data || []) as OrgAIConfig[]
      return rows[0] ?? null
    },
    enabled: !!user?.id,
  })

  // Whether the current user can edit the org's BYOK config. Source of
  // truth for the write enable; the actual mutation is also RLS-gated.
  const { data: isOrgAdmin = false } = useQuery({
    queryKey: ['is-org-admin'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_active_org_admin_of_current_org')
      if (error) throw error
      return !!data
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
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

    // BYOK allowed and configured at the org level. Model resolution:
    // user's preferred_model overrides the org default if set.
    if (platformConfig?.allow_byok && orgConfig?.byok_enabled && orgConfig?.is_configured) {
      return {
        mode: 'byok' as const,
        provider: orgConfig.byok_provider,
        model: userConfig?.preferred_model || orgConfig.byok_model,
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
        provider: orgConfig?.byok_provider || null,
        model: orgConfig?.byok_model || null,
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

  // Update org BYOK config. RLS rejects non-admins.
  const updateConfigMutation = useMutation({
    mutationFn: async (updates: AIConfigUpdate) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Sanity-check the api_key on save too — catches the case where the
      // user skipped Test Connection and went straight to Save with a
      // non-ASCII paste.
      if (updates.byok_api_key) {
        const cleaned = sanitizeApiKey(updates.byok_api_key)
        if (cleaned !== updates.byok_api_key.trim()) {
          throw new Error(
            'Your API key contains invisible or non-ASCII characters. ' +
            'Re-copy it directly from the provider\'s console.'
          )
        }
        updates = { ...updates, byok_api_key: cleaned }
      }

      // Resolve the current org. The RPC returns NULL if there's no
      // current org, in which case there's no scope to write into.
      const { data: orgIdData, error: orgIdErr } = await supabase.rpc('current_org_id')
      if (orgIdErr) throw orgIdErr
      const orgId = orgIdData as string | null
      if (!orgId) throw new Error('No active organization')

      // Upsert avoids the read-then-write pattern, which mattered when we
      // tightened SELECT to admins-only — a non-admin somehow reaching this
      // code path used to get a confusing empty SELECT then an INSERT
      // failure. Upsert lets RLS reject in one clean step.
      const { data, error } = await supabase
        .from('organization_ai_config')
        .upsert(
          { organization_id: orgId, ...updates },
          { onConflict: 'organization_id' }
        )
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-ai-config'] })
    },
  })

  // Test API key
  const testApiKeyMutation = useMutation({
    mutationFn: async ({ provider, apiKey: rawApiKey }: { provider: AIProvider; apiKey: string }) => {
      // Sanitize the key — copy/paste from docs or password managers often
      // smuggles in smart quotes, zero-width spaces, BOMs, or em-dashes.
      // HTTP headers must be Latin-1, so any non-ASCII char makes fetch
      // throw "String contains non ISO-8859-1 code point" before sending.
      const apiKey = sanitizeApiKey(rawApiKey)
      if (apiKey !== rawApiKey.trim()) {
        throw new Error(
          'Your API key contains invisible or non-ASCII characters. ' +
          'Re-copy it directly from the provider\'s console (avoid pasting through chat/docs).'
        )
      }
      if (!apiKey) throw new Error('API key is empty')

      // Simple test call to verify the key works
      if (provider === 'anthropic') {
        // Anthropic blocks browser-origin calls by default ("failed to fetch"
        // CORS error). The dangerous-direct-browser-access header opts in —
        // safe here because the key being tested is the user's own (BYOK
        // entered in this session), not a developer key being exposed.
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        })

        if (!response.ok) {
          const error = await response.json().catch(() => ({}))
          throw new Error(error.error?.message || `Invalid API key (HTTP ${response.status})`)
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

  // Update per-user AI preferences (preferred_model, include_* flags).
  // Writes to user_ai_config — RLS scoped to the user themselves. No
  // admin gating since this is the user's own preference.
  const updateUserPrefsMutation = useMutation({
    mutationFn: async (updates: { preferred_model?: string | null; include_thesis?: boolean; include_outcomes?: boolean; include_notes?: boolean; include_discussions?: boolean }) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('user_ai_config')
        .upsert({ user_id: user.id, ...updates }, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-ai-config'] })
    },
  })

  // Clear org API key (admins only — RLS enforces).
  const clearApiKeyMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated')

      const { data: orgIdData, error: orgIdErr } = await supabase.rpc('current_org_id')
      if (orgIdErr) throw orgIdErr
      const orgId = orgIdData as string | null
      if (!orgId) throw new Error('No active organization')

      const { error } = await supabase
        .from('organization_ai_config')
        .update({
          byok_api_key: null,
          byok_enabled: false,
        })
        .eq('organization_id', orgId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-ai-config'] })
    },
  })

  return {
    // Data
    platformConfig,
    userConfig,
    orgConfig,
    isOrgAdmin,
    effectiveConfig,

    // Loading states
    isLoading: isPlatformLoading || isUserLoading || isOrgLoading,

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

    updateUserPrefs: updateUserPrefsMutation.mutate,
    updateUserPrefsAsync: updateUserPrefsMutation.mutateAsync,
    isUpdatingPrefs: updateUserPrefsMutation.isPending,

    // Helpers
    getModelsForProvider: (provider: AIProvider) => AI_MODELS[provider] || [],
  }
}
