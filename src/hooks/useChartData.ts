import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ChartType, TimeFrame, IndicatorType, Annotation, ChartEvent } from '../components/charting'

// Types for database records
export interface ChartConfiguration {
  id: string
  user_id: string
  name: string
  symbol: string
  timeframe: TimeFrame
  chart_type: ChartType
  indicators: IndicatorType[]
  settings: Record<string, any>
  is_favorite: boolean
  created_at: string
  updated_at: string
}

export interface ChartAnnotationRecord {
  id: string
  chart_id: string
  user_id: string
  type: string
  data: Annotation
  z_index: number
  visible: boolean
  locked: boolean
  created_at: string
  updated_at: string
}

export interface ChartEventRecord {
  id: string
  chart_id: string
  user_id: string
  event_time: string
  event_type: string
  title: string
  description?: string
  color?: string
  icon?: string
  created_at: string
}

export interface SharedChart {
  id: string
  chart_id: string
  owner_id: string
  share_token: string
  share_type: 'snapshot' | 'live'
  saved_as_timestamp?: string
  expires_at?: string
  view_count: number
  created_at: string
}

export interface ChartTemplate {
  id: string
  user_id: string
  name: string
  description?: string
  indicators: IndicatorType[]
  drawing_tools: string[]
  settings: Record<string, any>
  is_public: boolean
  use_count: number
  created_at: string
  updated_at: string
}

export interface CustomDataSeries {
  id: string
  user_id: string
  name: string
  symbol?: string
  description?: string
  data_type: 'line' | 'bar' | 'scatter' | 'area'
  color: string
  data: Array<{ time: number; value: number }>
  created_at: string
  updated_at: string
}

// Generate a random share token
function generateShareToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Hook for managing chart configurations
 */
export function useChartConfigurations(userId?: string) {
  const queryClient = useQueryClient()

  // Fetch all user's charts
  const {
    data: charts = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['chart-configurations', userId],
    queryFn: async () => {
      if (!userId) return []
      const { data, error } = await supabase
        .from('chart_configurations')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data as ChartConfiguration[]
    },
    enabled: !!userId
  })

  // Create chart
  const createChart = useMutation({
    mutationFn: async (config: Omit<ChartConfiguration, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('chart_configurations')
        .insert([{ ...config, user_id: userId }])
        .select()
        .single()

      if (error) throw error
      return data as ChartConfiguration
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-configurations', userId] })
    }
  })

  // Update chart
  const updateChart = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ChartConfiguration> & { id: string }) => {
      const { data, error } = await supabase
        .from('chart_configurations')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as ChartConfiguration
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-configurations', userId] })
    }
  })

  // Delete chart
  const deleteChart = useMutation({
    mutationFn: async (chartId: string) => {
      const { error } = await supabase
        .from('chart_configurations')
        .delete()
        .eq('id', chartId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-configurations', userId] })
    }
  })

  // Toggle favorite
  const toggleFavorite = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) => {
      const { error } = await supabase
        .from('chart_configurations')
        .update({ is_favorite: isFavorite })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-configurations', userId] })
    }
  })

  return {
    charts,
    isLoading,
    error,
    createChart,
    updateChart,
    deleteChart,
    toggleFavorite
  }
}

/**
 * Hook for managing chart annotations
 */
export function useChartAnnotations(chartId?: string) {
  const queryClient = useQueryClient()

  // Fetch annotations for a chart
  const {
    data: annotations = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['chart-annotations', chartId],
    queryFn: async () => {
      if (!chartId) return []
      const { data, error } = await supabase
        .from('chart_annotations')
        .select('*')
        .eq('chart_id', chartId)
        .order('z_index', { ascending: true })

      if (error) throw error
      return data as ChartAnnotationRecord[]
    },
    enabled: !!chartId
  })

  // Add annotation
  const addAnnotation = useMutation({
    mutationFn: async (annotation: Omit<ChartAnnotationRecord, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('chart_annotations')
        .insert([annotation])
        .select()
        .single()

      if (error) throw error
      return data as ChartAnnotationRecord
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-annotations', chartId] })
    }
  })

  // Update annotation
  const updateAnnotation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ChartAnnotationRecord> & { id: string }) => {
      const { data, error } = await supabase
        .from('chart_annotations')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as ChartAnnotationRecord
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-annotations', chartId] })
    }
  })

  // Delete annotation
  const deleteAnnotation = useMutation({
    mutationFn: async (annotationId: string) => {
      const { error } = await supabase
        .from('chart_annotations')
        .delete()
        .eq('id', annotationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-annotations', chartId] })
    }
  })

  // Convert to Annotation format for chart
  const chartAnnotations: Annotation[] = annotations.map(a => a.data)

  return {
    annotations,
    chartAnnotations,
    isLoading,
    error,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation
  }
}

/**
 * Hook for sharing charts
 */
