import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface ListItem {
  id: string
  sort_order: number | null
  added_at: string
  [key: string]: any
}

interface UseListReorderOptions {
  listId: string
  items: ListItem[]
}

/**
 * Calculate new sort_order value using gap strategy
 * Inserts between two items, or at beginning/end with appropriate spacing
 */
const calculateNewSortOrder = (
  sortedItems: ListItem[],
  fromIndex: number,
  toIndex: number
): number => {
  // Get items sorted by current sort_order
  const sorted = [...sortedItems].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )

  // Remove the dragged item from sorted list to get the "target" positions
  const withoutDragged = sorted.filter((_, idx) => idx !== fromIndex)

  // Determine the effective target position in the list without the dragged item
  const effectiveToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex

  if (effectiveToIndex === 0) {
    // Moving to beginning
    const firstItem = withoutDragged[0]
    const firstOrder = firstItem?.sort_order ?? 10
    return firstOrder - 10
  }

  if (effectiveToIndex >= withoutDragged.length) {
    // Moving to end
    const lastItem = withoutDragged[withoutDragged.length - 1]
    const lastOrder = lastItem?.sort_order ?? 0
    return lastOrder + 10
  }

  // Moving to middle - calculate midpoint between surrounding items
  const beforeItem = withoutDragged[effectiveToIndex - 1]
  const afterItem = withoutDragged[effectiveToIndex]

  const beforeOrder = beforeItem?.sort_order ?? 0
  const afterOrder = afterItem?.sort_order ?? beforeOrder + 20

  // If there's no room between values, we'd need to rebalance
  // For now, just use midpoint - rebalancing will be handled separately
  return Math.floor((beforeOrder + afterOrder) / 2)
}

/**
 * Backfill sort_order for items that have null values
 * Should be called on initial load if items have null sort_order
 */
export const backfillSortOrder = async (items: ListItem[]): Promise<void> => {
  const needsUpdate = items.filter(i => i.sort_order === null)
  if (needsUpdate.length === 0) return

  // Sort by added_at to establish initial order
  const sorted = [...needsUpdate].sort((a, b) =>
    new Date(a.added_at).getTime() - new Date(b.added_at).getTime()
  )

  // Update each item with a sort_order based on position
  await Promise.all(sorted.map((item, idx) =>
    supabase
      .from('asset_list_items')
      .update({ sort_order: (idx + 1) * 10 })
      .eq('id', item.id)
  ))
}

/**
 * Rebalance all sort_order values when gaps become too small
 * This spreads items evenly with gaps of 10
 */
export const rebalanceSortOrder = async (
  listId: string,
  items: ListItem[]
): Promise<void> => {
  const sorted = [...items].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )

  await Promise.all(sorted.map((item, idx) =>
    supabase
      .from('asset_list_items')
      .update({ sort_order: (idx + 1) * 10 })
      .eq('id', item.id)
  ))
}

export function useListReorder({ listId, items }: UseListReorderOptions) {
  const queryClient = useQueryClient()

  // Mutation to update sort_order of a single item
  const reorderMutation = useMutation({
    mutationFn: async ({ itemId, newSortOrder }: { itemId: string; newSortOrder: number }) => {
      const { error } = await supabase
        .from('asset_list_items')
        .update({ sort_order: newSortOrder })
        .eq('id', itemId)

      if (error) throw error
    },
    onMutate: async ({ itemId, newSortOrder }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['asset-list-items', listId] })

      // Snapshot the previous value
      const previousItems = queryClient.getQueryData(['asset-list-items', listId])

      // Optimistically update the cache
      queryClient.setQueryData(['asset-list-items', listId], (old: ListItem[] | undefined) => {
        if (!old) return old
        return old.map(item =>
          item.id === itemId ? { ...item, sort_order: newSortOrder } : item
        )
      })

      return { previousItems }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousItems) {
        queryClient.setQueryData(['asset-list-items', listId], context.previousItems)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync with server
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  // Mutation for backfilling null sort_orders
  const backfillMutation = useMutation({
    mutationFn: async () => {
      await backfillSortOrder(items)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  // Mutation for rebalancing
  const rebalanceMutation = useMutation({
    mutationFn: async () => {
      await rebalanceSortOrder(listId, items)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  /**
   * Handle reordering when drag ends
   * @param fromIndex - Original index of dragged item
   * @param toIndex - Target index where item was dropped
   */
  const handleReorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return

    const sortedItems = [...items].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )

    const draggedItem = sortedItems[fromIndex]
    if (!draggedItem) return

    const newSortOrder = calculateNewSortOrder(sortedItems, fromIndex, toIndex)

    reorderMutation.mutate({
      itemId: draggedItem.id,
      newSortOrder
    })
  }

  /**
   * Check if items need backfilling and perform it
   */
  const ensureSortOrder = async () => {
    const needsBackfill = items.some(i => i.sort_order === null)
    if (needsBackfill) {
      await backfillMutation.mutateAsync()
    }
  }

  return {
    handleReorder,
    ensureSortOrder,
    rebalance: rebalanceMutation.mutate,
    isReordering: reorderMutation.isPending,
    isBackfilling: backfillMutation.isPending
  }
}
