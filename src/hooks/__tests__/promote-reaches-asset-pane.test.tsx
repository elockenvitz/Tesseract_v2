/**
 * A promoted idea has to reach the asset pane that lists live ideas.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 *
 * `usePromoteToTradeIdea` inserts a `trade_queue_items` row carrying an
 * `asset_id`. The dashboard asset pane's "Live ideas" section reads exactly
 * that -- the asset's trade queue items with a null outcome and a
 * non-terminal status, which a freshly promoted idea is -- under
 * `['asset-workspace', ...]`, with a 60-second `staleTime`.
 *
 * It invalidated the quick-thought keys, the trade queue and the ideas feed,
 * and not that one. So a reader promoted a thought and walked to the asset,
 * and the asset said nothing new had been proposed. For up to a minute: the
 * pane does not even refetch on mount inside the stale window.
 *
 * ── Why the assertion is on the cache and not on a spy ──────────────────
 *
 * Twelve writers already call `invalidateAssetWorkspace`, and the point of
 * the helper is that none of them has to know the key's shape -- the key
 * carries the asset id, the symbol, the history depth AND the organisation.
 * A test that asserted "the helper was called" would pass against a helper
 * invalidating the wrong prefix. This seeds the real key, runs the real
 * mutation, and asks the cache whether the pane will refetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/* A chain that answers whatever the mutation asks of it, so the test is
   about the invalidation rather than about Supabase's builder. */
const insertedRow = { data: { id: 'tq-new' }, error: null }
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'insert', 'select', 'update', 'eq']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.single = vi.fn(async () => insertedRow)
  /* `.update(...).eq(...)` is awaited directly, with no terminal call. */
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
  return { supabase: chain }
})
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }))
vi.mock('../../components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

import { usePromoteToTradeIdea } from '../usePromoteToTradeIdea'

/** The real keys, copied from the hooks that own them. */
const PANE = ['asset-workspace', 'a-1', 'AAPL', 90, 'org-a']
/** A neighbouring asset, to prove the prefix marks every asset's entry. */
const OTHER_ASSET = ['asset-workspace', 'a-2', 'MSFT', 12, 'org-a']
/** Nothing to do with what has been proposed; must not be swept up. */
const UNRELATED = ['asset-prices', 'a-1']

let client: QueryClient
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const stale = (key: unknown[]) => client.getQueryState(key)?.isInvalidated === true

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  for (const key of [PANE, OTHER_ASSET, UNRELATED]) client.setQueryData(key, { seeded: true })
})

describe('promoting a quick thought to a trade idea', () => {
  it('makes the asset pane that lists live ideas refetch', async () => {
    const { result } = renderHook(() => usePromoteToTradeIdea(), { wrapper: wrap })
    await result.current.promote({
      quickThoughtId: 'qt-1',
      quickThoughtContent: 'Channel checks look better than the print implies.',
      action: 'buy',
      assignedTo: 'u-1',
      assetId: 'a-1',
    })

    await waitFor(() => expect(stale(PANE)).toBe(true))
    /* The prefix, not the asset: the key also carries the symbol, the
       history depth and the organisation, so an id-scoped invalidation
       would miss whichever variant the reader was looking at. */
    expect(stale(OTHER_ASSET)).toBe(true)
    /* And nothing further. An invalidation that swept the whole cache would
       also satisfy the first assertion. */
    expect(stale(UNRELATED)).toBe(false)
  })

  it('leaves the pane alone when the promotion fails', async () => {
    /* `onSuccess` only. A reader whose promotion errored should not have a
       pane refetching to show a row that was never written. */
    const { result } = renderHook(() => usePromoteToTradeIdea(), { wrapper: wrap })
    insertedRow.error = { message: 'denied' } as never
    await expect(result.current.promote({
      quickThoughtId: 'qt-1',
      quickThoughtContent: 'x',
      action: 'buy',
      assignedTo: 'u-1',
      assetId: 'a-1',
    })).rejects.toBeTruthy()

    expect(stale(PANE)).toBe(false)
    insertedRow.error = null
  })
})
