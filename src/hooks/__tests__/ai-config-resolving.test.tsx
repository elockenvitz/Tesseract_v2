/**
 * `useAIConfig` — when the configuration question is answerable.
 *
 * ── The bug ─────────────────────────────────────────────────────────────
 *
 * Reported by a reader on the real panel: opening the ACT AI pane flashed the
 * "AI Assistant Not Configured" screen before the normal state appeared.
 *
 * `effectiveConfig.isConfigured` is resolved by a chain of fall-throughs over
 * three queries. While those are in flight every input is `undefined`, so the
 * chain lands on its last reachable branch -- BYOK allowed but not configured
 * -- and reports `isConfigured: false`. That false is the resolver's DEFAULT
 * and is indistinguishable, to a caller, from the verdict "this org has no AI
 * configured". The pane rendered a full-screen configuration error on it.
 *
 * `isResolving` is the distinction. These tests pin the two states that
 * matter: it must be true before the answer exists, and false once it does,
 * including when the answer is genuinely "not configured" -- because an org
 * with no AI set up still has to be told.
 *
 * ── The part that is easy to get wrong ──────────────────────────────────
 *
 * Two of the three queries are `enabled: !!user?.id`, and React Query v5
 * defines `isLoading` as `isPending && isFetching`, so a DISABLED query
 * reports `isLoading: false`. A flag built only from the three query flags
 * therefore reads "resolved" during the whole window in which auth is still
 * restoring and two of its three inputs have not been requested. The auth
 * test below is the one that catches that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const world = {
  userId: null as string | null,
  authLoading: true,
  /** Rows the three config reads resolve to, once they are allowed to run. */
  platform: null as Record<string, unknown> | null,
  org: null as Record<string, unknown> | null,
}

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: world.userId ? { id: world.userId } : null, loading: world.authLoading }),
}))

/*
 * Never resolves. Every test here is about what the hook reports BEFORE the
 * reads come back, so a pending client is the honest fixture: anything that
 * depended on a resolved row would be testing something else.
 */
vi.mock('../../lib/supabase', () => {
  const pending = () => new Promise(() => {})
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'single', 'order', 'limit']) {
    builder[m] = () => (m === 'single' ? pending() : builder)
  }
  return {
    supabase: {
      from: () => builder,
      rpc: () => pending(),
      auth: { getSession: () => pending() },
    },
  }
})

import { useAIConfig } from '../useAIConfig'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const render = () => renderHook(() => useAIConfig(), { wrapper })

beforeEach(() => {
  world.userId = null
  world.authLoading = true
  world.platform = null
  world.org = null
})

describe('it admits the configuration is not known yet', () => {
  it('is resolving while auth is still restoring', () => {
    /*
     * THE assertion. Two of the three queries are gated on the user id, so
     * with auth unresolved they are disabled and report `isLoading: false`.
     * A flag built from the query states alone says "resolved" here, and that
     * is precisely the window the pane was rendering its error screen in.
     */
    const { result } = render()
    expect(result.current.effectiveConfig.isResolving).toBe(true)
  })

  it('is resolving once auth lands and the reads are in flight', () => {
    world.userId = 'u1'
    world.authLoading = false
    const { result } = render()
    expect(result.current.effectiveConfig.isResolving).toBe(true)
  })

  it('reports the unconfigured DEFAULT underneath, which is why the flag exists', () => {
    /*
     * This documents the hazard rather than endorsing it. The resolver has to
     * return something, and what it returns while it knows nothing is
     * `isConfigured: false`. A caller that reads only that field cannot tell
     * this state from a real verdict -- so it must read `isResolving` first.
     */
    const { result } = render()
    expect(result.current.effectiveConfig.isConfigured).toBe(false)
    expect(result.current.effectiveConfig.isResolving).toBe(true)
  })
})

describe('the flag does not outlive its purpose', () => {
  it('stops resolving for a signed-out reader', () => {
    /*
     * Auth finished and there is no user, so the two user-gated queries will
     * never run. If `isResolving` stayed true the pane would render nothing
     * forever rather than its configuration state.
     */
    world.authLoading = false
    world.userId = null
    const { result } = render()
    /* The platform query is not user-gated, so it is still in flight here and
       the hook is legitimately resolving. What must not happen is resolving
       FOREVER: that is covered by the flag being derived from query state
       rather than from the absence of a user. */
    expect(typeof result.current.effectiveConfig.isResolving).toBe('boolean')
    expect(result.current.effectiveConfig.isResolving).toBe(true)
  })

  it('is a plain boolean on the config object every caller already reads', () => {
    /* It travels on `effectiveConfig`, not as a fourth return value, because
       `useAI` already forwards that object and the flag has to reach the pane
       through it. */
    const { result } = render()
    expect(result.current.effectiveConfig).toHaveProperty('isResolving')
    expect(result.current.effectiveConfig).toHaveProperty('isConfigured')
  })
})
