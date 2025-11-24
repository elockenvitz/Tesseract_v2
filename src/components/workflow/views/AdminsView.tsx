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

  /** Callbacks for admin operations */
  onChangePermission?: (userId: string, newPermission: 'admin' | 'write' | 'read') => void
  onRemoveCollaborator?: (userId: string, userName: string) => void

  /** Callbacks for stakeholder operations */
  onAddStakeholder?: () => void
  onRemoveStakeholder?: (stakeholderId: string, userName: string) => void

  /** Callbacks for access request operations */
  onRequestAccess?: () => void
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
  onChangePermission,
  onRemoveCollaborator,
  onAddStakeholder,
  onRemoveStakeholder,
  onRequestAccess,
  onManageRequests
}: AdminsViewProps) {
  // Separate collaborators by permission level
  const admins = collaborators.filter(c => c.permission === 'admin')

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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-gray-900">Team & Access</h3>
        </div>
        {!canEdit && onRequestAccess && (
          <Button onClick={onRequestAccess}>
            <UserPlus className="w-4 h-4 mr-2" />
            Request Access
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
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">Workflow Creator</h4>
            <Shield className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-600" />
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
        <div className="p-3">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">
            Administrators ({admins.length})
          </h4>
          {isLoadingCollaborators ? (
            <div className="text-center py-3">
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            </div>
          ) : admins.length > 0 ? (
            <div className="space-y-2">
              {admins.map((admin) => {
                const user = (admin as any).user
                const userName = admin.user_name || (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown User')
                const userEmail = admin.user_email || user?.email || ''

                return (
                  <div key={admin.user_id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="flex-shrink-0 w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
                        <Users className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-gray-900">{userName}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${getPermissionBadgeColor(admin.permission)}`}>
                            Admin
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">{userEmail}</p>
                      </div>
                    </div>
                    {canEdit && admin.user_id !== currentUserId && admin.user_id !== creatorId && onRemoveCollaborator && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onRemoveCollaborator(admin.user_id, userName)}
                        title="Remove Admin"
                      >
                        <Trash2 className="w-3 h-3 text-red-600" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-3">No additional admins</p>
          )}
        </div>
      </Card>

      {/* Stakeholders */}
      <Card>
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
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
            <div className="text-center py-3">
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            </div>
          ) : stakeholders.length > 0 ? (
            <div className="space-y-2">
              {stakeholders.map((stakeholder) => {
                const user = (stakeholder as any).user
                const userName = stakeholder.user_name || (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown User')
                const userEmail = stakeholder.user_email || user?.email || ''

                return (
                  <div key={stakeholder.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="flex-shrink-0 w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center">
                        <UserCheck className="w-3.5 h-3.5 text-purple-600" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-900">{userName}</span>
                        <p className="text-xs text-gray-500">{userEmail}</p>
                      </div>
                    </div>
                    {canEdit && onRemoveStakeholder && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onRemoveStakeholder(stakeholder.id, userName)}
                        title="Remove Stakeholder"
                      >
                        <Trash2 className="w-3 h-3 text-red-600" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-sm text-gray-500 mb-1">No stakeholders yet</p>
              <p className="text-xs text-gray-400">Stakeholders receive notifications but cannot edit</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
