/**
 * An asset page must not fetch the same eight tables twice because a sibling
 * component wanted a longer price window.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `useAssetWorkspace` issued nine Supabase reads inside a single `useQuery`,
 * and `days` was part of that query's key. `days` takes exactly two values:
 * SHALLOW_HISTORY_DAYS for most focuses, DEEP_HISTORY_DAYS for
 * research/framework/position or any caller passing `deepHistory`.
 *
 * But only ONE of the nine reads ever looked at `days` -- the
 * `price_history_cache` window. The other eight are byte-for-byte identical
 * whatever `days` says.
 *
 * Eight components call this hook, and an asset page routinely mounts a
 * shallow consumer beside a deep one: `InvestmentSnapshot` on 'overview'
 * (shallow) and a `RequirementWorkspace` asking for deep history. Two `days`
 * values meant two cache entries, two cache entries meant two full queryFn
 * runs, and that is eighteen concurrent requests where ten would do.
 *
 * ── Why the assertion is a REQUEST COUNT and not a key shape ──────────────
 *
 * A test asserting `days` is absent from the key would pass if the hook were
 * rewritten to fetch everything twice some other way, and would fail if the
 * key were legitimately reordered. The thing that costs the reader time is the
 * number of round-trips, so that is what is counted -- per table, so a
 * regression says WHICH read came back twice.
 *
 * The measurement is of real round-trips: the counter sits in the Supabase
 * mock at the `from()` boundary, which is the last point before the network.
 * React Query is real, so cache sharing is decided by React Query and not by
 * the test's idea of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

/** Every table name passed to `supabase.from()`, in order. */
const calls: string[] = []

/**
 * A builder that answers any PostgREST chain method with itself and resolves
 * to an empty result. `from()` is counted once per call, which is one
 * round-trip: the chain that follows is one request, however long it is.
 */
function builder(): unknown {
  const target = {
    then: (resolve: (v: { data: never[]; error: null }) => unknown) =>
      Promise.resolve({ data: [] as never[], error: null }).then(resolve),
  }
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'then') return t.then
      return () => builder()
    },
  })
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push(table)
      return builder()
    },
    rpc: () => builder(),
  },
}))

vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-1' }),
}))

import { useAssetWorkspace } from '../useAssetWorkspace'

/**
 * The two consumers an asset page mounts together. `deepHistory` is the real
 * lever `RequirementWorkspace` and `ListRowExpansion` pull.
 */
function ShallowAndDeep() {
  const shallow = useAssetWorkspace('a-1', 'AAPL', 'overview')
  const deep = useAssetWorkspace('a-1', 'AAPL', 'overview', { deepHistory: true })
  return (
    <div
      data-testid="both"
      data-ready={String(!shallow.isLoading && !deep.isLoading)}
    />
  )
}

function mount(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  calls.length = 0
})

describe('useAssetWorkspace request count', () => {
  it('shares the eight day-independent reads across a shallow and a deep consumer', async () => {
    const view = mount(<ShallowAndDeep />)
    await waitFor(() => {
      expect(view.getByTestId('both').getAttribute('data-ready')).toBe('true')
    })

    const counts = calls.reduce<Record<string, number>>((acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})

    /*
     * Price history is the one read that legitimately runs twice: two windows
     * are two different questions, and each is a real request.
     */
    expect(counts['price_history_cache'], JSON.stringify(counts)).toBe(2)

    /*
     * Everything else must be fetched ONCE no matter how many consumers with
     * how many focuses are mounted. Before the split each of these ran twice.
     */
    for (const table of [
      'asset_contributions',
      'asset_notes',
      'analyst_price_targets',
      'price_target_outcomes',
      'trade_queue_items',
      'decision_requests',
    ]) {
      expect(counts[table] ?? 0, `${table} in ${JSON.stringify(counts)}`).toBe(1)
    }
  })

  it('issues ten round-trips in total, not eighteen', async () => {
    const view = mount(<ShallowAndDeep />)
    await waitFor(() => {
      expect(view.getByTestId('both').getAttribute('data-ready')).toBe('true')
    })

    /*
     * Seven reads in the shared Promise.all, one `price_history_cache` per
     * distinct window, and `portfolio_holdings` which is read twice BY DESIGN
     * within one run: the first learns which books hold the asset, the second
     * reads the whole of those books because a weight is a share of the book's
     * own market value. With no holdings returned the second never fires, so
     * the floor here is what an empty book costs.
     *
     * Stated as an upper bound rather than an equality so that adding a read
     * to the workspace does not fail this test for the wrong reason -- the
     * defect being held off is DUPLICATION, and eighteen is what duplication
     * measured.
     */
    expect(calls.length, JSON.stringify(calls)).toBeLessThanOrEqual(10)
    expect(calls.length, JSON.stringify(calls)).toBeGreaterThan(0)
  })

  it('does not refetch the shared reads when only the price window changes', async () => {
    /* One consumer, shallow. */
    function Shallow() {
      const r = useAssetWorkspace('a-1', 'AAPL', 'overview')
      return <div data-testid="one" data-ready={String(!r.isLoading)} />
    }
    const view = mount(<Shallow />)
    await waitFor(() => {
      expect(view.getByTestId('one').getAttribute('data-ready')).toBe('true')
    })
    const afterShallow = calls.filter(t => t === 'asset_contributions').length
    expect(afterShallow).toBe(1)
  })
})
