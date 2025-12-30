import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { AnalystPriceTarget } from './useAnalystPriceTargets'

export type AggregationMethod = 'average' | 'weighted' | 'median' | 'range' | 'latest' | 'primary_only'

export interface OutcomePreferences {
  id: string
  user_id: string
  aggregation_method: AggregationMethod
  weight_by_role: boolean
  show_opinions: boolean
  default_timeframe: string
  created_at: string
  updated_at: string
}

export interface AggregatedResult {
  scenarioId: string
  scenarioName: string
  scenarioColor: string | null
  isDefault: boolean
  aggregatedPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  analystCount: number
  targets: AnalystPriceTarget[]
}

// Role weights for weighted aggregation
const ROLE_WEIGHTS: Record<string, number> = {
  primary: 3,
  secondary: 2,
  tertiary: 1
}

// Helper to calculate aggregated values
function calculateAggregation(
  targets: AnalystPriceTarget[],
  method: AggregationMethod,
  includeOpinions: boolean = true
): { aggregatedPrice: number | null; minPrice: number | null; maxPrice: number | null } {
  // Filter to only covering analyst targets if needed
  // Use current coverage status (t.coverage exists) not stale is_official flag
  const filteredTargets = includeOpinions
    ? targets
    : targets.filter(t => !!t.coverage)

  if (filteredTargets.length === 0) {
    return { aggregatedPrice: null, minPrice: null, maxPrice: null }
  }

  const prices = filteredTargets.map(t => t.price)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)

  let aggregatedPrice: number | null = null

  switch (method) {
    case 'average':
      aggregatedPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length
      break

    case 'weighted':
      const weightedSum = filteredTargets.reduce((sum, t) => {
        const role = t.coverage?.role || 'tertiary'
        const weight = ROLE_WEIGHTS[role] || 1
        return sum + t.price * weight
      }, 0)
      const totalWeight = filteredTargets.reduce((sum, t) => {
        const role = t.coverage?.role || 'tertiary'
        return sum + (ROLE_WEIGHTS[role] || 1)
      }, 0)
      aggregatedPrice = totalWeight > 0 ? weightedSum / totalWeight : null
      break

    case 'median':
      const sorted = [...prices].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      aggregatedPrice = sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2
      break

    case 'range':
      // For range, return the average but min/max are the key values
      aggregatedPrice = (minPrice + maxPrice) / 2
      break

    case 'latest':
      const latest = filteredTargets.reduce((newest, t) => {
        return new Date(t.updated_at) > new Date(newest.updated_at) ? t : newest
      })
      aggregatedPrice = latest.price
      break

    case 'primary_only':
      const primary = filteredTargets.find(t => t.coverage?.role === 'primary')
      aggregatedPrice = primary?.price || null
      break

    default:
      aggregatedPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length
  }

  return {
    aggregatedPrice: aggregatedPrice !== null ? Math.round(aggregatedPrice * 100) / 100 : null,
    minPrice,
    maxPrice
  }
}

interface UseOutcomeAggregationOptions {
  assetId: string
  priceTargets: AnalystPriceTarget[]
  scenarios: { id: string; name: string; color: string | null; is_default: boolean }[]
}

