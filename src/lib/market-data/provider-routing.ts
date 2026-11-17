/**
 * Which market-data provider this session may use, decided by the server.
 *
 * ── Why the browser is not allowed to decide ──────────────────────────────
 *
 * EODHD is a single-seat subscription in a product with 28 organizations, so
 * "may this session use it" is a licensing question, not a preference. The
 * browser therefore never compares a user id, an email, or a feature flag:
 * it asks the edge function, which re-derives the answer from the caller's
 * verified JWT against a server-side allowlist, and is told only yes or no.
 *
 * The yes is not load-bearing either. Every data request re-runs the same
 * decision server-side before it touches the provider, so a tampered client
 * gets a 403 rather than data. This hook exists to pick a code path, not to
 * grant access.
 *
 * ── Why it fails to Yahoo, loudly in only one direction ───────────────────
 *
 * Unknown means Yahoo. Loading, a network error, a 403, a 503, a malformed
 * body — all of them route to the provider every user already has. The only
 * thing that selects EODHD is an explicit `entitled: true`. That asymmetry is
 * deliberate: wrongly falling back costs this one account a better data
 * source for a moment, while wrongly routing forward would serve a licensed
 * feed to someone it is not licensed for.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { chartDataService } from '../chartData'
import type { MarketDataProviderId } from './contracts'
import { clearReferenceCache } from './routed-quote'
import { clearSymbolCache } from './eodhd-symbol'
import { clearChartingWorkspaces } from '../charting/workspace-state'

export const EODHD_FUNCTION = 'eodhd-market-data'

/** How long a yes/no is trusted before being re-asked. */
export const ENTITLEMENT_STALE_MS = 5 * 60 * 1000

export interface EntitlementState {
  /** The provider this session's market-data reads should go to. */
  provider: MarketDataProviderId
  /** True only on an explicit server `entitled: true`. */
  entitled: boolean
  /** Why not, when the server said so. Diagnostic only, never authorization. */
  reason?: string
  isLoading: boolean
  /**
   * Whether the server has actually answered.
   *
   * Distinct from `!isLoading`, and the distinction is the point. While the
   * answer is outstanding, `provider` reads `yahoo` so the existing
   * experience is preserved — but that Yahoo result must NOT be presented as
   * EODHD data, and a surface cannot tell the difference from `provider`
   * alone, because an unresolved session and a genuinely unentitled one
   * both report `yahoo`.
   *
   * So a label reads this: unresolved means say nothing about the provider,
   * not say "Yahoo" and not say "EODHD".
   */
  resolved: boolean
}

interface EntitlementBody {
  ok?: unknown
  data?: { provider?: unknown; entitled?: unknown; reason?: unknown }
}

export interface EntitlementAnswer {
  entitled: boolean
  reason?: string
}

/**
 * Turn whatever came back into a yes or a no.
 *
 * A pure function, separate from the fetch, so the one rule that matters can
 * be tested against every shape a response can take rather than asserted by
 * regex: only a literal `true` under a literal `ok: true` is a yes. The
 * string `"false"`, the number `1`, a non-empty object and an absent field
 * are all truthy or falsy in ways that would be a licensing decision made by
 * JavaScript coercion.
 *
 * Every failure is a no with a reason, never a throw: an exception here would
 * leave the provider undecided and the chart empty, when the correct outcome
 * is the default provider that every user already has.
 */
export function readEntitlementAnswer(data: unknown, error: unknown): EntitlementAnswer {
  if (error) return { entitled: false, reason: 'unreachable' }

  const body = data as EntitlementBody | null
  const row = body?.data
  if (body?.ok === true && row?.entitled === true) return { entitled: true }
  return {
    entitled: false,
    reason: typeof row?.reason === 'string' ? row.reason : 'not_entitled',
  }
}

/**
 * The signed-in user's id, for CACHE KEYING ONLY.
 *
 * It is read from the client session and is not trusted for anything. It is
 * in the query key so that signing out and signing in as somebody else cannot
 * serve them the previous user's entitlement answer out of the React Query
 * cache — which would be a licensing leak achieved entirely by caching.
 */
