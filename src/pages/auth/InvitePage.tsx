/**
 * InvitePage — /invite/:token
 *
 * The single front door for Early Access. A platform admin creates an
 * invitation in the Ops portal and sends this link; everything a recipient
 * needs to get from "I have a link" to "I am in the workspace" happens here.
 *
 * The page is a real route, not a modal or a query-string mode, for three
 * reasons: the link has to survive a refresh, it has to survive the round-trip
 * through email confirmation, and it has to be openable on a phone from a mail
 * client.
 *
 * The confirmation round-trip is the demanding one, and it is why the token is
 * carried three ways rather than one. It lives in the URL, which covers refresh
 * and history. It is handed to Supabase as the signup `emailRedirectTo`, so the
 * confirmation link IS this page — which is the only mechanism that survives
 * the recipient opening their mail on a different browser or a different
 * device. And it is parked in browser-local storage, which covers the case
 * where a mail client rewrites the link. See `src/lib/invites.ts`.
 *
 * Nothing here is a security boundary. Every branch below is a courtesy to the
 * person reading it; the enforcement is in accept_org_invite(), which checks
 * the token, the authenticated identity, that identity's confirmation state,
 * and the invitation's own state on its own.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, ShieldCheck, Clock, Ban, LogOut, CheckCircle2 } from 'lucide-react'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useAuth } from '../../hooks/useAuth'
import { hideBootLoader } from '../../lib/boot-loader'
import {
  acceptInvite,
  getInvitePreview,
  clearPendingInvite,
  inviteConfirmationRedirect,
  markPendingInviteMismatch,
  stashPendingInvite,
  type InvitePreview,
} from '../../lib/invites'

const credentialsSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type CredentialsData = z.infer<typeof credentialsSchema>

const signInSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})
type SignInData = z.infer<typeof signInSchema>

type Mode = 'signin' | 'signup'

/**
 * Supabase's per-address send cooldown (`smtp_max_frequency`) is 60 seconds.
 * The button counts it down rather than letting the person find out by being
 * refused — a resend that silently errors reads as "the email is broken".
 */
const RESEND_COOLDOWN_SECONDS = 60

/**
 * Does this sign-in failure mean "the address is right, the mailbox is
 * unproven"?
 *
 * Worth being explicit about why this case exists at all. With email
 * confirmation on, Supabase refuses a session to an unconfirmed identity, so
 * the person who created an account and never opened the email cannot sign in
 * — and cannot accept, and cannot re-signup (the address is taken). Read as a
 * bad password, it is a dead end. Read correctly, it is one resend away from
 * done.
 *
 * Matched on the stable error code first, with the message as a fallback for
 * older gotrue builds that only set the string.
 */
function isUnconfirmedEmailError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'email_not_confirmed') return true
  return /email\s*not\s*confirmed|confirm(ed)?\s+your\s+email/i.test(error.message ?? '')
}

