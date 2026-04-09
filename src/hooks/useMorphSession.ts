import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface MorphSession {
  id: string
  admin_user_id: string
  target_user_id: string
  target_org_id: string
  target_email: string
  target_name: string
  reason: string
  started_at: string
  expires_at: string
  ended_at: string | null
  is_active: boolean
}

/**
 * Stores the admin's original org ID before morphing so we can restore it.
 * Stored in sessionStorage to survive React re-renders but not tab close.
 */
const MORPH_ORIGINAL_ORG_KEY = 'morph_original_org_id'

function saveOriginalOrg(orgId: string) {
  sessionStorage.setItem(MORPH_ORIGINAL_ORG_KEY, orgId)
}

function getOriginalOrg(): string | null {
  return sessionStorage.getItem(MORPH_ORIGINAL_ORG_KEY)
}

function clearOriginalOrg() {
  sessionStorage.removeItem(MORPH_ORIGINAL_ORG_KEY)
}

export function useMorphSession() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const currentOrgId = (user as any)?.current_organization_id ?? null

  // Check for active morph session
  const { data: activeSession } = useQuery({
    queryKey: ['morph-session', 'active', user?.id],
    queryFn: async (): Promise<MorphSession | null> => {
      const { data, error } = await supabase
        .from('morph_sessions')
        .select('*')
        .eq('admin_user_id', user!.id)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data as MorphSession | null
    },
    enabled: !!user?.id,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })

  // Start morph session — switches org to target user's org
  const startMorph = useMutation({
    mutationFn: async ({ targetUserId, reason, durationMinutes = 60 }: {
      targetUserId: string
      reason: string
      durationMinutes?: number
    }) => {
      // Save current org so we can restore later
      if (currentOrgId) saveOriginalOrg(currentOrgId)

      const { data, error } = await supabase.rpc('start_morph_session', {
        p_target_user_id: targetUserId,
        p_reason: reason,
        p_duration_minutes: durationMinutes,
      })
      if (error) throw error

      const session = data as any

      // Switch to the target user's org so RLS shows their data
      // Uses morph_switch_org which bypasses membership check but requires active morph session
      if (session?.target_org_id) {
        await supabase.rpc('morph_switch_org', { p_org_id: session.target_org_id })
      }

      return session as MorphSession
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morph-session'] })
      // Force full reload so all queries refetch with new org context
      window.location.href = '/dashboard'
    },
  })

  // End morph session — switches back to admin's original org
  const endMorph = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc('end_morph_session', {
        p_session_id: sessionId,
      })
      if (error) throw error

      // Restore original org
      const originalOrg = getOriginalOrg()
      if (originalOrg) {
        await supabase.rpc('morph_restore_org', { p_org_id: originalOrg })
        clearOriginalOrg()
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morph-session'] })
      // Force full reload to restore admin's view
      window.location.href = '/dashboard'
    },
  })

  const isMorphing = !!activeSession

  return {
    activeSession,
    isMorphing,
    startMorph,
    endMorph,
  }
}