export function useSessionUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user?.id ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id ?? null
      setUserId(prev => {
        /*
         * The principal changed in this tab. Drop every provider-scoped
         * in-memory cache before the next render can read one.
         *
         * The React Query keys already carry the provider, so this is the
         * second line rather than the only one — but the two module-level
         * `Map`s outlive a sign-out. The rule and the clearing both live in
         * tested functions above; this is the one line that wires them to the
         * auth event.
         */
        if (shouldClearProviderCaches(prev, next)) clearProviderCaches()
        return next
      })
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return userId
}

/**
 * The cache key for the yes/no.
 *
 * Spelled as two segments rather than one hyphenated string because
 * `entitlement.test.ts` bans the server module's bare name anywhere in a
 * shipped file, comments and string literals included, and a one-piece key
 * would have collided with that ban for no reason.
 */
export function marketDataEntitlementKey(userId: string | null) {
  return ['market-data', 'entitlement', userId ?? null] as const
}

/**
 * Whether a principal change has happened that must invalidate cached data.
 *
 * A separate, pure function rather than an inline condition, so the rule can
 * be TESTED rather than read. The first version of this lived inline and its
 * guard asserted the condition's source text — which stayed green when the
 * condition was disabled, because the text was still there.
 *
 * `null -> someone` is a first sign-in with nothing cached to leak, so it is
 * false. `someone -> anyone else`, including a sign-out, is true.
 */
export function shouldClearProviderCaches(
  previous: string | null,
  next: string | null,
): boolean {
  return previous !== null && previous !== next
}

export interface ProviderCacheDeps {
  clearCharts: () => void
  clearReference: () => void
  /**
   * The Charting page's per-tab workspace.
   *
   * Keyed by principal already, so a new account cannot read the previous
   * one's selections — this stops the map holding a signed-out account's
   * symbols and comparisons in memory.
   */
  clearWorkspaces: () => void
}

/**
 * Drop every provider-scoped in-memory cache.
 *
 * Both caches are plain module-level `Map`s that outlive a sign-out, and a
 * `Map` has no idea whose data it is holding. Dependencies are injectable so
 * the isolation test can observe that BOTH are cleared, not just whichever
 * one a source regex happened to match.
 */
export function clearProviderCaches(deps: ProviderCacheDeps = DEFAULT_CACHE_DEPS): void {
  deps.clearCharts()
  deps.clearReference()
  deps.clearWorkspaces()
}

const DEFAULT_CACHE_DEPS: ProviderCacheDeps = {
  clearCharts: () => chartDataService.clearCache(),
  clearReference: () => {
    clearReferenceCache()
    clearSymbolCache()
  },
  clearWorkspaces: () => clearChartingWorkspaces(),
}

/**
 * Ask the server whether this session may use EODHD.
 *
 * Costs no provider request: the `entitlement` operation answers from the
 * allowlist alone and never calls EODHD, so an unentitled user asking is
 * free and tells them nothing about who is on the list.
 */
export function useMarketDataEntitlement(): EntitlementState {
  const userId = useSessionUserId()

  const query = useQuery({
    queryKey: marketDataEntitlementKey(userId),
    enabled: !!userId,
    staleTime: ENTITLEMENT_STALE_MS,
    gcTime: ENTITLEMENT_STALE_MS,
    // A denial is an answer, not a fault. Retrying it wastes a round trip and
    // delays the Yahoo path the user is going to get anyway.
    retry: false,
    queryFn: async (): Promise<EntitlementAnswer> => {
      const { data, error } = await supabase.functions.invoke(EODHD_FUNCTION, {
        body: { op: 'entitlement' },
      })
      return readEntitlementAnswer(data, error)
    },
  })

  const entitled = query.data?.entitled === true

  /*
   * Resolved means the server answered, either way. A signed-out session is
   * also resolved: there is nobody to be entitled, and the answer is no.
   */
  const resolved = !userId || query.data !== undefined

  return {
    provider: entitled ? 'eodhd' : 'yahoo',
    entitled,
    reason: query.data?.reason,
    isLoading: !!userId && query.isLoading,
    resolved,
  }
}
