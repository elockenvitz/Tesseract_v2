/**
 * A true 0% benchmark weight against an unknown one.
 *
 * The fake client answers the two reads `fetchBenchmarkWeight` makes — the
 * portfolio's newest file date, then the asset's row in that file — and records
 * the filters, so each case is pinned to what was actually asked.
 */
import type { ReactNode } from 'react'
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  fetchBenchmarkWeight, knownBenchmarkWeightPct, BenchmarkLookupError,
  type BenchmarkQueryClient,
} from '../benchmark-membership'
import { buildPositionChartData, metricAvailability } from '../../../components/outcomes/position-chart-model'
import type { PositionLifecycle } from '../../../hooks/usePositionLifecycle'

type Answer = { data: Array<Record<string, unknown>> | null; error: { message: string } | null }

/** file: answer to the newest-file read; row: answer to the asset-row read. */
function fakeClient(answers: { file: Answer; row?: Answer }) {
  const calls: Array<{ select: string; filters: Array<[string, string, unknown]> }> = []
  const client: BenchmarkQueryClient = {
    from: () => ({
      select(columns: string) {
        const call = { select: columns, filters: [] as Array<[string, string, unknown]> }
        calls.push(call)
        const answer = () => (columns === 'as_of_date' ? answers.file : answers.row ?? { data: [], error: null })
        const builder = {
          eq(c: string, v: string) { call.filters.push(['eq', c, v]); return builder },
          is(c: string, v: null) { call.filters.push(['is', c, v]); return builder },
          order() { return builder },
          limit() { return builder },
          then(resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(answer()).then(resolve, reject)
          },
        }
        return builder as unknown as ReturnType<ReturnType<BenchmarkQueryClient['from']>['select']>
      },
    }),
  }
  return { client, calls }
}

const FILE = { data: [{ as_of_date: '2026-08-14' }], error: null }

describe('fetchBenchmarkWeight', () => {
  it('a member of the newest file reads its weight', async () => {
    const { client, calls } = fakeClient({ file: FILE, row: { data: [{ weight: 1.25, as_of_date: '2026-08-14' }], error: null } })
    expect(await fetchBenchmarkWeight(client, 'p-1', 'a-1')).toEqual({ status: 'member', weightPct: 1.25, asOfDate: '2026-08-14' })
    // The asset row is looked up IN the newest file, not across files.
    expect(calls[1].filters).toContainEqual(['eq', 'as_of_date', '2026-08-14'])
    expect(calls[1].filters).toContainEqual(['eq', 'asset_id', 'a-1'])
  })

  it('a file that was read and does not contain the asset is a real 0%', async () => {
    const { client } = fakeClient({ file: FILE, row: { data: [], error: null } })
    const result = await fetchBenchmarkWeight(client, 'p-1', 'a-1')
    expect(result).toEqual({ status: 'not_member', weightPct: 0, asOfDate: '2026-08-14' })
    expect(knownBenchmarkWeightPct(result)).toBe(0)
  })

  it('a failed file lookup is an error, never 0%', async () => {
    const { client, calls } = fakeClient({ file: { data: null, error: { message: 'permission denied' } } })
    await expect(fetchBenchmarkWeight(client, 'p-1', 'a-1')).rejects.toBeInstanceOf(BenchmarkLookupError)
    expect(calls).toHaveLength(1)
  })

  it('a failed asset lookup is an error, never 0%', async () => {
    const { client } = fakeClient({ file: FILE, row: { data: null, error: { message: 'timeout' } } })
    await expect(fetchBenchmarkWeight(client, 'p-1', 'a-1')).rejects.toThrow('timeout')
  })

  it('a portfolio with no benchmark file is unavailable, not 0%', async () => {
    const { client, calls } = fakeClient({ file: { data: [], error: null } })
    const result = await fetchBenchmarkWeight(client, 'p-1', 'a-1')
    expect(result).toEqual({ status: 'unavailable' })
    expect(knownBenchmarkWeightPct(result)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('a row with no weight is unavailable, not 0%', async () => {
    const { client } = fakeClient({ file: FILE, row: { data: [{ weight: null }], error: null } })
    expect(await fetchBenchmarkWeight(client, 'p-1', 'a-1')).toEqual({ status: 'unavailable' })
  })

  it('an undated file is matched as undated', async () => {
    const { client, calls } = fakeClient({ file: { data: [{ as_of_date: null }], error: null }, row: { data: [], error: null } })
    expect((await fetchBenchmarkWeight(client, 'p-1', 'a-1')).status).toBe('not_member')
    expect(calls[1].filters).toContainEqual(['is', 'as_of_date', null])
  })
})

describe('active weight from the benchmark', () => {
  const lifecycle = { timeline: [], currentPrice: null } as unknown as PositionLifecycle
  const prices = [{ date: '2026-09-01', close: 100 }, { date: '2026-09-02', close: 101 }]
  const holdings = [
    { date: '2026-09-01', shares: 100, marketValue: 10000, weightPct: 2 },
    { date: '2026-09-02', shares: 100, marketValue: 10100, weightPct: 2.02 },
  ]

  it('is the full weight for a confirmed non-member', () => {
    const rows = buildPositionChartData(lifecycle, prices, holdings, 0)
    expect(rows.map(r => r.activeWt)).toEqual([2, 2.02])
    expect(metricAvailability(rows).active_weight).toBe(true)
  })

  it('is not computed at all when the benchmark weight is unknown', () => {
    const rows = buildPositionChartData(lifecycle, prices, holdings, null)
    expect(rows.map(r => r.activeWt)).toEqual([null, null])
    expect(rows.map(r => r.weightPct)).toEqual([2, 2.02])
    expect(metricAvailability(rows)).toEqual({ shares: true, weight: true, active_weight: false })
  })
})

describe('through react-query', () => {
  it('a failure leaves the weight unknown, and a refetch that succeeds makes it known', async () => {
    let answers: { file: Answer; row?: Answer } = { file: { data: null, error: { message: 'network' } } }
    const client: BenchmarkQueryClient = { from: (t) => fakeClient(answers).client.from(t) }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

    const { result } = renderHook(
      () => useQuery({ queryKey: ['bench', 'p-1', 'a-1'], queryFn: () => fetchBenchmarkWeight(client, 'p-1', 'a-1') }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(knownBenchmarkWeightPct(result.current.data)).toBeNull()

    answers = { file: FILE, row: { data: [], error: null } }
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data?.status).toBe('not_member'))
    expect(knownBenchmarkWeightPct(result.current.data)).toBe(0)
  })
})
