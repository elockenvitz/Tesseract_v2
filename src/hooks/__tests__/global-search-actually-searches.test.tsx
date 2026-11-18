/**
 * The global search has to reach the database, and say so when it cannot.
 *
 * ── The failure this exists to stop ──────────────────────────────────────
 *
 * Typing any ticker into the application's main search box produced
 * `No results for "AAPL"`. Every object type was affected -- assets, themes,
 * portfolios, users, projects, lists, workflows, teams, notebooks, model
 * files -- and only the static page rows survived, because those are matched
 * locally without a round trip.
 *
 * The cause was one line:
 *
 *   const rpc = supabase.rpc        // the method, torn off its object
 *   ...
 *   return rpc('global_search', …) // `this` is undefined
 *
 * `rpc` reads `this.rest` as its first act, so every call threw
 * `TypeError: Cannot read properties of undefined (reading 'rest')` BEFORE a
 * request was made. Confirmed in the browser against the running app: typing
 * a ticker issued no network request at all, and the entry in the React Query
 * cache sat at `status: "error"` with exactly that message.
 *
 * Two separate defects made it invisible, and both are covered here.
 *
 *  1. Nothing executed the search. The existing suite for this hook asserts
 *     over the SOURCE TEXT of the module -- that the `Promise.all` is there,
 *     that the helper mentions `global_search` -- and every one of those
 *     assertions passed while the feature returned nothing at all. Source
 *     text cannot see a lost receiver. So these cases run the query function
 *     against a client that behaves like the real one, and read the rows.
 *
 *  2. A thrown error rendered as an empty result. The `if (error)` branch in
 *     the hook handles an RPC that ANSWERS with a failure; an exception
 *     escapes the query function entirely, React Query holds no data, and the
 *     dropdown drew its "no matches" panel. The interface stated, with
 *     confidence, something false about the organization's data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

/** What the mocked RPC was asked for, so a silent no-op cannot pass. */
let rpcCalls: { fn: string; args: Record<string, unknown> }[]
/** Set to make the RPC answer with a failure rather than rows. */
let rpcError: unknown = null
/** Set to make the RPC throw, the way a detached method does. */
let rpcThrows = false

const ASSET_ROW = { id: 'a1', symbol: 'AAPL', company_name: 'Apple Inc.' }

/*
 * A stand-in for the Supabase client that behaves like the real one in the
 * single respect this bug turned on: `rpc` is a METHOD and reads `this`.
 *
 * Without the `this` read a detached call would work here and fail in the
 * browser, which is precisely the gap that let the defect ship -- so the
 * mock reproduces the receiver requirement rather than assuming it away.
 */
function makeClient() {
  return {
    rest: { marker: 'the client itself' },
    rpc(fn: string, args: Record<string, unknown>) {
      // The line that threw in production, reproduced deliberately.
      const rest = (this as { rest?: unknown } | undefined)!.rest
      rpcCalls.push({ fn, args })
      if (rpcThrows) throw new TypeError('rpc exploded')
      if (!rest) throw new TypeError('no rest on this')
      return Promise.resolve({
        data: rpcError ? null : { assets: [ASSET_ROW] },
        error: rpcError,
      })
    },
    from() {
      const builder = {
        select: () => builder,
        ilike: () => builder,
        in: () => Promise.resolve({ data: [], error: null }),
        limit: () => Promise.resolve({ data: [], error: null }),
      }
      return builder
    },
  }
}

const client = makeClient()

vi.mock('../../lib/supabase', () => ({ supabase: client }))
vi.mock('../usePilotMode', () => ({
  usePilotMode: () => ({ effectiveIsPilot: false, hasGraduated: true, access: {} }),
}))

const { useObjectSearch, STATIC_PAGES } = await import('../useObjectSearch')

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => { rpcCalls = []; rpcError = null; rpcThrows = false })
afterEach(() => { vi.restoreAllMocks() })

describe('the global search reaches the database', () => {
  it('returns the asset the RPC found', async () => {
    const { result } = renderHook(() => useObjectSearch('AAPL', 'AAPL'), { wrapper: wrap() })

    await waitFor(() => {
      expect(result.current.results.some(r => r.type === 'asset')).toBe(true)
    })

    const asset = result.current.results.find(r => r.type === 'asset')
    expect(asset).toMatchObject({ title: 'AAPL', subtitle: 'Apple Inc.' })
  })

  it('calls the RPC with the typed query, so an empty list cannot pass as a search', async () => {
    const { result } = renderHook(() => useObjectSearch('AAPL', 'AAPL'), { wrapper: wrap() })
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({
      fn: 'global_search',
      args: { search_query: 'AAPL', result_limit: 5 },
    })
  })

  it('does not report an error for a search that worked', async () => {
    const { result } = renderHook(() => useObjectSearch('AAPL', 'AAPL'), { wrapper: wrap() })
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    expect(result.current.isError).toBe(false)
  })
})

describe('a search that failed is not reported as a search that found nothing', () => {
  it('raises isError when the call throws', async () => {
    rpcThrows = true
    const { result } = renderHook(() => useObjectSearch('AAPL', 'AAPL'), { wrapper: wrap() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // And it must not have manufactured rows to cover the failure.
    expect(result.current.results.some(r => r.type === 'asset')).toBe(false)
  })

  it('keeps the local page rows, which never needed the network', async () => {
    rpcThrows = true
    const { result } = renderHook(() => useObjectSearch('charting', 'charting'), { wrapper: wrap() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.localResults.map(r => r.id)).toContain('charting')
  })

  it('an RPC that ANSWERS with a failure is still not silent', async () => {
    /*
     * The other half of the distinction. This path returns the static matches
     * rather than throwing, which is a deliberate choice -- but it must not
     * invent object rows it never received.
     */
    rpcError = { message: 'permission denied' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useObjectSearch('AAPL', 'AAPL'), { wrapper: wrap() })

    await waitFor(() => expect(rpcCalls.length).toBe(1))
    await waitFor(() => expect(result.current.isFetching).toBe(false))
    expect(result.current.results.some(r => r.type === 'asset')).toBe(false)
  })
})

describe('the static page rows are a set, not a list with repeats', () => {
  it('has no two pages sharing an id', () => {
    /*
     * The dropdown keys its rows `${type}-${id}`, so two rows with the same
     * id are two children with the same React key -- "Encountered two
     * children with the same key, page-today", logged on every search for
     * "attention", "dashboard", "decisions" or "today", with behaviour React
     * documents as unsupported. Both of those rows opened the same tab.
     */
    const ids = STATIC_PAGES.map(p => p.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes, `these page ids appear more than once: ${dupes.join(', ')}`).toEqual([])
  })

  it('still finds the home surface by the retired row keywords', () => {
    /*
     * Removing the duplicate row must not remove the words that reached it.
     * A search term that used to find a door and now finds nothing is the
     * half-fix this codebase has written about before.
     */
    const home = STATIC_PAGES.find(p => p.title === 'Dashboard')
    expect(home, 'the Dashboard row was not found').toBeDefined()
    for (const word of ['today', 'priorities', 'urgent', 'notifications', 'decisions']) {
      expect(home!.keywords, `"${word}" no longer reaches the home surface`).toContain(word)
    }
  })
})
