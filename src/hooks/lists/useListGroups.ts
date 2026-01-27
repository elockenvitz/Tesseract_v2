import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'

export interface ListGroup {
  id: string
  list_id: string
  name: string
  color: string
  sort_order: number
  is_collapsed: boolean
  created_at: string
  created_by: string | null
}

interface UseListGroupsOptions {
  listId: string
  enabled?: boolean
}

export function useListGroups({ listId, enabled = true }: UseListGroupsOptions) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Local state for collapsed groups (persisted to localStorage)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`list-groups-collapsed-${listId}`)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })

  // Fetch groups for this list
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['asset-list-groups', listId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_list_groups')
        .select('*')
        .eq('list_id', listId)
        .order('sort_order', { ascending: true })

      if (error) throw error
      return data as ListGroup[]
    },
    enabled
  })

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: async ({ name, color }: { name: string; color?: string }) => {
      // Get max sort_order to add new group at the end
      const maxSortOrder = groups.length > 0
        ? Math.max(...groups.map(g => g.sort_order)) + 10
        : 10

      const { data, error } = await supabase
        .from('asset_list_groups')
        .insert({
          list_id: listId,
          name,
          color: color || '#6b7280',
          sort_order: maxSortOrder,
          created_by: user?.id
        })
        .select()
        .single()

      if (error) throw error
      return data as ListGroup
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-groups', listId] })
    }
  })

  // Update group mutation
  const updateGroupMutation = useMutation({
    mutationFn: async ({
      groupId,
      updates
    }: {
      groupId: string
      updates: Partial<Pick<ListGroup, 'name' | 'color' | 'sort_order' | 'is_collapsed'>>
    }) => {
      const { data, error } = await supabase
        .from('asset_list_groups')
        .update(updates)
        .eq('id', groupId)
        .select()
        .single()

      if (error) throw error
      return data as ListGroup
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-groups', listId] })
    }
  })

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from('asset_list_groups')
        .delete()
        .eq('id', groupId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-groups', listId] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  // Move item to group mutation
  const moveItemToGroupMutation = useMutation({
    mutationFn: async ({ itemId, groupId }: { itemId: string; groupId: string | null }) => {
      const { error } = await supabase
        .from('asset_list_items')
        .update({ group_id: groupId })
        .eq('id', itemId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-items', listId] })
    }
  })

  // Reorder groups mutation
  const reorderGroupMutation = useMutation({
    mutationFn: async ({ groupId, newSortOrder }: { groupId: string; newSortOrder: number }) => {
      const { error } = await supabase
        .from('asset_list_groups')
        .update({ sort_order: newSortOrder })
        .eq('id', groupId)

      if (error) throw error
    },
    onMutate: async ({ groupId, newSortOrder }) => {
      await queryClient.cancelQueries({ queryKey: ['asset-list-groups', listId] })

      const previousGroups = queryClient.getQueryData(['asset-list-groups', listId])

      queryClient.setQueryData(['asset-list-groups', listId], (old: ListGroup[] | undefined) => {
        if (!old) return old
        return old.map(g => g.id === groupId ? { ...g, sort_order: newSortOrder } : g)
      })

      return { previousGroups }
    },
    onError: (err, variables, context) => {
      if (context?.previousGroups) {
        queryClient.setQueryData(['asset-list-groups', listId], context.previousGroups)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list-groups', listId] })
    }
  })

  // Toggle group collapse (local state + optionally persisted)
  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }

      // Persist to localStorage
      try {
        localStorage.setItem(`list-groups-collapsed-${listId}`, JSON.stringify([...next]))
      } catch {
        // Ignore localStorage errors
      }

      return next
    })
  }, [listId])

  // Helper to check if group is collapsed
  const isGroupCollapsed = useCallback((groupId: string) => {
    return collapsedGroups.has(groupId)
  }, [collapsedGroups])

  // Calculate new sort_order for group reordering
  const calculateGroupSortOrder = (fromIndex: number, toIndex: number): number => {
    const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order)

    if (toIndex === 0) {
      return sorted[0]?.sort_order ? sorted[0].sort_order - 10 : 10
    }

    if (toIndex >= sorted.length - 1) {
      return sorted[sorted.length - 1]?.sort_order
        ? sorted[sorted.length - 1].sort_order + 10
        : sorted.length * 10
    }

    // Insert between two groups
    const withoutDragged = sorted.filter((_, idx) => idx !== fromIndex)
    const effectiveToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex

    const before = withoutDragged[effectiveToIndex - 1]?.sort_order ?? 0
    const after = withoutDragged[effectiveToIndex]?.sort_order ?? before + 20

    return Math.floor((before + after) / 2)
  }

  return {
    groups,
    isLoading,
    collapsedGroups,

    // Actions
    createGroup: createGroupMutation.mutate,
    updateGroup: updateGroupMutation.mutate,
    deleteGroup: deleteGroupMutation.mutate,
    moveItemToGroup: moveItemToGroupMutation.mutate,
    reorderGroup: reorderGroupMutation.mutate,
    toggleGroupCollapse,
    isGroupCollapsed,
    calculateGroupSortOrder,

    // Loading states
    isCreating: createGroupMutation.isPending,
    isUpdating: updateGroupMutation.isPending,
    isDeleting: deleteGroupMutation.isPending,
    isMoving: moveItemToGroupMutation.isPending,
    isReordering: reorderGroupMutation.isPending
  }
}
