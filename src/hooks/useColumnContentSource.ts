/**
 * useColumnContentSource - Hook for managing dynamic content sources for table columns
 *
 * Allows users to choose content source for fields like thesis:
 * - Default: Asset's own field value
 * - Our View: AI-summarized team consensus from contributions
 * - Individual: Specific analyst's contribution
 * - Combined: AI-summarized selection of multiple analysts
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type ContentSourceType = 'default' | 'our_view' | 'individual' | 'combined'

export interface ContentSourceConfig {
  id: string
  user_id: string
  list_id: string | null
  column_id: string
  source_type: ContentSourceType
  source_user_ids: string[]
  created_at: string
  updated_at: string
}

export interface ContentSourceOptions {
  columnId: string
  listId?: string | null
}

export interface SetContentSourceParams {
  columnId: string
  listId?: string | null
  sourceType: ContentSourceType
  sourceUserIds?: string[]
}

export function useColumnContentSource(listId?: string | null) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all content source configs for current user
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['column-content-sources', user?.id, listId],
    queryFn: async () => {
      if (!user?.id) return []

      let query = supabase
        .from('table_column_content_sources')
        .select('*')
        .eq('user_id', user.id)

      // If listId provided, get configs for that list OR global configs
      if (listId) {
        query = query.or(`list_id.eq.${listId},list_id.is.null`)
      } else {
        query = query.is('list_id', null)
      }

      const { data, error } = await query
      if (error) throw error
      return data as ContentSourceConfig[]
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  })

  // Create a map for quick lookups
  const configsMap = useMemo(() => {
    const map = new Map<string, ContentSourceConfig>()
    configs.forEach(config => {
      // Key format: columnId or columnId:listId
      const key = config.list_id ? `${config.column_id}:${config.list_id}` : config.column_id
      map.set(key, config)
    })
    return map
  }, [configs])

  // Get config for a column
  const getConfig = useCallback((columnId: string, specificListId?: string | null): ContentSourceConfig | undefined => {
    // First check for list-specific config
    if (specificListId) {
      const listConfig = configsMap.get(`${columnId}:${specificListId}`)
      if (listConfig) return listConfig
    }
    // Fall back to global config
    return configsMap.get(columnId)
  }, [configsMap])

  // Get source type for a column
  const getSourceType = useCallback((columnId: string, specificListId?: string | null): ContentSourceType => {
    const config = getConfig(columnId, specificListId)
    return config?.source_type || 'default'
  }, [getConfig])

  // Get source user IDs for a column
  const getSourceUserIds = useCallback((columnId: string, specificListId?: string | null): string[] => {
    const config = getConfig(columnId, specificListId)
    return config?.source_user_ids || []
  }, [getConfig])

  // Set content source mutation
  const setSourceMutation = useMutation({
    mutationFn: async ({ columnId, listId: targetListId, sourceType, sourceUserIds = [] }: SetContentSourceParams) => {
      if (!user?.id) throw new Error('Not authenticated')

      if (sourceType === 'default') {
        // Remove the config (revert to default)
        let deleteQuery = supabase
          .from('table_column_content_sources')
          .delete()
          .eq('user_id', user.id)
          .eq('column_id', columnId)

        if (targetListId) {
          deleteQuery = deleteQuery.eq('list_id', targetListId)
        } else {
          deleteQuery = deleteQuery.is('list_id', null)
        }

        const { error } = await deleteQuery
        if (error) throw error
      } else {
        // Upsert the config
        const { error } = await supabase
          .from('table_column_content_sources')
          .upsert({
            user_id: user.id,
            list_id: targetListId || null,
            column_id: columnId,
            source_type: sourceType,
            source_user_ids: sourceUserIds,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,list_id,column_id',
            ignoreDuplicates: false
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['column-content-sources', user?.id] })
    }
  })

  // Set content source for a column
  const setContentSource = useCallback((params: SetContentSourceParams) => {
    setSourceMutation.mutate(params)
  }, [setSourceMutation])

  // Check if a column has a custom source
  const hasCustomSource = useCallback((columnId: string, specificListId?: string | null): boolean => {
    const sourceType = getSourceType(columnId, specificListId)
    return sourceType !== 'default'
  }, [getSourceType])

  return {
    configs,
    configsMap,
    isLoading,
    getConfig,
    getSourceType,
    getSourceUserIds,
    setContentSource,
    hasCustomSource,
    isMutating: setSourceMutation.isPending,
  }
}

/**
 * Hook to fetch content based on source type for a specific asset/column
 */
export function useColumnContent(
  assetId: string,
  columnId: string,
  sourceType: ContentSourceType,
  sourceUserIds: string[] = []
) {
  const { user } = useAuth()

  // Fetch the appropriate content based on source type
  const { data: content, isLoading } = useQuery({
    queryKey: ['column-content', assetId, columnId, sourceType, sourceUserIds],
    queryFn: async () => {
      if (!assetId || sourceType === 'default') return null

      if (sourceType === 'our_view') {
        // Fetch AI-summarized team consensus
        const { data: summary, error } = await supabase
          .from('contribution_summaries')
          .select('summary')
          .eq('asset_id', assetId)
          .eq('section', columnId)
          .single()

        if (error && error.code !== 'PGRST116') throw error
        return summary?.summary || null
      }

      if (sourceType === 'individual' && sourceUserIds.length > 0) {
        // Fetch specific analyst's contribution
        const { data: contribution, error } = await supabase
          .from('asset_contributions')
          .select('content')
          .eq('asset_id', assetId)
          .eq('section', columnId)
          .eq('created_by', sourceUserIds[0])
          .single()

        if (error && error.code !== 'PGRST116') throw error
        return contribution?.content || null
      }

      if (sourceType === 'combined' && sourceUserIds.length > 0) {
        // For combined, we need to generate AI summary - return contributions for now
        const { data: contributions, error } = await supabase
          .from('asset_contributions')
          .select('content, created_by')
          .eq('asset_id', assetId)
          .eq('section', columnId)
          .in('created_by', sourceUserIds)

        if (error) throw error

        // Return combined content (could be AI-summarized in the future)
        if (contributions && contributions.length > 0) {
          return contributions.map(c => c.content).join('\n\n---\n\n')
        }
        return null
      }

      return null
    },
    enabled: !!assetId && sourceType !== 'default',
    staleTime: 2 * 60 * 1000,
  })

  return {
    content,
    isLoading,
  }
}

/**
 * Hook to fetch analysts who have contributions for a specific column/section
 */
export function useContributingAnalysts(assetId: string, columnId: string) {
  const { data: analysts = [], isLoading } = useQuery({
    queryKey: ['contributing-analysts', assetId, columnId],
    queryFn: async () => {
      if (!assetId) return []

      const { data, error } = await supabase
        .from('asset_contributions')
        .select(`
          created_by,
          users:created_by (
            id,
            first_name,
            last_name
          )
        `)
        .eq('asset_id', assetId)
        .eq('section', columnId)

      if (error) throw error

      // Transform to unique analysts
      const uniqueAnalysts = new Map<string, { id: string; name: string }>()
      data?.forEach(d => {
        const userData = d.users as any
        if (userData && !uniqueAnalysts.has(userData.id)) {
          uniqueAnalysts.set(userData.id, {
            id: userData.id,
            name: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'Unknown'
          })
        }
      })

      return Array.from(uniqueAnalysts.values())
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000,
  })

  return {
    analysts,
    isLoading,
  }
}

export default useColumnContentSource
