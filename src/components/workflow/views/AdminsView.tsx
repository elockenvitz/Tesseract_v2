/**
 * AdminsView Component — "Access" tab
 *
 * Layout:
 *   Row 1: Roles & Permissions (compact) | Owner card
 *   Row 2: Pending access requests (conditional)
 *   Row 3: Admins | Stakeholders
 *   Footer: contextual links
 */

import React from 'react'
import {
  UserPlus,
  Mail,
  Trash2,
  ArrowRight,
  Bell,
} from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'

// ─── Types ─────────────────────────────────────────────────────

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
  creatorId: string
  creatorName: string
  creatorEmail: string
  currentUserId?: string
  collaborators?: WorkflowCollaborator[]
  stakeholders?: WorkflowStakeholder[]
  accessRequests?: AccessRequest[]
  canEdit?: boolean
  canRequestAccess?: boolean
  isLoadingCollaborators?: boolean
  isLoadingStakeholders?: boolean
  isLoadingRequests?: boolean
  onChangePermission?: (userId: string, newPermission: 'admin' | 'write' | 'read') => void
  onRemoveCollaborator?: (userId: string, userName: string) => void
  onAddAdmin?: () => void
  onAddStakeholder?: () => void
  onRemoveStakeholder?: (stakeholderId: string, userName: string) => void
  onRequestAccess?: () => void
  onManageRequests?: () => void
  onApproveAccessRequest?: (requestId: string, userId: string, permission: string, workflowId: string) => void
  onRejectAccessRequest?: (requestId: string) => void
  onGoToRuns?: () => void
  onGoToStages?: () => void
}

// ─── Helpers ───────────────────────────────────────────────────

function UserAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'
  const dims = size === 'sm' ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px]'
  return (
    <div className={`flex-shrink-0 ${dims} rounded-full flex items-center justify-center font-semibold bg-gray-100 text-gray-600`}>
      {initials}
    </div>
  )
}

// ─── User row (shared between Admins & Stakeholders) ──────────

