import React, { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { Lock, Clock, LogOut, ArrowRight, Loader2, Mail } from 'lucide-react'
import { Button } from './ui/Button'
import { acceptInviteByToken } from '../lib/org-domain-routing'
import { supabase } from '../lib/supabase'
import { showBootLoader, hideBootLoader } from '../lib/boot-loader'
// ClientOnboardingWizard removed — new pilot orgs are auto-provisioned with the
// Tech & Consumer Growth template via the `seed_pilot_template_portfolio` RPC,
// so there's no interactive setup step for the admin to walk through.

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading: authLoading, isRecoverySession, signOut } = useAuth()
  const location = useLocation()
  const [inviteToken, setInviteToken] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)

  // Derived values (safe even if user is null)
  const currentOrgId = (user as any)?.current_organization_id ?? null
  const hasOrg = !!currentOrgId
  const isOpsRoute = location.pathname.startsWith('/ops')

  // ─── All hooks must be called unconditionally (Rules of Hooks) ───

  // Onboarding wizard path was removed — new pilot orgs land ready-to-use
  // via auto-seeded Tech & Consumer Growth template at provision time.

  // ─── Rendering logic (order matters: loading → auth → org → onboarding → app) ───

  // Boot-loader handoff. While auth is still resolving, keep the
  // persistent #tesseract-boot-loader (painted by index.html) visible
  // so the cold-refresh sequence reads as one continuous loading
  // state. Once we leave auth-loading we hand off to whatever the
  // route renders — either children (DashboardPage's gate fades it
  // once the pilot decision settles) or a terminal screen (login
  // redirect, blocked/pending/no-org), which is real content and
  // needs the loader gone immediately.
  const willRenderTerminal =
    !authLoading &&
    (
      !user ||
      isRecoverySession ||
      ((user as any)?._routeAction === 'blocked' && !hasOrg) ||
      ((user as any)?._routeAction === 'request_created' && !hasOrg) ||
      !hasOrg
    )
  useEffect(() => {
    if (authLoading) {
      showBootLoader('Loading…')
    } else if (willRenderTerminal) {
      hideBootLoader()
    } else if (isOpsRoute) {
      // Ops routes don't render DashboardPage, so DashboardPage's
      // hide effect never fires — without this branch the boot
      // loader sits over the Ops portal forever.
      hideBootLoader()
    }
    // children path (non-ops): DashboardPage owns the hide so the
    // fade lines up with the actual app paint.
  }, [authLoading, willRenderTerminal, isOpsRoute])
  if (authLoading) {
    return null
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Redirect to update-password if in a recovery session
  if (isRecoverySession) {
    return <Navigate to="/update-password" replace />
  }

  const routeAction = (user as any)?._routeAction as string | undefined
  const routeOrgName = (user as any)?._routeOrgName as string | undefined

  // Blocked screen — invite_only org, user has no org
  if (routeAction === 'blocked' && !hasOrg) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-red-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Access Required</h2>
          {routeOrgName && (
            <p className="text-sm text-gray-600 mb-1 font-medium">{routeOrgName}</p>
          )}
          <p className="text-sm text-gray-500 mb-6">
            This organization requires an invitation to join. Contact your organization administrator to request access.
          </p>
          <Button variant="outline" onClick={() => signOut()} className="w-full">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>
    )
  }

  // Pending screen — approval_required org, request submitted
  if (routeAction === 'request_created' && !hasOrg) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Request Sent</h2>
          {routeOrgName && (
            <p className="text-sm text-gray-600 mb-1 font-medium">{routeOrgName}</p>
          )}
          <p className="text-sm text-gray-500 mb-6">
            Your request to join has been submitted and is pending admin approval. You'll be able to access the organization once approved.
          </p>
          <Button variant="outline" onClick={() => signOut()} className="w-full">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>
    )
  }

  // No-org screen — user has no org and no domain match
  if (!hasOrg) {
    const handleAcceptInvite = async () => {
      const trimmed = inviteToken.trim()
      if (!trimmed) return
      setInviteError(null)
      setInviteLoading(true)
      try {
        const { organization_id, error } = await acceptInviteByToken(trimmed, user!.id)
        if (error) {
          setInviteError(error)
        } else if (organization_id) {
          setInviteSuccess(true)
          setTimeout(() => window.location.reload(), 800)
        }
      } finally {
        setInviteLoading(false)
      }
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-7 h-7 text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Invite Required</h2>
          <p className="text-sm text-gray-500 mb-6">
            You need an invitation to join an organization. Ask your admin to invite you, or paste your invite code below.
          </p>
          {inviteSuccess ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 mb-4">
              <p className="text-sm font-medium text-green-800">Invite accepted! Redirecting...</p>
            </div>
          ) : (
            <div className="mb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inviteToken}
                  onChange={(e) => { setInviteToken(e.target.value); setInviteError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAcceptInvite() }}
                  placeholder="Paste invite code"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={inviteLoading}
                />
                <Button onClick={handleAcceptInvite} disabled={!inviteToken.trim() || inviteLoading} className="shrink-0">
                  {inviteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                </Button>
              </div>
              {inviteError && <p className="text-xs text-red-600 mt-1.5 text-left">{inviteError}</p>}
            </div>
          )}
          <Button variant="ghost" onClick={() => signOut()} className="w-full text-gray-500">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
