/**
 * useAssetFlags - Hook for managing user-specific asset flags/highlighting
 *
 * Allows users to color-code rows for attention (urgent, research, watch, etc.)
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type FlagColor = 'yellow' | 'red' | 'green' | 'blue' | 'purple' | null

export const FLAG_COLORS: { value: FlagColor; label: string; bg: string; border: string; text: string }[] = [
  { value: 'yellow', label: 'Attention', bg: 'bg-yellow-50', border: 'border-l-yellow-400', text: 'text-yellow-700' },
  { value: 'red', label: 'Urgent', bg: 'bg-red-50', border: 'border-l-red-400', text: 'text-red-700' },
  { value: 'green', label: 'Good', bg: 'bg-green-50', border: 'border-l-green-400', text: 'text-green-700' },
  { value: 'blue', label: 'Research', bg: 'bg-blue-50', border: 'border-l-blue-400', text: 'text-blue-700' },
  { value: 'purple', label: 'Watch', bg: 'bg-purple-50', border: 'border-l-purple-400', text: 'text-purple-700' },
]

export const FLAG_COLOR_ORDER: FlagColor[] = [null, 'yellow', 'red', 'green', 'blue', 'purple']

interface AssetFlag {
  id: string
  user_id: string
  asset_id: string
  color: FlagColor
  label: string | null
  created_at: string
}

export function useAssetFlags() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all flags for current user
  const { data: flags = [], isLoading } = useQuery({
    queryKey: ['asset-flags', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('user_asset_flags')
        .select('*')
        .eq('user_id', user.id)
      if (error) throw error
      return data as AssetFlag[]
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  })

  // Create a map for quick lookups
  const flagsMap = new Map<string, AssetFlag>()
  flags.forEach(flag => flagsMap.set(flag.asset_id, flag))

  // Get flag for an asset
  const getFlag = useCallback((assetId: string): AssetFlag | undefined => {
    return flagsMap.get(assetId)
  }, [flagsMap])

  // Get flag color for an asset
  const getFlagColor = useCallback((assetId: string): FlagColor => {
    const flag = flagsMap.get(assetId)
    return flag?.color || null
  }, [flagsMap])

  // Set flag mutation
  const setFlagMutation = useMutation({
    mutationFn: async ({ assetId, color, label }: { assetId: string; color: FlagColor; label?: string }) => {
      if (!user?.id) throw new Error('Not authenticated')

      if (color === null) {
        // Remove flag
        const { error } = await supabase
          .from('user_asset_flags')
          .delete()
          .eq('user_id', user.id)
          .eq('asset_id', assetId)
        if (error) throw error
      } else {
        // Upsert flag
        const { error } = await supabase
          .from('user_asset_flags')
          .upsert({
            user_id: user.id,
            asset_id: assetId,
            color,
            label: label || null,
          }, {
            onConflict: 'user_id,asset_id'
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-flags', user?.id] })
    }
  })

  // Set flag for an asset
  const setFlag = useCallback((assetId: string, color: FlagColor, label?: string) => {
    setFlagMutation.mutate({ assetId, color, label })
  }, [setFlagMutation])

  // Cycle through flag colors
  const cycleFlag = useCallback((assetId: string) => {
    const currentColor = getFlagColor(assetId)
    const currentIndex = FLAG_COLOR_ORDER.indexOf(currentColor)
    const nextIndex = (currentIndex + 1) % FLAG_COLOR_ORDER.length
    const nextColor = FLAG_COLOR_ORDER[nextIndex]
    setFlag(assetId, nextColor)
  }, [getFlagColor, setFlag])

  // Get styles for a flag color
  const getFlagStyles = useCallback((color: FlagColor) => {
    if (!color) return null
    return FLAG_COLORS.find(c => c.value === color) || null
  }, [])

  return {
    flags,
    flagsMap,
    isLoading,
    getFlag,
    getFlagColor,
    setFlag,
    cycleFlag,
    getFlagStyles,
    isMutating: setFlagMutation.isPending,
  }
}

export default useAssetFlags
