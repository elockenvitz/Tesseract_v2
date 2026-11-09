/**
 * Who may do what to a list, and to one row in it.
 *
 * ── Why this is a function and not only a hook ───────────────────────────
 *
 * `useListPermissions` answers the question for ONE list, which is all the
 * List tab ever needed. The Asset page asks it for every list a name sits in,
 * and a hook called once per row is a Rules-of-Hooks violation — so the rule
 * had to become callable. It is the same rule: the hook now delegates here and
 * holds nothing of its own.
 *
 * ── The rule that is easy to lose ───────────────────────────────────────
 *
 * On a COLLABORATIVE list, write access does not mean you may remove any row.
 * You may remove the rows you added.
 *
 * This file was for a long time the ONLY thing enforcing that: the DELETE
 * policy on `asset_list_items` admitted the owner and any write collaborator,
 * so a collaborator who went around the UI could remove somebody else's row.
 * Migration 20261027002812 closed it — Postgres now applies the same own-row
 * term, and 20261027013936 made `added_by` NOT NULL so there is no author-less
 * row to fall back on. The two rules must stay in agreement: widening either
 * one is a product decision, not a refactor.
 */

export interface ListDataLike {
  id: string
  name: string
  list_type: 'mutual' | 'collaborative'
  created_by: string | null
}

export interface CollaboratorLike {
  user_id: string
  /*
   * There is no 'admin'. It sat in one CHECK constraint on
   * `asset_list_collaborations.permission` and was excluded by a second, so
   * both had to hold and the value could never be written; migration
   * 20261027013936 dropped it. The branches here that tested for it were
   * therefore unreachable, which made `hasAdminAccess` an alias for `isOwner`
   * while reading as though a second tier existed.
   */
  permission: 'read' | 'write'
}

export interface ListItemOwner {
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

/** Nothing is permitted. The answer for an absent list or an absent reader. */
export const NO_LIST_ACCESS: ListPermissions = {
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
  listType: 'mutual',
}

export interface ListPermissionsInput {
  list: ListDataLike | null | undefined
  collaborators?: readonly CollaboratorLike[]
  userId: string | null | undefined
}

export function listPermissions({
  list,
  collaborators = [],
  userId,
}: ListPermissionsInput): ListPermissions {
  if (!list || !userId) return NO_LIST_ACCESS

  const isOwner = list.created_by === userId
  const collaboration = collaborators.find(c => c.user_id === userId)
  const isCollaborator = !!collaboration
  const collaboratorPermission = collaboration?.permission

  const hasWriteAccess = isOwner || collaboratorPermission === 'write'

  // Settings and collaborator management are the owner's, and only the
  // owner's — see the note on CollaboratorLike.permission. Named rather than
  // inlined because it is a rule, and because an admin tier would land here.
  const hasAdminAccess = isOwner

  const canView = isOwner || isCollaborator

  /*
   * `hasCollaborators` is only as good as the rows the caller passed.
   *
   * SELECT on `asset_list_collaborations` is `user_id = auth.uid()` for a
   * collaborator, so a collaborator who nests the table sees exactly their own
   * row and cannot tell whether anyone else shares the list. That is enough
   * for every access answer above — each one looks up the reader's own row —
   * but it is NOT enough for this one. Only the owner's read is complete, and
   * `canChangeListType` already requires ownership, so the gate holds.
   */
  const hasCollaborators = collaborators.length > 0

  if (list.list_type === 'mutual') {
    return {
      canView,
      canWrite: hasWriteAccess,
      isOwner,
      isCollaborator,
      canEditListSettings: hasAdminAccess,
      canDeleteList: isOwner,
      canManageCollaborators: hasAdminAccess,
      canChangeListType: isOwner && !hasCollaborators,
      canAddAnyItem: hasWriteAccess,
      canRemoveAnyItem: hasWriteAccess,
      canAddToOwnSection: false, // N/A for mutual
      canRemoveFromOwnSection: false, // N/A for mutual
      canSuggestChanges: false, // N/A for mutual
      canRemoveItem: () => hasWriteAccess,
      canEditItemNotes: () => hasWriteAccess,
      listType: 'mutual',
    }
  }

  return {
    canView,
    canWrite: hasWriteAccess,
    isOwner,
    isCollaborator,
    canEditListSettings: hasAdminAccess,
    canDeleteList: isOwner,
    canManageCollaborators: hasAdminAccess,
    canChangeListType: isOwner && !hasCollaborators,
    canAddAnyItem: false, // Cannot add to anyone's section
    canRemoveAnyItem: false, // Cannot remove from anyone's section
    canAddToOwnSection: hasWriteAccess,
    canRemoveFromOwnSection: hasWriteAccess,
    canSuggestChanges: hasWriteAccess,
    canRemoveItem: (item: ListItemOwner) =>
      hasWriteAccess && item.added_by === userId,
    canEditItemNotes: (item: ListItemOwner) =>
      hasWriteAccess && item.added_by === userId,
    listType: 'collaborative',
  }
}
