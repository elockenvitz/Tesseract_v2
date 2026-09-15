/**
 * Components mounting together share one auth read.
 *
 * `useAuth` is a hook, not a provider, so a Dashboard mounts about a hundred
 * copies at once. Each used to run its own `getSession()` and profile fetch,
 * and every `getSession()` waits on supabase-js's single auth lock -- the same
 * lock each REST request takes to attach the token. The duplicate reads queued
 * there held Today's first request for over half a second.
 *
 * The share is in flight only: once a read settles, the next mount reads again,
 * so no component is ever handed an older profile than its own read would get.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'

const env = vi.hoisted(() => {
  const session = { access_token: 't1', user: { id: 'u1', email: 'eric@bogey.cap', user_metadata: {} } }
  return {
    session,
    getSession: vi.fn(),
    profileRead: vi.fn(),
    route: vi.fn(),
    profile: { id: 'u1', email: 'eric@bogey.cap', first_name: 'Eric', current_organization_id: 'org-1' } as Record<string, unknown>,
    profileError: null as null | { code: string },
    release: [] as Array<() => void>,
  }
})

vi.mock('@sentry/react', () => ({ setUser: vi.fn(), setTag: vi.fn() }))
vi.mock('../../lib/org-domain-routing', () => ({
  titleCase: (s: string) => s,
  routeOrgByEmail: env.route,
}))
vi.mock('../../lib/supabase', () => {
  /** Held until the test releases it, so concurrent mounts really overlap. */
  const held = <T,>(value: () => T) => new Promise<T>(resolve => { env.release.push(() => resolve(value())) })
  return {
    supabase: {
      auth: {
        getSession: (...a: unknown[]) => { env.getSession(...a); return held(() => ({ data: { session: env.session } })) },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => { env.profileRead(); return held(() => ({ data: env.profileError ? null : env.profile, error: env.profileError })) },
          }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    },
  }
})

import { useAuth } from '../useAuth'

const seen: Array<Record<string, unknown> | null> = []
function Consumer() {
  const { user } = useAuth()
  seen.push(user as Record<string, unknown> | null)
  return <span data-testid="who">{(user as { first_name?: string } | null)?.first_name ?? ''}</span>
}

/** Let every held network promise resolve, repeatedly, until nothing is waiting. */
async function drain() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      const pending = env.release.splice(0)
      pending.forEach(r => r())
      await Promise.resolve()
    })
  }
}

beforeEach(() => {
  localStorage.clear()
  env.getSession.mockClear()
  env.profileRead.mockClear()
  env.route.mockReset()
  env.profile = { id: 'u1', email: 'eric@bogey.cap', first_name: 'Eric', current_organization_id: 'org-1' }
  env.profileError = null
  env.release.length = 0
  seen.length = 0
})
afterEach(cleanup)

const mountMany = (n: number) => render(<>{Array.from({ length: n }, (_, i) => <Consumer key={i} />)}</>)

describe('a Dashboard-sized burst of useAuth mounts', () => {
  it('reads the session and the profile once, not once per component', async () => {
    const view = mountMany(100)
    await drain()
    expect(env.getSession).toHaveBeenCalledTimes(1)
    expect(env.profileRead).toHaveBeenCalledTimes(1)
    const names = view.getAllByTestId('who').map(n => n.textContent)
    expect(names).toHaveLength(100)
    expect(new Set(names)).toEqual(new Set(['Eric']))
  })

  it('shares only a read in flight: a later mount reads afresh', async () => {
    mountMany(3)
    await drain()
    expect(env.profileRead).toHaveBeenCalledTimes(1)

    env.profile = { ...env.profile, first_name: 'Erica' }
    const later = render(<Consumer />)
    await drain()
    expect(env.getSession).toHaveBeenCalledTimes(2)
    expect(env.profileRead).toHaveBeenCalledTimes(2)
    const whos = later.getAllByTestId('who')
    await waitFor(() => expect(whos[whos.length - 1]).toHaveTextContent('Erica'))
  })

  it('routes a user with no organization once for the burst', async () => {
    env.profile = { ...env.profile, current_organization_id: null }
    env.route.mockResolvedValue({ profile: null, routeResult: { action: 'no_org', org_name: null } })
    mountMany(40)
    await drain()
    expect(env.route).toHaveBeenCalledTimes(1)
    expect(seen[seen.length - 1]).toMatchObject({ _routeAction: 'no_org' })
  })

  it('still falls back to the session user for everyone when the profile read fails', async () => {
    env.profileError = { code: '500' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = mountMany(10)
    await drain()
    expect(env.profileRead).toHaveBeenCalledTimes(1)
    expect(view.getAllByTestId('who').map(n => n.textContent)).toEqual(Array(10).fill(''))
    expect(seen[seen.length - 1]).toMatchObject({ id: 'u1', email: 'eric@bogey.cap' })
    warn.mockRestore()
  })
})
