import { useState, useEffect, useCallback, useRef } from 'react'
import * as Sentry from '@sentry/react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { routeOrgByEmail, titleCase } from '../lib/org-domain-routing'

const USER_CACHE_KEY = 'auth-user-cache'
const RECOVERY_SESSION_KEY = 'auth-recovery-session'

// Read cached user synchronously (outside hook to avoid re-reads)
function getCachedUser(): User | null {
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY)
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

// Check if this page load is a password recovery redirect
function detectRecoveryFromUrl(): boolean {
  // Supabase PKCE: /update-password?code=XXX (code param on the recovery page)
  if (window.location.pathname === '/update-password' && new URLSearchParams(window.location.search).has('code')) {
    return true
  }
  // Supabase implicit flow: #type=recovery in hash
  if (window.location.hash.includes('type=recovery')) {
    return true
  }
  // Previously flagged recovery session that hasn't been completed yet
  try {
    return sessionStorage.getItem(RECOVERY_SESSION_KEY) === 'true'
  } catch {
    return false
  }
}

export function useAuth() {
  // Initialize from cache for instant display
  const [user, setUser] = useState<User | null>(() => getCachedUser())
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRecoverySession, setIsRecoverySession] = useState(() => detectRecoveryFromUrl())
  const orgRouteAttemptedRef = useRef(false)

  // Cache user to localStorage
  const cacheUser = useCallback((userData: User | null) => {
    try {
      if (userData) {
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData))
      } else {
        localStorage.removeItem(USER_CACHE_KEY)
      }
    } catch {
      // Ignore storage errors
    }
  }, [])

  const handleAuthSession = async (session: Session | null) => {
    setSession(session)

    // If user is authenticated, fetch full profile from public.users table
    if (session?.user) {
      try {
        // First, try to fetch existing user profile
        const { data: existingProfile, error: fetchError } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (fetchError && fetchError.code === 'PGRST116') {
          // User doesn't exist in public.users table - create them
          // Pull names from user_metadata if available (set during signup)
          const meta = session.user.user_metadata || {}
          const { error: insertError } = await supabase
            .from('users')
            .insert({
              id: session.user.id,
              email: session.user.email,
              first_name: meta.first_name || null,
              last_name: meta.last_name || null,
            })

          if (insertError) {
            console.warn('Failed to create user record (non-blocking):', insertError)
          }

          // Fetch the newly created profile
          const { data: newProfile, error: newFetchError } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single()

          if (newFetchError) {
            console.warn('Failed to fetch new user profile:', newFetchError)
            const userData = session.user
            setUser(userData)
            cacheUser(userData)
          } else {
            const userData = { ...session.user, ...newProfile } as any
            setUser(userData)
            cacheUser(userData)
          }
        } else if (fetchError) {
          console.warn('Failed to fetch user profile:', fetchError)
          const userData = session.user
          setUser(userData)
          cacheUser(userData)
        } else {
          // User exists - just update email if it changed (don't overwrite names)
          if (existingProfile.email !== session.user.email) {
            await supabase
              .from('users')
              .update({ email: session.user.email })
              .eq('id', session.user.id)
          }
          // Merge auth user with profile data
          let userData = { ...session.user, ...existingProfile } as any

          // Route org if user has no current org set.
          //
          // There used to be a step before this one: auto_accept_pending_invites(),
          // which joined the user to any organization with a pending invitation
          // matching their email address. It has been retired — an email string
          // match is not evidence that the person controls the mailbox, and with
          // open signup and autoconfirm it was a way to walk into someone else's
          // workspace as an org admin. Invitations are now claimed only by
          // presenting the token, on /invite/:token.
          if (!userData.current_organization_id && !orgRouteAttemptedRef.current) {
            orgRouteAttemptedRef.current = true

            // Domain-based routing for organizations that opt into it.
            const { profile, routeResult } = await routeOrgByEmail(session.user.email!, session.user.id)
            if (profile) {
              userData = { ...userData, ...profile }
            }
            // Attach route metadata for downstream screens (blocked/pending)
            userData._routeAction = routeResult.action
            userData._routeOrgName = routeResult.org_name
            // Dispatch auto-join event for toast
            if (routeResult.action === 'auto_join' && routeResult.org_name) {
              window.dispatchEvent(new CustomEvent('org-auto-joined', {
                detail: { orgName: routeResult.org_name },
              }))
            }

            if (!userData.current_organization_id && !userData._routeAction) {
              userData._routeAction = 'no_org'
            }
          }

          setUser(userData)
          cacheUser(userData)
        }
      } catch (err) {
        console.warn('Network error handling user session (non-blocking):', err)
        // Fall back to auth user only
        const userData = session.user
        setUser(userData)
        cacheUser(userData)
      }
    } else {
      setUser(null)
      cacheUser(null)
      orgRouteAttemptedRef.current = false
    }

    setLoading(false)
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleAuthSession(session)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoverySession(true)
        try { sessionStorage.setItem(RECOVERY_SESSION_KEY, 'true') } catch {}
      }
      handleAuthSession(session)
    })

    // Listen for org-switched event — re-read localStorage to update React state.
    // Kept for any non-reload callers (e.g. background session refresh). The
    // main switchOrg path now does a full page reload, so in practice this
    // handler rarely fires in that flow.
    const handleOrgSwitched = () => {
      const cached = getCachedUser()
      if (cached) setUser(cached)
    }
    window.addEventListener('org-switched', handleOrgSwitched)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('org-switched', handleOrgSwitched)
    }
  }, [])

  // Mirror the React user into Sentry's user context so every captured
  // event is attributed to a specific pilot. Cleared on sign-out so a
  // shared browser doesn't leak the previous user into the next session.
  useEffect(() => {
    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.email ?? undefined,
      })
      const orgId = (user as any).current_organization_id
      Sentry.setTag('organization_id', orgId ?? 'none')
    } else {
      Sentry.setUser(null)
      Sentry.setTag('organization_id', undefined)
    }
  }, [user])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  /**
   * Create an account.
   *
   * `emailRedirectTo` is where Supabase sends the recipient after they click
   * the link in the confirmation email. It is optional here and supplied by
   * the caller, because only the caller knows where the person was going —
   * /invite/:token passes its own route so the confirmation round-trip lands
   * back on the invitation rather than on a generic dashboard.
   *
   * Omitting it is not neutral: Supabase then redirects to the project's
   * `site_url`, which is how a confirmed invitee used to end up on a
   * "no workspace" screen with a perfectly good invitation they could no
   * longer reach. The URL must also appear in the project's redirect
   * allow-list or the auth service ignores it and falls back to `site_url`
   * anyway — silently, with no error on this call.
   */
  const signUpWithNames = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    options?: { emailRedirectTo?: string }
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: titleCase(firstName), last_name: titleCase(lastName) },
        ...(options?.emailRedirectTo ? { emailRedirectTo: options.emailRedirectTo } : {}),
      }
    })

    // If signup successful AND we hold a session, create/update the user record
    // with names.
    //
    // The session check is what makes this correct once email confirmation is
    // required. Without a session the caller is still `anon`, every policy on
    // public.users refuses the write, and this becomes a guaranteed failure
    // logged as an error on the happy path of every new signup. There is
    // nothing to recover from: `handleAuthSession` creates the profile row from
    // `user_metadata` on the first real sign-in, which is exactly where the
    // names were just stored.
    if (data.user && data.session && !error) {
      try {
        // Normalize names: "JEFFREY" → "Jeffrey"
        const normalizedFirst = titleCase(firstName)
        const normalizedLast = titleCase(lastName)

        // Use upsert to handle both new users and existing users
        // This ensures first_name and last_name are always saved
        const { error: upsertError } = await supabase
          .from('users')
          .upsert({
            id: data.user.id,
            email: data.user.email,
            first_name: normalizedFirst,
            last_name: normalizedLast
          }, {
            onConflict: 'id',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.error('Failed to save user record with names:', upsertError)
        } else {
        }
      } catch (err) {
        console.error('Error saving user record:', err)
      }
    }

    return { data, error }
  }

  /**
   * Re-send the signup confirmation email.
   *
   * The recipient who closes the tab, loses the mail, or lands in a spam
   * folder has no other way forward: they cannot sign in (an unconfirmed
   * identity is refused a session) and they cannot accept their invitation
   * (accept_org_invite refuses an unconfirmed identity). Without this the only
   * remedy is asking a platform admin to intervene.
   *
   * Supabase enforces its own per-address cooldown (`smtp_max_frequency`,
   * 60s), so callers should rate-limit the button rather than let the person
   * discover the limit as an error.
   */
  const resendConfirmation = async (email: string, emailRedirectTo?: string) => {
    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email,
      ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}),
    })
    return { data, error }
  }

  const signOut = async () => {
    cacheUser(null)
    try { sessionStorage.removeItem(RECOVERY_SESSION_KEY) } catch {}
    // Clear tab state so the next user doesn't inherit stale tabs
    try {
      const { TabStateManager } = await import('../lib/tabStateManager')
      TabStateManager.clearAll()
    } catch {}
    setIsRecoverySession(false)
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const resetPassword = async (email: string) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    })
    return { data, error }
  }

  const updatePassword = async (newPassword: string) => {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    if (!error) {
      setIsRecoverySession(false)
      try { sessionStorage.removeItem(RECOVERY_SESSION_KEY) } catch {}
    }
    return { data, error }
  }

  return {
    user,
    session,
    loading,
    isRecoverySession,
    signIn,
    signUp: signUpWithNames,
    resendConfirmation,
    signOut,
    resetPassword,
    updatePassword,
  }
}