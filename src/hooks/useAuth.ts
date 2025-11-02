import { useState, useEffect } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  const handleAuthSession = async (session: Session | null) => {
    setSession(session)

    // If user is authenticated, fetch full profile from public.users table
    if (session?.user) {
      try {
        // Use upsert to handle user record creation/update
        const { error: upsertError } = await supabase
          .from('users')
          .upsert({
            id: session.user.id,
            email: session.user.email,
          }, {
            onConflict: 'id',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.warn('Failed to upsert user record (non-blocking):', upsertError)
        }

        // Fetch full user profile including coverage_admin field
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (profileError) {
          console.warn('Failed to fetch user profile:', profileError)
          // Fall back to auth user only
          setUser(session.user)
        } else {
          // Merge auth user with profile data
          setUser({ ...session.user, ...profile } as any)
        }
      } catch (err) {
        console.warn('Network error handling user session (non-blocking):', err)
        // Fall back to auth user only
        setUser(session.user)
      }
    } else {
      setUser(null)
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
    
    // If signup successful, create user record with names
    if (data.user && !error) {
      try {
        const { error: insertError } = await supabase
          .from('users')
          .insert({
            id: data.user.id,
            email: data.user.email,
            first_name: firstName,
            last_name: lastName
          })

        if (insertError) {
          console.error('Failed to create user record with names:', insertError)
        }
      } catch (err) {
        console.error('Error creating user record:', err)
      }
    }
    
    return { data, error }
  }

  const signOut = async () => {
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