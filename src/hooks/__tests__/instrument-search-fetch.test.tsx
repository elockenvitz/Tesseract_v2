/**
 * Proof that the symbol search FETCHES the ticker, not merely sorts it up.
 *
 * ── Why a ranking test is not enough ─────────────────────────────────────
 *
 * `lib/charting/__tests__/instrument-ranking` proves the ordering. But the
 * original defect had two halves, and ordering is the easier one:
 *
 *   `.or(symbol.ilike.%Q%,company_name.ilike.%Q%).limit(10)` applies its
 *   limit in the DATABASE. For "MS" the `%ms%` pattern matched hundreds of
 *   assets and the ten returned were an arbitrary ten -- measured against
 *   the live corpus, Morgan Stanley and MSCI were not among them AT ALL.
 *
 * A ranking test passes just as happily on a result set that never contained
 * the answer. So the fake below models the real constraint: a broad query
 * that returns a capped, arbitrary page which EXCLUDES the exact ticker.
 * The only way the ticker can reach the list is the narrow
 * `symbol.ilike.Q%` query -- which is exactly the row the path must fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
/* Safe above `vi.mock` -- vitest hoists the mock factory above every
   import, which is also why `env` below is created with `vi.hoisted`. */
import { useInstrumentSearch } from '../useInstrumentSearch'

interface Row { id: string; symbol: string; company_name: string | null }

const env = vi.hoisted(() => ({
  /* Every asset the database holds. */
  corpus: [] as Row[],
  /* What the BROAD query is allowed to return, regardless of what matches:
     the database's own limit, applied before the client sees anything. */
  broadCap: 3,
  prefixQueries: [] as string[],
  broadQueries: [] as string[],
}))

vi.mock('../../lib/supabase', () => {
  const makeChain = () => {
    const state: { kind: 'none' | 'prefix' | 'broad'; pattern: string; limit: number } = {
      kind: 'none', pattern: '', limit: 1000,
    }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.ilike = (_col: string, pattern: string) => {
      state.kind = 'prefix'
      state.pattern = pattern
      env.prefixQueries.push(pattern)
      return chain
    }
    chain.or = (expr: string) => {
      state.kind = 'broad'
      state.pattern = expr
      env.broadQueries.push(expr)
      return chain
    }
    chain.limit = (n: number) => { state.limit = n; return chain }
    chain.then = (resolve: (v: unknown) => unknown) => {
      let data: Row[] = []
      if (state.kind === 'prefix') {
        const q = state.pattern.replace(/%$/, '').toLowerCase()
        data = env.corpus.filter(r => r.symbol.toLowerCase().startsWith(q))
      } else if (state.kind === 'broad') {
        const q = (/ilike\.%([^%]*)%/.exec(state.pattern)?.[1] ?? '').toLowerCase()
        const all = env.corpus.filter(r =>
          r.symbol.toLowerCase().includes(q) ||
          (r.company_name ?? '').toLowerCase().includes(q))
        /* THE constraint being modelled: the database caps the page, and the
           page it happens to return is not the one containing the answer. */
        data = all.slice(0, env.broadCap)
      }
      return Promise.resolve({ data, error: null }).then(resolve)
    }
    return chain
  }
  return { supabase: { from: () => makeChain() } }
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  env.corpus = []
  env.broadCap = 3
  env.prefixQueries = []
  env.broadQueries = []
})

