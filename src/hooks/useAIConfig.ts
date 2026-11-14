import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

/**
 * Store (or replace) the organization's provider API key.
 *
 * The cast works around a pre-existing, repo-wide typing defect rather than
 * hiding one of ours. In this project's `Database` type, `rpc()` resolves
 * `Fn['Args']` to `never` for EVERY declared function, so the args parameter
 * becomes `undefined` and any call that passes arguments fails to compile.
 * Roughly thirty existing call sites (`mark_messages_read`,
 * `set_message_pinned`, `delete_organization`, the whole organization
 * settings surface) already fail this way and are counted in the repo's type
 * ceiling. Rather than add two more, the cast is localized here.
 * `set_org_ai_api_key` is declared in `src/types/database.ts` with its real
 * signature, so once the root cause is fixed this helper drops the cast and
 * keeps compiling.
 *
 * There is deliberately no counterpart that reads a key back. The only
 * reader is `resolve_org_ai_config`, which is granted to `service_role`
 * alone and is therefore unreachable from this client.
 */
async function storeOrgApiKey(key: string): Promise<void> {
  const { error } = await supabase.rpc(
    'set_org_ai_api_key',
    { p_key: key } as never
  )
  if (error) throw error
}

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
  /**
   * Whether `isConfigured` is an ANSWER yet, or just the default.
   *
   * The resolution below is a chain of fall-throughs over three queries. While
   * those are in flight every input is `undefined`, so the chain lands on its
   * last reachable branch and reports `isConfigured: false` -- which reads
   * identically to "this org has no AI configured". A surface that renders a
   * "not configured" screen on that gets one for a moment on every open,
   * before the real answer arrives and replaces it.
   *
   * So: do not render a configuration verdict while this is true.
   */
  isResolving: boolean
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
    { id: 'claude-sonnet-5-5',          name: 'Claude Sonnet 5.5',  description: 'Best balance of speed and capability', recommended: true },
    { id: 'claude-opus-5-5',            name: 'Claude Opus 5.5',    description: 'Most capable, for the hardest analysis' },
    { id: 'claude-haiku-5-5',           name: 'Claude Haiku 5.5',   description: 'Fastest and lowest cost' },
    { id: 'claude-sonnet-4-6',          name: 'Claude Sonnet 4.6',  description: 'Previous generation' },
    { id: 'claude-opus-4-7',            name: 'Claude Opus 4.7',    description: 'Previous generation' },
    { id: 'claude-haiku-4-5-20251001',  name: 'Claude Haiku 4.5',   description: 'Previous generation' },
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
  const { user, loading: authLoading } = useAuth()
  /*
   * The active organization, because two of the queries below are answers
   * ABOUT it.
   *
   * `get_org_ai_config_summary` and `is_active_org_admin_of_current_org`
   * resolve the organization server-side and take no argument, so nothing in
   * the request distinguished one org from another -- and the cache keys did
   * not either. After switching organizations React Query served the previous
   * org's answer: a BYOK org could look unconfigured, an unconfigured org
   * could look like it had a key, and the BYOK editor could be enabled for
   * somebody who is not an admin of the org they are now in. (The write
   * itself is RLS-gated, so that last one was a wrong control rather than a
   * hole.)
   */
  const { currentOrgId, isLoading: isOrgContextLoading } = useOrganization()
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
    queryKey: ['org-ai-config', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_org_ai_config_summary')
      if (error) throw error
      // RPC returns SETOF — pick first row (org has 0 or 1 config)
      const rows = (data || []) as OrgAIConfig[]
      return rows[0] ?? null
    },
    enabled: !!user?.id && !!currentOrgId,
  })

  // Whether the current user can edit the org's BYOK config. Source of
  // truth for the write enable; the actual mutation is also RLS-gated.
  const { data: isOrgAdmin = false } = useQuery({
    queryKey: ['is-org-admin', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_active_org_admin_of_current_org')
      if (error) throw error
      return !!data
    },
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
  })

  /*
   * Is the configuration question answerable yet?
   *
   * `authLoading` is in here and is the easy one to leave out: two of the
   * three queries are `enabled: !!user?.id`, and a DISABLED React Query
   * reports `isLoading: false`. So during the window where auth is still
   * restoring, all three flags read false and the config would look resolved
   * while two of its three inputs had not been requested.
   */
  /* `isOrgContextLoading` for the same reason `authLoading` is here: the org
     query is now disabled until the active org is known, and a disabled query
     reports `isLoading: false`. Without it the config would read as resolved
     while the org half had not been requested. */
  const isResolving =
    authLoading || isOrgContextLoading || isPlatformLoading || isUserLoading || isOrgLoading

  // Compute effective config
  const resolvedConfig = (() => {
    const preferences = {
      includeThesis: userConfig?.include_thesis ?? true,
      includeOutcomes: userConfig?.include_outcomes ?? true,
      includeNotes: userConfig?.include_notes ?? true,
      includeDiscussions: userConfig?.include_discussions ?? false,
    }

    /*
     * Resolution ORDER, and it must match the edge function's.
     *
     * Two changes from the previous version, both of which only showed up the
     * day platform AI gets switched on:
     *
     *   - The order is now BYOK first. Platform-on used to take precedence and
     *     silently stop using an org's own key, moving a firm that pays for
     *     its own Anthropic account onto the platform's bill unasked. An org
     *     that configured a key keeps using it; the platform is what everyone
     *     else gets. That is "platform by default, BYOK optional".
     *
     *   - `isConfigured: true // Assume platform has keys configured` is gone.
     *     It was false on 2026-11-09: the flag was off AND no ANTHROPIC_API_KEY
     *     secret existed, so a UI built on that assumption would have told
     *     every user AI was ready while every request failed. The browser
     *     cannot see whether a platform secret is deployed, so this now
     *     reports what it can actually establish and leaves the authoritative
     *     answer to the edge function, which returns a configuration error
     *     naming the problem.
     */

    // BYOK allowed and configured at the org level. Model resolution:
    // user's preferred_model overrides the org default if set.
    if (platformConfig?.allow_byok && orgConfig?.byok_enabled && orgConfig?.is_configured) {
      return {
        mode: 'byok' as const,
        provider: orgConfig.byok_provider,
        model: userConfig?.preferred_model || orgConfig.byok_model,
        isConfigured: true,
        isPlatformEnabled: !!platformConfig?.platform_ai_enabled,
        allowByok: true,
        ...preferences,
      }
    }

    // Platform AI enabled. Whether a platform key is actually deployed is not
    // visible from the browser, so isConfigured is optimistic here by
    // necessity; the edge function is the authority and says so explicitly
    // when it is not.
    if (platformConfig?.platform_ai_enabled) {
      return {
        mode: 'platform' as const,
        provider: platformConfig.platform_provider,
        model: userConfig?.preferred_model || platformConfig.platform_model,
        isConfigured: true,
        isPlatformEnabled: true,
        allowByok: platformConfig.allow_byok,
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

  const effectiveConfig: EffectiveAIConfig = { ...resolvedConfig, isResolving }

  /*
   * Update org BYOK config.
   *
   * The key and the rest of the row take DIFFERENT paths now, and that split
   * is the security fix.
   *
   * The key goes to `set_org_ai_api_key`, a SECURITY DEFINER function that
   * checks org-admin itself and writes into Supabase Vault. It returns void.
   * There is no companion function that returns a key to a browser role, and
   * `byok_api_key` is no longer a column, so there is nothing to read back.
   *
   * Everything else (provider, model, enabled) is an ordinary RLS-gated write.
   * Note the explicit column list on `.select()`: the previous version called
   * a bare `.select()` after the upsert, which asked the database for every
   * column of the row it had just written -- including, at the time, the
   * plaintext key. So saving a key echoed it straight back into the browser's
   * network response and into the react-query cache. Naming columns is what
   * stops that from coming back by accident.
   */
  const updateConfigMutation = useMutation({
    mutationFn: async (updates: AIConfigUpdate) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { byok_api_key, ...rowUpdates } = updates

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
      if (Object.keys(rowUpdates).length > 0) {
        const { error } = await supabase
          .from('organization_ai_config')
          .upsert(
            { organization_id: orgId, ...rowUpdates },
            { onConflict: 'organization_id' }
          )
          .select('organization_id, byok_provider, byok_model, byok_enabled')
          .single()
        if (error) throw error
      }

      // The key last, so a rejected row update does not leave a key stored
      // against settings that failed to save. The ASCII and length checks
      // live in the function as well, so a caller that skips this one still
      // cannot store an unusable key.
      if (byok_api_key) {
        const cleaned = sanitizeApiKey(byok_api_key)
        if (cleaned !== byok_api_key.trim()) {
          throw new Error(
            'Your API key contains invisible or non-ASCII characters. ' +
            'Re-copy it directly from the provider\'s console.'
          )
        }
        await storeOrgApiKey(cleaned)
      }

      return { organization_id: orgId }
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

      /*
       * Store the key, then verify it through Tesseract's own pipeline.
       *
       * This used to POST the key straight from the browser to
       * api.anthropic.com with `anthropic-dangerous-direct-browser-access`,
       * and to the other three providers' endpoints besides. The argument for
       * it was that the key is the admin's own, which is true and is not the
       * whole picture: it put a live provider credential through the browser,
       * every extension loaded in it, and any corporate TLS-inspecting proxy
       * on the way out, for no gain over doing it server-side.
       *
       * It also tested the wrong thing. "Anthropic accepts this key" is not
       * "Tesseract AI works" -- the key was valid throughout the five months
       * ai-chat served no traffic. So the probe now goes through ai-chat with
       * `purpose: 'snippet'` (which routes to Haiku, the cheapest model) and a
       * two-word prompt, which exercises the real path end to end: the edge
       * function's auth gate, the Vault key resolution, the rate-limit gate,
       * the provider call, and the usage log. It costs a fraction of a cent.
       *
       * The key is stored first because resolution happens server-side out of
       * Vault; there is no longer any way to hand a candidate key to the
       * provider without storing it. That makes this "save and verify" rather
       * than "test then save", which is why the button says so.
       */
      await storeOrgApiKey(apiKey)
      await queryClient.invalidateQueries({ queryKey: ['org-ai-config'] })

      const { data: session } = await supabase.auth.getSession()
      const token = session?.session?.access_token
      if (!token) throw new Error('Your session has expired. Sign in again and retry.')

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: 'Reply with the single word OK.',
            purpose: 'snippet',
            verbosity: 'brief',
          }),
        },
      )

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          payload?.error ||
          `The key was saved but the test request failed (HTTP ${response.status}).`
        )
      }

      return { success: true, model: payload?.model ?? null, provider }
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

      // One function call rather than a table update that nulls a column.
      // The column is gone; the secret lives in Vault, and only
      // `clear_org_ai_api_key` can destroy it. It resolves the org itself,
      // re-checks org-admin, deletes the vault row and sets byok_enabled to
      // false in one transaction -- so a half-cleared state (enabled, with no
      // key behind it) is not reachable from here.
      const { error } = await supabase.rpc('clear_org_ai_api_key')
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
