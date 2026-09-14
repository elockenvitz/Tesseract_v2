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
import { useHasCoverage } from './useMyCoverage'
import {
  mergePilotAccess,
  PILOT_ACCESS_DEFAULTS,
  type PilotAccessConfig,
  type PilotAccessLevel,
} from '../lib/pilot/pilot-access'
import { pilotUnlocks, pilotCommittedTradeKey } from '../lib/pilot/pilot-unlocks'

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
  /** True once this user has committed an accepted_trade in the current org —
   *  any trade, on any idea. Drives the pilot's Trade Book / Outcomes
   *  unlocks. See `lib/pilot/pilot-unlocks`. */
  hasCommittedPilotTrade: boolean
  /** True once the pilot mission is complete in this org, Close the loop
   *  included (written only by usePilotMission — reaching Outcomes is not
   *  enough). The user then gets the full app experience. */
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

  // Has this user committed any accepted_trade in THIS org? That is what opens
  // Trade Book and Outcomes for a pilot: any idea, any trade, executed in Trade
  // Lab or accepted from the Inbox. See `lib/pilot/pilot-unlocks`. Per-org and
  // per-user, so an unlock never carries between pilot orgs.
  //
  // Cached in localStorage per-(user, org) for synchronous render-time
  // fallback. The access useMemo below ANDs this with hasUnlockedTradeBook —
  // both have to be true for Trade Book to render unlocked, so caching
  // pilot_progress alone wasn't enough to kill the cold-load locked
  // preview flash. Tri-state ('1' / '0' / null) so first-time users
  // (no cache) are distinguishable from a cached `false`.
  const pilotTradeCacheKey = user?.id && currentOrgId
    ? `has_committed_trade_${user.id}_${currentOrgId}`
    : null
  const cachedHasPilotTrade = useMemo<boolean | null>(() => {
    if (!pilotTradeCacheKey) return null
    try {
      const raw = localStorage.getItem(pilotTradeCacheKey)
      return raw === '1' ? true : raw === '0' ? false : null
    } catch {
      return null
    }
  }, [pilotTradeCacheKey])

  const { data: pilotTradeResolved } = useQuery({
    queryKey: pilotCommittedTradeKey(currentOrgId, user?.id),
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

  // The real result if we have one, else the cache.
  const hasCommittedPilotTrade =
    typeof pilotTradeResolved === 'boolean'
      ? pilotTradeResolved
      : (cachedHasPilotTrade ?? false)

  // Persist on each resolved answer so the next cold load starts from the
  // right value. Only when resolved, not when showing the cached fallback.
  useEffect(() => {
    if (!pilotTradeCacheKey || typeof pilotTradeResolved !== 'boolean') return
    try {
      localStorage.setItem(pilotTradeCacheKey, pilotTradeResolved ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [pilotTradeCacheKey, pilotTradeResolved])

  const isPilot = !!orgFlags?.pilotMode

  // Coverage is the pilot's setup step, and having done it is what opens the
  // Coverage app for the rest of the pilot. Read-only here.
  const { hasCoverage } = useHasCoverage()

  // Self-heal trade_book_unlocked at the hook level so the dashboard
  // (and any other pilot surface that isn't the locked Trade Book
  // preview) recovers when `pilot_progress.trade_book_unlocked_at_<orgId>`
  // is missing for the current org despite the pilot having committed a
  // trade in it. This is now the only writer of that mark from the
  // app shell, so it is written by the tutorial decision and nothing
  // else. Symptom we saw repeatedly: the System Loop stayed
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
  const unlocks = pilotUnlocks({
    hasPilotTrade: hasCommittedPilotTrade,
    tradeBookMarked: hasUnlockedTradeBook,
    outcomesMarked: hasUnlockedOutcomes,
  })
  const tradeBookHealFiredRef = useRef(false)
  useEffect(() => {
    if (tradeBookHealFiredRef.current) return
    if (!isPilot || progressLoading || orgLoading) return
    if (!hasReadyProgress) return
    // Read from the server, not the cache: a mark is durable.
    if (pilotTradeResolved !== true) return
    if (!unlocks.shouldMarkTradeBook) return
    tradeBookHealFiredRef.current = true
    markPilotStage('trade_book_unlocked')
  }, [
    isPilot,
    progressLoading,
    orgLoading,
    hasReadyProgress,
    pilotTradeResolved,
    unlocks.shouldMarkTradeBook,
    markPilotStage,
  ])
  const access = useMemo(() => {
    // Once the user has graduated, all pilot gating drops away —
    // they get the FULL app, every feature unlocked. Previously this
    // returned PILOT_ACCESS_DEFAULTS, which still marks charting /
    // calendar / files as 'hidden' (defaults are the starting point
    // for a fresh pilot, NOT the post-graduation state). That made
    // graduated users get bounced off charting, calendar, etc. with
    // no obvious cause.
    if (!isPilot || hasGraduated) {
      const fullAccess = {} as PilotAccessConfig
      ;(Object.keys(PILOT_ACCESS_DEFAULTS) as Array<keyof PilotAccessConfig>)
        .forEach(k => { fullAccess[k] = 'full' })
      return fullAccess
    }
    const base = mergePilotAccess(orgFlags?.accessOverride)
    // Progressive unlocks layered on top of the org's static access map.
    // Unlock requires BOTH:
    //   (a) the pilot has committed a trade in THIS org — any trade, AND
    //   (b) the corresponding pilot_progress stage is marked.
    // See `lib/pilot/pilot-unlocks`. Never downgrade — if the org override
    // says 'full', leave it.
    if (unlocks.tradeBook && base.tradeBook === 'preview') base.tradeBook = 'full'
    if (unlocks.outcomes && base.outcomes === 'preview') base.outcomes = 'full'
    /*
     * Coverage opens as soon as the pilot has declared any.
     *
     * It is the pilot's first step now — the setup that precedes the mission —
     * and a step you can complete but never revisit is a step the product took
     * away from you. The unlock is the artifact itself rather than a flag, for
     * the reason `FirstSessionCoveragePrompt` gives at length: the rows ARE
     * the state, so there is nothing here that can disagree with them.
     *
     * Only this key. Nothing else about a pilot's access changes, and an org
     * override that already says 'full' or 'preview' is left alone.
     */
    if (hasCoverage && base.coverage === 'hidden') base.coverage = 'full'
    return base
  }, [isPilot, hasGraduated, orgFlags?.accessOverride, unlocks.tradeBook, unlocks.outcomes, hasCoverage])

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
    && (typeof pilotTradeResolved === 'boolean' || cachedHasPilotTrade != null)

  return {
    isPilot,
    isLoading,
    isInitialResolve,
    /** See comment on `accessIsReady` above. */
    accessIsReady,
    effectiveIsPilot,
    hasCommittedPilotTrade,
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
