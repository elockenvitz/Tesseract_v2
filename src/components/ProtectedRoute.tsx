import React, { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { Lock, Clock, LogOut, ArrowRight, KeyRound } from 'lucide-react'
import { Button } from './ui/Button'
import { isInviteTokenShaped, readPendingInvite } from '../lib/invites'
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
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center dark:bg-gray-800">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-red-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">Access Required</h2>
          {routeOrgName && (
            <p className="text-sm text-gray-600 mb-1 font-medium dark:text-gray-400">{routeOrgName}</p>
          )}
          <p className="text-sm text-gray-500 mb-6 dark:text-gray-400">
            This organization requires an invitation to join. During Early Access
            invitations are issued by Tesseract — ask your Tesseract contact to
            send you one.
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
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center dark:bg-gray-800">
          <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">Request Sent</h2>
          {routeOrgName && (
            <p className="text-sm text-gray-600 mb-1 font-medium dark:text-gray-400">{routeOrgName}</p>
          )}
          <p className="text-sm text-gray-500 mb-6 dark:text-gray-400">
            Your request to join has been submitted and is pending admin approval. You'll be able to access the organization once approved.
          </p>
          <Button variant="outline" onClick={() => signOut()} className="w-full">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>
    )
  }

  // No-org screen.
  //
  // This is where an account with no workspace lands. It used to offer a
  // "paste invite code" box that called accept_org_invite directly — a second
  // acceptance path with its own error handling, reached by typing a secret
  // into a text field. It now forwards to /invite/:token, so there is exactly
  // one acceptance flow and it is the same one the emailed link opens.
  if (!hasOrg) {
    // Coming back from an email confirmation lands on "/" with the invitation
    // still parked. Send them to it rather than showing a dead end while a
    // perfectly good invitation is waiting.
    //
    // Scoped to the signed-in identity. Without that, a valid invitation for
    // someone else's address — left in this browser by an earlier arrival —
    // forwards THIS account to it, the address check refuses, and every return
    // to a no-workspace screen forwards it again for the life of the park
    // window. Passing the uid lets a pairing the invitation page has already
    // seen refused drop out of auto-routing, while leaving the invitation
    // itself intact for the person it was sent to.
    const parked = readPendingInvite(user?.id)
    if (parked && isInviteTokenShaped(parked)) {
      return <Navigate to={`/invite/${parked}`} replace />
    }

    const openInvite = () => {
      // Accept either the whole link or just the token — people paste both.
      const raw = inviteToken.trim()
      const token = raw.split('/').pop()?.split('?')[0] ?? ''
      if (!isInviteTokenShaped(token)) {
        setInviteError('That doesn’t look like an invitation link.')
        return
      }
      window.location.assign(`/invite/${token}`)
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center dark:bg-gray-800">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-7 h-7 text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">
            Professional Early Access
          </h2>
          <p className="text-sm text-gray-500 mb-6 dark:text-gray-400">
            Tesseract workspaces are set up by invitation. Open the invitation
            link from your email, or paste it below.
          </p>
          <div className="mb-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteToken}
                onChange={(e) => { setInviteToken(e.target.value); setInviteError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') openInvite() }}
                placeholder="Paste your invitation link"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:border-gray-600"
              />
              <Button onClick={openInvite} disabled={!inviteToken.trim()} className="shrink-0">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
            {inviteError && <p className="text-xs text-red-600 mt-1.5 text-left">{inviteError}</p>}
          </div>
          <Button variant="ghost" onClick={() => signOut()} className="w-full text-gray-500 dark:text-gray-400">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
