/**
 * The attention feed asks everything at once.
 *
 * ── Why this is a performance test with no timings in it ──────────────────
 *
 * "The application can still feel slow to load." No browser was available
 * this session, so nothing here claims a millisecond. What it does claim is
 * structural and is the thing a profile would have had to point at anyway:
 * how many round trips deep the feed is before it can answer.
 *
 * Depth is observable without a clock. Hold every read open and never
 * resolve it, then look at which reads were ISSUED. A read that was waiting
 * behind an `await` cannot have been issued, so the set of tables requested
 * in the first wave is exactly the feed's first layer -- and a read that
 * should be in that layer and is not is a round trip the reader pays for in
 * series.
 *
 * ── The two that were in series ──────────────────────────────────────────
 *
 *   attention_user_state   Its own `await`, ahead of all thirteen
 *                          collectors, although no collector reads it: it
 *                          is used after they return, to drop what the
 *                          reader dismissed or snoozed and to merge read
 *                          state into the rest. One trip, on the critical
 *                          path of every load and every refetch.
 *   the context of a       `collectQuickThoughts` read the reader's own
 *   quick thought          thoughts, then their holdings, then their
 *                          project assignments, then their portfolios --
 *                          four trips in a row where only the teammate
 *                          query at the end depends on any of them. It runs
 *                          inside the fan-out, so its depth is the fan-out's
 *                          depth whenever it is the slowest member.
 *
 * Both are reorderings. The queries, their filters and their results are
 * unchanged, which is why "it returns the same thing" is not what this
 * tests -- the suites that cover the feed's output already do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/** Every table `from()` was called with, in order. */
const asked: string[] = []

vi.mock('../../lib/supabase', () => {
  /*
   * A chain that is never answered.
   *
   * `then` hands back a promise that does not settle, so every `await` in
   * the feed parks forever and the reads that were already in flight are the
   * only ones recorded. That is the measurement.
   */
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'or', 'order', 'limit', 'not']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.then = () => new Promise(() => {})
  chain.maybeSingle = () => new Promise(() => {})
  chain.single = () => new Promise(() => {})
  return {
    supabase: {
      from: vi.fn((table: string) => { asked.push(table); return chain }),
      rpc: vi.fn(() => new Promise(() => {})),
    },
  }
})

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'reader@example.com' } }),
}))

const ORG = 'org-a'
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: ORG }),
  useOrganizationOptional: () => ({ currentOrgId: ORG }),
}))

vi.mock('../../lib/memory/obligation-writer', () => ({
  syncIdeaRevisitObligation: vi.fn(),
}))

import { useAttention } from '../useAttention'

let client: QueryClient
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

/**
 * Mount the feed and let every read that is not behind an `await` go out.
 *
 * A handful of macrotasks, because the fan-out is built through several
 * layers of promise construction before the first read leaves. Nothing
 * resolves, so waiting longer cannot let a SECOND layer through -- which is
 * what makes the recorded set the first layer and not a timing race.
 */
async function firstWave(): Promise<string[]> {
  renderHook(() => useAttention(), { wrapper: wrap })
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
  return [...asked]
}

beforeEach(() => {
  asked.length = 0
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('the first layer of the attention feed', () => {
  it('asks for the reader s own state alongside the collectors, not before them', async () => {
    const wave = await firstWave()

    expect(wave).toContain('attention_user_state')
    /* The point: it is not alone. With it in series, this was the only
       table in the wave and all thirteen collectors were still parked. */
    expect(wave.filter(t => t !== 'attention_user_state').length).toBeGreaterThan(5)
  })

  it('opens every collector in the same wave', async () => {
    const wave = await firstWave()

    /* One first read per collector, by the table each of them opens with.
       Several collectors share `project_assignments`, so this is a
       containment check rather than a count. */
    for (const table of [
      'project_assignments', 'trade_queue_items', 'asset_list_suggestions',
      'notifications', 'quick_thoughts', 'projects', 'portfolio_team',
      'coverage', 'personal_tasks',
    ]) {
      expect(wave, `${table} was still parked behind an await`).toContain(table)
    }
  })

  it('asks for a quick thought s context in the same wave as the thought', async () => {
    const wave = await firstWave()

    /* `portfolio_holdings` and `portfolios` are no other collector's first
       read, so their presence here is this collector's four-deep chain
       having become one. */
    expect(wave).toContain('quick_thoughts')
    expect(wave).toContain('portfolio_holdings')
    expect(wave).toContain('project_assignments')
    expect(wave).toContain('portfolios')
  })

  it('issues each of those reads once, not once per collector that wants it', async () => {
    const wave = await firstWave()

    /* A guard against the obvious wrong fix: duplicating a read into the
       same wave trades depth for load and is not what was done here. The
       reader's own state is read exactly once per computation. */
    expect(wave.filter(t => t === 'attention_user_state')).toHaveLength(1)
    expect(wave.filter(t => t === 'portfolio_holdings')).toHaveLength(1)
  })
})
