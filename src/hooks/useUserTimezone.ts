/**
 * useUserTimezone — Returns the user's configured timezone.
 *
 * Priority:
 *   1. User's saved timezone from the DB (users.timezone)
 *   2. Browser's detected timezone (Intl.DateTimeFormat)
 *   3. 'America/New_York' as last resort
 *
 * Used by scheduling, display formatting, and automation rule computation.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'America/New_York'
  }
}

export function useUserTimezone(): string {
  const { user } = useAuth()

  const { data: savedTimezone } = useQuery({
    queryKey: ['user-timezone', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('timezone').eq('id', user!.id).single()
      return data?.timezone || null
    },
    enabled: !!user?.id,
    staleTime: 10 * 60_000, // Cache for 10 min
  })

  return savedTimezone || getBrowserTimezone()
}

/**
 * Non-hook version for use in DB functions and server-side contexts.
 * Fetches the timezone for a specific user ID.
 */
export async function getUserTimezone(userId: string): Promise<string> {
  const { data } = await supabase.from('users').select('timezone').eq('id', userId).single()
  return data?.timezone || 'America/New_York'
}
