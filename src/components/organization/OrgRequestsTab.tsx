/**
 * OrgRequestsTab — Admin-only tab showing pending access requests
 * with approve/reject + actual membership provisioning.
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Bell, Clock, Check, XCircle, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../common/Toast'
import type { AccessRequest } from '../../types/organization'

interface OrgRequestsTabProps {
  isOrgAdmin: boolean
  organizationId?: string
}

export function OrgRequestsTab({ isOrgAdmin, organizationId }: OrgRequestsTabProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [confirmAction, setConfirmAction] = useState<{
    requestId: string
    status: 'approved' | 'rejected'
    requesterName: string
    requestType: string
  } | null>(null)

  // Fetch access requests (admin only, scoped to current org via RLS)
  const { data: accessRequests = [] } = useQuery({
    queryKey: ['access-requests', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('access_requests')
        .select(`
          *,
          requester:requester_id (
            id,
            email,
            raw_user_meta_data
          ),
          target_team:target_team_id (*),
          target_portfolio:target_portfolio_id (*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data.map((r: any) => ({
        ...r,
        requester: {
          id: r.requester?.id,
          email: r.requester?.email,
          full_name: r.requester?.raw_user_meta_data?.full_name || r.requester?.email?.split('@')[0],
          avatar_url: r.requester?.raw_user_meta_data?.avatar_url
        }
      })) as AccessRequest[]
    },
    enabled: isOrgAdmin
  })

  // Approve/reject via atomic RPC (provisions membership server-side)
  const handleAccessRequestMutation = useMutation({
    mutationFn: async ({ requestId, status, notes, requestType }: { requestId: string; status: 'approved' | 'rejected'; notes?: string; requestType: string }) => {
      // Branch: join_org uses dedicated RPC, everything else uses generic
      if (requestType === 'join_org') {
        const { data, error } = await supabase.rpc('approve_org_join_request', {
          p_request_id: requestId,
          p_new_status: status,
          p_notes: notes ?? null
        })
        if (error) throw error
        return data as { status: string; provisioned_membership: boolean }
      }

      const { data, error } = await supabase.rpc('approve_access_request', {
        p_request_id: requestId,
        p_new_status: status,
        p_notes: notes ?? null
      })

      if (error) throw error
      return data as { status: string; provisioned_team: boolean; provisioned_portfolio: boolean }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] })
      queryClient.invalidateQueries({ queryKey: ['team-memberships'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-memberships'] })
      queryClient.invalidateQueries({ queryKey: ['organization-members'] })
      if (variables.status === 'approved') {
        toast.success('Request approved', 'Membership has been provisioned')
      } else {
        toast.info('Request rejected')
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to process request')
    }
  })

  if (!isOrgAdmin) return null

  return (
    <div className="space-y-3">
      {accessRequests.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No pending requests</h3>
          <p className="text-sm text-gray-500">All access requests have been handled</p>
        </div>
      ) : (
        accessRequests.map(request => (
          <Card key={request.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-gray-900">
                      {request.requester?.full_name}
                    </span>
                    <span className="text-sm text-gray-500">
                      {request.request_type === 'join_org'
                        ? 'wants to join the organization'
                        : `requested ${request.request_type.replace(/_/g, ' ')}`}
                    </span>
                  </div>
                  {request.target_team && (
                    <p className="text-sm text-gray-600">
                      Team: {request.target_team.name}
                    </p>
                  )}
                  {request.target_portfolio && (
                    <p className="text-sm text-gray-600">
                      Portfolio: {request.target_portfolio.name}
                    </p>
                  )}
                  {request.reason && (
                    <p className="text-sm text-gray-500 mt-1 italic">"{request.reason}"</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmAction({
                    requestId: request.id,
                    status: 'rejected',
                    requesterName: request.requester?.full_name || 'this user',
                    requestType: request.request_type,
                  })}
                  className="text-red-600 hover:bg-red-50"
                >
                  <XCircle className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={() => setConfirmAction({
                    requestId: request.id,
                    status: 'approved',
                    requesterName: request.requester?.full_name || 'this user',
                    requestType: request.request_type,
                  })}
                >
                  <Check className="w-4 h-4 mr-1" />
                  Approve
                </Button>
              </div>
            </div>
          </Card>
        ))
      )}

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setConfirmAction(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                confirmAction.status === 'approved'
                  ? 'bg-green-100'
                  : 'bg-red-100'
              }`}>
                {confirmAction.status === 'approved' ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                )}
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {confirmAction.status === 'approved' ? 'Approve' : 'Reject'} request?
                </h3>
                <p className="text-sm text-gray-500">
                  {confirmAction.status === 'approved'
                    ? `This will grant ${confirmAction.requesterName} access and provision their membership.`
                    : `This will reject the access request from ${confirmAction.requesterName}. This action cannot be undone.`}
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className={confirmAction.status === 'rejected' ? 'bg-red-600 hover:bg-red-700' : ''}
                disabled={handleAccessRequestMutation.isPending}
                onClick={() => {
                  handleAccessRequestMutation.mutate(
                    { requestId: confirmAction.requestId, status: confirmAction.status, requestType: confirmAction.requestType },
                    { onSettled: () => setConfirmAction(null) }
                  )
                }}
              >
                {handleAccessRequestMutation.isPending
                  ? 'Processing...'
                  : confirmAction.status === 'approved'
                    ? 'Approve'
                    : 'Reject'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
