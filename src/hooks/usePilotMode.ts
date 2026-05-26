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

import { useEffect, useMemo, useRef } from 'react'
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
  /** True ONLY for first-time logins where we have no cached pilot hint
   *  to fall back on AND the real query hasn't resolved yet. UI that
   *  swings between pilot and non-pilot dashboards (e.g. DashboardPage)
   *  should render a neutral skeleton in this window — both
   *  `effectiveIsPilot=true` and `effectiveIsPilot=false` are best-guesses
   *  with no information backing them. */
  isInitialResolve: boolean
  /** True once the per-feature access decision is trustworthy on this
   *  paint. False during the cold-load window where the unlock queries
   *  haven't returned AND we have no localStorage cache to fall back on.
   *  Pilot-aware surfaces (Trade Book / Outcomes preview gating, System
   *  Loop active stage) should hold a neutral render until this flips
   *  true; otherwise they flash the wrong gate state for ~200ms before
   *  snapping to the right one. */
  accessIsReady: boolean
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
  const { hasUnlockedTradeBook, hasUnlockedOutcomes, hasGraduated, cachedHasGraduated, isLoading: progressLoading, hasReadyProgress, mark: markPilotStage } = usePilotProgress()

  // Cached hint from the previous session: was this user a pilot? Read
  // synchronously on mount so we can answer "is this a pilot session?"
  // consistently across a cold refresh, before the org-pilot-flags query
  // has resolved. Without it, pilot UI (hidden tabs, no "+" button) would
  // flash to the non-pilot state for ~200ms on every hard refresh.
  // Tri-state: '1' (was pilot) | '0' (was non-pilot) | null (never cached).
  // The third state matters for first-time logins — without distinguishing
  // it from '0' we'd render the non-pilot dashboard while loading and
  // then snap to the pilot dashboard once the query resolved.
  const cachedPilotRaw = useMemo<'1' | '0' | null>(() => {
    if (!user?.id) return null
    try {
      const v = localStorage.getItem(`was_pilot_${user.id}`)
      return v === '1' ? '1' : v === '0' ? '0' : null
    } catch {
      return null
    }
  }, [user?.id])
  const cachedIsPilot = cachedPilotRaw === '1'
  const hasCachedPilotHint = cachedPilotRaw !== null

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
  //
  // Cached in localStorage per-(user, org) for synchronous render-time
  // fallback. The access useMemo below ANDs this with hasUnlockedTradeBook —
  // both have to be true for Trade Book to render unlocked, so caching
  // pilot_progress alone wasn't enough to kill the cold-load locked
  // preview flash. Tri-state ('1' / '0' / null) so first-time users
  // (no cache) are distinguishable from a cached `false`.
  const cachedHasCommittedTrade = useMemo<boolean | null>(() => {
    if (!user?.id || !currentOrgId) return null
    try {
      const raw = localStorage.getItem(`has_committed_trade_${user.id}_${currentOrgId}`)
      return raw === '1' ? true : raw === '0' ? false : null
    } catch {
      return null
    }
  }, [user?.id, currentOrgId])

  const { data: hasCommittedTradeInOrgQuery } = useQuery({
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

  // Effective value: real query result if we have one, otherwise the
  // localStorage cache. Same render-time fallback pattern as
  // `usePilotProgress.cachedProgress`. Avoids the cold-load window
  // where `hasCommittedTradeInOrgQuery` is undefined → access drops
  // to 'preview' → Trade Book tab flashes the locked teaser.
  const hasCommittedTradeInOrg =
    typeof hasCommittedTradeInOrgQuery === 'boolean'
      ? hasCommittedTradeInOrgQuery
      : (cachedHasCommittedTrade ?? false)

  // Persist on each successful refetch so the next cold load starts
  // from the right value. Only write when the query has actually
  // resolved (boolean), not when we're showing the cached fallback.
  useEffect(() => {
    if (!user?.id || !currentOrgId || typeof hasCommittedTradeInOrgQuery !== 'boolean') return
    try {
      localStorage.setItem(
        `has_committed_trade_${user.id}_${currentOrgId}`,
        hasCommittedTradeInOrgQuery ? '1' : '0'
      )
    } catch {
      /* ignore */
    }
  }, [user?.id, currentOrgId, hasCommittedTradeInOrgQuery])

  const isPilot = !!orgFlags?.pilotMode

  // Self-heal trade_book_unlocked at the hook level so the dashboard
  // (and any other pilot surface that isn't the locked Trade Book
  // preview) recovers when `pilot_progress.trade_book_unlocked_at_<orgId>`
  // is missing for the current org despite the user having committed
  // a trade in it. Symptom we saw repeatedly: the System Loop stayed
  // stuck on Decide because hasUnlockedTradeBook resolved false, and
  // only flipped to the correct stage after the user opened the Trade
  // Book tab (whose own self-heal in PilotTradeBookPreview wrote the
  // missing per-org key). With the heal here too, the dashboard
  // recovers on its own.
  //
  // Bounded by a ref so we mark at most once per session — the
  // mark mutation is idempotent server-side, but firing it on every
  // matching render still produces unnecessary cache churn. The
  // earlier flicker that drove us to remove this effect was caused
  // by usePilotProgress.markStage.onSuccess re-invalidating the
  // query right after writing it; that invalidate is now gone (see
  // commit history on usePilotProgress), so the heal can live here
  // safely again.
  const tradeBookHealFiredRef = useRef(false)
  useEffect(() => {
    if (tradeBookHealFiredRef.current) return
    if (!isPilot || progressLoading || orgLoading) return
    if (!hasReadyProgress) return
    if (!hasCommittedTradeInOrg) return
    if (hasUnlockedTradeBook) return
    tradeBookHealFiredRef.current = true
    markPilotStage('trade_book_unlocked')
  }, [
    isPilot,
    progressLoading,
    orgLoading,
    hasReadyProgress,
    hasCommittedTradeInOrg,
    hasUnlockedTradeBook,
    markPilotStage,
  ])
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
  // of org flag state. Use the cached graduation hint while loading so
  // a post-graduation user doesn't see the pilot dashboard flash on
  // every hard refresh before the pilot_progress query resolves.
  const effectiveIsPilot = isLoading
    ? ((hasGraduated || cachedHasGraduated) ? false : cachedIsPilot)
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

  const isInitialResolve = isLoading && !hasCachedPilotHint && !cachedHasGraduated

  // True when the access decision is trustworthy on first paint —
  // either both unlock signals have actually resolved (we have real
  // server data) or the localStorage cache fallback has both pieces
  // (we know what to render without waiting). False during the
  // cold-load window where queries are pending AND we have no cache,
  // which is when callers should hold rendering rather than flash a
  // wrong-state preview (Trade Book locked) or wrong-stage strip
  // (Decide instead of Review).
  const accessIsReady =
    hasReadyProgress
    && !!currentOrgId
    && (typeof hasCommittedTradeInOrgQuery === 'boolean' || cachedHasCommittedTrade != null)

  return {
    isPilot,
    isLoading,
    isInitialResolve,
    /** See comment on `accessIsReady` above. */
    accessIsReady,
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
