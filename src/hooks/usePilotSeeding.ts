import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { usePilotMode } from './usePilotMode'
import { fetchInstantiatedScenario } from './usePilotScenario'

/**
 * Everything a pilot's workspace is supposed to already contain, seeded when
 * the session starts rather than when Trade Lab happens to open.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * These two RPCs used to live inside `usePilotScenario`, and that hook mounts
 * in exactly one place: `SimulationPage`, a lazily-loaded Trade Lab tab. So a
 * fresh pilot who set up coverage, captured an idea and opened Idea Pipeline —
 * the order the mission itself teaches — had never mounted the hook, and
 * nothing had ever been seeded. The board was empty, and so was the Decision
 * Inbox. Nothing was filtering the demo rows out; they had never been written.
 *
 * It failed twice over, because `seed_pilot_pipeline_demo_ideas` reads the
 * user's instantiated `pilot_scenarios` row and returns 0 when there is none —
 * and that row is created by `ensure_pilot_scenario_for_user`, called from the
 * same Trade Lab-only hook. Seeding could not bootstrap itself from anywhere
 * else in the app.
 *
 * So it moves to the shell. `DashboardPage` is the one component both the
 * desktop and the phone render, whatever tab is open.
 *
 * ── Why it is safe to call from there ────────────────────────────────────
 *
 * Every RPC here is idempotent — a partial unique index on `pilot_scenarios`,
 * an origin-metadata slug check on the demo ideas, an existing-id return on
 * the decision request — so a returning pilot re-runs them to a no-op. They
 * also check pilot eligibility server-side. The client-side pilot gate below
 * is about not spending a round trip per session on everyone else, not about
 * authority.
 *
 * RLS posture: unchanged. All three are existing SECURITY DEFINER RPCs that
 * resolve the target org from the caller's own pilot scenario. No policy, no
 * new query path, and no new table is touched here.
 */
export function usePilotSeeding(): void {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const { effectiveIsPilot } = usePilotMode()
  const queryClient = useQueryClient()

  /*
   * The same key and fetcher `usePilotScenario` uses, so mounting both costs
   * one cache entry rather than two requests. This hook needs the answer to
   * one question — has anything been instantiated yet — and Trade Lab needs
   * the scenario itself; they are the same read.
   */
  const query = useQuery({
    queryKey: ['pilot-scenario', user?.id, currentOrgId],
    enabled: !!user?.id && !!currentOrgId && effectiveIsPilot,
    staleTime: 60_000,
    queryFn: async () => fetchInstantiatedScenario(user!.id, currentOrgId!),
  })

  /*
   * The Idea Pipeline reads `['trade-queue-items', orgId]`. Seeding used to
   * invalidate `trade-queue-ideas`, `trade-ideas` and `trade-lab-proposals`,
   * none of which that key matches, under a five-minute global `staleTime` —
   * so a pilot already sitting on the board kept the empty result they had
   * arrived with. Every seeding path now refreshes the board too.
   */
  const refreshSeededSurfaces = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    queryClient.invalidateQueries({ queryKey: ['trade-queue-ideas'] })
    queryClient.invalidateQueries({ queryKey: ['trade-ideas'] })
  }, [queryClient])

  const scenarioId = query.data?.id ?? null

  // First seeding: no instantiation exists for this user in this org.
  useEffect(() => {
    if (!user?.id || !currentOrgId || !effectiveIsPilot) return
    if (query.isLoading) return
    if (query.data) return
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('ensure_pilot_scenario_for_user', {})
        if (error) {
          if (import.meta.env.DEV) console.warn('ensure_pilot_scenario_for_user:', error.message)
          return
        }
        if (cancelled) return
        if ((data as any)?.seeded) {
          queryClient.invalidateQueries({ queryKey: ['pilot-scenario', user.id, currentOrgId] })
          refreshSeededSurfaces()
          queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] })
        }
        // Pipeline demo ideas — NVDA/AMZN/META across the earlier research
        // stages, so the board has visible flow the first time a pilot opens
        // it. Depends on the scenario row the call above just created, which
        // is why it follows rather than runs beside it.
        const { data: demoCount, error: demoErr } = await supabase.rpc('seed_pilot_pipeline_demo_ideas', {})
        if (demoErr) {
          if (import.meta.env.DEV) console.warn('seed_pilot_pipeline_demo_ideas:', demoErr.message)
        } else if (!cancelled && ((demoCount as number) || 0) > 0) {
          refreshSeededSurfaces()
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn('pilot seeding failed:', e)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id, currentOrgId, effectiveIsPilot, query.isLoading, query.data, queryClient, refreshSeededSurfaces])

  /*
   * Top-up for a returning pilot whose scenario predates later additions —
   * the demo ideas, and the decision_request the Inbox needs. Both RPCs are
   * no-ops once their rows exist.
   */
  useEffect(() => {
    if (!user?.id || !currentOrgId || !effectiveIsPilot) return
    if (!scenarioId) return
    let cancelled = false
    void (async () => {
      try {
        const { data: demoCount, error } = await supabase.rpc('seed_pilot_pipeline_demo_ideas', {})
        if (error) {
          if (import.meta.env.DEV) console.warn('seed_pilot_pipeline_demo_ideas:', error.message)
        } else if (!cancelled && ((demoCount as number) || 0) > 0) {
          refreshSeededSurfaces()
        }

        // The AAPL recommendation only reaches the Inbox once a matching
        // decision_requests row exists.
        const { data: drId, error: drErr } = await supabase.rpc('ensure_pilot_decision_request_for_user', {})
        if (drErr) {
          if (import.meta.env.DEV) console.warn('ensure_pilot_decision_request_for_user:', drErr.message)
        } else if (!cancelled && drId) {
          queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
          queryClient.invalidateQueries({ queryKey: ['decision-inbox'] })
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn('pilot top-ups failed:', e)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id, currentOrgId, effectiveIsPilot, scenarioId, queryClient, refreshSeededSurfaces])
}
