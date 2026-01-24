import { useMemo } from 'react'
import { useAuth } from '../useAuth'

interface ListData {
  id: string
  name: string
  list_type: 'mutual' | 'collaborative'
  created_by: string | null
}

interface Collaborator {
  user_id: string
  permission: 'read' | 'write' | 'admin'
}

interface ListItemOwner {
  added_by: string | null
}

export interface ListPermissions {
  // Basic access
  canView: boolean
  canWrite: boolean
  isOwner: boolean
  isCollaborator: boolean

  // List management
  canEditListSettings: boolean
  canDeleteList: boolean
  canManageCollaborators: boolean
  canChangeListType: boolean

  // Item actions for mutual lists
  canAddAnyItem: boolean
  canRemoveAnyItem: boolean

  // Item actions for collaborative lists
  canAddToOwnSection: boolean
  canRemoveFromOwnSection: boolean
  canSuggestChanges: boolean

  // Helper to check specific item permissions
  canRemoveItem: (item: ListItemOwner) => boolean
  canEditItemNotes: (item: ListItemOwner) => boolean

  // List type
  listType: 'mutual' | 'collaborative'
}

interface UseListPermissionsOptions {
  list: ListData | null | undefined
  collaborators?: Collaborator[]
}

export function useListPermissions({
  list,
  collaborators = []
}: UseListPermissionsOptions): ListPermissions {
  const { user } = useAuth()

  return useMemo(() => {
    // Default no-access permissions
    const noAccess: ListPermissions = {
      canView: false,
      canWrite: false,
      isOwner: false,
      isCollaborator: false,
      canEditListSettings: false,
      canDeleteList: false,
      canManageCollaborators: false,
      canChangeListType: false,
      canAddAnyItem: false,
      canRemoveAnyItem: false,
      canAddToOwnSection: false,
      canRemoveFromOwnSection: false,
      canSuggestChanges: false,
      canRemoveItem: () => false,
      canEditItemNotes: () => false,
      listType: 'mutual'
    }

    if (!list || !user?.id) {
      return noAccess
    }

    const userId = user.id
    const isOwner = list.created_by === userId
    const collaboration = collaborators.find(c => c.user_id === userId)
    const isCollaborator = !!collaboration
    const collaboratorPermission = collaboration?.permission

    // Determine write access
    const hasWriteAccess = isOwner ||
      collaboratorPermission === 'write' ||
      collaboratorPermission === 'admin'

    // Determine admin access
    const hasAdminAccess = isOwner || collaboratorPermission === 'admin'

    // Determine view access
    const canView = isOwner || isCollaborator

    // Check if list has any collaborators (for type change restriction)
    const hasCollaborators = collaborators.length > 0

    // Mutual list permissions
    if (list.list_type === 'mutual') {
      return {
        canView,
        canWrite: hasWriteAccess,
        isOwner,
        isCollaborator,
        canEditListSettings: hasAdminAccess,
        canDeleteList: isOwner,
        canManageCollaborators: hasAdminAccess,
        canChangeListType: isOwner && !hasCollaborators, // Can only change if no collaborators
        canAddAnyItem: hasWriteAccess,
        canRemoveAnyItem: hasWriteAccess,
        canAddToOwnSection: false, // N/A for mutual
        canRemoveFromOwnSection: false, // N/A for mutual
        canSuggestChanges: false, // N/A for mutual
        canRemoveItem: () => hasWriteAccess,
        canEditItemNotes: () => hasWriteAccess,
        listType: 'mutual'
      }
    }

    // Collaborative list permissions
    return {
      canView,
      canWrite: hasWriteAccess,
      isOwner,
      isCollaborator,
      canEditListSettings: hasAdminAccess,
      canDeleteList: isOwner,
      canManageCollaborators: hasAdminAccess,
      canChangeListType: isOwner && !hasCollaborators, // Can only change if no collaborators
      canAddAnyItem: false, // Cannot add to anyone's section
      canRemoveAnyItem: false, // Cannot remove from anyone's section
      canAddToOwnSection: hasWriteAccess,
      canRemoveFromOwnSection: hasWriteAccess,
      canSuggestChanges: hasWriteAccess,
      canRemoveItem: (item: ListItemOwner) => {
        // Can only remove items you added
        return hasWriteAccess && item.added_by === userId
      },
      canEditItemNotes: (item: ListItemOwner) => {
        // Can only edit notes on items you added
        return hasWriteAccess && item.added_by === userId
      },
      listType: 'collaborative'
    }
  }, [list, collaborators, user?.id])
}

export default useListPermissions
