import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Widget types that users can add
export type WidgetType = 'rich_text' | 'checklist' | 'numeric' | 'date' | 'metric' | 'timeline'

export interface UserAssetWidget {
  id: string
  user_id: string
  asset_id: string
  widget_type: WidgetType
  title: string
  description: string | null
  config: Record<string, unknown>
  display_order: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface WidgetValue {
  id: string
  widget_id: string
  user_id: string
  content: string | null
  value: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CreateWidgetInput {
  asset_id: string
  widget_type: WidgetType
  title: string
  description?: string
  config?: Record<string, unknown>
}

export interface UpdateWidgetInput {
  id: string
  title?: string
  description?: string
  config?: Record<string, unknown>
  display_order?: number
}

export interface SaveWidgetValueInput {
  widget_id: string
  content?: string
  value?: Record<string, unknown>
}

// Widget type options for the UI
export const WIDGET_TYPE_OPTIONS: { value: WidgetType; label: string; description: string; icon: string }[] = [
  { value: 'rich_text', label: 'Text Note', description: 'Free-form rich text for notes and analysis', icon: 'FileText' },
  { value: 'checklist', label: 'Checklist', description: 'Track items with checkboxes', icon: 'CheckSquare' },
  { value: 'numeric', label: 'Numeric Value', description: 'Track a specific number or metric', icon: 'Hash' },
  { value: 'date', label: 'Date', description: 'Track an important date', icon: 'Calendar' },
  { value: 'metric', label: 'Metric Card', description: 'Display a key metric with label', icon: 'Gauge' },
  { value: 'timeline', label: 'Timeline', description: 'Track events over time', icon: 'Clock' }
]

/**
 * Hook to manage user-added widgets on asset pages
 */
export function useUserAssetWidgets(assetId: string, viewUserId?: string) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const effectiveUserId = viewUserId || user?.id

  // Fetch widgets for an asset (optionally filtered by user)
  const { data: widgets = [], isLoading, error } = useQuery({
    queryKey: ['user-asset-widgets', assetId, effectiveUserId],
    queryFn: async () => {
      let query = supabase
        .from('user_asset_widgets')
        .select('*')
        .eq('asset_id', assetId)
        .eq('is_archived', false)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (effectiveUserId) {
        query = query.eq('user_id', effectiveUserId)
      }

      const { data, error } = await query

      if (error) throw error
      return data as UserAssetWidget[]
    },
    enabled: !!assetId
  })

  // Fetch current user's widgets (for editing)
  const { data: myWidgets = [] } = useQuery({
    queryKey: ['user-asset-widgets', assetId, user?.id, 'mine'],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('user_asset_widgets')
        .select('*')
        .eq('asset_id', assetId)
        .eq('user_id', user.id)
        .eq('is_archived', false)
        .order('display_order', { ascending: true })

      if (error) throw error
      return data as UserAssetWidget[]
    },
    enabled: !!assetId && !!user?.id
  })

  // Fetch widget values
  const { data: widgetValues = [] } = useQuery({
    queryKey: ['user-asset-widget-values', assetId, effectiveUserId],
    queryFn: async () => {
      if (!widgets.length) return []

      const widgetIds = widgets.map(w => w.id)

      let query = supabase
        .from('user_asset_widget_values')
        .select('*')
        .in('widget_id', widgetIds)

      if (effectiveUserId) {
        query = query.eq('user_id', effectiveUserId)
      }

      const { data, error } = await query

      if (error) throw error
      return data as WidgetValue[]
    },
    enabled: widgets.length > 0
  })

  // Create widget mutation
  const createWidgetMutation = useMutation({
    mutationFn: async (input: CreateWidgetInput) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('user_asset_widgets')
        .insert({
          user_id: user.id,
          asset_id: input.asset_id,
          widget_type: input.widget_type,
          title: input.title,
          description: input.description || null,
          config: input.config || {},
          display_order: myWidgets.length // Add at the end
        })
        .select()
        .single()

      if (error) throw error
      return data as UserAssetWidget
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-widgets', assetId] })
    }
  })

  // Update widget mutation
  const updateWidgetMutation = useMutation({
    mutationFn: async (input: UpdateWidgetInput) => {
      const { id, ...updates } = input

      const { data, error } = await supabase
        .from('user_asset_widgets')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as UserAssetWidget
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-widgets', assetId] })
    }
  })

  // Delete (archive) widget mutation
  const deleteWidgetMutation = useMutation({
    mutationFn: async (widgetId: string) => {
      const { error } = await supabase
        .from('user_asset_widgets')
        .update({ is_archived: true })
        .eq('id', widgetId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-widgets', assetId] })
    }
  })

  // Save widget value mutation
  const saveWidgetValueMutation = useMutation({
    mutationFn: async (input: SaveWidgetValueInput) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('user_asset_widget_values')
        .upsert({
          widget_id: input.widget_id,
          user_id: user.id,
          content: input.content || null,
          value: input.value || {}
        }, {
          onConflict: 'widget_id,user_id'
        })
        .select()
        .single()

      if (error) throw error
      return data as WidgetValue
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-widget-values', assetId] })
    }
  })

  // Get value for a specific widget
  const getWidgetValue = (widgetId: string): WidgetValue | undefined => {
    return widgetValues.find(v => v.widget_id === widgetId)
  }

  return {
    // Data
    widgets,
    myWidgets,
    widgetValues,
    isLoading,
    error,

    // Helpers
    getWidgetValue,
    isMyWidget: (widgetId: string) => myWidgets.some(w => w.id === widgetId),

    // Mutations
    createWidget: createWidgetMutation.mutateAsync,
    updateWidget: updateWidgetMutation.mutateAsync,
    deleteWidget: deleteWidgetMutation.mutateAsync,
    saveWidgetValue: saveWidgetValueMutation.mutateAsync,

    // Mutation states
    isCreating: createWidgetMutation.isPending,
    isUpdating: updateWidgetMutation.isPending,
    isDeleting: deleteWidgetMutation.isPending,
    isSaving: saveWidgetValueMutation.isPending
  }
}
