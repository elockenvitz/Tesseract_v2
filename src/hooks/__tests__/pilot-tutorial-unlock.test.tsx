/**
 * Trade Book and Outcomes unlock on the tutorial idea's decision, not on any
 * trade in the org.
 *
 * Two fresh pilots accepted the seeded AAPL recommendation during Pipeline
 * basics. The mission correctly stayed on "Test the trade", but Trade Book
 * unlocked because the unlock read "any accepted trade in the org". These run
 * the real usePilotProgress, usePilotMode and usePilotMission against a fake
 * database that applies `.eq` filters, so a trade on another idea genuinely
 * cannot match. A "refresh" is a new query client over the same rows and the
 * same localStorage.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const ORG = 'ef21e7c7-6cef-4785-a082-cf54ef1f59bc'
const USER = 'fa46cffc-dafb-4071-a3ea-5536240d462e'
const TUTORIAL = '0b0fb33a-1800-4a91-b00d-19f91ce2109e' // LLY
const SEEDED_AAPL = 'bc847c42-5947-4940-8a4d-ffa403cf92c0'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  progressWrites: [] as string[][],
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
      let update: Row | null = null
      const rows = () => (db.tables[table] ?? []).filter(r =>
        // Embedded-join filters (`portfolios.organization_id`): every row here is in ORG.
        filters.every(([k, v]) => k.includes('.') || r[k] === v))
      const done = () => {
        if (update) {
          for (const r of rows()) {
            const before = Object.keys((r.pilot_progress as Row) ?? {})
            Object.assign(r, update)
            db.progressWrites.push(Object.keys((r.pilot_progress as Row) ?? {}).filter(k => !before.includes(k)))
          }
          return { error: null }
        }
        return head ? { count: rows().length, error: null } : { data: rows(), error: null }
      }
      const chain: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; return chain },
        eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
        update: (v: Row) => { update = v; return chain },
        limit: async () => done(),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(done()).then(res, rej),
      }
      return chain
    },
  },
}))

import { usePilotMode } from '../usePilotMode'
import { usePilotMission } from '../usePilotMission'

const key = (stage: string) => `${stage}_at_${ORG}`

function seed({ pilot = true, progress = {} as Row, accepted = [] as string[], simulated = [] as string[] }) {
  db.progressWrites = []
  db.tables = {
    organizations: [{ id: ORG, settings: { pilot_mode: pilot } }],
    users: [{
      id: USER,
      pilot_progress: {
        [`tutorial_idea_id_${ORG}`]: TUTORIAL,
        [key('pipeline_step_moved')]: 't',
        [key('pipeline_step_inbox')]: 't',
        [key('pipeline_step_tradelab')]: 't',
        ...progress,
      },
    }],
    trade_queue_items: [
      { id: TUTORIAL, stage: 'investigate', outcome: null },
      { id: SEEDED_AAPL, stage: 'ready_for_decision', outcome: null },
    ],
    simulation_trades: simulated.map((id, i) => ({ id: `sim-${i}`, trade_queue_item_id: id })),
    accepted_trades: accepted.map((id, i) => ({ id: `acc-${i}`, trade_queue_item_id: id, accepted_by: USER })),
  }
}

const progress = () => db.tables.users[0].pilot_progress as Row

function usePilot() {
  return { mode: usePilotMode(), mission: usePilotMission() }
}

async function load() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(() => usePilot(), { wrapper })
  await waitFor(() => {
    const { mode, mission } = hook.result.current
    expect(mode.isLoading).toBe(false)
    expect(mode.accessIsReady).toBe(true)
    expect(mission.isLoading).toBe(false)
  })
  // Let the reads settle and any effect-driven mark write run.
  await new Promise(r => setTimeout(r, 40))
  return hook
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('a pilot who accepted the seeded AAPL recommendation', () => {
  it('keeps Trade Book locked, writes no unlock, and stays on Test the trade', async () => {
    seed({ accepted: [SEEDED_AAPL] })
    const { result } = await load()
    expect(result.current.mode.hasCommittedTutorialTrade).toBe(false)
    expect(result.current.mode.accessFor('tradeBook')).toBe('preview')
    expect(result.current.mode.accessFor('outcomes')).toBe('preview')
    expect(progress()[key('trade_book_unlocked')]).toBeUndefined()
    expect(db.progressWrites.flat()).not.toContain(key('trade_book_unlocked'))
    expect(result.current.mission.currentStepId).toBe('simulation_completed')
  })

  /** Knowledge Cap and Symbol Cap: marks already written by the AAPL trade. */
  it('re-locks a pilot whose marks were written by that trade before this rule', async () => {
    seed({
      accepted: [SEEDED_AAPL],
      progress: { [key('trade_book_unlocked')]: 't', [key('outcomes_unlocked')]: 't' },
    })
    const { result } = await load()
    expect(result.current.mode.accessFor('tradeBook')).toBe('preview')
    expect(result.current.mode.accessFor('outcomes')).toBe('preview')
    expect(result.current.mission.currentStepId).toBe('simulation_completed')
  })

  it('stays locked after a refresh, even with the old org-wide cache saying yes', async () => {
    seed({ accepted: [SEEDED_AAPL] })
    const first = await load()
    first.unmount()
    localStorage.setItem(`has_committed_trade_${USER}_${ORG}`, '1')

    const second = await load()
    expect(second.result.current.mode.accessFor('tradeBook')).toBe('preview')
    expect(progress()[key('trade_book_unlocked')]).toBeUndefined()
  })
})

