/**
 * The recents list cannot outlive the access that produced it.
 *
 * ── What the scoping does NOT cover ──────────────────────────────────────
 *
 * `lib/charting/recent-instruments` keys storage `userId:orgId`, which stops
 * another ACCOUNT reading the list. It does nothing about the same account
 * seeing an instrument it has since lost access to: the entry was authorized
 * when it was WRITTEN, and localStorage never learns that an asset was
 * deleted, a membership removed, or a policy narrowed.
 *
 * So the ids are read back through `assets` on mount, and RLS answers. The
 * fake below models that by returning only the rows it is told are visible
 * -- the client asks for all of them and gets back what it is allowed, which
 * is exactly how the real policy behaves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  recordRecentInstrument,
  readRecentInstruments,
} from '../../lib/charting/recent-instruments'
import { useRecentInstruments } from '../useRecentInstruments'

const env = vi.hoisted(() => ({
  /* The rows RLS will return, whatever is asked for. */
  visible: [] as Array<{ id: string; symbol: string; company_name: string | null }>,
  failWith: null as string | null,
  selects: 0,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.in = (_col: string, ids: string[]) => {
        chain.__ids = ids
        return chain
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        env.selects += 1
        if (env.failWith) {
          return Promise.resolve({ data: null, error: { message: env.failWith } }).then(resolve)
        }
        const asked = (chain.__ids as string[]) ?? []
        /* The policy: of the ids asked for, only the visible ones come back. */
        const data = env.visible.filter(r => asked.includes(r.id))
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

const USER = 'user-a'
const ORG = 'org-a'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  window.localStorage.clear()
  env.visible = []
  env.failWith = null
  env.selects = 0
})

describe('an entry the caller may no longer read', () => {
  beforeEach(() => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAPL', companyName: 'Apple Inc.' })
    recordRecentInstrument(USER, ORG, { id: 'id-2', symbol: 'SECRET', companyName: 'Revoked Co' })
  })

  it('is not shown, though it is still on disk', async () => {
    /* Access to id-2 has been withdrawn since it was recorded. */
    env.visible = [{ id: 'id-1', symbol: 'AAPL', company_name: 'Apple Inc.' }]

    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 })

    expect(result.current.recents.map(r => r.symbol)).toEqual(['AAPL'])
    expect(result.current.recents.map(r => r.symbol)).not.toContain('SECRET')
  })

  it('is pruned from storage, not merely hidden in the view', async () => {
    env.visible = [{ id: 'id-1', symbol: 'AAPL', company_name: 'Apple Inc.' }]

    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.recents).toHaveLength(1), { timeout: 3000 })

    /* Hiding it in the view leaves it on disk for the next reader. */
    expect(readRecentInstruments(USER, ORG).map(r => r.id)).toEqual(['id-1'])
  })

  it('shows nothing at all when EVERY entry was revoked', async () => {
    env.visible = []
    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 })
    expect(result.current.recents).toEqual([])
  })
})

describe('the check fails closed', () => {
  beforeEach(() => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAPL', companyName: 'Apple Inc.' })
  })

  it('shows nothing when the authorization query errors', async () => {
    /* The alternative -- falling back to the cached list -- is an
       authorization check defeatable by making the check fail. */
    env.failWith = 'network down'
    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 })
    expect(result.current.recents).toEqual([])
  })

  it('does NOT delete the stored list on an error, so it can come back', async () => {
    env.failWith = 'network down'
    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 })
    /* A failed check must not be able to destroy data. */
    expect(readRecentInstruments(USER, ORG).map(r => r.id)).toEqual(['id-1'])
  })

  it('distinguishes an error from an empty result', async () => {
    env.failWith = 'network down'
    const { result: errored } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(errored.current.isError).toBe(true), { timeout: 3000 })

    env.failWith = null
    env.visible = []
    const { result: empty } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(empty.current.isLoading).toBe(false), { timeout: 3000 })

    /* Both show nothing, but only one of them is a failure. `data || []`
       is exactly how those two became one elsewhere in this codebase. */
    expect(errored.current.isError).toBe(true)
    expect(empty.current.isError).toBe(false)
  })
})

describe('what the list shows is current, not captured', () => {
  it('refreshes a renamed company rather than showing the stored name', async () => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'FB', companyName: 'Facebook, Inc.' })
    env.visible = [{ id: 'id-1', symbol: 'META', company_name: 'Meta Platforms, Inc.' }]

    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.recents).toHaveLength(1), { timeout: 3000 })

    expect(result.current.recents[0].symbol).toBe('META')
    expect(result.current.recents[0].companyName).toBe('Meta Platforms, Inc.')
  })

  it('keeps most-recent-first order through the re-check', async () => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAA', companyName: 'A' })
    recordRecentInstrument(USER, ORG, { id: 'id-2', symbol: 'BBB', companyName: 'B' })
    recordRecentInstrument(USER, ORG, { id: 'id-3', symbol: 'CCC', companyName: 'C' })
    /* Deliberately returned in a DIFFERENT order than stored: the database
       has no reason to preserve the caller's ordering, and a list whose
       whole value is "most recent first" must not inherit the row order. */
    env.visible = [
      { id: 'id-1', symbol: 'AAA', company_name: 'A' },
      { id: 'id-2', symbol: 'BBB', company_name: 'B' },
      { id: 'id-3', symbol: 'CCC', company_name: 'C' },
    ]

    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.recents).toHaveLength(3), { timeout: 3000 })
    expect(result.current.recents.map(r => r.symbol)).toEqual(['CCC', 'BBB', 'AAA'])
  })
})

describe('the request itself', () => {
  it('asks for nothing when there is nothing stored', async () => {
    const { result } = renderHook(() => useRecentInstruments(USER, ORG), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 })
    expect(env.selects).toBe(0)
    expect(result.current.recents).toEqual([])
  })

  it('asks for nothing before the principal resolves', async () => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAPL', companyName: 'Apple' })
    renderHook(() => useRecentInstruments(null, null), { wrapper })
    await new Promise(r => setTimeout(r, 300))
    expect(env.selects).toBe(0)
  })

  it('re-validates on an organization switch rather than reusing the answer', async () => {
    recordRecentInstrument(USER, ORG, { id: 'id-1', symbol: 'AAPL', companyName: 'Apple' })
    recordRecentInstrument(USER, 'org-b', { id: 'id-2', symbol: 'MSFT', companyName: 'Microsoft' })
    env.visible = [
      { id: 'id-1', symbol: 'AAPL', company_name: 'Apple' },
      { id: 'id-2', symbol: 'MSFT', company_name: 'Microsoft' },
    ]

    const { result, rerender } = renderHook(
      ({ org }) => useRecentInstruments(USER, org),
      { wrapper, initialProps: { org: ORG } },
    )
    await waitFor(() => expect(result.current.recents).toHaveLength(1), { timeout: 3000 })
    expect(result.current.recents[0].symbol).toBe('AAPL')

    rerender({ org: 'org-b' })
    await waitFor(() => expect(result.current.recents[0]?.symbol).toBe('MSFT'), { timeout: 3000 })
  })
})
