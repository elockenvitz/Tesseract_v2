/**
 * usePilotScenario — the preloaded decision a pilot user lands in Trade Lab with.
 *
 * This reads the instantiated row. It does not create it: seeding runs from
 * the shell, in `usePilotSeeding`, because this hook mounts only inside Trade
 * Lab and a pilot who never opened Trade Lab was never seeded at all.
 *
 * Filtering:
 *   - We only return *instantiated* scenarios (`is_template = FALSE`).
 *     Templates are never surfaced to pilot users directly.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

export interface PilotScenario {
  id: string
  organization_id: string
  user_id: string | null
  title: string
  asset_id: string | null
  symbol: string | null
  direction: string | null
  thesis: string | null
  why_now: string | null
  proposed_action: string | null
  proposed_sizing_input: string | null
  target_weight_pct: number | null
  delta_weight_pct: number | null
  portfolio_id: string | null
  trade_queue_item_id: string | null
  status: 'active' | 'completed' | 'archived'
  is_template: boolean
  assigned_at: string | null
  accepted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  asset?: { symbol: string; company_name: string | null } | null
  portfolio?: { name: string; portfolio_id: string | null } | null
}

const PILOT_SCENARIO_SELECT =
  `*, asset:assets(symbol, company_name), portfolio:portfolios(name, portfolio_id)`

/**
 * Exported so `usePilotSeeding` can ask the same question through the same
 * query key. One cache entry, one request, two readers.
 */
export async function fetchInstantiatedScenario(userId: string, organizationId: string): Promise<PilotScenario | null> {
  const { data, error } = await supabase
    .from('pilot_scenarios')
    .select(PILOT_SCENARIO_SELECT)
    .eq('status', 'active')
    .eq('is_template', false)
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as PilotScenario | null) ?? null
}

export function usePilotScenario() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  const query = useQuery({
    queryKey: ['pilot-scenario', user?.id, currentOrgId],
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async (): Promise<PilotScenario | null> => {
      return fetchInstantiatedScenario(user!.id, currentOrgId!)
    }
  })

  /*
   * Seeding does NOT live here. It used to, and because this hook mounts only
   * inside `SimulationPage` — a lazily-loaded Trade Lab tab — a fresh pilot
   * who went coverage → capture → Idea Pipeline never triggered it, and their
   * workspace stayed empty. It now runs from the shell. See `usePilotSeeding`.
   */

  return {
    scenario: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Admin-side mutations (used by the ops portal) ────────────────────

export function usePilotScenarioMutations(organizationId: string | null) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pilot-scenarios', organizationId] })
    queryClient.invalidateQueries({ queryKey: ['pilot-scenario'] })
    queryClient.invalidateQueries({ queryKey: ['ops-pilot-user-scenarios'] })
    // Seeding writes trade_queue_items, and the Idea Pipeline reads them under
    // this key. Without it an ops-side seed or reset left the board showing a
    // five-minute-stale result.
    queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    queryClient.invalidateQueries({ queryKey: ['trade-queue-ideas'] })
    queryClient.invalidateQueries({ queryKey: ['trade-ideas'] })
    queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] })
  }

  const create = useMutation({
    mutationFn: async (input: Omit<Partial<PilotScenario>, 'id' | 'organization_id' | 'created_at' | 'updated_at'> & { title: string }) => {
      if (!organizationId) throw new Error('Missing organization')
      const { data, error } = await supabase.rpc('stage_pilot_scenario', {
        p_organization_id: organizationId,
        p_title: input.title,
        p_symbol: input.symbol ?? null,
        p_asset_id: input.asset_id ?? null,
        p_direction: input.direction ?? 'buy',
        p_thesis: input.thesis ?? null,
        p_why_now: input.why_now ?? null,
        p_proposed_action: input.proposed_action ?? null,
        p_proposed_sizing_input: input.proposed_sizing_input ?? null,
        p_target_weight_pct: input.target_weight_pct ?? null,
        p_delta_weight_pct: input.delta_weight_pct ?? null,
        p_portfolio_id: input.portfolio_id ?? null,
        p_user_id: input.user_id ?? null,
        p_is_template: input.is_template ?? false,
      })
      if (error) throw error
      const scenarioId = (data as any)?.scenario_id
      if (!scenarioId) throw new Error('RPC did not return a scenario id')
      const { data: row, error: fetchError } = await supabase
        .from('pilot_scenarios')
        .select(PILOT_SCENARIO_SELECT)
        .eq('id', scenarioId)
        .single()
      if (fetchError) throw fetchError
      return row as PilotScenario
    },
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<PilotScenario> }) => {
      const { error } = await supabase
        .from('pilot_scenarios')
        .update(patch as any)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_pilot_scenario', { p_scenario_id: id })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  // Seed/reset a scenario for a specific pilot user from the ops panel.
  const seedForUser = useMutation({
    mutationFn: async ({ userId, reset = false }: { userId: string; reset?: boolean }) => {
      const { data, error } = await supabase.rpc('ensure_pilot_scenario_for_user', {
        p_user_id: userId,
        p_force_reset: reset,
      })
      if (error) throw error
      return data as {
        seeded: boolean
        reason?: string
        scenario_id?: string
        trade_queue_item_id?: string
        trade_proposal_id?: string
        portfolio_id?: string
        asset_id?: string
        used_template?: boolean
      }
    },
    onSuccess: invalidate,
  })

  return {
    create: create.mutateAsync,
    isCreating: create.isPending,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
    seedForUser: seedForUser.mutateAsync,
    isSeeding: seedForUser.isPending,
  }
}

export function usePilotScenariosForOrg(organizationId: string | null) {
  return useQuery<PilotScenario[]>({
    queryKey: ['pilot-scenarios', organizationId],
    enabled: !!organizationId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pilot_scenarios')
        .select(PILOT_SCENARIO_SELECT)
        .eq('organization_id', organizationId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as PilotScenario[]
    }
  })
}

// Per-user scenario summary for the ops panel (active instantiations only).
export function usePilotUserScenarios(organizationId: string | null) {
  return useQuery<Record<string, PilotScenario>>({
    queryKey: ['ops-pilot-user-scenarios', organizationId],
    enabled: !!organizationId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pilot_scenarios')
        .select(PILOT_SCENARIO_SELECT)
        .eq('organization_id', organizationId!)
        .eq('status', 'active')
        .eq('is_template', false)
        .not('user_id', 'is', null)
      if (error) throw error
      const map: Record<string, PilotScenario> = {}
      for (const row of (data || []) as PilotScenario[]) {
        if (row.user_id) map[row.user_id] = row
      }
      return map
    },
  })
}
