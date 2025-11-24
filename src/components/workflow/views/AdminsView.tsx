/**
 * AdminsView Component
 *
 * Complete Admins/Team tab view for workflows.
 * Manages workflow collaborators, stakeholders, and access requests.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { Users, UserPlus, UserCheck, Mail, Shield, Trash2, ChevronDown } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'

export interface WorkflowCollaborator {
  user_id: string
  user_name: string
  user_email: string
  permission: 'admin' | 'write' | 'read'
  added_at: string
}

export interface WorkflowStakeholder {
  id: string
  user_id: string
  user_name: string
  user_email: string
  added_at: string
}

export interface AccessRequest {
  id: string
  user_id: string
  user_name: string
  user_email: string
  requested_at: string
  message?: string
}

export interface AdminsViewProps {
  /** Workflow creator information */
  creatorId: string
  creatorName: string
  creatorEmail: string

  /** Current user ID */
  currentUserId?: string

  /** List of collaborators */
  collaborators?: WorkflowCollaborator[]

  /** List of stakeholders */
  stakeholders?: WorkflowStakeholder[]

  /** Pending access requests (visible to admins only) */
  accessRequests?: AccessRequest[]

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Loading states */
  isLoadingCollaborators?: boolean
  isLoadingStakeholders?: boolean
  isLoadingRequests?: boolean

  /** Callbacks for collaborator operations */
  onInviteCollaborator?: () => void
  onChangePermission?: (userId: string, newPermission: 'admin' | 'write' | 'read') => void
  onRemoveCollaborator?: (userId: string, userName: string) => void

  /** Callbacks for stakeholder operations */
  onAddStakeholder?: () => void
  onRemoveStakeholder?: (stakeholderId: string, userName: string) => void

  /** Callbacks for access request operations */
  onApproveRequest?: (requestId: string) => void
  onRejectRequest?: (requestId: string) => void
  onManageRequests?: () => void
}

export function AdminsView({
  creatorId,
  creatorName,
  creatorEmail,
  currentUserId,
  collaborators = [],
  stakeholders = [],
  accessRequests = [],
  canEdit = false,
  isLoadingCollaborators = false,
  isLoadingStakeholders = false,
  isLoadingRequests = false,
  onInviteCollaborator,
  onChangePermission,
  onRemoveCollaborator,
  onAddStakeholder,
  onRemoveStakeholder,
  onApproveRequest,
  onRejectRequest,
  onManageRequests
}: AdminsViewProps) {
  // Separate collaborators by permission level
  const admins = collaborators.filter(c => c.permission === 'admin')
  const writers = collaborators.filter(c => c.permission === 'write')
  const readers = collaborators.filter(c => c.permission === 'read')

  const hasPendingRequests = accessRequests.length > 0

  // Get badge color for permission level
  const getPermissionBadgeColor = (permission: string) => {
    switch (permission) {
      case 'admin':
        return 'bg-blue-100 text-blue-700 border-blue-300'
      case 'write':
        return 'bg-green-100 text-green-700 border-green-300'
      case 'read':
        return 'bg-gray-100 text-gray-700 border-gray-300'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-300'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Team & Access</h3>
          <p className="text-sm text-gray-500 mt-1">
            Manage collaborators, stakeholders, and access permissions
          </p>
        </div>
        {canEdit && onInviteCollaborator && (
          <Button onClick={onInviteCollaborator}>
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Collaborator
          </Button>
        )}
      </div>

      {/* Pending Access Requests (Admins Only) */}
      {canEdit && hasPendingRequests && (
        <Card>
          <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <Mail className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-900">
                    {accessRequests.length} Pending Access Request{accessRequests.length !== 1 ? 's' : ''}
                  </h4>
                  <p className="text-sm text-yellow-700 mt-1">
                    Users have requested access to this workflow
                  </p>
                </div>
              </div>
              {onManageRequests && (
                <Button size="sm" variant="outline" onClick={onManageRequests}>
                  Review Requests
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Workflow Creator */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">Workflow Creator</h4>
            <Shield className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900">{creatorName}</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 border border-blue-300">
                  Owner
                </span>
              </div>
              <p className="text-xs text-gray-500">{creatorEmail}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Admins */}
      <Card>
        <div className="p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">
            Administrators ({admins.length})
          </h4>
          {isLoadingCollaborators ? (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          ) : admins.length > 0 ? (
            <div className="space-y-2">
              {admins.map((admin) => (
                <div key={admin.user_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <Users className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900">{admin.user_name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${getPermissionBadgeColor(admin.permission)}`}>
                          Admin
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{admin.user_email}</p>
                    </div>
                  </div>
                  {canEdit && admin.user_id !== currentUserId && admin.user_id !== creatorId && onRemoveCollaborator && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onRemoveCollaborator(admin.user_id, admin.user_name)}
                      title="Remove Admin"
                    >
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No additional admins</p>
          )}
        </div>
      </Card>

      {/* Collaborators (Write/Read) */}
      <Card>
        <div className="p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">
            Collaborators ({writers.length + readers.length})
          </h4>
          {isLoadingCollaborators ? (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          ) : (writers.length + readers.length) > 0 ? (
            <div className="space-y-2">
              {[...writers, ...readers].map((collab) => (
                <div key={collab.user_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900">{collab.user_name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${getPermissionBadgeColor(collab.permission)}`}>
                          {collab.permission === 'write' ? 'Write' : 'Read'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{collab.user_email}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {canEdit && onChangePermission && (
                      <div className="relative">
                        <select
                          value={collab.permission}
                          onChange={(e) => onChangePermission(collab.user_id, e.target.value as 'admin' | 'write' | 'read')}
                          className="text-xs border border-gray-300 rounded px-2 py-1 pr-6 appearance-none bg-white"
                        >
                          <option value="admin">Admin</option>
                          <option value="write">Write</option>
                          <option value="read">Read</option>
                        </select>
                        <ChevronDown className="w-3 h-3 absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    )}
                    {canEdit && onRemoveCollaborator && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onRemoveCollaborator(collab.user_id, collab.user_name)}
                        title="Remove Collaborator"
                      >
                        <Trash2 className="w-3 h-3 text-red-600" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No collaborators yet</p>
          )}
        </div>
      </Card>

      {/* Stakeholders */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Stakeholders ({stakeholders.length})
            </h4>
            {canEdit && onAddStakeholder && (
              <Button size="sm" variant="outline" onClick={onAddStakeholder}>
                <UserPlus className="w-3 h-3 mr-1" />
                Add
              </Button>
            )}
          </div>
          {isLoadingStakeholders ? (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          ) : stakeholders.length > 0 ? (
            <div className="space-y-2">
              {stakeholders.map((stakeholder) => (
                <div key={stakeholder.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                      <UserCheck className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-900">{stakeholder.user_name}</span>
                      <p className="text-xs text-gray-500">{stakeholder.user_email}</p>
                    </div>
                  </div>
                  {canEdit && onRemoveStakeholder && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onRemoveStakeholder(stakeholder.id, stakeholder.user_name)}
                      title="Remove Stakeholder"
                    >
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 mb-2">No stakeholders yet</p>
              <p className="text-xs text-gray-400">Stakeholders receive notifications but cannot edit</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
