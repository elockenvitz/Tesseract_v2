import { useState, useEffect, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const USER_CACHE_KEY = 'auth-user-cache'

// Read cached user synchronously (outside hook to avoid re-reads)
function getCachedUser(): User | null {
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY)
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

export function useAuth() {
  // Initialize from cache for instant display
  const [user, setUser] = useState<User | null>(() => getCachedUser())
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

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
          // This happens for users who signed up before we had the users table
          const { error: insertError } = await supabase
            .from('users')
            .insert({
              id: session.user.id,
              email: session.user.email,
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
          const userData = { ...session.user, ...existingProfile } as any
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthSession(session)
    })

    return () => subscription.unsubscribe()
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
    })

    // If signup successful, create/update user record with names
    if (data.user && !error) {
      try {
        // Use upsert to handle both new users and existing users
        // This ensures first_name and last_name are always saved
        const { error: upsertError } = await supabase
          .from('users')
          .upsert({
            id: data.user.id,
            email: data.user.email,
            first_name: firstName,
            last_name: lastName
          }, {
            onConflict: 'id',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.error('Failed to save user record with names:', upsertError)
        } else {
          console.log('User record saved with names:', firstName, lastName)
        }
      } catch (err) {
        console.error('Error saving user record:', err)
      }
    }

    return { data, error }
  }

  const signOut = async () => {
    cacheUser(null) // Clear cache on sign out
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const resetPassword = async (email: string) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { data, error }
  }

  return {
    user,
    session,
    loading,
    signIn,
    signUp: signUpWithNames,
    signOut,
    resetPassword,
  }
}