describe('the exact ticker reaches the list even when the broad page excludes it', () => {
  beforeEach(() => {
    /* Ordered so the broad query's first three are all name-matches on "ms"
       -- the arrangement actually measured, where META, QS and CDNS came
       back and Morgan Stanley did not. */
    env.corpus = [
      { id: '1', symbol: 'META', company_name: 'Meta Platforms, Inc.' },
      { id: '2', symbol: 'QS', company_name: 'QuantumScape Corporation' },
      { id: '3', symbol: 'CDNS', company_name: 'Cadence Design Systems, Inc.' },
      { id: '4', symbol: 'MS', company_name: 'Morgan Stanley' },
      { id: '5', symbol: 'MSCI', company_name: 'MSCI Inc.' },
    ]
  })

  it('returns Morgan Stanley first, though the broad page never held it', async () => {
    const { result } = renderHook(() => useInstrumentSearch('MS'), { wrapper })
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0), { timeout: 3000 })
    expect(result.current.results[0].symbol).toBe('MS')
  })

  it('issues the narrow prefix query, which is the only path to that row', async () => {
    const { result } = renderHook(() => useInstrumentSearch('MS'), { wrapper })
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0), { timeout: 3000 })
    expect(env.prefixQueries, 'no symbol-prefix query was issued').toContain('MS%')
    expect(env.broadQueries.length, 'the broad query was dropped').toBeGreaterThan(0)
  })

  it('still includes the capped broad matches, so name search is not lost', async () => {
    const { result } = renderHook(() => useInstrumentSearch('MS'), { wrapper })
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(2), { timeout: 3000 })
    expect(result.current.results.map(r => r.symbol)).toContain('META')
  })
})

describe('the request shape', () => {
  it('asks for nothing at all on an empty query', async () => {
    const { result } = renderHook(() => useInstrumentSearch(''), { wrapper })
    await new Promise(r => setTimeout(r, 400))
    expect(env.prefixQueries).toEqual([])
    expect(env.broadQueries).toEqual([])
    expect(result.current.results).toEqual([])
  })

  it('debounces, so a burst of keystrokes is ONE pair of requests', async () => {
    env.corpus = [{ id: '1', symbol: 'NVDA', company_name: 'NVIDIA Corporation' }]
    const { rerender } = renderHook(({ q }) => useInstrumentSearch(q), {
      wrapper, initialProps: { q: 'N' },
    })
    for (const q of ['NV', 'NVI', 'NVID', 'NVIDI']) {
      rerender({ q })
      await new Promise(r => setTimeout(r, 40))
    }
    await new Promise(r => setTimeout(r, 900))
    /* Five keystrokes. Without the debounce this is five pairs. */
    expect(env.prefixQueries.length, `prefix queries: ${env.prefixQueries.join(',')}`)
      .toBeLessThanOrEqual(2)
    expect(env.broadQueries.length).toBeLessThanOrEqual(2)
  })

  it('a bare "%" asks for nothing rather than for the whole table', async () => {
    env.corpus = [
      { id: '1', symbol: 'AAPL', company_name: 'Apple Inc.' },
      { id: '2', symbol: 'MSFT', company_name: 'Microsoft Corporation' },
    ]
    const { result } = renderHook(() => useInstrumentSearch('%'), { wrapper })
    await new Promise(r => setTimeout(r, 700))
    expect(env.prefixQueries, 'a lone wildcard was sent to the database').toEqual([])
    expect(result.current.results).toEqual([])
  })

  it('does NOT strip the underscore, because CASH_USD is a real symbol', async () => {
    /* The tempting fix -- strip every wildcard character -- would turn
       "CASH_USD" into "CASHUSD" and make that instrument unfindable. */
    env.corpus = [{ id: '1', symbol: 'CASH_USD', company_name: 'Cash & Equivalents' }]
    const { result } = renderHook(() => useInstrumentSearch('CASH_USD'), { wrapper })
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0), { timeout: 3000 })
    expect(result.current.results[0].symbol).toBe('CASH_USD')
    expect(env.prefixQueries).toContain('CASH_USD%')
  })

  it('drops a comma, which would otherwise restructure the or() filter', async () => {
    env.corpus = [{ id: '1', symbol: 'BRKB', company_name: 'Berkshire Hathaway' }]
    renderHook(() => useInstrumentSearch('Berkshire, Inc'), { wrapper })
    await new Promise(r => setTimeout(r, 700))
    for (const expr of env.broadQueries) {
      /* Exactly two commas: the one separating the two ilike terms. A third
         would mean the typed comma reached the filter as a separator. */
      expect((expr.match(/,/g) ?? []).length, `filter restructured: ${expr}`).toBe(1)
    }
  })
})
