/**
 * Signing out clears the chart recents, on the path the app actually uses.
 *
 * ── Why this could not be left to the existing wiring ────────────────────
 *
 * `clearRecentInstruments` is also wired into `clearProviderCaches`, and a
 * test in `lib/market-data/__tests__/provider-isolation` proves that call
 * reaches it. That proof covers ONE path.
 *
 * `clearProviderCaches` is reached only from the auth handler inside
 * `useSessionUserId`, and that hook exists only while something that calls
 * `useMarketDataEntitlement` is mounted -- a chart, an asset tab, the price
 * history hook. Sign out from a surface that never mounted one and the
 * handler was never subscribed, so nothing cleared.
 *
 * That was tolerable while every provider cache was an in-memory `Map` that
 * dies with the page. The recents list is the first of them written to DISK,
 * so it survives, and a clear that depends on which components happened to
 * be mounted is not a clear.
 *
 * Hence the call in `signOut` itself, and hence this test, which mounts NO
 * chart component at all. Injecting the failure where the existing gate
 * already looks would have proven the path that already worked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  recordRecentInstrument,
  readRecentInstruments,
} from '../../lib/charting/recent-instruments'

const env = vi.hoisted(() => ({
  signOutCalls: 0,
  profile: { id: 'u1', email: 'eric@bogey.cap', first_name: 'Eric', current_organization_id: 'org-1' },
}))

vi.mock('@sentry/react', () => ({ setUser: vi.fn(), setTag: vi.fn() }))
vi.mock('../../lib/org-domain-routing', () => ({
  titleCase: (s: string) => s,
  routeOrgByEmail: vi.fn(async () => ({ profile: env.profile, routeResult: null })),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 't1', user: { id: 'u1', email: 'eric@bogey.cap', user_metadata: {} } } },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: async () => { env.signOutCalls += 1; return { error: null } },
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: env.profile, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    }),
  },
}))

import { useAuth } from '../useAuth'

const USER = 'u1'
const ORG = 'org-1'

/*
 * Deliberately bare. It renders no chart, no asset tab and no price history,
 * so `useSessionUserId` is never mounted and `clearProviderCaches` is never
 * subscribed to the auth event -- the exact situation the clear has to
 * survive.
 */
function SignOutOnly() {
  const { signOut, loading } = useAuth()
  return (
    <button data-testid="out" disabled={loading} onClick={() => { void signOut() }}>
      sign out
    </button>
  )
}

beforeEach(() => {
  localStorage.clear()
  env.signOutCalls = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('signing out', () => {
  it('clears the chart recents although no chart was ever mounted', async () => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAPL', companyName: 'Apple Inc.' })
    recordRecentInstrument(USER, ORG, { id: 'id-2', symbol: 'NVDA', companyName: 'NVIDIA' })
    expect(readRecentInstruments(USER, ORG)).toHaveLength(2)

    render(<SignOutOnly />)
    await waitFor(() => expect(screen.getByTestId('out')).not.toBeDisabled())
    await act(async () => { screen.getByTestId('out').click() })

    await waitFor(() => expect(env.signOutCalls).toBe(1))
    expect(readRecentInstruments(USER, ORG), 'the recents survived sign-out').toEqual([])
  })

  it('clears every principal list on that machine, not just the active one', async () => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAPL', companyName: 'Apple' })
    recordRecentInstrument('user-b', 'org-b', { id: 'id-2', symbol: 'MSFT', companyName: 'Microsoft' })

    render(<SignOutOnly />)
    await waitFor(() => expect(screen.getByTestId('out')).not.toBeDisabled())
    await act(async () => { screen.getByTestId('out').click() })
    await waitFor(() => expect(env.signOutCalls).toBe(1))

    expect(readRecentInstruments(USER, ORG)).toEqual([])
    expect(readRecentInstruments('user-b', 'org-b')).toEqual([])
  })

  it('still signs out when there is nothing stored to clear', async () => {
    render(<SignOutOnly />)
    await waitFor(() => expect(screen.getByTestId('out')).not.toBeDisabled())
    await act(async () => { screen.getByTestId('out').click() })
    await waitFor(() => expect(env.signOutCalls).toBe(1))
  })

  it('leaves unrelated storage alone', async () => {
    localStorage.setItem('some-other-feature', 'keep-me')
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAPL', companyName: 'Apple' })

    render(<SignOutOnly />)
    await waitFor(() => expect(screen.getByTestId('out')).not.toBeDisabled())
    await act(async () => { screen.getByTestId('out').click() })
    await waitFor(() => expect(env.signOutCalls).toBe(1))

    expect(localStorage.getItem('some-other-feature')).toBe('keep-me')
  })
})
