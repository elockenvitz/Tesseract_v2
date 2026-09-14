/**
 * The mission advances on the tutorial idea's own rows, and nothing else.
 *
 * Replays the Knowledge Cap pilot (2026-09-14): tutorial idea LLY captured
 * and taken through Pipeline basics, then the seeded AAPL recommendation
 * accepted from the Decision Inbox. That unlocked Trade Book (any committed
 * trade in the org does), and the roadmap stayed on "Test the trade" — which is
 * correct, because no row links a simulation or a decision to LLY.
 *
 * The fake database applies `.eq` filters, so a row on another idea genuinely
 * cannot match the mission's reads. A "refresh" is a new query client over the
 * same rows.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Production ids.
const ORG = 'ef21e7c7-6cef-4785-a082-cf54ef1f59bc'
const USER = 'fa46cffc-dafb-4071-a3ea-5536240d462e'
const TUTORIAL = '0b0fb33a-1800-4a91-b00d-19f91ce2109e' // LLY
const SEEDED_AAPL = 'bc847c42-5947-4940-8a4d-ffa403cf92c0'
const AAPL_ACCEPTED = 'c4b8e144-b1bf-42b3-84ff-bb4b8de29176'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'fa46cffc-dafb-4071-a3ea-5536240d462e' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'ef21e7c7-6cef-4785-a082-cf54ef1f59bc' }) }))
vi.mock('../useMyCoverage', () => ({ useHasCoverage: () => ({ hasCoverage: true, isLoading: false }) }))
vi.mock('../../lib/pilot/pilot-telemetry', () => ({ logPilotEvent: vi.fn() }))
vi.mock('@sentry/react', () => ({ withScope: vi.fn(), captureException: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      let head = false
      const rows = () => (db.tables[table] ?? []).filter(r =>
        // Embedded-join filters (`portfolios.organization_id`) are not modelled.
        filters.every(([k, v]) => k.includes('.') || r[k] === v))
      const done = () => head
        ? { count: rows().length, error: null }
        : { data: rows(), error: null }
      const chain: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; return chain },
        eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
        limit: async () => done(),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(done()).then(res, rej),
      }
      return chain
    },
  },
}))

import { usePilotMission } from '../usePilotMission'

const pipelineBasics = {
  [`tutorial_idea_id_${ORG}`]: TUTORIAL,
  [`pipeline_step_moved_at_${ORG}`]: '2026-09-14T15:07:10Z',
  [`pipeline_step_inbox_at_${ORG}`]: '2026-09-14T15:07:20Z',
  [`pipeline_step_tradelab_at_${ORG}`]: '2026-09-14T15:07:30Z',
}

function seed(progress: Row) {
  db.tables = {
    organizations: [{ id: ORG, settings: { pilot_mode: true } }],
    users: [{ id: USER, pilot_progress: progress }],
    trade_queue_items: [
      { id: TUTORIAL, stage: 'investigate', outcome: null },
      { id: SEEDED_AAPL, stage: 'ready_for_decision', outcome: null },
    ],
    simulation_trades: [],
    // Accepted from the Decision Inbox, on the seeded idea.
    accepted_trades: [{ id: AAPL_ACCEPTED, trade_queue_item_id: SEEDED_AAPL, accepted_by: USER, source: 'inbox' }],
  }
}

async function load() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(() => usePilotMission(), { wrapper })
  await waitFor(() => {
    expect(hook.result.current.isLoading).toBe(false)
    expect(hook.result.current.tutorialIdeaId).toBe(TUTORIAL)
  })
  // The mission reads resolve after the progress read.
  await new Promise(r => setTimeout(r, 30))
  return hook
}

beforeEach(() => {
  seed({
    ...pipelineBasics,
    // Trade Book and Outcomes unlocked by the AAPL acceptance and the banner.
    [`trade_book_unlocked_at_${ORG}`]: '2026-09-14T15:07:48.613Z',
    [`outcomes_unlocked_at_${ORG}`]: '2026-09-14T15:08:30Z',
  })
})
afterEach(cleanup)

describe('the production state', () => {
  it('stays on Test the trade: the AAPL decision and the Trade Book unlock are not the tutorial idea', async () => {
    const { result } = await load()
    expect(result.current.completedCount).toBe(2)
    expect(result.current.currentStepId).toBe('simulation_completed')
    expect(result.current.steps[2].label).toBe('Test the trade')
  })
})

describe('the tutorial idea carried through', () => {
  it('a simulated trade on the tutorial idea completes Test the trade, leaving Make the decision current', async () => {
    db.tables.simulation_trades.push({ id: 'sim-1', trade_queue_item_id: TUTORIAL })
    const { result } = await load()
    expect(result.current.steps[2].done).toBe(true)
    expect(result.current.currentStepId).toBe('decision_submitted')
    expect(result.current.steps[3].label).toBe('Make the decision')
  })

  it('executing it — simulation row deleted, accepted trade on the idea — completes both, and a refresh keeps them', async () => {
    db.tables.accepted_trades.push({ id: 'acc-1', trade_queue_item_id: TUTORIAL, accepted_by: USER, source: 'simulation' })
    const first = await load()
    expect(first.result.current.steps[2].done).toBe(true)
    expect(first.result.current.steps[3].done).toBe(true)
    expect(first.result.current.currentStepId).toBe('outcome_reviewed')
    first.unmount()

    const second = await load()
    expect(second.result.current.completedCount).toBe(4)
    expect(second.result.current.currentStepId).toBe('outcome_reviewed')
  })

  it('a simulated trade on another idea does not count', async () => {
    db.tables.simulation_trades.push({ id: 'sim-aapl', trade_queue_item_id: SEEDED_AAPL })
    const { result } = await load()
    expect(result.current.currentStepId).toBe('simulation_completed')
  })
})
