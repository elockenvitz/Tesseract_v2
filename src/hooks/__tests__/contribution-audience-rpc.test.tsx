/**
 * Security Release C — the client half.
 *
 * The database now makes the old direct writes impossible rather than merely
 * discouraged: a BEFORE UPDATE trigger pins `visibility` and `team_id` for
 * every caller except the RPC's owning role, and `authenticated` has lost
 * INSERT/UPDATE/DELETE on contribution_visibility_targets. A client that still
 * issues them does not fail loudly — the field write is silently preserved and
 * the target write is refused into an error the old code only logged. The user
 * sees "saved" and nothing changes.
 *
 * So these assertions are about what the client must NOT send, which is the
 * half a green manual test cannot show you:
 *
 *   1. An audience change goes through set_contribution_audience and nowhere
 *      near contribution_visibility_targets.
 *   2. A content save carries no `visibility` or `team_id` at all, and does not
 *      touch the target table — a save cannot widen or destroy an audience.
 *   3. A content save that does NOT change the audience issues no audience
 *      write whatsoever.
 *   4. An RPC error propagates. The old code console.error'd these, which is
 *      how a picker that did nothing still reported success.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const env = vi.hoisted(() => ({
  /** Every supabase.from(table) call, in order. */
  tables: [] as Array<{ table: string; op: string; payload?: unknown }>,
  /** Every supabase.rpc(name, args) call, in order. */
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcError: null as null | { message: string },
  /** The contribution the hook's lookup finds, and its stored targets. */
  existing: { id: 'c1', visibility: 'team', content: 'old', draft_content: null } as Record<string, unknown>,
  storedTargets: [{ node_id: 'team-1' }] as Array<{ node_id: string }>,
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-1' }),
}))
vi.mock('../useAIConfig', () => ({ useAIConfig: () => ({ effectiveConfig: {} }) }))
vi.mock('../../lib/revision-service', () => ({
  findOrCreateRevision: vi.fn(() => Promise.resolve('rev-1')),
  addRevisionEvents: vi.fn(() => Promise.resolve()),
  sectionToCategory: () => 'thesis',
  getSignificanceTier: () => 2,
}))

vi.mock('../../lib/supabase', () => {
  /** A chainable PostgREST double that records the operation it was asked for. */
  const builder = (table: string) => {
    const record: { table: string; op: string; payload?: unknown } = { table, op: 'select' }
    env.tables.push(record)

    const chain: Record<string, unknown> = {}
    const self = () => chain

    // Terminal shapes the hook awaits.
    const resolved = () => {
      if (table === 'contribution_visibility_targets') {
        return { data: env.storedTargets, error: null }
      }
      return { data: { ...env.existing, user: null }, error: null }
    }

    for (const k of ['select', 'eq', 'order', 'limit', 'is']) {
      chain[k] = (...a: unknown[]) => { void a; return self() }
    }
    chain.update = (payload: unknown) => { record.op = 'update'; record.payload = payload; return self() }
    chain.insert = (payload: unknown) => { record.op = 'insert'; record.payload = payload; return self() }
    chain.delete = () => { record.op = 'delete'; return self() }
    chain.maybeSingle = () => Promise.resolve({ data: env.existing, error: null })
    chain.single = () => Promise.resolve(resolved())
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(resolved()).then(res)

    return chain
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        env.rpcs.push({ name, args })
        return Promise.resolve(
          env.rpcError
            ? { data: null, error: env.rpcError }
            : { data: { contribution_id: 'c1', visibility: args.p_visibility, node_count: 1 }, error: null }
        )
      },
    },
  }
})

import { useContributions } from '../useContributions'

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const targetWrites = () =>
  env.tables.filter(t => t.table === 'contribution_visibility_targets' && t.op !== 'select')

const contributionUpdates = () =>
  env.tables.filter(t => t.table === 'asset_contributions' && t.op === 'update')

beforeEach(() => {
  env.tables.length = 0
  env.rpcs.length = 0
  env.rpcError = null
  env.existing = { id: 'c1', visibility: 'team', content: 'old', draft_content: null }
  env.storedTargets = [{ node_id: 'team-1' }]
})

