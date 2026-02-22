/**
 * useCreateRunAction
 *
 * Central hook for the "Create Run" action.
 * Returns the action handler, disabled state, and reason.
 * Only the pinned header CTA should call openCreateRunModal().
 */

import { useMemo } from 'react'

export interface CreateRunAction {
  /** Whether the Create Run button should be disabled */
  isDisabled: boolean
  /** Human-readable reason when disabled */
  disabledReason: string | null
  /** Whether the user has permission to create runs at all */
  canCreate: boolean
}

interface UseCreateRunActionOptions {
  isArchived: boolean
  userPermission: string | null | undefined
  stageCount: number
  isLoading?: boolean
}

export function useCreateRunAction({
  isArchived,
  userPermission,
  stageCount,
  isLoading,
}: UseCreateRunActionOptions): CreateRunAction {
  return useMemo(() => {
    // No permission — hide entirely
    if (userPermission !== 'admin') {
      return { isDisabled: true, disabledReason: null, canCreate: false }
    }

    // Archived process
    if (isArchived) {
      return { isDisabled: true, disabledReason: 'Restore this process before creating a run.', canCreate: true }
    }

    // Still loading
    if (isLoading) {
      return { isDisabled: true, disabledReason: 'Loading…', canCreate: true }
    }

    // No stages configured
    if (stageCount === 0) {
      return { isDisabled: true, disabledReason: 'Add at least one stage before creating a run.', canCreate: true }
    }

    return { isDisabled: false, disabledReason: null, canCreate: true }
  }, [isArchived, userPermission, stageCount, isLoading])
}
