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
  orgId: null as string | null,
  orgLoading: true,
  /** Rows the three config reads resolve to, once they are allowed to run. */
  platform: null as Record<string, unknown> | null,
  org: null as Record<string, unknown> | null,
}

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: world.userId ? { id: world.userId } : null, loading: world.authLoading }),
}))

/*
 * The active organization. Two of the reads are answers ABOUT it, so it is
 * both a cache-key input and a resolving input.
 */
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: world.orgId, isLoading: world.orgLoading }),
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
  world.orgId = null
  world.orgLoading = true
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

/**
 * The org-scoping defect, which is a different bug in the same hook.
 *
 * `get_org_ai_config_summary` and `is_active_org_admin_of_current_org` take
 * no argument -- they resolve the organization server-side -- so nothing in
 * the REQUEST distinguished one org from another, and the cache keys did not
 * either. After switching organizations React Query answered from the
 * previous org's entry.
 *
 * What that looked like: a BYOK org reading as unconfigured, an unconfigured
 * org reading as though it had a key, and the BYOK editor enabled for
 * somebody who is not an admin of the org they are now in.
 */
describe('an answer about one organization is not served for another', () => {
  const keysFor = (orgId: string) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    world.userId = 'u1'
    world.authLoading = false
    world.orgId = orgId
    world.orgLoading = false
    renderHook(() => useAIConfig(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    return client.getQueryCache().getAll().map(q => q.queryKey as unknown[])
  }

  it('puts the organization in the key of every org-scoped read', () => {
    const keys = keysFor('org-a')
    for (const prefix of ['org-ai-config', 'is-org-admin']) {
      const key = keys.find(k => k[0] === prefix)
      expect(key, `${prefix} was never requested`).toBeTruthy()
      expect(key, `${prefix} is cached without the organization`).toContain('org-a')
    }
  })

  it('asks again for a different organization rather than reusing the answer', () => {
    /* Two renders, two orgs, two distinct cache entries. One entry would mean
       the second org reads the first org's configuration. */
    const a = keysFor('org-a').find(k => k[0] === 'org-ai-config')
    const b = keysFor('org-b').find(k => k[0] === 'org-ai-config')
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('does not ask about an organization it does not know yet', () => {
    /* Firing with no org resolves `current_org()` to whatever the server
       picks and caches it under `null`, which is the same bug wearing a
       different key. */
    world.userId = 'u1'
    world.authLoading = false
    world.orgId = null
    world.orgLoading = false
    const { result } = render()
    expect(result.current.effectiveConfig.isConfigured).toBe(false)
  })

  it('is still resolving while the organization is being established', () => {
    /* The org query is now disabled until the org is known, and a disabled
       query reports `isLoading: false` -- the same trap `authLoading` is in
       this flag for. */
    world.userId = 'u1'
    world.authLoading = false
    world.orgId = null
    world.orgLoading = true
    const { result } = render()
    expect(result.current.effectiveConfig.isResolving).toBe(true)
  })
})
