/**
 * useSavedViews - Hook for managing saved table views
 *
 * Features:
 * - CRUD operations for saved views
 * - Default view management
 * - Quick switch between views
 * - Keyboard shortcuts (1-9 for quick access)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// View configuration interface
export interface ViewConfig {
  columns: Array<{
    id: string
    visible: boolean
    width: number
    pinned: boolean
  }>
  filters: Record<string, any>
  sorts: Array<{ field: string; order: 'asc' | 'desc' }>
  groupBy: string | null
  density: 'comfortable' | 'compact' | 'ultra-compact'
  viewMode?: 'table' | 'compact' | 'kanban' | 'tree'
}

export interface SavedView {
  id: string
  user_id: string
  name: string
  icon: string | null
  color: string | null
  config: ViewConfig
  is_default: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CreateViewInput {
  name: string
  icon?: string
  color?: string
  config: ViewConfig
  is_default?: boolean
}

export interface UpdateViewInput {
  id: string
  name?: string
  icon?: string
  color?: string
  config?: ViewConfig
  is_default?: boolean
  sort_order?: number
}

export function useSavedViews() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all saved views for the current user
  const {
    data: views = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['saved-views', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('user_saved_views')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true })

      if (error) throw error
      return data as SavedView[]
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000
  })

  // Get the default view
  const defaultView = views.find(v => v.is_default) || null

  // Create a new view
  const createViewMutation = useMutation({
    mutationFn: async (input: CreateViewInput) => {
      if (!user?.id) throw new Error('Not authenticated')

      // If setting as default, clear other defaults first
      if (input.is_default) {
        await supabase
          .from('user_saved_views')
          .update({ is_default: false })
          .eq('user_id', user.id)
      }

      const { data, error } = await supabase
        .from('user_saved_views')
        .insert({
          user_id: user.id,
          name: input.name,
          icon: input.icon || 'layout-list',
          color: input.color || '#3b82f6',
          config: input.config,
          is_default: input.is_default || false,
          sort_order: views.length
        })
        .select()
        .single()

      if (error) throw error
      return data as SavedView
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-views', user?.id] })
    }
  })

  // Update an existing view
  const updateViewMutation = useMutation({
    mutationFn: async (input: UpdateViewInput) => {
      if (!user?.id) throw new Error('Not authenticated')

      // If setting as default, clear other defaults first
      if (input.is_default) {
        await supabase
          .from('user_saved_views')
          .update({ is_default: false })
          .eq('user_id', user.id)
          .neq('id', input.id)
      }

      const updates: Partial<SavedView> = {
        updated_at: new Date().toISOString()
      }

      if (input.name !== undefined) updates.name = input.name
      if (input.icon !== undefined) updates.icon = input.icon
      if (input.color !== undefined) updates.color = input.color
      if (input.config !== undefined) updates.config = input.config
      if (input.is_default !== undefined) updates.is_default = input.is_default
      if (input.sort_order !== undefined) updates.sort_order = input.sort_order

      const { data, error } = await supabase
        .from('user_saved_views')
        .update(updates)
        .eq('id', input.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      return data as SavedView
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-views', user?.id] })
    }
  })

  // Delete a view
  const deleteViewMutation = useMutation({
    mutationFn: async (viewId: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('user_saved_views')
        .delete()
        .eq('id', viewId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-views', user?.id] })
    }
  })

  // Duplicate a view
  const duplicateView = useCallback(async (view: SavedView) => {
    await createViewMutation.mutateAsync({
      name: `${view.name} (Copy)`,
      icon: view.icon || undefined,
      color: view.color || undefined,
      config: view.config,
      is_default: false
    })
  }, [createViewMutation])

  // Set a view as default
  const setDefaultView = useCallback(async (viewId: string) => {
    await updateViewMutation.mutateAsync({
      id: viewId,
      is_default: true
    })
  }, [updateViewMutation])

  // Reorder views
  const reorderViews = useCallback(async (viewIds: string[]) => {
    if (!user?.id) return

    // Update sort_order for each view
    const updates = viewIds.map((id, index) => ({
      id,
      sort_order: index
    }))

    for (const update of updates) {
      await supabase
        .from('user_saved_views')
        .update({ sort_order: update.sort_order })
        .eq('id', update.id)
        .eq('user_id', user.id)
    }

    queryClient.invalidateQueries({ queryKey: ['saved-views', user?.id] })
  }, [user?.id, queryClient])

  // Get view by index (for keyboard shortcuts 1-9)
  const getViewByIndex = useCallback((index: number): SavedView | null => {
    if (index < 0 || index >= views.length) return null
    return views[index]
  }, [views])

  // Keyboard shortcuts for quick view switching
  const handleKeyboardSwitch = useCallback((
    onSwitchView: (view: SavedView) => void
  ) => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle 1-9 keys when not in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const key = parseInt(e.key, 10)
      if (key >= 1 && key <= 9) {
        const view = getViewByIndex(key - 1)
        if (view) {
          e.preventDefault()
          onSwitchView(view)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [getViewByIndex])

  return {
    // Data
    views,
    defaultView,
    isLoading,
    error,

    // Mutations
    createView: createViewMutation.mutateAsync,
    updateView: updateViewMutation.mutateAsync,
    deleteView: deleteViewMutation.mutateAsync,
    duplicateView,
    setDefaultView,
    reorderViews,

    // Helpers
    getViewByIndex,
    handleKeyboardSwitch,

    // Mutation states
    isCreating: createViewMutation.isPending,
    isUpdating: updateViewMutation.isPending,
    isDeleting: deleteViewMutation.isPending
  }
}

export default useSavedViews
