/**
 * usePilotMode — single source of truth for "is this session a pilot session?"
 * and "what can they see?".
 *
 * Resolution order (OR-combined):
 *   - users.is_pilot_user = true
 *   - current org's settings.pilot_mode = true
 *
 * Access config: starts from PILOT_ACCESS_DEFAULTS, merges any per-org
 * override at organizations.settings.pilot_access.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { usePilotProgress } from './usePilotProgress'
import {
  mergePilotAccess,
  PILOT_ACCESS_DEFAULTS,
  type PilotAccessConfig,
  type PilotAccessLevel,
} from '../lib/pilot/pilot-access'

export interface PilotModeState {
  /** True if user or org marks this session as pilot. */
  isPilot: boolean
  /** True while flags/org data is still loading. Callers should generally
   *  treat "still loading" as NOT in pilot to avoid flashing restricted UI. */
  isLoading: boolean
  /** Resolved per-feature access config. Defaults when not in pilot. */
  access: PilotAccessConfig
  /** Shortcut: is a given feature 'full' | 'preview' | 'hidden'? */
  accessFor: (feature: keyof PilotAccessConfig) => PilotAccessLevel
  /** Is a given feature effectively usable (not hidden)? */
  canSee: (feature: keyof PilotAccessConfig) => boolean
  /** Is a given feature fully accessible (not preview, not hidden)? */
  canUse: (feature: keyof PilotAccessConfig) => boolean
}

export function usePilotMode(): PilotModeState {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const { hasUnlockedTradeBook, hasUnlockedOutcomes, isLoading: progressLoading } = usePilotProgress()

  // Per-user pilot flag (small, fast query). Cached aggressively since it
  // changes rarely.
  const { data: userFlag, isLoading: userLoading } = useQuery({
    queryKey: ['user-is-pilot', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('is_pilot_user')
        .eq('id', user!.id)
        .maybeSingle()
      if (error) return null
      return !!data?.is_pilot_user
    }
  })

  // Org pilot flag + access override
  const { data: orgFlags, isLoading: orgLoading } = useQuery({
    queryKey: ['org-pilot-flags', currentOrgId],
    enabled: !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', currentOrgId!)
        .maybeSingle()
      if (error) return null
      const settings = (data?.settings ?? {}) as Record<string, any>
      return {
        pilotMode: !!settings.pilot_mode,
        accessOverride: (settings.pilot_access ?? null) as Partial<PilotAccessConfig> | null,
      }
    }
  })

  const isPilot = !!userFlag || !!orgFlags?.pilotMode
  const access = useMemo(() => {
    if (!isPilot) return PILOT_ACCESS_DEFAULTS
    const base = mergePilotAccess(orgFlags?.accessOverride)
    // Progressive unlocks layered on top of the org's static access map:
    //   - After the user's first "View in Trade Book" from the Decision
    //     Recorded modal, raise tradeBook preview→full.
    //   - After the user has opened Trade Book at least once with committed
    //     trades visible, raise outcomes preview→full.
    // Never downgrade here — if the org override says 'full', leave it.
    if (hasUnlockedTradeBook && base.tradeBook === 'preview') base.tradeBook = 'full'
    if (hasUnlockedOutcomes && base.outcomes === 'preview') base.outcomes = 'full'
    return base
  }, [isPilot, orgFlags?.accessOverride, hasUnlockedTradeBook, hasUnlockedOutcomes])

  const accessFor = (feature: keyof PilotAccessConfig) => access[feature]
  const canSee = (feature: keyof PilotAccessConfig) => access[feature] !== 'hidden'
  const canUse = (feature: keyof PilotAccessConfig) => access[feature] === 'full'

  return {
    isPilot,
    isLoading: userLoading || orgLoading || progressLoading,
    access,
    accessFor,
    canSee,
    canUse,
  }
}
