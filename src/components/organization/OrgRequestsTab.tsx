/**
 * OrgRequestsTab — Admin-only tab showing pending access requests
 * with approve/reject + actual membership provisioning.
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Bell, Clock, Check, XCircle, AlertTriangle, Users, Briefcase } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../common/Toast'
import type { AccessRequest } from '../../types/organization'
import { logOrgActivity } from '../../lib/org-activity-log'

/**
 * The requester's message, clamped until it needs not to be.
 *
 * Whether four lines is "too long" depends on the text, the width and the
 * font, so it is measured rather than guessed: the clamp is CSS, and a
 * clamped element reports a `scrollHeight` larger than its `clientHeight`
 * exactly when it is hiding something. A character-count heuristic would
 * offer More on a short message at one width and withhold it from a long one
 * at another — and withholding it is the serious direction, because this text
 * is what an approve/decline decision rests on.
 *
 * Re-measured on resize, since rotating the phone changes the answer.
 */
export function RequestMessage({ text }: { text: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [overflows, setOverflows] = React.useState(false)

  React.useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      // Only meaningful while clamped; once expanded the clamp is off and the
      // two heights match, so the flag is left as it was.
      if (expanded) return
      setOverflows(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [text, expanded])

  return (
    <>
      <p
        ref={ref}
        data-slot="request-message"
        /* `whitespace-pre-wrap` keeps the line breaks the requester typed —
           without it a message written as paragraphs collapses into one. */
        className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-400 ${
          expanded ? '' : 'line-clamp-4'
        }`}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          data-slot="request-message-toggle"
          className="no-touch-target tap-pad mt-0.5 text-xs font-medium text-indigo-600"
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </>
  )
}

/**
 * How each request type reads in the card.
 *
 * Keys are the values the `chk_access_request_type` check constraint allows.
 * Anything not listed falls back to the underscored value title-cased, so a
 * new type added to the constraint renders sensibly rather than blank.
 */
const REQUEST_TYPE_LABELS: Record<string, string> = {
  join_team: 'Join team',
  join_portfolio: 'Join portfolio',
  join_node: 'Join node',
  join_org: 'Join organization',
  role_change: 'Role change',
  team_admin: 'Team admin',
  portfolio_manager: 'Portfolio manager',
  org_admin: 'Org admin',
  create_team: 'Create team',
  create_portfolio: 'Create portfolio',
  other: 'Access request',
}

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
      /*
        The requester is fetched separately, not embedded.

        `requester_id` references **auth.users**, and PostgREST only exposes
        `public` — so `requester:requester_id(...)` could not resolve, the
        select errored, and this query threw on every run. The tab rendered
        empty no matter what was pending, on every screen size. The
        `raw_user_meta_data` unwrapping was the tell: that column exists only
        on the auth table.

        `public.users` carries the identity this UI renders, under the same
        org scoping `access_requests` itself uses.
      */
      const { data, error } = await supabase
        .from('access_requests')
        .select(`
          *,
          target_team:target_team_id (*),
          target_portfolio:target_portfolio_id (*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) throw error

      const requesterIds = [...new Set((data ?? []).map((r: any) => r.requester_id).filter(Boolean))]
      const requesterById = new Map<string, any>()
      if (requesterIds.length > 0) {
        const { data: requesters, error: requesterError } = await supabase
          .from('users')
          .select('id, email, full_name, first_name, last_name')
          .in('id', requesterIds)
        if (requesterError) throw requesterError
        for (const u of (requesters ?? []) as any[]) requesterById.set(u.id, u)
      }

      return (data ?? []).map((r: any) => {
        const u = requesterById.get(r.requester_id)
        const composed = [u?.first_name, u?.last_name].filter(Boolean).join(' ')
        return {
          ...r,
          requester: {
            id: r.requester_id,
            email: u?.email,
            full_name: u?.full_name || composed || u?.email?.split('@')[0],
            avatar_url: undefined,
          },
        }
      }) as AccessRequest[]
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
      if (organizationId) {
        logOrgActivity({
          organizationId,
          action: 'access_request.reviewed',
          targetType: 'access_request',
          targetId: variables.requestId,
          entityType: 'access_request',
          actionType: variables.status === 'approved' ? 'approved' : 'rejected',
          details: { request_type: variables.requestType, status: variables.status, notes: variables.notes },
        })
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to process request')
    }
  })

  if (!isOrgAdmin) return null

  // Only the labels; the values come from the `request_type` check constraint.

  return (
    <div className="space-y-3">
      {accessRequests.length === 0 ? (
        <div className="text-center py-8 sm:py-12">
          <Bell className="w-10 h-10 sm:w-12 sm:h-12 text-gray-300 mx-auto mb-3 sm:mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-1 sm:mb-2 dark:text-white">No pending requests</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">All access requests have been handled</p>
        </div>
      ) : (
        accessRequests.map(request => {
          const requesterName = request.requester?.full_name || 'Unknown'
          const initials = requesterName
            .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
          const target = request.target_team?.name || request.target_portfolio?.name
          const typeLabel = request.request_type === 'join_org'
            ? 'Join organization'
            : REQUEST_TYPE_LABELS[request.request_type]
              ?? request.request_type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

          return (
          /*
            Four zones, top to bottom: who, what, why, decide.

            This was one block — the name shared its row with a sentence
            fragment and both Buttons, so at 390px the name wrapped mid-word
            while an unlabelled red X sat beside it carrying the most
            consequential action on the screen. Nothing here is new data; it
            is the same fields, separated.
          */
          <Card key={request.id} className="p-3 sm:p-4 max-sm:shadow-none">
            {/* 1. Requester — owns its row. */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-semibold text-amber-700">
                {initials || <Clock className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {requesterName}
                </div>
                <div className="truncate text-[11px] text-gray-400">
                  {typeLabel} · {new Date(request.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </div>
              </div>
              {/* The only status these can have while listed is pending —
                  the query filters on it — so it is stated, not invented. */}
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                Pending
              </span>
            </div>

            {/* 2. What is being asked for. */}
            {target && (
              <div className="mt-2 flex items-center gap-1.5">
                {request.target_team
                  ? <Users className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  : <Briefcase className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                <span className="min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                  {target}
                </span>
              </div>
            )}

            {/* 3. Their message, as readable prose. Italicising a whole
                   paragraph makes it harder to read, not more quoted. */}
            {request.reason && <RequestMessage text={request.reason} />}

            {/* 4. The decision. Named, not an unlabelled glyph. */}
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmAction({
                  requestId: request.id,
                  status: 'rejected',
                  requesterName,
                  requestType: request.request_type,
                })}
                className="flex-1 text-red-600 hover:bg-red-50 sm:flex-none"
              >
                <XCircle className="w-4 h-4 mr-1" />
                Decline
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmAction({
                  requestId: request.id,
                  status: 'approved',
                  requesterName,
                  requestType: request.request_type,
                })}
                className="flex-1 sm:flex-none"
              >
                <Check className="w-4 h-4 mr-1" />
                Approve
              </Button>
            </div>
          </Card>
          )
        })
      )}

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setConfirmAction(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4 dark:bg-gray-800">
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
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  {confirmAction.status === 'approved' ? 'Approve' : 'Reject'} request?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
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
