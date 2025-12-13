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
            setUser(session.user)
          } else {
            setUser({ ...session.user, ...newProfile } as any)
          }
        } else if (fetchError) {
          console.warn('Failed to fetch user profile:', fetchError)
          setUser(session.user)
        } else {
          // User exists - just update email if it changed (don't overwrite names)
          if (existingProfile.email !== session.user.email) {
            await supabase
              .from('users')
              .update({ email: session.user.email })
              .eq('id', session.user.id)
          }
          // Merge auth user with profile data
          setUser({ ...session.user, ...existingProfile } as any)
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