/**
 * A ruling has to reach the asset page that led with the request.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 *
 * The Overview now LEADS with "the decision in front of you" for a reader who
 * arrived to rule on something, and the sticky strip says "Awaiting a
 * decision". Both read `['asset-workspace', ...]`, which has a 60-second
 * staleTime; who proposed it comes from `['asset-work-requests', ...]` and the
 * history from `['asset-decision-timeline', ...]`.
 *
 * The inbox mutations invalidated `['decision-requests']` and the trade keys
 * and none of those three. So a PM who accepted a recommendation and walked
 * back to the asset was told, by the block at the top of the page, that the
 * ruling they had just made was still outstanding.
 *
 * These tests assert the cache state a real mutation leaves behind -- not that
 * a helper was called -- so the invalidation cannot be satisfied by naming the
 * table while the surfaces that answer the question stay fresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('../../lib/services/decision-request-service', () => ({
  createDecisionRequest: vi.fn(async () => ({ id: 'dr-7' })),
  updateDecisionRequest: vi.fn(async () => ({ id: 'dr-7' })),
  deleteDecisionRequest: vi.fn(async () => undefined),
  getAllDecisionRequests: vi.fn(async () => []),
  getNeedsDecisionRequests: vi.fn(async () => []),
  getDecisionRequestsForIdea: vi.fn(async () => []),
  RESOLVED_DECISION_REQUEST_STATUSES: ['accepted', 'rejected'],
}))
vi.mock('../../lib/services/inbox-accept-pipeline', () => ({
  acceptFromInbox: vi.fn(async () => ({ acceptedTradeId: 'at-1' })),
  rejectFromInbox: vi.fn(async () => ({ ok: true })),
  revertAcceptFromInbox: vi.fn(async () => undefined),
  findAcceptedTradeForDecisionRequest: vi.fn(async () => null),
}))
vi.mock('../usePilotProgress', () => ({
  usePilotProgress: () => ({ hasGraduated: true, cachedHasGraduated: true }),
}))

import {
  useCreateDecisionRequest,
  useUpdateDecisionRequest,
  useDeleteDecisionRequest,
  useAcceptFromInbox,
  useRejectFromInbox,
  useRevertDecisionAccept,
} from '../useDecisionRequests'

/** The real keys, copied from the hooks that own them. */
const SURFACES: Record<string, unknown[]> = {
  'the inbox list': ['decision-requests', 'all', 'all', true],
  'the Overview lead block and the strip': ['asset-workspace', 'a-1', 'AAPL', 90, 'org-a'],
  'who proposed it': ['asset-work-requests', 'a-1'],
  'the decision history': ['asset-decision-timeline', 'a-1', 'all', null],
}
/** A neighbouring asset, to prove the prefix marks every asset's entry. */
const OTHER_ASSET = ['asset-workspace', 'a-2', 'MSFT', 90, 'org-a']
/** Not about whether anything is waiting; must not be swept up. */
const UNRELATED = ['asset-prices', 'a-1']

let client: QueryClient
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const seed = () => {
  for (const key of Object.values(SURFACES)) client.setQueryData(key, { seeded: true })
  client.setQueryData(OTHER_ASSET, { seeded: true })
  client.setQueryData(UNRELATED, { seeded: true })
}

const stale = (key: unknown[]) => client.getQueryState(key)?.isInvalidated === true

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  seed()
})

/* Every way a request stops -- or starts -- waiting on a human. */
const RULINGS: Array<[string, () => { mutate: (v: never) => void }, unknown]> = [
  ['accepting it from the inbox', useAcceptFromInbox as never, { requestId: 'dr-7' }],
  ['rejecting it from the inbox', useRejectFromInbox as never, { requestId: 'dr-7' }],
  ['reverting an acceptance', useRevertDecisionAccept as never, { requestId: 'dr-7' }],
  ['updating it directly', useUpdateDecisionRequest as never, { requestId: 'dr-7', input: { status: 'accepted' } }],
  ['withdrawing it', useDeleteDecisionRequest as never, 'dr-7'],
  ['raising a new one', useCreateDecisionRequest as never, { tradeQueueItemId: 'tq-1' }],
]

describe.each(RULINGS)('%s', (_name, hook, variables) => {
  it('makes every surface that states what is waiting refetch', async () => {
    const { result } = renderHook(() => (hook as () => { mutate: (v: unknown) => void })(), { wrapper: wrap })
    result.current.mutate(variables)

    for (const [surface, key] of Object.entries(SURFACES)) {
      await waitFor(() => expect(stale(key), surface).toBe(true))
    }
    /* The prefix is deliberate: a reader with two assets open sees both
       corrected, and only the mounted one actually asks the server. */
    expect(stale(OTHER_ASSET)).toBe(true)
    expect(stale(UNRELATED)).toBe(false)
  })
})
