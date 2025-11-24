/**
 * AccessRequestModal Component
 *
 * Modal for requesting elevated access to a workflow.
 * Extracted from WorkflowsPage.tsx during Phase 5 refactoring.
 */

import React, { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X, Clock, CheckCircle, Bell } from 'lucide-react'
import { Button } from '../../ui/Button'
import { supabase } from '../../../lib/supabase'

export interface AccessRequestModalProps {
  /** Workflow ID */
  workflowId: string

  /** Workflow name */
  workflowName: string

  /** Current user permission level */
  currentPermission?: 'read' | 'write' | 'admin' | 'owner'

  /** Callback when modal is closed */
  onClose: () => void

  /** Callback when access is requested */
  onRequest: (requestedPermission: 'write' | 'admin', reason: string) => void
}

export function AccessRequestModal({ workflowId, workflowName, currentPermission, onClose, onRequest }: AccessRequestModalProps) {
  const [requestedPermission, setRequestedPermission] = useState<'write' | 'admin'>('write')
  const [reason, setReason] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [reminderSent, setReminderSent] = useState(false)

  // Check for existing pending request
  const { data: pendingRequest, isLoading: loadingPendingRequest } = useQuery({
    queryKey: ['pending-access-request', workflowId],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId) return null

      const { data, error } = await supabase
        .from('workflow_access_requests')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .maybeSingle()

      if (error) throw error
      return data
    }
  })

  // Send reminder mutation
  const sendReminderMutation = useMutation({
    mutationFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id
      if (!userId || !pendingRequest) throw new Error('Missing data')

      // Get workflow name and requester name
      const { data: workflow } = await supabase
        .from('workflows')
        .select('name, created_by')
        .eq('id', workflowId)
        .single()

      const { data: requesterData } = await supabase
        .from('users')
        .select('first_name, last_name, email')
        .eq('id', userId)
        .single()

      const requesterName = requesterData
        ? `${requesterData.first_name || ''} ${requesterData.last_name || ''}`.trim() || requesterData.email
        : 'A user'

      // Notify workflow owner
      await supabase.from('notifications').insert({
        user_id: workflow?.created_by,
        type: 'workflow_access_request',
        title: 'Access Request Reminder',
        message: `${requesterName} sent a reminder about their ${pendingRequest.requested_permission} access request for "${workflowName}"`,
        context_type: 'workflow',
        context_id: workflowId,
        context_data: {
          workflow_id: workflowId,
          workflow_name: workflowName,
          user_id: userId,
          requester_name: requesterName,
          requested_permission: pendingRequest.requested_permission,
          reason: pendingRequest.reason,
          request_id: pendingRequest.id,
          is_reminder: true
        },
        is_read: false
      })

      // Notify all workflow admins
      const { data: admins } = await supabase
        .from('workflow_collaborations')
        .select('user_id')
        .eq('workflow_id', workflowId)
        .eq('permission', 'admin')
        .neq('user_id', userId)

      if (admins && admins.length > 0) {
        await supabase.from('notifications').insert(
          admins.map(admin => ({
            user_id: admin.user_id,
            type: 'workflow_access_request',
            title: 'Access Request Reminder',
            message: `${requesterName} sent a reminder about their ${pendingRequest.requested_permission} access request for "${workflowName}"`,
            context_type: 'workflow',
            context_id: workflowId,
            context_data: {
              workflow_id: workflowId,
              workflow_name: workflowName,
              user_id: userId,
              requester_name: requesterName,
              requested_permission: pendingRequest.requested_permission,
              reason: pendingRequest.reason,
              request_id: pendingRequest.id,
              is_reminder: true
            },
            is_read: false
          }))
        )
      }
    },
    onSuccess: () => {
      setReminderSent(true)
    },
    onError: (error) => {
      console.error('Error sending reminder:', error)
      alert('Failed to send reminder. Please try again.')
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (reason.trim()) {
      onRequest(requestedPermission, reason.trim())
      setIsSubmitted(true)
    }
  }

  const handleClose = () => {
    setIsSubmitted(false)
    setReminderSent(false)
    setReason('')
    setRequestedPermission('write')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Request Access</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadingPendingRequest ? (
          <div className="py-8 text-center">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : pendingRequest ? (
          <div className="py-4">
            <div className="flex items-start space-x-3 mb-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-base font-medium text-gray-900 mb-1">
                  Access request pending
                </h3>
                <p className="text-sm text-gray-600">
                  You have already requested {pendingRequest.requested_permission} access to this workflow.
                </p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="space-y-2">
                <div>
                  <span className="text-xs font-medium text-gray-500">Requested Permission:</span>
                  <p className="text-sm text-gray-900 capitalize">{pendingRequest.requested_permission}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500">Your Reason:</span>
                  <p className="text-sm text-gray-900">{pendingRequest.reason}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500">Requested:</span>
                  <p className="text-sm text-gray-900">
                    {new Date(pendingRequest.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            </div>

            {reminderSent ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <p className="text-sm text-green-800 font-medium">
                    Reminder sent to workflow admins!
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-3">
                  Your request is waiting for admin approval. You can send a reminder to notify them again.
                </p>
                <Button
                  onClick={() => sendReminderMutation.mutate()}
                  disabled={sendReminderMutation.isPending}
                  variant="outline"
                  className="w-full"
                >
                  <Bell className="w-4 h-4 mr-2" />
                  {sendReminderMutation.isPending ? 'Sending...' : 'Send Reminder to Admins'}
                </Button>
              </div>
            )}

            <Button onClick={handleClose} variant="outline" className="w-full">
              Close
            </Button>
          </div>
        ) : isSubmitted ? (
          <div className="py-6">
            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
            </div>
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Access request sent successfully!
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                Workflow admins will be notified and will review your request.
              </p>
              <Button onClick={handleClose} className="w-full">
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                Request higher access level for "{workflowName}"
              </p>
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                Current permission: <span className="font-medium capitalize">{currentPermission}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Requested Permission Level
                  </label>
                  <select
                    value={requestedPermission}
                    onChange={(e) => setRequestedPermission(e.target.value as 'write' | 'admin')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="write">Write Access - Edit checklist items and workflow content</option>
                    <option value="admin">Admin Access - Full workflow management permissions</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for Request
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                    placeholder="Please explain why you need this access level..."
                    required
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    This request will be sent to the workflow administrators for approval.
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit">
                  Send Request
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
