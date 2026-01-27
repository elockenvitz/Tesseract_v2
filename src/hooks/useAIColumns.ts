/**
 * useAIColumns - Hook for managing AI-powered custom columns
 *
 * Features:
 * - AI Column Library (system + user-defined)
 * - User column selections per list
 * - Content caching
 * - Quick prompt history
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface AIColumnContextConfig {
  includeThesis?: boolean
  includeContributions?: boolean
  includeNotes?: boolean
  includePriceTargets?: boolean
}

export interface AIColumnDefinition {
  id: string
  user_id: string | null
  organization_id: string | null
  name: string
  description: string | null
  prompt: string
  icon: string
  is_system: boolean
  context_config: AIColumnContextConfig
  created_at: string
  updated_at: string
}

export interface AIColumnSelection {
  id: string
  user_id: string
  column_id: string
  list_id: string | null
  width: number
  display_order: number
  is_visible: boolean
  created_at: string
}

export interface AIColumnCache {
  id: string
  column_id: string
  asset_id: string
  content: string
  generated_at: string
  input_hash: string | null
}

export interface QuickPromptHistory {
  id: string
  user_id: string
  prompt: string
  used_count: number
  last_used_at: string
  created_at: string
}

export interface CreateAIColumnParams {
  name: string
  description?: string
  prompt: string
  icon?: string
  contextConfig?: AIColumnContextConfig
}

export interface UpdateAIColumnParams {
  id: string
  name?: string
  description?: string
  prompt?: string
  icon?: string
  contextConfig?: AIColumnContextConfig
}

/**
 * Main hook for AI columns
 */
