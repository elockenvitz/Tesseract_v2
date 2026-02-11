/**
 * useIntentVariants Hook
 *
 * React hook for managing Intent Variants in Trade Lab v3.
 * Handles creation, updates, revalidation, and trade sheet creation.
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'
import * as variantService from '../lib/services/intent-variant-service'
import type {
  ActionContext,
  UISource,
  TradeAction,
  RoundingConfig,
  ActiveWeightConfig,
  AssetPrice,
  IntentVariant,
} from '../types/trading'

// =============================================================================
// HELPER
// =============================================================================

function buildActionContext(user: any, uiSource?: UISource): ActionContext {
  return {
    actorId: user?.id || '',
    actorName:
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      user?.email ||
      '',
    actorEmail: user?.email,
    actorRole: (user?.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
    requestId: crypto.randomUUID(),
    uiSource,
  }
}

// =============================================================================
// MAIN HOOK
// =============================================================================

interface UseIntentVariantsOptions {
  labId?: string
  viewId?: string | null
  portfolioId?: string
}

export function useIntentVariants(options: UseIntentVariantsOptions = {}) {
  const { labId, viewId, portfolioId } = options
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  // ==========================================================================
  // QUERIES
  // ==========================================================================

  // Fetch variants
  const variantsQuery = useQuery({
    queryKey: ['intent-variants', labId, viewId],
    queryFn: () =>
      labId
        ? variantService.getVariantsForLab({ labId, viewId })
        : Promise.resolve([]),
    enabled: !!labId,
    // Prevent automatic background refetches from overwriting optimistic cache
    // updates (temp variants, surgical setQueryData in mutation handlers).
    // Data is kept fresh via setQueryData in create/update/delete onSuccess,
    // and explicit invalidateQueries will still force refetches when needed.
    staleTime: 30_000,
  })

  // Fetch conflict summary
  const conflictQuery = useQuery({
    queryKey: ['intent-variants-conflicts', labId, viewId],
    queryFn: () =>
      labId
        ? variantService.getConflictSummary(labId, viewId ?? undefined)
        : Promise.resolve({ total: 0, conflicts: 0, warnings: 0, canCreateTradeSheet: false }),
    enabled: !!labId,
  })

  // Fetch trade sheets
  const tradeSheetsQuery = useQuery({
    queryKey: ['trade-sheets', labId],
    queryFn: () =>
      labId
        ? variantService.getTradeSheetsForLab(labId)
        : Promise.resolve([]),
    enabled: !!labId,
  })

  // ==========================================================================
  // COMPUTED
  // ==========================================================================

  const variants = variantsQuery.data ?? []
  const conflictSummary = conflictQuery.data ?? {
    total: 0,
    conflicts: 0,
    warnings: 0,
    canCreateTradeSheet: false,
  }
  const tradeSheets = tradeSheetsQuery.data ?? []

  // Computed helpers
  const hasConflicts = conflictSummary.conflicts > 0
  const hasWarnings = conflictSummary.warnings > 0
  const canCreateTradeSheet = conflictSummary.canCreateTradeSheet

  // ==========================================================================
  // MUTATIONS
  // ==========================================================================

  // Create variant
  const createVariantM = useMutation({
    mutationFn: (params: {
      assetId: string
      action: TradeAction
      sizingInput: string
      tradeQueueItemId?: string | null
      notes?: string | null
      sortOrder?: number
      currentPosition?: {
        shares: number
        weight: number
        cost_basis: number | null
        active_weight: number | null
      } | null
      price: AssetPrice
      portfolioTotalValue: number
      roundingConfig: RoundingConfig
      activeWeightConfig?: ActiveWeightConfig | null
      hasBenchmark: boolean
      uiSource?: UISource
    }) => {
      if (!labId || !user) throw new Error('Not ready')
      return variantService.createVariant({
        input: {
          lab_id: labId,
          view_id: viewId,
          trade_queue_item_id: params.tradeQueueItemId,
          asset_id: params.assetId,
          action: params.action,
          sizing_input: params.sizingInput,
          notes: params.notes,
          sort_order: params.sortOrder,
        },
        portfolioId,
        currentPosition: params.currentPosition,
        price: params.price,
        portfolioTotalValue: params.portfolioTotalValue,
        roundingConfig: params.roundingConfig,
        activeWeightConfig: params.activeWeightConfig,
        hasBenchmark: params.hasBenchmark,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (newVariant) => {
      // Surgically replace the temp variant with the real one.
      // A full invalidateQueries would trigger a refetch that wipes temp variants
      // for OTHER assets whose imports are still in-flight, causing row flicker.
      queryClient.setQueryData<IntentVariant[]>(
        ['intent-variants', labId, viewId],
        (old) => {
          if (!old) return [newVariant]
          // Carry over the asset join data and any sizing_input the user typed
          // on the temp variant while the server call was in-flight.
          const temp = old.find(v => v.asset_id === newVariant.asset_id && v.id.startsWith('temp-'))
          const merged = temp
            ? {
                ...newVariant,
                asset: (temp as any).asset,
                // Preserve sizing_input if the user typed into the temp variant
                ...(temp.sizing_input ? { sizing_input: temp.sizing_input } : {}),
              }
            : newVariant
          const withoutTemp = old.filter(v =>
            !(v.asset_id === newVariant.asset_id && v.id.startsWith('temp-'))
            && v.id !== newVariant.id
          )
          return [...withoutTemp, merged]
        }
      )
      queryClient.invalidateQueries({ queryKey: ['intent-variants-conflicts', labId] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create variant')
    },
  })

  // Update variant
  const updateVariantM = useMutation({
    mutationFn: (params: {
      variantId: string
      updates: {
        action?: TradeAction
        sizingInput?: string
        notes?: string | null
        sortOrder?: number
      }
      currentPosition?: {
        shares: number
        weight: number
        cost_basis: number | null
        active_weight: number | null
      } | null
      price: AssetPrice
      portfolioTotalValue: number
      roundingConfig: RoundingConfig
      activeWeightConfig?: ActiveWeightConfig | null
      hasBenchmark: boolean
      uiSource?: UISource
    }) => {
      if (!user) throw new Error('Not authenticated')
      // Skip DB call for temp variants (optimistic placeholders)
      if (params.variantId.startsWith('temp-')) return Promise.resolve({} as any)
      return variantService.updateVariant({
        variantId: params.variantId,
        updates: {
          action: params.updates.action,
          sizing_input: params.updates.sizingInput,
          notes: params.updates.notes,
          sort_order: params.updates.sortOrder,
        },
        currentPosition: params.currentPosition,
        price: params.price,
        portfolioTotalValue: params.portfolioTotalValue,
        roundingConfig: params.roundingConfig,
        activeWeightConfig: params.activeWeightConfig,
        hasBenchmark: params.hasBenchmark,
        context: buildActionContext(user, params.uiSource),
      })
    },
    // No onMutate — callers (SimulationPage inline handler) apply the optimistic
    // cache update synchronously before calling mutate(). A redundant async
    // onMutate would create a second setQueryData with a new array reference,
    // triggering an extra render that causes a visible flash.
    onSuccess: (updatedVariant) => {
      // Merge server response (computed values, sizing_spec) into cache.
      if (updatedVariant?.id) {
        queryClient.setQueryData<IntentVariant[]>(
          ['intent-variants', labId, viewId],
          (old) => old?.map(v => v.id === updatedVariant.id ? { ...v, ...updatedVariant } : v) ?? []
        )
      }
      queryClient.invalidateQueries({ queryKey: ['intent-variants-conflicts', labId] })
    },
    onError: (error) => {
      // Refetch to get correct state instead of restoring stale previous data
      queryClient.invalidateQueries({ queryKey: ['intent-variants', labId] })
      toast.error(error instanceof Error ? error.message : 'Failed to update variant')
    },
  })

  // Delete variant (with optimistic cache removal for instant UI)
  const deleteVariantM = useMutation({
    mutationFn: (params: { variantId: string; uiSource?: UISource }) => {
      if (!user) throw new Error('Not authenticated')
      // Skip DB call for temp variants (optimistic placeholders)
      if (params.variantId.startsWith('temp-')) return Promise.resolve()
      return variantService.deleteVariant(
        params.variantId,
        buildActionContext(user, params.uiSource)
      )
    },
    onMutate: async (params) => {
      // Cancel in-flight fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['intent-variants', labId, viewId] })
      const previous = queryClient.getQueryData<IntentVariant[]>(['intent-variants', labId, viewId])
      // Optimistically remove the variant from cache
      queryClient.setQueryData<IntentVariant[]>(
        ['intent-variants', labId, viewId],
        (old) => old?.filter(v => v.id !== params.variantId) ?? []
      )
      return { previous }
    },
    onSuccess: () => {
      // onMutate already removed the variant from cache. Don't invalidate the
      // full variants query — a refetch would wipe temp variants for other assets.
      queryClient.invalidateQueries({ queryKey: ['intent-variants-conflicts', labId] })
    },
    onError: (error, _params, context) => {
      // Rollback optimistic update on failure
      if (context?.previous) {
        queryClient.setQueryData(['intent-variants', labId, viewId], context.previous)
      }
      toast.error(error instanceof Error ? error.message : 'Failed to delete variant')
    },
  })

  // Delete ALL variants for an asset (handles duplicates from rapid toggling)
  const deleteVariantsByAssetM = useMutation({
    mutationFn: (params: { assetId: string; uiSource?: UISource }) => {
      if (!labId || !user) throw new Error('Not ready')
      return variantService.deleteVariantsByAsset(
        labId,
        params.assetId,
        buildActionContext(user, params.uiSource)
      )
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ['intent-variants', labId, viewId] })
      const previous = queryClient.getQueryData<IntentVariant[]>(['intent-variants', labId, viewId])
      // Optimistically remove ALL variants for this asset from cache
      queryClient.setQueryData<IntentVariant[]>(
        ['intent-variants', labId, viewId],
        (old) => old?.filter(v => v.asset_id !== params.assetId) ?? []
      )
      return { previous }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intent-variants-conflicts', labId] })
    },
    onError: (error, _params, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['intent-variants', labId, viewId], context.previous)
      }
      toast.error(error instanceof Error ? error.message : 'Failed to delete variants')
    },
  })

  // Revalidate variants (batch price update)
  const revalidateM = useMutation({
    mutationFn: (params: {
      prices: Map<string, AssetPrice>
      positions: Map<string, {
        shares: number
        weight: number
        cost_basis: number | null
        active_weight: number | null
      }>
      portfolioTotalValue: number
      roundingConfig: RoundingConfig
      hasBenchmark: boolean
      uiSource?: UISource
    }) => {
      if (!labId || !user) throw new Error('Not ready')
      return variantService.revalidateVariants({
        labId,
        viewId: viewId ?? undefined,
        prices: params.prices,
        positions: params.positions,
        portfolioTotalValue: params.portfolioTotalValue,
        roundingConfig: params.roundingConfig,
        hasBenchmark: params.hasBenchmark,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['intent-variants', labId] })
      queryClient.invalidateQueries({ queryKey: ['intent-variants-conflicts', labId] })
      if (result.conflicts > 0) {
        toast.warning(`${result.conflicts} direction conflict(s) detected`)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to revalidate')
    },
  })

  // Create trade sheet
  const createTradeSheetM = useMutation({
    mutationFn: (params: {
      name: string
      description?: string | null
      uiSource?: UISource
    }) => {
      if (!labId || !user) throw new Error('Not ready')
      if (hasConflicts) {
        throw new Error('Cannot create Trade Sheet with unresolved conflicts')
      }
      return variantService.createTradeSheet({
        labId,
        viewId: viewId ?? undefined,
        name: params.name,
        description: params.description,
        context: buildActionContext(user, params.uiSource),
      })
    },
    onSuccess: (sheet) => {
      queryClient.invalidateQueries({ queryKey: ['trade-sheets', labId] })
      toast.success(`Trade Sheet "${sheet.name}" created`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create Trade Sheet')
    },
  })

  // ==========================================================================
  // RETURN
  // ==========================================================================

  return {
    // Data
    variants,
    conflictSummary,
    tradeSheets,

    // Computed
    hasConflicts,
    hasWarnings,
    canCreateTradeSheet,

    // Loading states
    isLoading: variantsQuery.isLoading,
    isLoadingConflicts: conflictQuery.isLoading,
    isLoadingTradeSheets: tradeSheetsQuery.isLoading,

    // Mutations
    createVariant: createVariantM.mutate,
    createVariantAsync: createVariantM.mutateAsync,
    isCreating: createVariantM.isPending,

    updateVariant: updateVariantM.mutate,
    updateVariantAsync: updateVariantM.mutateAsync,
    isUpdating: updateVariantM.isPending,

    deleteVariant: deleteVariantM.mutate,
    deleteVariantAsync: deleteVariantM.mutateAsync,
    isDeleting: deleteVariantM.isPending,

    deleteVariantsByAsset: deleteVariantsByAssetM.mutate,

    revalidate: revalidateM.mutate,
    revalidateAsync: revalidateM.mutateAsync,
    isRevalidating: revalidateM.isPending,

    createTradeSheet: createTradeSheetM.mutate,
    createTradeSheetAsync: createTradeSheetM.mutateAsync,
    isCreatingTradeSheet: createTradeSheetM.isPending,

    // Refetch
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['intent-variants', labId] })
      queryClient.invalidateQueries({ queryKey: ['intent-variants-conflicts', labId] })
      queryClient.invalidateQueries({ queryKey: ['trade-sheets', labId] })
    },
  }
}

// =============================================================================
// ROUNDING CONFIG HOOK
// =============================================================================

interface UseRoundingConfigOptions {
  portfolioId?: string
  assetId?: string
}

export function useRoundingConfig(options: UseRoundingConfigOptions = {}) {
  const { portfolioId, assetId } = options
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  const configQuery = useQuery({
    queryKey: ['rounding-config', portfolioId, assetId],
    queryFn: () =>
      portfolioId
        ? variantService.getRoundingConfig(portfolioId, assetId)
        : Promise.resolve({
            lot_size: 1,
            min_lot_behavior: 'round' as const,
            round_direction: 'nearest' as const,
          }),
    enabled: !!portfolioId,
  })

  const setConfigM = useMutation({
    mutationFn: (params: {
      config: RoundingConfig
      uiSource?: UISource
    }) => {
      if (!portfolioId || !assetId || !user) {
        throw new Error('Portfolio and asset required')
      }
      return variantService.setAssetRoundingConfig(
        portfolioId,
        assetId,
        params.config,
        buildActionContext(user, params.uiSource)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rounding-config', portfolioId] })
      toast.success('Rounding config updated')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update config')
    },
  })

  return {
    config: configQuery.data ?? {
      lot_size: 1,
      min_lot_behavior: 'round' as const,
      round_direction: 'nearest' as const,
    },
    isLoading: configQuery.isLoading,
    setConfig: setConfigM.mutate,
    setConfigAsync: setConfigM.mutateAsync,
    isSetting: setConfigM.isPending,
  }
}