export function useChartSharing(chartId?: string, userId?: string) {
  const queryClient = useQueryClient()

  // Fetch shared links for a chart
  const {
    data: sharedLinks = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['shared-charts', chartId],
    queryFn: async () => {
      if (!chartId) return []
      const { data, error } = await supabase
        .from('shared_charts')
        .select('*')
        .eq('chart_id', chartId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as SharedChart[]
    },
    enabled: !!chartId
  })

  // Create share link
  const createShareLink = useMutation({
    mutationFn: async (options: {
      shareType: 'snapshot' | 'live'
      expiresAt?: string
    }) => {
      if (!chartId || !userId) throw new Error('Chart ID and User ID required')

      const shareToken = generateShareToken()

      const { data, error } = await supabase
        .from('shared_charts')
        .insert([{
          chart_id: chartId,
          owner_id: userId,
          share_token: shareToken,
          share_type: options.shareType,
          saved_as_timestamp: options.shareType === 'live' ? new Date().toISOString() : null,
          expires_at: options.expiresAt
        }])
        .select()
        .single()

      if (error) throw error
      return data as SharedChart
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared-charts', chartId] })
    }
  })

  // Delete share link
  const deleteShareLink = useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase
        .from('shared_charts')
        .delete()
        .eq('id', shareId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared-charts', chartId] })
    }
  })

  // Get shared chart by token (public)
  const getSharedChart = useCallback(async (token: string) => {
    const { data: shareData, error: shareError } = await supabase
      .from('shared_charts')
      .select('*, chart_configurations(*)')
      .eq('share_token', token)
      .single()

    if (shareError) throw shareError

    // Increment view count
    await supabase
      .from('shared_charts')
      .update({ view_count: (shareData.view_count || 0) + 1 })
      .eq('id', shareData.id)

    return shareData
  }, [])

  return {
    sharedLinks,
    isLoading,
    error,
    createShareLink,
    deleteShareLink,
    getSharedChart
  }
}

/**
 * Hook for chart templates
 */
export function useChartTemplates(userId?: string) {
  const queryClient = useQueryClient()

  // Fetch user's templates and public templates
  const {
    data: templates = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['chart-templates', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_templates')
        .select('*')
        .or(`user_id.eq.${userId},is_public.eq.true`)
        .order('use_count', { ascending: false })

      if (error) throw error
      return data as ChartTemplate[]
    },
    enabled: !!userId
  })

  // Create template
  const createTemplate = useMutation({
    mutationFn: async (template: Omit<ChartTemplate, 'id' | 'user_id' | 'use_count' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('chart_templates')
        .insert([{ ...template, user_id: userId }])
        .select()
        .single()

      if (error) throw error
      return data as ChartTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-templates', userId] })
    }
  })

  // Use template (increment count)
  const useTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      const template = templates.find(t => t.id === templateId)
      if (!template) throw new Error('Template not found')

      await supabase
        .from('chart_templates')
        .update({ use_count: (template.use_count || 0) + 1 })
        .eq('id', templateId)

      return template
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-templates', userId] })
    }
  })

  // Delete template
  const deleteTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from('chart_templates')
        .delete()
        .eq('id', templateId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-templates', userId] })
    }
  })

  return {
    templates,
    userTemplates: templates.filter(t => t.user_id === userId),
    publicTemplates: templates.filter(t => t.is_public && t.user_id !== userId),
    isLoading,
    error,
    createTemplate,
    useTemplate,
    deleteTemplate
  }
}

/**
 * Hook for custom data series
 */
export function useCustomDataSeries(userId?: string, symbol?: string) {
  const queryClient = useQueryClient()

  // Fetch custom data series
  const {
    data: dataSeries = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['custom-data-series', userId, symbol],
    queryFn: async () => {
      if (!userId) return []

      let query = supabase
        .from('custom_data_series')
        .select('*')
        .eq('user_id', userId)

      if (symbol) {
        query = query.or(`symbol.eq.${symbol},symbol.is.null`)
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) throw error
      return data as CustomDataSeries[]
    },
    enabled: !!userId
  })

  // Create data series
  const createDataSeries = useMutation({
    mutationFn: async (series: Omit<CustomDataSeries, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('custom_data_series')
        .insert([{ ...series, user_id: userId }])
        .select()
        .single()

      if (error) throw error
      return data as CustomDataSeries
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-data-series', userId] })
    }
  })

  // Update data series
  const updateDataSeries = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CustomDataSeries> & { id: string }) => {
      const { data, error } = await supabase
        .from('custom_data_series')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as CustomDataSeries
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-data-series', userId] })
    }
  })

  // Delete data series
  const deleteDataSeries = useMutation({
    mutationFn: async (seriesId: string) => {
      const { error } = await supabase
        .from('custom_data_series')
        .delete()
        .eq('id', seriesId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-data-series', userId] })
    }
  })

  return {
    dataSeries,
    isLoading,
    error,
    createDataSeries,
    updateDataSeries,
    deleteDataSeries
  }
}
