import { useState, useEffect, useCallback, useRef } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { routeOrgByEmail, autoAcceptPendingInvites, titleCase } from '../lib/org-domain-routing'

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

          // Route org if user has no current org set
          if (!userData.current_organization_id && !orgRouteAttemptedRef.current) {
            orgRouteAttemptedRef.current = true

            // Step A: Auto-accept any pending invites matching this email
            const inviteResult = await autoAcceptPendingInvites()
            if (inviteResult.accepted_count > 0) {
              // Re-fetch profile (now has current_organization_id)
              const { data: refreshed } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single()
              if (refreshed) {
                userData = { ...userData, ...refreshed }
              }
              // Dispatch auto-join event for toast
              if (inviteResult.org_name) {
                window.dispatchEvent(new CustomEvent('org-auto-joined', {
                  detail: { orgName: inviteResult.org_name },
                }))
              }
            }

            // Step B: If still no org, try domain-based routing
            if (!userData.current_organization_id) {
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
            }

            // Step C: If still no org after both steps, mark as no_org
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

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  const signUpWithNames = async (email: string, password: string, firstName: string, lastName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: titleCase(firstName), last_name: titleCase(lastName) }
      }
    })

    // If signup successful, create/update user record with names
    if (data.user && !error) {
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
    signOut,
    resetPassword,
    updatePassword,
  }
}