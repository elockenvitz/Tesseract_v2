/**
 * Portfolio never states an active weight against a benchmark it does not have.
 *
 * A book with no `portfolio_benchmark_weights` rows came back as `{}`, which
 * passed the "have data" check, so every held line was compared with a zero
 * index weight and the strip printed "~50% active share · 35 overweight · 0
 * underweight" for a book with no benchmark. 29 active portfolios had no file
 * on 2026-09-15, every pilot book among them.
 *
 * Absent or failed → say so, compute nothing. Loaded with rows → a held name
 * missing from the file is confirmed out of the index and may be 0%.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const db = vi.hoisted(() => ({ rows: [] as unknown[], error: null as { message: string } | null }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'in']) chain[op] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: db.error ? null : db.rows, error: db.error }).then(resolve)
      return chain
    },
  },
}))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'org-1' }) }))
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import { useActiveWeights } from '../useDesktopPortfolio'
import { benchmarkFileFrom, compareToBenchmark } from '../../lib/desktop-portfolio/benchmark'
import { ActiveWeights } from '../../components/portfolio-v2/ActiveWeights'

const position = (assetId: string, weightPct: number, over: Record<string, unknown> = {}) => ({
  portfolioId: 'p1', assetId, symbol: assetId.toUpperCase(), companyName: null, sector: null,
  shares: 1, price: 1, avgCost: null, marketValue: weightPct, weightPct, asOf: null, isCash: false, ...over,
})

const book = {
  portfolioId: 'p1',
  positions: [position('aapl', 6), position('msft', 5), position('nvda', 4), position('tsla', 3), position('cash', 2, { isCash: true })],
  totalValue: 20, cashValue: 2, cashPct: 10, positionCount: 4, asOf: null,
}

afterEach(cleanup)

describe('the comparison rule', () => {
  it('computes nothing while the file is loading, failed, or absent', () => {
    expect(compareToBenchmark(book, { kind: 'loading' })).toEqual({ state: 'loading', rows: [] })
    expect(compareToBenchmark(book, { kind: 'failed' })).toEqual({ state: 'unavailable', rows: [] })
    expect(compareToBenchmark(book, { kind: 'loaded', weights: {} })).toEqual({ state: 'none', rows: [] })
    expect(compareToBenchmark(null, { kind: 'loaded', weights: { aapl: 7 } }).state).toBe('loading')
  })

  it('treats a held name absent from a loaded file as 0%, and adds material index-only names', () => {
    const { state, rows } = compareToBenchmark(book, { kind: 'loaded', weights: { aapl: 7, msft: 5, googl: 4, tiny: 0.1 } })
    expect(state).toBe('ready')
    const by = Object.fromEntries(rows.map(r => [r.assetId, r]))
    expect(by.aapl).toMatchObject({ benchPct: 7, activePct: -1 })
    expect(by.msft).toMatchObject({ benchPct: 5, activePct: 0 })
    // Confirmed absent from the file that loaded: 0% is a fact, not a guess.
    expect(by.nvda).toMatchObject({ benchPct: 0, activePct: 4 })
    expect(by.googl).toMatchObject({ weightPct: 0, benchPct: 4, activePct: -4 })
    expect(by.tiny).toBeUndefined()
    expect(by.cash).toBeUndefined()
  })

  it('refuses a file with a constituent whose weight is unknown', () => {
    expect(benchmarkFileFrom([{ asset_id: 'aapl', weight: 7 }, { asset_id: 'msft', weight: null }])).toEqual({ kind: 'failed' })
    expect(benchmarkFileFrom([{ asset_id: 'aapl', weight: 'n/a' }])).toEqual({ kind: 'failed' })
    expect(benchmarkFileFrom([{ asset_id: 'aapl', weight: '7.5' }])).toEqual({ kind: 'loaded', weights: { aapl: 7.5 } })
    expect(benchmarkFileFrom([])).toEqual({ kind: 'loaded', weights: {} })
  })
})

describe('useActiveWeights against the database', () => {
  const run = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    return renderHook(() => useActiveWeights(book), { wrapper })
  }
  beforeEach(() => { db.rows = []; db.error = null })

  it('reports no benchmark on file when the book has none', async () => {
    const { result } = run()
    await waitFor(() => expect(result.current.state).toBe('none'))
    expect(result.current.rows).toEqual([])
  })

  it('reports the benchmark unavailable when the read fails', async () => {
    db.error = { message: 'permission denied' }
    const { result } = run()
    await waitFor(() => expect(result.current.state).toBe('unavailable'))
    expect(result.current.rows).toEqual([])
  })

  it('compares against a file that loaded', async () => {
    db.rows = [
      { asset_id: 'aapl', weight: 7, portfolio_id: 'p1', as_of_date: '2026-09-12' },
      { asset_id: 'msft', weight: 5, portfolio_id: 'p1', as_of_date: '2026-09-12' },
    ]
    const { result } = run()
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.rows.find(r => r.assetId === 'nvda')).toMatchObject({ benchPct: 0, activePct: 4 })
  })
})

describe('the strip', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
    assetId: `a${i}`, symbol: `S${i}`, companyName: null,
    weightPct: i % 2 ? 0 : 3, benchPct: i % 2 ? 2 : 1, activePct: i % 2 ? -2 : 2,
  }))

  it('says there is no benchmark, and prints no active share or counts', () => {
    render(<ActiveWeights comparison={{ state: 'none', rows: [] }} onOpen={() => {}} />)
    expect(screen.getByTestId('benchmark-absent')).toHaveTextContent('No benchmark on file')
    expect(document.body.textContent).not.toMatch(/active share|overweight|underweight|%/)
  })

  it('says the benchmark is unavailable when the read failed', () => {
    render(<ActiveWeights comparison={{ state: 'unavailable', rows: [] }} onOpen={() => {}} />)
    expect(screen.getByTestId('benchmark-absent')).toHaveTextContent('Benchmark unavailable')
    expect(document.body.textContent).not.toMatch(/active share|%/)
  })

  it('draws nothing while loading', () => {
    const { container } = render(<ActiveWeights comparison={{ state: 'loading', rows: [] }} onOpen={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('draws the comparison against a real file', () => {
    render(<ActiveWeights comparison={{ state: 'ready', rows: rows(6) }} onOpen={() => {}} />)
    expect(screen.getByText(/active share/)).toBeTruthy()
    expect(screen.queryByTestId('benchmark-absent')).toBeNull()
  })
})