describe('contribution audience goes through the RPC', () => {
  it('updateVisibility calls set_contribution_audience and never writes the target table', async () => {
    const { result } = renderHook(() => useContributions({ assetId: 'a1' }), { wrapper })

    await result.current.updateVisibility.mutateAsync({
      contributionId: 'c1',
      visibility: 'department',
      targetIds: ['dept-9'],
    })

    expect(env.rpcs).toEqual([
      {
        name: 'set_contribution_audience',
        args: { p_contribution_id: 'c1', p_visibility: 'department', p_node_ids: ['dept-9'] },
      },
    ])
    expect(targetWrites()).toEqual([])
    // and it does not write the pinned fields by hand either
    expect(contributionUpdates()).toEqual([])
  })

  it('an RPC failure propagates instead of being logged', async () => {
    env.rpcError = { message: 'contribution not found or not yours' }
    const { result } = renderHook(() => useContributions({ assetId: 'a1' }), { wrapper })

    await expect(
      result.current.updateVisibility.mutateAsync({
        contributionId: 'c1',
        visibility: 'firm',
        targetIds: [],
      })
    ).rejects.toMatchObject({ message: 'contribution not found or not yours' })
  })
})

describe('a content save cannot change the audience', () => {
  it('sends no visibility or team_id, and no target writes', async () => {
    const { result } = renderHook(() => useContributions({ assetId: 'a1' }), { wrapper })

    await result.current.saveContribution.mutateAsync({
      content: 'new prose',
      sectionKey: 'thesis',
      visibility: 'team',
      targetIds: ['team-1'],
    })

    const updates = contributionUpdates()
    expect(updates).toHaveLength(1)
    const payload = updates[0].payload as Record<string, unknown>
    expect(payload).toHaveProperty('content', 'new prose')
    expect(payload).not.toHaveProperty('visibility')
    expect(payload).not.toHaveProperty('team_id')
    expect(targetWrites()).toEqual([])
  })

  it('issues NO audience write when the audience is unchanged', async () => {
    const { result } = renderHook(() => useContributions({ assetId: 'a1' }), { wrapper })

    await result.current.saveContribution.mutateAsync({
      content: 'new prose',
      sectionKey: 'thesis',
      visibility: 'team',          // same as stored
      targetIds: ['team-1'],       // same as stored
    })

    expect(env.rpcs).toEqual([])
  })

  it('routes a deliberate audience change in the same save through the RPC', async () => {
    const { result } = renderHook(() => useContributions({ assetId: 'a1' }), { wrapper })

    await result.current.saveContribution.mutateAsync({
      content: 'new prose',
      sectionKey: 'thesis',
      visibility: 'firm',          // differs from stored 'team'
      targetIds: [],
    })

    expect(env.rpcs).toHaveLength(1)
    expect(env.rpcs[0].name).toBe('set_contribution_audience')
    expect(env.rpcs[0].args.p_visibility).toBe('firm')
    expect(targetWrites()).toEqual([])
  })
})

describe('publishDraft', () => {
  it('publishes content without the pinned fields and routes an audience change to the RPC', async () => {
    env.existing = { id: 'c1', visibility: 'team', content: 'old', draft_content: 'drafted' }
    const { result } = renderHook(() => useContributions({ assetId: 'a1' }), { wrapper })

    await result.current.publishDraft.mutateAsync({
      sectionKey: 'thesis',
      visibility: 'division',
      targetIds: ['div-2'],
    })

    const updates = contributionUpdates()
    expect(updates).toHaveLength(1)
    const payload = updates[0].payload as Record<string, unknown>
    expect(payload).toHaveProperty('content', 'drafted')
    expect(payload).not.toHaveProperty('visibility')
    expect(payload).not.toHaveProperty('team_id')
    expect(targetWrites()).toEqual([])

    await waitFor(() => expect(env.rpcs).toHaveLength(1))
    expect(env.rpcs[0].args.p_visibility).toBe('division')
  })
})
