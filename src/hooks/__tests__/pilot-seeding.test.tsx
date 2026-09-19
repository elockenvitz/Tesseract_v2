/**
 * A pilot's workspace gets seeded whether or not they open Trade Lab.
 *
 * Both RPCs used to be called from `usePilotScenario`, which mounts only
 * inside `SimulationPage` — a lazily-loaded Trade Lab tab. A fresh pilot who
 * set up coverage, captured an idea and opened Idea Pipeline, the order the
 * mission itself teaches, reached an empty board that nothing had ever
 * written to. And `seed_pilot_pipeline_demo_ideas` returns 0 without an
 * instantiated scenario, so seeding could not bootstrap itself from anywhere
 * else either.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rpc = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  orgId: 'org1' as string | null,
  isPilot: true,
  scenario: null as { id: string } | null,
}))

vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: state.orgId }),
}))
vi.mock('../usePilotMode', () => ({ usePilotMode: () => ({ effectiveIsPilot: state.isPilot }) }))
vi.mock('../usePilotScenario', () => ({
  fetchInstantiatedScenario: async () => state.scenario,
}))

import { usePilotSeeding } from '../usePilotSeeding'

let client: QueryClient
let invalidated: unknown[][]

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children)

beforeEach(() => {
  state.userId = 'u1'
  state.orgId = 'org1'
  state.isPilot = true
  state.scenario = null
  rpc.mockReset()
  rpc.mockImplementation(async (name: string) => {
    if (name === 'ensure_pilot_scenario_for_user') return { data: { seeded: true }, error: null }
    if (name === 'seed_pilot_pipeline_demo_ideas') return { data: 3, error: null }
    if (name === 'ensure_pilot_decision_request_for_user') return { data: 'dr1', error: null }
    return { data: null, error: null }
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidated = []
  const real = client.invalidateQueries.bind(client)
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters: any) => {
    invalidated.push(filters?.queryKey)
    return real(filters)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const called = (name: string) => rpc.mock.calls.some(c => c[0] === name)
const invalidatedKey = (key: string) => invalidated.some(k => Array.isArray(k) && k[0] === key)

describe('seeding a pilot who has never opened Trade Lab', () => {
  it('creates the scenario and the demo ideas', async () => {
    renderHook(() => usePilotSeeding(), { wrapper })
    await waitFor(() => expect(called('ensure_pilot_scenario_for_user')).toBe(true))
    await waitFor(() => expect(called('seed_pilot_pipeline_demo_ideas')).toBe(true))
  })

  /**
   * The board reads `['trade-queue-items', orgId]`. Seeding used to invalidate
   * only `trade-queue-ideas` and `trade-ideas`, which that key does not match,
   * under a five-minute global staleTime — so a pilot already sitting on the
   * board kept the empty result they arrived with.
   */
  it('refreshes the key the Idea Pipeline actually reads', async () => {
    renderHook(() => usePilotSeeding(), { wrapper })
    await waitFor(() => expect(invalidatedKey('trade-queue-items')).toBe(true))
  })
})

describe('who it runs for', () => {
  it('writes nothing for a non-pilot', async () => {
    state.isPilot = false
    renderHook(() => usePilotSeeding(), { wrapper })
    await new Promise(r => setTimeout(r, 30))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('writes nothing before an org is known', async () => {
    state.orgId = null
    renderHook(() => usePilotSeeding(), { wrapper })
    await new Promise(r => setTimeout(r, 30))
    expect(rpc).not.toHaveBeenCalled()
  })

  /** A returning pilot tops up the Inbox request rather than re-seeding. */
  it('tops up an already-seeded pilot without recreating the scenario', async () => {
    state.scenario = { id: 's1' }
    renderHook(() => usePilotSeeding(), { wrapper })
    await waitFor(() => expect(called('ensure_pilot_decision_request_for_user')).toBe(true))
    expect(called('ensure_pilot_scenario_for_user')).toBe(false)
  })
})

describe('where seeding is mounted', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  /** The shell renders on both desktop and phone, whatever tab is open. */
  it('runs from the shell', () => {
    expect(src('pages/DashboardPage.tsx')).toContain('usePilotSeeding()')
  })

  it('no longer runs from the Trade Lab-only scenario hook', () => {
    const scenario = src('hooks/usePilotScenario.ts')
    expect(scenario).not.toContain('ensure_pilot_decision_request_for_user')
    expect(scenario).not.toContain('seed_pilot_pipeline_demo_ideas')
  })
})