export function useAIColumns(listId?: string | null) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all available AI columns (system + user's own)
  const { data: libraryColumns = [], isLoading: loadingLibrary } = useQuery({
    queryKey: ['ai-column-library', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('ai_column_library')
        .select('*')
        .or(`is_system.eq.true,user_id.eq.${user.id}`)
        .order('is_system', { ascending: false })
        .order('name')

      if (error) throw error
      return data as AIColumnDefinition[]
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  })

  // Fetch user's column selections
  const { data: selections = [], isLoading: loadingSelections } = useQuery({
    queryKey: ['ai-column-selections', user?.id, listId],
    queryFn: async () => {
      if (!user?.id) return []

      let query = supabase
        .from('user_ai_column_selections')
        .select('*')
        .eq('user_id', user.id)
        .order('display_order')

      if (listId) {
        query = query.or(`list_id.eq.${listId},list_id.is.null`)
      } else {
        query = query.is('list_id', null)
      }

      const { data, error } = await query
      if (error) throw error
      return data as AIColumnSelection[]
    },
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000,
  })

  // Get active columns (library columns that user has selected)
  const activeColumns = useMemo(() => {
    const selectionMap = new Map(selections.map(s => [s.column_id, s]))
    return libraryColumns
      .filter(col => selectionMap.has(col.id))
      .map(col => {
        const selection = selectionMap.get(col.id)!
        return {
          ...col,
          width: selection.width,
          displayOrder: selection.display_order,
          isVisible: selection.is_visible,
          selectionId: selection.id,
        }
      })
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [libraryColumns, selections])

  // Get system columns
  const systemColumns = useMemo(() =>
    libraryColumns.filter(col => col.is_system),
    [libraryColumns]
  )

  // Get user's custom columns
  const customColumns = useMemo(() =>
    libraryColumns.filter(col => !col.is_system && col.user_id === user?.id),
    [libraryColumns, user?.id]
  )

  // Create a new AI column
  const createColumnMutation = useMutation({
    mutationFn: async (params: CreateAIColumnParams) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('ai_column_library')
        .insert({
          user_id: user.id,
          name: params.name,
          description: params.description || null,
          prompt: params.prompt,
          icon: params.icon || 'sparkles',
          context_config: params.contextConfig || { includeThesis: true, includeContributions: true },
        })
        .select()
        .single()

      if (error) throw error
      return data as AIColumnDefinition
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-library', user?.id] })
    }
  })

  // Update an AI column
  const updateColumnMutation = useMutation({
    mutationFn: async (params: UpdateAIColumnParams) => {
      if (!user?.id) throw new Error('Not authenticated')

      const updateData: any = { updated_at: new Date().toISOString() }
      if (params.name !== undefined) updateData.name = params.name
      if (params.description !== undefined) updateData.description = params.description
      if (params.prompt !== undefined) updateData.prompt = params.prompt
      if (params.icon !== undefined) updateData.icon = params.icon
      if (params.contextConfig !== undefined) updateData.context_config = params.contextConfig

      const { error } = await supabase
        .from('ai_column_library')
        .update(updateData)
        .eq('id', params.id)
        .eq('user_id', user.id) // Ensure user owns the column

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-library', user?.id] })
    }
  })

  // Delete an AI column
  const deleteColumnMutation = useMutation({
    mutationFn: async (columnId: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('ai_column_library')
        .delete()
        .eq('id', columnId)
        .eq('user_id', user.id) // Ensure user owns the column

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-library', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['ai-column-selections', user?.id] })
    }
  })

  // Add column to view (create selection)
  const addColumnToViewMutation = useMutation({
    mutationFn: async ({ columnId, targetListId }: { columnId: string; targetListId?: string | null }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get max display order
      const maxOrder = selections.reduce((max, s) => Math.max(max, s.display_order), 0)

      const { error } = await supabase
        .from('user_ai_column_selections')
        .insert({
          user_id: user.id,
          column_id: columnId,
          list_id: targetListId || null,
          display_order: maxOrder + 1,
          is_visible: true,
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-selections', user?.id] })
    }
  })

  // Remove column from view (delete selection)
  const removeColumnFromViewMutation = useMutation({
    mutationFn: async (selectionId: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('user_ai_column_selections')
        .delete()
        .eq('id', selectionId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-selections', user?.id] })
    }
  })

  // Update column selection (width, visibility, order)
  const updateSelectionMutation = useMutation({
    mutationFn: async ({ selectionId, updates }: { selectionId: string; updates: Partial<{ width: number; is_visible: boolean; display_order: number }> }) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('user_ai_column_selections')
        .update(updates)
        .eq('id', selectionId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-selections', user?.id] })
    }
  })

  // Helper functions
  const createColumn = useCallback((params: CreateAIColumnParams) =>
    createColumnMutation.mutateAsync(params),
    [createColumnMutation]
  )

  const updateColumn = useCallback((params: UpdateAIColumnParams) =>
    updateColumnMutation.mutate(params),
    [updateColumnMutation]
  )

  const deleteColumn = useCallback((columnId: string) =>
    deleteColumnMutation.mutate(columnId),
    [deleteColumnMutation]
  )

  const addColumnToView = useCallback((columnId: string, targetListId?: string | null) =>
    addColumnToViewMutation.mutate({ columnId, targetListId }),
    [addColumnToViewMutation]
  )

  const removeColumnFromView = useCallback((selectionId: string) =>
    removeColumnFromViewMutation.mutate(selectionId),
    [removeColumnFromViewMutation]
  )

  const updateSelection = useCallback((selectionId: string, updates: Partial<{ width: number; is_visible: boolean; display_order: number }>) =>
    updateSelectionMutation.mutate({ selectionId, updates }),
    [updateSelectionMutation]
  )

  const isColumnInView = useCallback((columnId: string) =>
    selections.some(s => s.column_id === columnId),
    [selections]
  )

  return {
    // Data
    libraryColumns,
    systemColumns,
    customColumns,
    activeColumns,
    selections,

    // Loading states
    isLoading: loadingLibrary || loadingSelections,
    loadingLibrary,
    loadingSelections,

    // Mutations
    createColumn,
    updateColumn,
    deleteColumn,
    addColumnToView,
    removeColumnFromView,
    updateSelection,

    // Helpers
    isColumnInView,

    // Mutation states
    isCreating: createColumnMutation.isPending,
    isUpdating: updateColumnMutation.isPending,
    isDeleting: deleteColumnMutation.isPending,
  }
}

/**
 * Hook for AI column cache (generated content per asset)
 */
export function useAIColumnCache(columnId: string, assetIds: string[]) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch cached content for assets
  const { data: cache = [], isLoading } = useQuery({
    queryKey: ['ai-column-cache', columnId, assetIds],
    queryFn: async () => {
      if (!columnId || assetIds.length === 0) return []

      const { data, error } = await supabase
        .from('ai_column_cache')
        .select('*')
        .eq('column_id', columnId)
        .in('asset_id', assetIds)

      if (error) throw error
      return data as AIColumnCache[]
    },
    enabled: !!columnId && assetIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  // Create a map for quick lookups
  const cacheMap = useMemo(() => {
    const map = new Map<string, AIColumnCache>()
    cache.forEach(c => map.set(c.asset_id, c))
    return map
  }, [cache])

  // Get cached content for an asset
  const getCachedContent = useCallback((assetId: string): string | null => {
    return cacheMap.get(assetId)?.content || null
  }, [cacheMap])

  // Check if content exists for an asset
  const hasCache = useCallback((assetId: string): boolean => {
    return cacheMap.has(assetId)
  }, [cacheMap])

  // Save generated content
  const saveCacheMutation = useMutation({
    mutationFn: async ({ assetId, content, inputHash }: { assetId: string; content: string; inputHash?: string }) => {
      const { error } = await supabase
        .from('ai_column_cache')
        .upsert({
          column_id: columnId,
          asset_id: assetId,
          content,
          generated_at: new Date().toISOString(),
          input_hash: inputHash || null,
        }, {
          onConflict: 'column_id,asset_id'
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-cache', columnId] })
    }
  })

  const saveCache = useCallback((assetId: string, content: string, inputHash?: string) =>
    saveCacheMutation.mutate({ assetId, content, inputHash }),
    [saveCacheMutation]
  )

  // Clear cache for an asset
  const clearCacheMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase
        .from('ai_column_cache')
        .delete()
        .eq('column_id', columnId)
        .eq('asset_id', assetId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-column-cache', columnId] })
    }
  })

  const clearCache = useCallback((assetId: string) =>
    clearCacheMutation.mutate(assetId),
    [clearCacheMutation]
  )

  return {
    cache,
    cacheMap,
    isLoading,
    getCachedContent,
    hasCache,
    saveCache,
    clearCache,
    isSaving: saveCacheMutation.isPending,
  }
}

/**
 * Hook for quick prompt history
 */
export function useQuickPromptHistory() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch prompt history
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['quick-prompt-history', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('user_quick_prompt_history')
        .select('*')
        .eq('user_id', user.id)
        .order('last_used_at', { ascending: false })
        .limit(20)

      if (error) throw error
      return data as QuickPromptHistory[]
    },
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000,
  })

  // Add or update prompt in history
  const addPromptMutation = useMutation({
    mutationFn: async (prompt: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Check if prompt already exists
      const existing = history.find(h => h.prompt.toLowerCase() === prompt.toLowerCase())

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('user_quick_prompt_history')
          .update({
            used_count: existing.used_count + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Create new
        const { error } = await supabase
          .from('user_quick_prompt_history')
          .insert({
            user_id: user.id,
            prompt,
            used_count: 1,
            last_used_at: new Date().toISOString(),
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-prompt-history', user?.id] })
    }
  })

  // Delete a prompt from history
  const deletePromptMutation = useMutation({
    mutationFn: async (promptId: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('user_quick_prompt_history')
        .delete()
        .eq('id', promptId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-prompt-history', user?.id] })
    }
  })

  const addPrompt = useCallback((prompt: string) =>
    addPromptMutation.mutate(prompt),
    [addPromptMutation]
  )

  const deletePrompt = useCallback((promptId: string) =>
    deletePromptMutation.mutate(promptId),
    [deletePromptMutation]
  )

  return {
    history,
    isLoading,
    addPrompt,
    deletePrompt,
    isAdding: addPromptMutation.isPending,
  }
}

export default useAIColumns
