/**
 * usePilotScenario — the preloaded idea a pilot user lands in Trade Lab with.
 *
 * Resolution:
 *   1. User-specific scenario (pilot_scenarios.user_id = me, status='active')
 *   2. Org-wide scenario (pilot_scenarios.user_id IS NULL, status='active')
 *
 * Multiple active scenarios per user/org: the most recent `created_at` wins.
 * (Keeps the experience predictable; admins can archive older ones to demote.)
 */

import { useMemo } from 'react'
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
  assigned_at: string | null
  accepted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  asset?: { symbol: string; company_name: string | null } | null
  portfolio?: { name: string; portfolio_id: string | null } | null
}

export function usePilotScenario() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  const query = useQuery({
    queryKey: ['pilot-scenario', user?.id, currentOrgId],
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async (): Promise<PilotScenario | null> => {
      // RLS already filters to current org. Fetch both user-specific + org-wide
      // active scenarios in one round trip and pick the best match client-side.
      const { data, error } = await supabase
        .from('pilot_scenarios')
        .select(`
          *,
          asset:assets(symbol, company_name),
          portfolio:portfolios(name, portfolio_id)
        `)
        .eq('status', 'active')
        .or(`user_id.eq.${user!.id},user_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      if (!data || data.length === 0) return null

      // Prefer a scenario specifically assigned to this user over an org-wide one.
      const mine = data.find((s: any) => s.user_id === user!.id)
      return (mine ?? data[0]) as PilotScenario
    }
  })

  return {
    scenario: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Admin-side mutations (used by the ops portal to stage / manage scenarios) ──

export function usePilotScenarioMutations(organizationId: string | null) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pilot-scenarios', organizationId] })
    queryClient.invalidateQueries({ queryKey: ['pilot-scenario'] }) // user-facing
  }

  const create = useMutation({
    mutationFn: async (input: Omit<Partial<PilotScenario>, 'id' | 'organization_id' | 'created_at' | 'updated_at'> & { title: string }) => {
      if (!organizationId) throw new Error('Missing organization')
      const { data, error } = await supabase
        .from('pilot_scenarios')
        .insert({
          organization_id: organizationId,
          created_by: user?.id ?? null,
          assigned_at: input.user_id ? new Date().toISOString() : null,
          ...input,
        })
        .select('*')
        .single()
      if (error) throw error
      return data as PilotScenario
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
      const { error } = await supabase.from('pilot_scenarios').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return {
    create: create.mutateAsync,
    isCreating: create.isPending,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
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
        .select(`*, asset:assets(symbol, company_name), portfolio:portfolios(name, portfolio_id)`)
        .eq('organization_id', organizationId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as PilotScenario[]
    }
  })
}
