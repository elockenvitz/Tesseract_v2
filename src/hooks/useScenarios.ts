import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface Scenario {
  id: string
  asset_id: string
  name: string
  description: string | null
  color: string | null
  is_default: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  creator?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
}

// Default colors for scenarios
export const SCENARIO_COLORS = {
  Bull: '#22c55e',  // green-500
  Base: '#3b82f6',  // blue-500
  Bear: '#ef4444',  // red-500
  default: '#8b5cf6' // purple-500 for custom scenarios
}

// Helper to compute full name
const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseScenariosOptions {
  assetId: string
  includeCustom?: boolean // Include custom scenarios (default: true)
}

export function useScenarios({ assetId, includeCustom = true }: UseScenariosOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch scenarios for an asset
  const {
    data: scenarios,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['scenarios', assetId, includeCustom],
    queryFn: async () => {
      // First ensure default scenarios exist
      await supabase.rpc('ensure_default_scenarios', { p_asset_id: assetId })

      let query = supabase
        .from('scenarios')
        .select(`
          *,
          creator:users!scenarios_created_by_fkey(id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .order('is_default', { ascending: false })
        .order('name')

      if (!includeCustom) {
        query = query.eq('is_default', true)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(s => ({
        ...s,
        creator: s.creator ? { ...s.creator, full_name: getFullName(s.creator) } : undefined
      })) as Scenario[]
    },
    enabled: !!assetId,
    staleTime: Infinity, // Never refetch automatically
    gcTime: 30 * 60 * 1000
  })

  // Get default scenarios (Bull, Base, Bear)
  const defaultScenarios = scenarios?.filter(s => s.is_default) || []

  // Get custom scenarios
  const customScenarios = scenarios?.filter(s => !s.is_default) || []

  // Get current user's custom scenarios
  const myCustomScenarios = customScenarios.filter(s => s.created_by === user?.id)

  // Create a new custom scenario
  const createScenario = useMutation({
    mutationFn: async ({
      name,
      description,
      color
    }: {
      name: string
      description?: string
      color?: string
    }) => {
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('scenarios')
        .insert({
          asset_id: assetId,
          name,
          description: description || null,
          color: color || SCENARIO_COLORS.default,
          is_default: false,
          created_by: user.id
        })
        .select(`
          *,
          creator:users!scenarios_created_by_fkey(id, first_name, last_name)
        `)
        .single()

      if (error) throw error

      return {
        ...data,
        creator: data.creator ? { ...data.creator, full_name: getFullName(data.creator) } : undefined
      } as Scenario
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios', assetId] })
    }
  })

  // Update a scenario
  const updateScenario = useMutation({
    mutationFn: async ({
      scenarioId,
      name,
      description,
      color
    }: {
      scenarioId: string
      name?: string
      description?: string
      color?: string
    }) => {
      const updates: Partial<Scenario> = {}
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (color !== undefined) updates.color = color

      const { data, error } = await supabase
        .from('scenarios')
        .update(updates)
        .eq('id', scenarioId)
        .select()
        .single()

      if (error) throw error
      return data as Scenario
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios', assetId] })
    }
  })

  // Delete a custom scenario
  const deleteScenario = useMutation({
    mutationFn: async (scenarioId: string) => {
      const { error } = await supabase
        .from('scenarios')
        .delete()
        .eq('id', scenarioId)
        .eq('is_default', false) // Safety: can't delete default scenarios
        .eq('created_by', user?.id) // Can only delete own scenarios

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios', assetId] })
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
    }
  })

  // Get scenario by name (useful for finding Bull/Base/Bear by name)
  const getScenarioByName = (name: string) => {
    return scenarios?.find(s => s.name.toLowerCase() === name.toLowerCase())
  }

  return {
    scenarios: scenarios || [],
    defaultScenarios,
    customScenarios,
    myCustomScenarios,
    isLoading,
    error,
    refetch,
    createScenario,
    updateScenario,
    deleteScenario,
    getScenarioByName
  }
}