function UserRow({
  name,
  email,
  canRemove,
  onRemove,
}: {
  name: string
  email?: string
  canRemove?: boolean
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 group transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <UserAvatar name={name} />
        <div className="min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate block">{name}</span>
          {email && <p className="text-[11px] text-gray-400 truncate">{email}</p>}
        </div>
      </div>
      {canRemove && onRemove && (
        <button
          onClick={onRemove}
          className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
          title="Remove"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// ─── Component ─────────────────────────────────────────────────

export function AdminsView({
  creatorId,
  creatorName,
  creatorEmail,
  currentUserId,
  collaborators = [],
  stakeholders = [],
  accessRequests = [],
  canEdit = false,
  canRequestAccess = false,
  isLoadingCollaborators = false,
  isLoadingStakeholders = false,
  onRemoveCollaborator,
  onAddAdmin,
  onAddStakeholder,
  onRemoveStakeholder,
  onRequestAccess,
  onManageRequests,
  onGoToRuns,
  onGoToStages,
}: AdminsViewProps) {
  const admins = collaborators.filter((c) => c.permission === 'admin')
  const hasPendingRequests = accessRequests.length > 0

  return (
    <div className="space-y-3">

      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Team & Access</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Permissions apply to both definition and active runs.
          </p>
        </div>
        {canRequestAccess && !canEdit && onRequestAccess && (
          <Button size="sm" onClick={onRequestAccess} variant="outline">
            <UserPlus className="w-3.5 h-3.5 mr-1.5" />
            Request Access
          </Button>
        )}
      </div>

      {/* ─── Owner ─────────────────────────────────────────── */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <UserAvatar name={creatorName} />
            <div className="min-w-0">
              <span className="text-sm font-medium text-gray-900 truncate block">{creatorName}</span>
              {creatorEmail && (
                <p className="text-[11px] text-gray-400 truncate">{creatorEmail}</p>
              )}
            </div>
          </div>
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Owner</span>
        </div>
      </Card>

      {/* ─── Pending Access Requests ────────────────────────── */}
      {canEdit && hasPendingRequests && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2.5">
            <Mail className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span className="text-sm font-medium text-amber-900">
              {accessRequests.length} pending request{accessRequests.length !== 1 ? 's' : ''}
            </span>
          </div>
          {onManageRequests && (
            <Button size="sm" variant="outline" onClick={onManageRequests}>
              Review
            </Button>
          )}
        </div>
      )}

      {/* ─── Row 2: Admins + Stakeholders ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Admins */}
        <Card className="flex flex-col">
          <div className="px-4 py-2.5 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                Admins{admins.length > 0 ? ` (${admins.length})` : ''}
              </h4>
              {canEdit && onAddAdmin && admins.length > 0 && (
                <Button size="sm" variant="outline" onClick={onAddAdmin}>
                  <UserPlus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mb-1.5">Full edit access to definition and runs.</p>

            {isLoadingCollaborators ? (
              <div className="flex-1 flex items-center justify-center py-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              </div>
            ) : admins.length > 0 ? (
              <div className="-mx-1">
                {admins.map((admin) => {
                  const user = (admin as any).user
                  const userName = admin.user_name || (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown User')
                  const userEmail = admin.user_email || user?.email || ''
                  return (
                    <UserRow
                      key={admin.user_id}
                      name={userName}
                      email={userEmail}
                      canRemove={canEdit && admin.user_id !== currentUserId && admin.user_id !== creatorId}
                      onRemove={() => onRemoveCollaborator?.(admin.user_id, userName)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-3">
                <p className="text-sm text-gray-400">No admins yet</p>
                {canEdit && onAddAdmin && (
                  <Button size="sm" variant="outline" onClick={onAddAdmin} className="mt-1.5">
                    <UserPlus className="w-3 h-3 mr-1" />
                    Add admin
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Stakeholders */}
        <Card className="flex flex-col">
          <div className="px-4 py-2.5 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <h4 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                  Stakeholders{stakeholders.length > 0 ? ` (${stakeholders.length})` : ''}
                </h4>
                <Bell className="w-3 h-3 text-gray-300" />
              </div>
              {canEdit && onAddStakeholder && stakeholders.length > 0 && (
                <Button size="sm" variant="outline" onClick={onAddStakeholder}>
                  <UserPlus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mb-1.5">Notified on run activity. No edit access.</p>

            {isLoadingStakeholders ? (
              <div className="flex-1 flex items-center justify-center py-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600" />
              </div>
            ) : stakeholders.length > 0 ? (
              <div className="-mx-1">
                {stakeholders.map((stakeholder) => {
                  const user = (stakeholder as any).user
                  const userName = stakeholder.user_name || (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown User')
                  const userEmail = stakeholder.user_email || user?.email || ''
                  return (
                    <UserRow
                      key={stakeholder.id}
                      name={userName}
                      email={userEmail}
                      canRemove={canEdit}
                      onRemove={() => onRemoveStakeholder?.(stakeholder.id, userName)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-3">
                <p className="text-sm text-gray-400">No stakeholders yet</p>
                {canEdit && onAddStakeholder && (
                  <Button size="sm" variant="outline" onClick={onAddStakeholder} className="mt-1.5">
                    <UserPlus className="w-3 h-3 mr-1" />
                    Add stakeholder
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ─── Footer ──────────────────────────────────────────── */}
      {(onGoToRuns || onGoToStages) && (
        <div className="flex items-center justify-end gap-3 px-1 text-[11px]">
          {onGoToRuns && (
            <button onClick={onGoToRuns} className="inline-flex items-center font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Runs <ArrowRight className="w-3 h-3 ml-0.5" />
            </button>
          )}
          {onGoToStages && (
            <button onClick={onGoToStages} className="inline-flex items-center font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Stages <ArrowRight className="w-3 h-3 ml-0.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