describe('a pilot whose tutorial LLY idea has an accepted trade', () => {
  it('unlocks Trade Book, and the mission moves to Close the loop', async () => {
    // Executed: the simulation row is gone, the accepted trade is on the idea.
    seed({ accepted: [SEEDED_AAPL, TUTORIAL] })
    const { result } = await load()
    expect(result.current.mode.hasCommittedTutorialTrade).toBe(true)
    await waitFor(() => expect(result.current.mode.accessFor('tradeBook')).toBe('full'))
    expect(progress()[key('trade_book_unlocked')]).toEqual(expect.any(String))
    // Outcomes still waits for its own step.
    expect(result.current.mode.accessFor('outcomes')).toBe('preview')
    expect(result.current.mission.steps[2].done).toBe(true)
    expect(result.current.mission.steps[3].done).toBe(true)
    expect(result.current.mission.currentStepId).toBe('outcome_reviewed')
  })

  it('stays unlocked after a refresh, with the mark written once', async () => {
    seed({ accepted: [TUTORIAL] })
    const first = await load()
    await waitFor(() => expect(first.result.current.mode.accessFor('tradeBook')).toBe('full'))
    first.unmount()

    const second = await load()
    expect(second.result.current.mode.accessFor('tradeBook')).toBe('full')
    expect(db.progressWrites.flat().filter(k => k === key('trade_book_unlocked'))).toHaveLength(1)
  })

  it('opens Outcomes once its step is marked too', async () => {
    seed({ accepted: [TUTORIAL], progress: { [key('trade_book_unlocked')]: 't', [key('outcomes_unlocked')]: 't' } })
    const { result } = await load()
    expect(result.current.mode.accessFor('outcomes')).toBe('full')
  })
})

describe('unchanged for everyone else', () => {
  it('a non-pilot with an unrelated accepted trade has full access', async () => {
    seed({ pilot: false, accepted: [SEEDED_AAPL] })
    const { result } = await load()
    expect(result.current.mode.effectiveIsPilot).toBe(false)
    expect(result.current.mode.accessFor('tradeBook')).toBe('full')
    expect(result.current.mode.accessFor('outcomes')).toBe('full')
    expect(db.progressWrites.flat()).toEqual([])
  })

  it('a graduated pilot has full access whatever the trades are', async () => {
    seed({ accepted: [SEEDED_AAPL], progress: { [key('graduated')]: 't' } })
    const { result } = await load()
    expect(result.current.mode.effectiveIsPilot).toBe(false)
    expect(result.current.mode.accessFor('tradeBook')).toBe('full')
    expect(result.current.mode.accessFor('outcomes')).toBe('full')
  })
})
