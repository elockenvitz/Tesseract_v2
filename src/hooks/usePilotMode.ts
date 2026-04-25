/**
 * usePilotMode — single source of truth for "is this session a pilot session?"
 * and "what can they see?".
 *
 * Pilot-ness is org-scoped: the currently selected org's
 * settings.pilot_mode drives everything. A user who is a pilot in one
 * client org sees the full app in any non-pilot org they belong to.
 *
 * Access config: starts from PILOT_ACCESS_DEFAULTS, merges any per-org
 * override at organizations.settings.pilot_access.
 */

import { useEffect, useMemo } from 'react'
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
  /** Best-effort "is pilot" that falls back to a cached hint from the
   *  previous session while the real query is still loading. Use this for
   *  UI gates that must stay stable across a cold refresh (e.g. hiding the
   *  "+" new-tab button, swapping pilot/non-pilot menus). Callers that need
   *  the authoritative value should use `isPilot` + `isLoading`. */
  effectiveIsPilot: boolean
  /** True once the user has committed ≥1 accepted_trade in the currently
   *  selected pilot org. Drives per-org unlocks for Trade Book / Outcomes
   *  and auto-dismiss of the Get Started banner after the first execute. */
  hasCommittedTradeInOrg: boolean
  /** True once the user has reached Outcomes — they've completed the
   *  pilot loop and now get the full app experience. */
  hasGraduated: boolean
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
  const { hasUnlockedTradeBook, hasUnlockedOutcomes, hasGraduated, isLoading: progressLoading } = usePilotProgress()

  // Cached hint from the previous session: was this user a pilot? Read
  // synchronously on mount so we can answer "is this a pilot session?"
  // consistently across a cold refresh, before the org-pilot-flags query
  // has resolved. Without it, pilot UI (hidden tabs, no "+" button) would
  // flash to the non-pilot state for ~200ms on every hard refresh.
  const cachedIsPilot = useMemo<boolean>(() => {
    if (!user?.id) return false
    try {
      return localStorage.getItem(`was_pilot_${user.id}`) === '1'
    } catch {
      return false
    }
  }, [user?.id])

  // Org pilot flag + access override — the only input to pilot-ness.
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

  // Has the user committed ≥1 accepted_trade in *this* org? Pilot unlocks
  // are otherwise stored in users.pilot_progress (user-scoped), so a pilot
  // who unlocked Trade Book / Outcomes in one pilot org would carry that
  // unlock into every subsequent pilot org they land in — defeating the
  // "locked until you complete a trade here" UX. Requiring at least one
  // committed trade in the current org gates unlocks per-org.
  const { data: hasCommittedTradeInOrg } = useQuery({
    queryKey: ['org-has-accepted-trade', currentOrgId, user?.id],
    enabled: !!currentOrgId && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      // accepted_trades is scoped through portfolio_id (no direct org_id
      // column), so we use an embedded filter on portfolios.organization_id.
      // `portfolios!inner` makes it a required join.
      const { data, error } = await supabase
        .from('accepted_trades')
        .select('id, portfolios!inner(organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
        .eq('accepted_by', user!.id)
        .limit(1)
      if (error) return false
      return (data?.length ?? 0) > 0
    }
  })

  const isPilot = !!orgFlags?.pilotMode
  const access = useMemo(() => {
    // Once the user has graduated, all pilot gating drops away —
    // they get the same access as a non-pilot user even though the
    // org may still be flagged as pilot. The graduation flag is set
    // when they reach Outcomes (see DecisionAccountabilityPage).
    if (!isPilot || hasGraduated) return PILOT_ACCESS_DEFAULTS
    const base = mergePilotAccess(orgFlags?.accessOverride)
    // Progressive unlocks layered on top of the org's static access map.
    // Unlock requires BOTH:
    //   (a) the user has completed at least one trade in THIS org, AND
    //   (b) the corresponding pilot_progress stage is marked.
    // The per-org gate ensures a fresh pilot org always starts locked,
    // even for a user who previously unlocked Trade Book in a different
    // pilot org. Never downgrade — if the org override says 'full',
    // leave it.
    const perOrgUnlocked = !!hasCommittedTradeInOrg
    if (perOrgUnlocked && hasUnlockedTradeBook && base.tradeBook === 'preview') base.tradeBook = 'full'
    if (perOrgUnlocked && hasUnlockedOutcomes && base.outcomes === 'preview') base.outcomes = 'full'
    return base
  }, [isPilot, hasGraduated, orgFlags?.accessOverride, hasUnlockedTradeBook, hasUnlockedOutcomes, hasCommittedTradeInOrg])

  const accessFor = (feature: keyof PilotAccessConfig) => access[feature]
  const canSee = (feature: keyof PilotAccessConfig) => access[feature] !== 'hidden'
  const canUse = (feature: keyof PilotAccessConfig) => access[feature] === 'full'

  const isLoading = orgLoading || progressLoading
  // Graduation overrides everything: the user has completed the loop
  // and earned the full app — render them as a non-pilot regardless
  // of org flag state.
  const effectiveIsPilot = isLoading
    ? (hasGraduated ? false : cachedIsPilot)
    : (hasGraduated ? false : isPilot)

  // Keep the cache fresh so the next cold refresh has the correct hint.
  useEffect(() => {
    if (isLoading || !user?.id) return
    try {
      localStorage.setItem(`was_pilot_${user.id}`, isPilot ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [isLoading, isPilot, user?.id])

  return {
    isPilot,
    isLoading,
    effectiveIsPilot,
    hasCommittedTradeInOrg: !!hasCommittedTradeInOrg,
    /** Once true, the user has finished the pilot loop and the app
     *  switches to the full experience (full dashboard, all tabs,
     *  no banners). The org may still be pilot-flagged for audit. */
    hasGraduated,
    access,
    accessFor,
    canSee,
    canUse,
  }
}