export function useOutcomeAggregation({
  assetId,
  priceTargets,
  scenarios
}: UseOutcomeAggregationOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Storage key for instant preference access
  const PREFS_STORAGE_KEY = 'outcome-preferences'

  // Read localStorage ONCE on mount using lazy initializer (survives re-renders)
  const [initialStoredPrefs] = useState<Partial<OutcomePreferences> | null>(() => {
    try {
      const stored = localStorage.getItem(PREFS_STORAGE_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  // Store preferences to localStorage
  const storePreferences = useCallback((prefs: Partial<OutcomePreferences>) => {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // Ignore storage errors
    }
  }, [])

  // Fetch user preferences from DB
  const {
    data: preferencesData
  } = useQuery({
    queryKey: ['outcome-preferences', user?.id],
    queryFn: async () => {
      if (!user) return null

      const { data, error } = await supabase
        .from('outcome_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error

      // Store to localStorage for instant access next time
      if (data) {
        storePreferences(data)
      }

      // Return actual data or empty object to indicate "fetched but no prefs"
      return (data || { _empty: true }) as OutcomePreferences | { _empty: true }
    },
    enabled: !!user,
    staleTime: Infinity, // Never refetch automatically - only on mutation
    gcTime: 30 * 60 * 1000 // Keep in cache for 30 minutes
  })

  // Sync DB data to localStorage whenever it loads (for next time)
  useEffect(() => {
    if (preferencesData && !('_empty' in preferencesData)) {
      storePreferences(preferencesData)
    }
  }, [preferencesData, storePreferences])

  // Use DB data if available, fall back to localStorage for instant display
  const actualPrefs = preferencesData && !('_empty' in preferencesData)
    ? preferencesData
    : initialStoredPrefs

  // Preferences are always "ready" - we use localStorage as instant fallback
  const preferencesLoading = false

  // Compute effective preferences - use stored/fetched data immediately
  const effectivePreferences: Omit<OutcomePreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
    aggregation_method: actualPrefs?.aggregation_method || 'average',
    weight_by_role: actualPrefs?.weight_by_role ?? true,
    show_opinions: actualPrefs?.show_opinions ?? true,
    default_timeframe: actualPrefs?.default_timeframe || '12 months'
  }

  // Calculate aggregated results for each scenario (only when preferences ready)
  const aggregatedResults: AggregatedResult[] = scenarios.map(scenario => {
    const scenarioTargets = priceTargets.filter(pt => pt.scenario_id === scenario.id)
    const { aggregatedPrice, minPrice, maxPrice } = calculateAggregation(
      scenarioTargets,
      effectivePreferences?.aggregation_method || 'average',
      effectivePreferences?.show_opinions ?? true
    )

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      scenarioColor: scenario.color,
      isDefault: scenario.is_default,
      aggregatedPrice,
      minPrice,
      maxPrice,
      analystCount: scenarioTargets.length,
      targets: scenarioTargets
    }
  })

  // Separate default and custom scenario results
  const defaultResults = aggregatedResults.filter(r => r.isDefault)
  const customResults = aggregatedResults.filter(r => !r.isDefault)

  // Save preferences
  const savePreferences = useMutation({
    mutationFn: async (newPreferences: Partial<Omit<OutcomePreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      if (!user) throw new Error('Not authenticated')

      // Immediately update localStorage for instant access
      try {
        const stored = localStorage.getItem(PREFS_STORAGE_KEY)
        const currentStored = stored ? JSON.parse(stored) : {}
        storePreferences({ ...currentStored, ...newPreferences })
      } catch {
        storePreferences(newPreferences)
      }

      const { data: existing } = await supabase
        .from('outcome_preferences')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (existing) {
        const { data, error } = await supabase
          .from('outcome_preferences')
          .update({
            ...newPreferences,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) throw error
        storePreferences(data) // Update localStorage with full data
        return data as OutcomePreferences
      } else {
        const { data, error } = await supabase
          .from('outcome_preferences')
          .insert({
            user_id: user.id,
            aggregation_method: 'average',
            weight_by_role: true,
            show_opinions: true,
            default_timeframe: '12 months',
            ...newPreferences
          })
          .select()
          .single()

        if (error) throw error
        storePreferences(data) // Update localStorage with full data
        return data as OutcomePreferences
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outcome-preferences', user?.id] })
    }
  })

  // Calculate with custom method (for preview)
  const calculateWithMethod = (method: AggregationMethod, includeOpinions: boolean = true): AggregatedResult[] => {
    return scenarios.map(scenario => {
      const scenarioTargets = priceTargets.filter(pt => pt.scenario_id === scenario.id)
      const { aggregatedPrice, minPrice, maxPrice } = calculateAggregation(
        scenarioTargets,
        method,
        includeOpinions
      )

      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        scenarioColor: scenario.color,
        isDefault: scenario.is_default,
        aggregatedPrice,
        minPrice,
        maxPrice,
        analystCount: scenarioTargets.length,
        targets: scenarioTargets
      }
    })
  }

  // Get unique contributors
  const contributors = [...new Map(priceTargets.map(pt => [pt.user_id, pt.user])).values()]
    .filter((u): u is NonNullable<typeof u> => !!u)

  // Check if there's enough data for aggregation
  const hasData = priceTargets.length > 0
  const hasMultipleAnalysts = contributors.length > 1

  return {
    preferences: effectivePreferences,
    preferencesLoading,
    aggregatedResults,
    defaultResults,
    customResults,
    contributors,
    hasData,
    hasMultipleAnalysts,
    savePreferences,
    calculateWithMethod
  }
}

// Available aggregation methods with descriptions
export const AGGREGATION_METHODS: { value: AggregationMethod; label: string; description: string }[] = [
  { value: 'average', label: 'Average', description: 'Simple arithmetic mean of all targets' },
  { value: 'weighted', label: 'Weighted', description: 'Weighted by analyst role (primary > secondary > tertiary)' },
  { value: 'median', label: 'Median', description: 'Middle value to reduce outlier impact' },
  { value: 'range', label: 'Range', description: 'Show min-max with mean' },
  { value: 'latest', label: 'Latest', description: 'Most recently updated target' },
  { value: 'primary_only', label: 'Primary Only', description: 'Only show primary analyst\'s target' }
]
