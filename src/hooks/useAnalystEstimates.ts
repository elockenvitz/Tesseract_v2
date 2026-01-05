import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface EstimateMetric {
  id: string
  key: string
  label: string
  format: 'number' | 'currency' | 'percent' | 'ratio'
  unit: string | null
  is_default: boolean
  sort_order: number
}

export interface AnalystEstimate {
  id: string
  asset_id: string
  user_id: string
  metric_key: string
  period_type: 'annual' | 'quarterly'
  fiscal_year: number
  fiscal_quarter: number | null
  value: number
  currency: string
  notes: string | null
  source: 'manual' | 'excel_sync' | 'api'
  source_file_id: string | null
  is_official: boolean
  created_at: string
  updated_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
  metric?: EstimateMetric
}

export interface EstimateHistory {
  id: string
  estimate_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  source: string | null
  changed_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

interface EstimateConsensus {
  consensus_value: number
  analyst_count: number
  min_value: number
  max_value: number
  std_dev: number
}

const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseAnalystEstimatesOptions {
  assetId: string
  metricKey?: string
  fiscalYear?: number
  userId?: string
}

export function useAnalystEstimates({
  assetId,
  metricKey,
  fiscalYear,
  userId
}: UseAnalystEstimatesOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all estimates for this asset
  const {
    data: estimates,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['analyst-estimates', assetId, metricKey, fiscalYear, userId],
    queryFn: async () => {
      let query = supabase
        .from('analyst_estimates')
        .select(`
          *,
          user:users!analyst_estimates_user_id_fkey(id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .order('fiscal_year', { ascending: true })
        .order('fiscal_quarter', { ascending: true, nullsFirst: true })

      if (metricKey) {
        query = query.eq('metric_key', metricKey)
      }

      if (fiscalYear) {
        query = query.eq('fiscal_year', fiscalYear)
      }

      if (userId) {
        query = query.eq('user_id', userId)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(e => ({
        ...e,
        value: Number(e.value),
        user: e.user ? { ...e.user, full_name: getFullName(e.user) } : undefined
      })) as AnalystEstimate[]
    },
    enabled: !!assetId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  })

  // Get my estimates
  const myEstimates = estimates?.filter(e => e.user_id === user?.id) || []

  // Group estimates by metric
  const estimatesByMetric = (estimates || []).reduce((acc, e) => {
    if (!acc[e.metric_key]) acc[e.metric_key] = []
    acc[e.metric_key].push(e)
    return acc
  }, {} as Record<string, AnalystEstimate[]>)

  // Group estimates by user
  const estimatesByUser = (estimates || []).reduce((acc, e) => {
    if (!acc[e.user_id]) acc[e.user_id] = []
    acc[e.user_id].push(e)
    return acc
  }, {} as Record<string, AnalystEstimate[]>)

  // Group estimates by period
  const estimatesByPeriod = (estimates || []).reduce((acc, e) => {
    const key = e.fiscal_quarter
      ? `${e.fiscal_year}Q${e.fiscal_quarter}`
      : `FY${e.fiscal_year}`
    if (!acc[key]) acc[key] = []
    acc[key].push(e)
    return acc
  }, {} as Record<string, AnalystEstimate[]>)

  // Save or update an estimate
  const saveEstimate = useMutation({
    mutationFn: async ({
      metricKey,
      periodType,
      fiscalYear,
      fiscalQuarter,
      value,
      currency = 'USD',
      notes,
      source = 'manual'
    }: {
      metricKey: string
      periodType: 'annual' | 'quarterly'
      fiscalYear: number
      fiscalQuarter?: number | null
      value: number
      currency?: string
      notes?: string
      source?: 'manual' | 'excel_sync' | 'api'
    }) => {
      if (!user) throw new Error('Not authenticated')

      // Check if estimate already exists
      const { data: existing } = await supabase
        .from('analyst_estimates')
        .select('id')
        .eq('asset_id', assetId)
        .eq('user_id', user.id)
        .eq('metric_key', metricKey)
        .eq('period_type', periodType)
        .eq('fiscal_year', fiscalYear)
        .eq('fiscal_quarter', fiscalQuarter ?? null)
        .maybeSingle()

      const estimateData = {
        value,
        currency,
        notes: notes || null,
        source,
        updated_at: new Date().toISOString()
      }

      if (existing) {
        const { data, error } = await supabase
          .from('analyst_estimates')
          .update(estimateData)
          .eq('id', existing.id)
          .select(`*, user:users!analyst_estimates_user_id_fkey(id, first_name, last_name)`)
          .single()

        if (error) throw error
        return { ...data, value: Number(data.value), user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined } as AnalystEstimate
      } else {
        const { data, error } = await supabase
          .from('analyst_estimates')
          .insert({
            asset_id: assetId,
            user_id: user.id,
            metric_key: metricKey,
            period_type: periodType,
            fiscal_year: fiscalYear,
            fiscal_quarter: fiscalQuarter ?? null,
            ...estimateData
          })
          .select(`*, user:users!analyst_estimates_user_id_fkey(id, first_name, last_name)`)
          .single()

        if (error) throw error
        return { ...data, value: Number(data.value), user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined } as AnalystEstimate
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-estimates', assetId] })
    }
  })

  // Bulk save estimates (for Excel sync)
  const bulkSaveEstimates = useMutation({
    mutationFn: async (estimatesData: Array<{
      metricKey: string
      periodType: 'annual' | 'quarterly'
      fiscalYear: number
      fiscalQuarter?: number | null
      value: number
      currency?: string
      notes?: string
      source?: 'manual' | 'excel_sync' | 'api'
      sourceFileId?: string
    }>) => {
      if (!user) throw new Error('Not authenticated')

      const results: AnalystEstimate[] = []

      for (const est of estimatesData) {
        const { data: existing } = await supabase
          .from('analyst_estimates')
          .select('id')
          .eq('asset_id', assetId)
          .eq('user_id', user.id)
          .eq('metric_key', est.metricKey)
          .eq('period_type', est.periodType)
          .eq('fiscal_year', est.fiscalYear)
          .eq('fiscal_quarter', est.fiscalQuarter ?? null)
          .maybeSingle()

        const estimateData = {
          value: est.value,
          currency: est.currency || 'USD',
          notes: est.notes || null,
          source: est.source || 'excel_sync',
          source_file_id: est.sourceFileId || null,
          updated_at: new Date().toISOString()
        }

        if (existing) {
          const { data, error } = await supabase
            .from('analyst_estimates')
            .update(estimateData)
            .eq('id', existing.id)
            .select()
            .single()

          if (error) throw error
          results.push({ ...data, value: Number(data.value) } as AnalystEstimate)
        } else {
          const { data, error } = await supabase
            .from('analyst_estimates')
            .insert({
              asset_id: assetId,
              user_id: user.id,
              metric_key: est.metricKey,
              period_type: est.periodType,
              fiscal_year: est.fiscalYear,
              fiscal_quarter: est.fiscalQuarter ?? null,
              ...estimateData
            })
            .select()
            .single()

          if (error) throw error
          results.push({ ...data, value: Number(data.value) } as AnalystEstimate)
        }
      }

      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-estimates', assetId] })
    }
  })

  // Delete an estimate
  const deleteEstimate = useMutation({
    mutationFn: async (estimateId: string) => {
      const { error } = await supabase
        .from('analyst_estimates')
        .delete()
        .eq('id', estimateId)
        .eq('user_id', user?.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-estimates', assetId] })
    }
  })

  // Get specific estimate
  const getEstimate = (
    targetMetricKey: string,
    targetFiscalYear: number,
    targetFiscalQuarter?: number | null,
    targetUserId?: string
  ) => {
    const uid = targetUserId || user?.id
    return estimates?.find(e =>
      e.metric_key === targetMetricKey &&
      e.fiscal_year === targetFiscalYear &&
      e.fiscal_quarter === (targetFiscalQuarter ?? null) &&
      e.user_id === uid
    )
  }

  return {
    estimates: estimates || [],
    myEstimates,
    estimatesByMetric,
    estimatesByUser,
    estimatesByPeriod,
    isLoading,
    error,
    refetch,
    saveEstimate,
    bulkSaveEstimates,
    deleteEstimate,
    getEstimate
  }
}

// Hook for fetching estimate metrics
export function useEstimateMetrics() {
  const { data: metrics, isLoading, error } = useQuery({
    queryKey: ['estimate-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimate_metrics')
        .select('*')
        .order('sort_order')

      if (error) throw error
      return data as EstimateMetric[]
    },
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000 // 1 hour
  })

  const defaultMetrics = metrics?.filter(m => m.is_default) || []

  const getMetricByKey = (key: string) => metrics?.find(m => m.key === key)

  return {
    metrics: metrics || [],
    defaultMetrics,
    isLoading,
    error,
    getMetricByKey
  }
}

// Hook for estimate consensus
export function useEstimateConsensus(
  assetId: string,
  metricKey: string,
  fiscalYear: number,
  fiscalQuarter?: number | null,
  method: 'mean' | 'median' = 'mean'
) {
  const { data: consensus, isLoading, error } = useQuery({
    queryKey: ['estimate-consensus', assetId, metricKey, fiscalYear, fiscalQuarter, method],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_estimate_consensus', {
          p_asset_id: assetId,
          p_metric_key: metricKey,
          p_fiscal_year: fiscalYear,
          p_fiscal_quarter: fiscalQuarter ?? null,
          p_method: method
        })

      if (error) throw error
      return data?.[0] as EstimateConsensus | null
    },
    enabled: !!assetId && !!metricKey && !!fiscalYear,
    staleTime: 5 * 60 * 1000 // 5 minutes
  })

  return {
    consensus,
    isLoading,
    error
  }
}

// Hook for estimate history
export function useEstimateHistory(estimateId: string | undefined) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['estimate-history', estimateId],
    queryFn: async () => {
      if (!estimateId) return []

      const { data, error } = await supabase
        .from('analyst_estimate_history')
        .select(`
          *,
          user:users!analyst_estimate_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('estimate_id', estimateId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return data as EstimateHistory[]
    },
    enabled: !!estimateId
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}