export function InvitePage() {
  const { token = '' } = useParams<{ token: string }>()
  // Navigation out of this page is always a full document load, never a
  // client-side push: acceptance changes membership, current organization and
  // the cached auth user, and the app's query cache was populated when all
  // three were something else.
  const { user, loading: authLoading, signIn, signUp, signOut, resendConfirmation } = useAuth()

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [mode, setMode] = useState<Mode>('signup')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 'sent' after we asked for a confirmation email, 'blocked' when we found out
  // from a refused sign-in or a refused acceptance that one is still needed.
  // The two say different things to the reader and reach the same screen.
  const [awaitingConfirmation, setAwaitingConfirmation] =
    useState<null | 'sent' | 'blocked'>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendNote, setResendNote] = useState<string | null>(null)

  useEffect(() => { hideBootLoader() }, [])

  // Park the token for the auth round-trip. If the recipient has to confirm an
  // email or gets bounced through /login, this is what brings them back.
  useEffect(() => { if (token) stashPendingInvite(token) }, [token])

  useEffect(() => {
    let cancelled = false
    getInvitePreview(token).then((p) => {
      if (cancelled) return
      setPreview(p)
      // A token that will never work should not sit in browser storage waiting
      // to hijack the next arrival at the no-workspace screen. `already_accepted`
      // is deliberately included: that journey is over either way.
      if (!p.valid) clearPendingInvite()
    })
    return () => { cancelled = true }
  }, [token])

  // The resend cooldown, ticking. Cleared on unmount so a backgrounded tab is
  // not holding an interval open.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = window.setInterval(() => setResendCooldown((n) => (n > 0 ? n - 1 : 0)), 1000)
    return () => window.clearInterval(id)
  }, [resendCooldown])

  // Where Supabase should land the recipient after they click the link in the
  // confirmation email: this exact invitation, so the round-trip closes even in
  // a browser that has never seen this flow.
  const confirmationRedirect = inviteConfirmationRedirect(token) ?? undefined

  const invitedEmail = preview?.email ?? null
  const signedInEmail = user?.email?.toLowerCase() ?? null
  const emailMatches = !!invitedEmail && signedInEmail === invitedEmail.toLowerCase()

  // A valid invitation, a signed-in account, and an address that is not the
  // invited one. accept_org_invite() would refuse this pairing every time, so
  // record it and stop auto-routing this account here — otherwise a shared
  // browser sends it back to this screen from every no-workspace screen until
  // the park window expires.
  //
  // The invitation is marked, not discarded. The person it was sent to may be
  // the very next one to sign in on this browser — quite likely, since the
  // "sign out and switch account" button below is the intended exit — and the
  // token has to still be here for them.
  useEffect(() => {
    if (preview?.valid && user?.id && signedInEmail && !emailMatches) {
      markPendingInviteMismatch(token, user.id)
    }
  }, [preview?.valid, user?.id, signedInEmail, emailMatches, token])

  const runAccept = useCallback(async () => {
    setBusy(true)
    setFormError(null)
    const result = await acceptInvite(token)
    if (result.error) {
      // The server refused because the identity is unconfirmed. That is not an
      // error to report and leave them with — it is the one state on this page
      // with an obvious next action, so send them to the screen that offers it.
      if (result.needsEmailConfirmation) {
        setAwaitingConfirmation('blocked')
        setBusy(false)
        return
      }
      setFormError(result.error)
      setBusy(false)
      return
    }
    clearPendingInvite()
    // Full reload rather than a client-side navigate: membership, current org
    // and the cached auth user all changed underneath the running app, and the
    // dashboard's queries are keyed on values that were null a moment ago.
    window.location.assign('/dashboard')
  }, [token])

  // Signed in as the invited address with a valid invitation — accept it
  // without making them press a second button. Idempotent server-side, so a
  // refresh mid-flight is harmless.
  useEffect(() => {
    if (
      !authLoading && preview?.valid && emailMatches &&
      !busy && !formError && awaitingConfirmation === null
    ) {
      void runAccept()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, preview?.valid, emailMatches])

  const credentialsForm = useForm<CredentialsData>({ resolver: zodResolver(credentialsSchema) })
  const signInForm = useForm<SignInData>({ resolver: zodResolver(signInSchema) })

  const onCreateAccount = async (data: CredentialsData) => {
    if (!invitedEmail) return
    setBusy(true)
    setFormError(null)
    const { data: result, error } = await signUp(
      invitedEmail, data.password, data.firstName, data.lastName,
      { emailRedirectTo: confirmationRedirect }
    )
    if (error) {
      setFormError(
        /already registered/i.test(error.message)
          ? 'You already have an account with this address — sign in instead.'
          : error.message
      )
      setBusy(false)
      if (/already registered/i.test(error.message)) setMode('signin')
      return
    }
    // No session means Supabase wants the mailbox proven before it issues one.
    // The confirmation link it just sent points back at this exact invitation
    // (`emailRedirectTo` above), so the round-trip closes wherever they open it.
    //
    // This is also the shape Supabase returns for an address that is already
    // registered but unconfirmed — it resends rather than leaking that the
    // account exists — which is the right outcome, and the same screen.
    if (!result?.session) {
      setAwaitingConfirmation('sent')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setBusy(false)
      return
    }
    // With a session in hand the accept effect above takes over once useAuth
    // settles; keep the button busy until then.
  }

  const onSignIn = async (data: SignInData) => {
    if (!invitedEmail) return
    setBusy(true)
    setFormError(null)
    const { error } = await signIn(invitedEmail, data.password)
    if (error) {
      // Right password, unproven mailbox. Supabase refuses the session, and
      // without this branch the person reads "email not confirmed" as a
      // password problem and tries again forever.
      if (isUnconfirmedEmailError(error)) {
        setAwaitingConfirmation('blocked')
        setBusy(false)
        return
      }
      setFormError(error.message)
      setBusy(false)
    }
  }

  const onResend = async () => {
    if (!invitedEmail || resendCooldown > 0) return
    setResendNote(null)
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
    const { error } = await resendConfirmation(invitedEmail, confirmationRedirect)
    setResendNote(
      error
        ? // Almost always the per-address send cooldown. Say what to do, not
          // what the API called it.
          'We couldn’t send another one just yet — wait a minute and try again.'
        : `Sent again to ${invitedEmail}.`
    )
  }

  // ── terminal states ───────────────────────────────────────────────────────

  if (!preview) {
    return (
      <AuthLayout title="Checking your invitation…">
        <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">One moment.</div>
      </AuthLayout>
    )
  }

  if (!preview.valid) {
    const { icon, title, body } = invalidCopy(preview)
    return (
      <AuthLayout title={title}>
        <div className="text-center space-y-4 py-2">
          <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto">
            {icon}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{body}</p>
          {preview.reason === 'already_accepted' && preview.acceptedByYou ? (
            <Button className="w-full" onClick={() => window.location.assign('/dashboard')}>
              Go to Tesseract
            </Button>
          ) : (
            <Link
              to="/login"
              className="inline-block text-sm font-medium text-primary-600 hover:text-primary-500"
            >
              Go to sign in
            </Link>
          )}
        </div>
      </AuthLayout>
    )
  }

  // The verification gate. Everything that discovers "this mailbox is not yet
  // proven" lands here: a signup that returned no session, a sign-in Supabase
  // refused, and an acceptance the database refused. It is the only screen on
  // this page that is a waiting room rather than a dead end, so it carries the
  // action that ends the wait.
  if (awaitingConfirmation) {
    return (
      <AuthLayout title="Confirm your email">
        <div className="text-center space-y-4 py-2">
          <div className="w-14 h-14 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mx-auto">
            <Mail className="w-7 h-7 text-primary-600" />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {awaitingConfirmation === 'sent' ? (
              <>
                We sent a confirmation link to{' '}
                <span className="font-medium break-all">{invitedEmail}</span>. Open it to
                finish joining {preview.orgName}.
              </>
            ) : (
              <>
                Before you can join {preview.orgName}, confirm that{' '}
                <span className="font-medium break-all">{invitedEmail}</span> is your
                address. Open the link in the confirmation email, or send a new one.
              </>
            )}
          </p>
          <p className="text-xs text-gray-400">
            The link brings you back to this invitation — you can close this tab, and it
            works on another device.
          </p>

          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              disabled={resendCooldown > 0}
              onClick={() => void onResend()}
            >
              {resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : 'Resend confirmation email'}
            </Button>
            {resendNote && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{resendNote}</p>
            )}
          </div>

          {/* An address that is already confirmed gets no new email — Supabase
              will not say so, to avoid confirming the account exists. This is
              the way out of that corner for someone who simply forgot they had
              an account.

              Two exits, because there are two ways to be here. Without a
              session the answer is the sign-in form. WITH one — reachable only
              if the acceptance was refused for confirmation while a session
              existed — the answer is to try the acceptance again, because
              dismissing to a form they are already past would leave them on a
              screen with nothing happening. */}
          <button
            type="button"
            onClick={() => {
              setAwaitingConfirmation(null)
              setResendNote(null)
              setFormError(null)
              if (user && emailMatches) void runAccept()
              else setMode('signin')
            }}
            className="text-sm font-medium text-primary-600 hover:text-primary-500"
          >
            {user && emailMatches ? 'Already confirmed? Try again' : 'Already confirmed? Sign in'}
          </button>
        </div>
      </AuthLayout>
    )
  }

  // Signed in as somebody else. The server would refuse this anyway (P0022);
  // saying so plainly beats letting them press a button that cannot work.
  if (user && !emailMatches) {
    return (
      <AuthLayout title="Wrong account">
        <div className="text-center space-y-4 py-2">
          <div className="w-14 h-14 rounded-full bg-warning-50 dark:bg-warning-900/30 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-7 h-7 text-warning-600" />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This invitation was sent to <span className="font-medium">{invitedEmail}</span>, but
            you're signed in as <span className="font-medium">{signedInEmail}</span>.
          </p>
          <Button variant="outline" className="w-full" onClick={() => signOut()}>
            <LogOut className="w-4 h-4 mr-2" /> Sign out and switch account
          </Button>
        </div>
      </AuthLayout>
    )
  }

  // Signed in as the right person — the accept effect is running.
  if (user && emailMatches) {
    return (
      <AuthLayout title={`Joining ${preview.orgName}…`}>
        <div className="text-center space-y-4 py-2">
          <div className="w-14 h-14 rounded-full bg-success-50 dark:bg-success-900/30 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7 text-success-600" />
          </div>
          {formError ? (
            <>
              <p className="text-sm text-error-600">{formError}</p>
              <Button className="w-full" onClick={() => { setFormError(null); void runAccept() }}>
                Try again
              </Button>
            </>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">Setting up your workspace.</p>
          )}
        </div>
      </AuthLayout>
    )
  }

  // ── signed out: create the account, or sign in ────────────────────────────

  return (
    <AuthLayout
      title={`You're invited to ${preview.orgName}`}
      subtitle="Tesseract Professional Early Access"
    >
      <div className="space-y-6">
        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5 text-sm">
          <span className="text-gray-500 dark:text-gray-400">Invitation for </span>
          <span className="font-medium text-gray-900 dark:text-white break-all">{invitedEmail}</span>
        </div>

        {formError && (
          <div className="bg-error-50 border border-error-200 text-error-700 dark:bg-error-900/30 dark:border-error-800 dark:text-error-300 px-4 py-3 rounded-lg text-sm">
            {formError}
          </div>
        )}

        {mode === 'signup' ? (
          <form onSubmit={credentialsForm.handleSubmit(onCreateAccount)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First name"
                autoComplete="given-name"
                {...credentialsForm.register('firstName')}
                error={credentialsForm.formState.errors.firstName?.message}
              />
              <Input
                label="Last name"
                autoComplete="family-name"
                {...credentialsForm.register('lastName')}
                error={credentialsForm.formState.errors.lastName?.message}
              />
            </div>
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              {...credentialsForm.register('password')}
              error={credentialsForm.formState.errors.password?.message}
            />
            <Button type="submit" loading={busy} className="w-full">
              Create account and join
            </Button>
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setMode('signin'); setFormError(null) }}
                className="font-medium text-primary-600 hover:text-primary-500"
              >
                Sign in
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={signInForm.handleSubmit(onSignIn)} className="space-y-5">
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              {...signInForm.register('password')}
              error={signInForm.formState.errors.password?.message}
            />
            <Button type="submit" loading={busy} className="w-full">
              Sign in and join
            </Button>
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              Need an account?{' '}
              <button
                type="button"
                onClick={() => { setMode('signup'); setFormError(null) }}
                className="font-medium text-primary-600 hover:text-primary-500"
              >
                Create one
              </button>
            </p>
          </form>
        )}
      </div>
    </AuthLayout>
  )
}

function invalidCopy(preview: InvitePreview): { icon: JSX.Element; title: string; body: string } {
  switch (preview.reason) {
    case 'expired':
      return {
        icon: <Clock className="w-7 h-7 text-gray-500" />,
        title: 'This invitation has expired',
        body: `Ask your Tesseract contact to send a new invitation${preview.orgName ? ` to ${preview.orgName}` : ''}.`,
      }
    case 'revoked':
      return {
        icon: <Ban className="w-7 h-7 text-gray-500" />,
        title: 'This invitation is no longer valid',
        body: 'It was withdrawn. Ask your Tesseract contact for a new invitation.',
      }
    case 'already_accepted':
      return {
        icon: <CheckCircle2 className="w-7 h-7 text-success-600" />,
        title: preview.acceptedByYou ? "You've already joined" : 'This invitation has been used',
        body: preview.acceptedByYou
          ? `You're already a member of ${preview.orgName}.`
          : 'This invitation has already been accepted. Sign in with the invited address.',
      }
    default:
      return {
        icon: <Mail className="w-7 h-7 text-gray-500" />,
        title: "We couldn't find that invitation",
        body: 'Check that you opened the most recent link, or ask your Tesseract contact to resend it.',
      }
  }
}
