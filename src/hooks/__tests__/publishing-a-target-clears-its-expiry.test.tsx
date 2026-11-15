/**
 * Publishing a price target has to stop the product calling it expired.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 *
 * `price_target_outcomes` is the authoritative record of whether a target
 * still stands, and publishing one resets that row to `pending` in the
 * database: `create_outcome_for_target` fires on INSERT and on UPDATE of
 * `analyst_price_targets`, recomputes the horizon and clears the evaluation.
 * So the moment a reader publishes a target for next year, the database has
 * stopped calling the old one expired.
 *
 * The client had not. Five write paths here invalidated the targets, the
 * scenario cards and the asset pane, and none of them invalidated the two
 * keys that carry the expiry:
 *
 *   ['target-outcomes', ...]   30 seconds. Read by the price-target section,
 *                              the outcome timeline and the target chart,
 *                              all of which get their freshness from it.
 *   ['expired-targets', uid]   FIVE MINUTES, and the "Price Targets Expired"
 *                              banner reads nothing else.
 *
 * A reader published a new target with an explicit horizon and the page went
 * on reporting the previous one as expired, from a cached answer taken before
 * the write. Not cosmetic: the surface was stating a lapsed valuation as the
 * firm's current one.
 *
 * ── Why the assertion is on the cache ────────────────────────────────────
 *
 * The same reason as `promote-reaches-asset-pane`: a test that asserted "the
 * helper was called" would pass against a helper invalidating the wrong
 * prefix. This seeds the real keys, in every variant shape the real hooks
 * use, runs the real mutation, and asks the cache whether those readers will
 * refetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/* A chain that answers whatever the mutations ask of it, so the test is about
   the invalidation rather than about Supabase's builder. */
const result: { error: unknown } = { error: null }
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  /* The publish path reads the existing row first. `null` is the
     "no target yet" branch, which takes the INSERT. */
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  chain.single = vi.fn(async () => ({ data: { id: 'pt-1' }, error: null }))
  /* `.update(...).eq(...)` and `.insert(...)` are awaited with no terminal
     call, so the chain is itself a thenable. */
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: result.error }).then(resolve)
  return { supabase: chain }
})
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }))
vi.mock('../../lib/revision-service', () => ({
  findOrCreateRevision: vi.fn(async () => ({ id: 'rev-1' })),
  addRevisionEvents: vi.fn(async () => undefined),
}))

import { useAnalystPriceTargets } from '../useAnalystPriceTargets'

/** The real keys, in the real shapes, copied from the hooks that own them. */
const OUTCOMES = ['target-outcomes', 'a-1', undefined, 'all', undefined]
/** A different variant of the same prefix: the timeline asks for one status. */
const OUTCOMES_PENDING = ['target-outcomes', 'a-1', 'u-1', 'pending', 'Base']
/** The banner's key. Five minutes of staleTime sat behind this one. */
const EXPIRED = ['expired-targets', 'u-1']
/** Another asset's entry, to show the prefix marks every variant. */
const OTHER_ASSET = ['target-outcomes', 'a-2', undefined, 'all', undefined]
/** Nothing to do with expiry; must not be swept up. */
const UNRELATED = ['asset-prices', 'a-1']

let client: QueryClient
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const stale = (key: unknown[]) => client.getQueryState(key)?.isInvalidated === true

const ALL = [OUTCOMES, OUTCOMES_PENDING, EXPIRED, OTHER_ASSET, UNRELATED]

beforeEach(() => {
  result.error = null
  client = new QueryClient({
    /* The real staleTimes, so that a test passing for the wrong reason -- a
       refetch the cache would have done anyway -- is not possible here. */
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
  })
  for (const key of ALL) client.setQueryData(key, { seeded: true })
})

const hook = () => renderHook(
  () => useAnalystPriceTargets({ assetId: 'a-1' }),
  { wrapper: wrap },
)

describe('publishing a price target', () => {
  it('marks every surface that states the expiry stale, and nothing else', async () => {
    const { result: r } = hook()
    await r.current.publishPriceTarget.mutateAsync({
      scenarioId: 's-base',
      scenarioName: 'Base',
      price: 400,
      timeframe: '12 months',
      timeframeType: 'date',
      /* An explicit future horizon: the case the reader reported. */
      targetDate: '2028-01-31',
    })

    await waitFor(() => expect(stale(OUTCOMES)).toBe(true))
    /* Both variants of the prefix, not just the one the editor happened to
       mount: the key carries the asset, the analyst, the status filter and
       the scenario, so an exactly-keyed invalidation would miss whichever
       variant the reader was actually looking at. */
    expect(stale(OUTCOMES_PENDING)).toBe(true)
    expect(stale(OTHER_ASSET)).toBe(true)
    /* The banner. Five minutes, and the only key behind it. */
    expect(stale(EXPIRED)).toBe(true)
    /* And nothing further. An invalidation that swept the whole cache would
       also satisfy every assertion above. */
    expect(stale(UNRELATED)).toBe(false)
  })

  it('leaves the expiry alone when the write fails', async () => {
    /* `onSuccess` only. A reader whose publish errored still has the old
       target standing, and the expiry on screen is still the right answer. */
    result.error = { message: 'denied' }
    const { result: r } = hook()
    await expect(r.current.publishPriceTarget.mutateAsync({
      scenarioId: 's-base', price: 400, timeframeType: 'date', targetDate: '2028-01-31',
    })).rejects.toBeTruthy()

    expect(stale(OUTCOMES)).toBe(false)
    expect(stale(EXPIRED)).toBe(false)
  })
})

describe('the other four writers that can change an expiry', () => {
  /* Each of these moves the published horizon or removes the target, so each
     one changes the answer the two keys above are caching. They were listed
     in the report as "invalidates its own key"; none of them invalidated
     these. Covered together because the defect was one omission repeated. */
  it('savePriceTarget marks the expiry stale', async () => {
    const { result: r } = hook()
    await r.current.savePriceTarget.mutateAsync({
      scenarioId: 's-base', price: 410, timeframe: '18 months',
    })
    await waitFor(() => expect(stale(EXPIRED)).toBe(true))
    expect(stale(OUTCOMES)).toBe(true)
  })

  it('deletePriceTarget marks the expiry stale', async () => {
    const { result: r } = hook()
    await r.current.deletePriceTarget.mutateAsync('pt-1')
    await waitFor(() => expect(stale(EXPIRED)).toBe(true))
    expect(stale(OUTCOMES)).toBe(true)
  })

  it('saveDraftPriceTarget marks the expiry stale', async () => {
    const { result: r } = hook()
    await r.current.saveDraftPriceTarget.mutateAsync({
      scenarioId: 's-base', price: 420, timeframe: '6 months',
    })
    await waitFor(() => expect(stale(EXPIRED)).toBe(true))
  })

  it('discardDraft marks the expiry stale', async () => {
    const { result: r } = hook()
    await r.current.discardDraft.mutateAsync('pt-1')
    await waitFor(() => expect(stale(EXPIRED)).toBe(true))
  })
})
