/**
 * Executing any trade in Trade Lab unlocks Trade Book and moves the pilot's
 * roadmap to Close the loop.
 *
 * Golf Cap (2026-09-14): the pilot opened Trade Lab, added and sized the seeded
 * AAPL recommendation, and executed it. Trade Book stayed locked and the
 * roadmap stayed on "Test the trade", because both followed only the captured
 * tutorial idea (LLY). The product rule is: add any idea, size it, execute it —
 * whichever trade that is.
 *
 * These run the real usePilotProgress, usePilotMode and usePilotMission against
 * a fake database that applies `.eq` filters, so a trade someone else committed
 * genuinely cannot match. A "refresh" is a new query client over the same rows
 * and the same localStorage.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Golf Cap production ids.
const ORG = '439d4c48-18a2-4570-8777-23fb379c087f'
const USER = 'fa46cffc-dafb-4071-a3ea-5536240d462e'
const TUTORIAL = 'fd5a0277-854a-4f26-8873-d49ce24d2675' // LLY, captured
const SEEDED_AAPL = 'f9ea5654-51e2-408a-bde4-2504b0c09c14' // the seeded recommendation's idea
const AAPL_ACCEPTED = 'f26caf72-cb38-481f-9898-ffe2002a4e35'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  progressWrites: [] as string[][],
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'fa46cffc-dafb-4071-a3ea-5536240d462e' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: '439d4c48-18a2-4570-8777-23fb379c087f' }) }))
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
        order: () => chain,
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

function seed({ pilot = true, progress = {} as Row, accepted = [] as Row[], simulated = [] as string[] }) {
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
    accepted_trades: accepted,
  }
}

/** An accepted trade as Trade Lab execute writes it. */
const executed = (tqi: string, id = `acc-${tqi.slice(0, 4)}`, by = USER): Row =>
  ({ id, trade_queue_item_id: tqi, accepted_by: by })

const progress = () => db.tables.users[0].pilot_progress as Row
const usePilot = () => ({ mode: usePilotMode(), mission: usePilotMission() })

async function load(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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
  return { ...hook, client }
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Golf Cap: the pilot executed the seeded AAPL recommendation in Trade Lab', () => {
  beforeEach(() => seed({ accepted: [executed(SEEDED_AAPL, AAPL_ACCEPTED)] }))

  it('unlocks Trade Book and writes the mark once', async () => {
    const { result } = await load()
    expect(result.current.mode.hasCommittedPilotTrade).toBe(true)
    await waitFor(() => expect(result.current.mode.accessFor('tradeBook')).toBe('full'))
    expect(db.progressWrites.flat().filter(k => k === key('trade_book_unlocked'))).toHaveLength(1)
    // Outcomes waits for its own step.
    expect(result.current.mode.accessFor('outcomes')).toBe('preview')
  })

  it('completes Test the trade and Make the decision, and moves the roadmap to Close the loop', async () => {
    const { result } = await load()
    const { mission } = result.current
    expect(mission.steps[2].done).toBe(true)
    expect(mission.steps[3].done).toBe(true)
    expect(mission.currentStepId).toBe('outcome_reviewed')
    // Close the loop reviews the trade that was executed.
    expect(mission.decisionIdeaIds).toEqual([SEEDED_AAPL])
    expect(mission.reviewIdeaId).toBe(SEEDED_AAPL)
  })

  it('does not graduate', async () => {
    const { result } = await load()
    expect(result.current.mode.hasGraduated).toBe(false)
    expect(result.current.mission.complete).toBe(false)
    expect(progress()[key('graduated')]).toBeUndefined()
  })

  it('keeps both after a refresh', async () => {
    const first = await load()
    await waitFor(() => expect(first.result.current.mode.accessFor('tradeBook')).toBe('full'))
    first.unmount()

    const second = await load()
    expect(second.result.current.mode.accessFor('tradeBook')).toBe('full')
    expect(second.result.current.mission.currentStepId).toBe('outcome_reviewed')
    expect(db.progressWrites.flat().filter(k => k === key('trade_book_unlocked'))).toHaveLength(1)
  })
})

describe('executing the captured idea works the same way', () => {
  it('unlocks Trade Book and reviews that decision', async () => {
    seed({ accepted: [executed(TUTORIAL)] })
    const { result } = await load()
    await waitFor(() => expect(result.current.mode.accessFor('tradeBook')).toBe('full'))
    expect(result.current.mission.currentStepId).toBe('outcome_reviewed')
    expect(result.current.mission.reviewIdeaId).toBe(TUTORIAL)
  })
})

describe('nothing executed yet', () => {
  it('keeps Trade Book locked and the roadmap on Test the trade, even with a trade sized in the lab', async () => {
    seed({ simulated: [SEEDED_AAPL] })
    const { result } = await load()
    expect(result.current.mode.accessFor('tradeBook')).toBe('preview')
    expect(db.progressWrites.flat()).not.toContain(key('trade_book_unlocked'))
    expect(result.current.mission.currentStepId).toBe('simulation_completed')
  })

  it('a trade someone else committed in the org does not count', async () => {
    seed({ accepted: [executed(SEEDED_AAPL, 'acc-other', 'someone-else')] })
    const { result } = await load()
    expect(result.current.mode.accessFor('tradeBook')).toBe('preview')
    expect(result.current.mission.currentStepId).toBe('simulation_completed')
  })
})

describe('in the same session, without a reload', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('flips when execute fires its invalidations', async () => {
    seed({ simulated: [SEEDED_AAPL] })
    const { result, client } = await load()
    expect(result.current.mode.accessFor('tradeBook')).toBe('preview')

    // Execute: the simulation row is deleted and the accepted trade is written.
    db.tables.simulation_trades = []
    db.tables.accepted_trades.push(executed(SEEDED_AAPL, AAPL_ACCEPTED))
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['accepted-trades'] })
      await client.invalidateQueries({ queryKey: ['pilot-mission'] })
    })

    await waitFor(() => expect(result.current.mode.accessFor('tradeBook')).toBe('full'))
    await waitFor(() => expect(result.current.mission.currentStepId).toBe('outcome_reviewed'))
    expect(result.current.mode.hasGraduated).toBe(false)
  })

  it('both execute handlers fire those invalidations', () => {
    const page = src('pages/SimulationPage.tsx')
    const single = page.slice(page.indexOf("setDecisionRecord(buildDecisionRecord({\n        trades: data.trades"), page.indexOf("toast.error('Execute failed', err.message)"))
    const bulk = page.slice(page.lastIndexOf('if (committed > 0) {'), page.indexOf("queryClient.invalidateQueries({ queryKey: ['decision-accountability'] })"))
    for (const handler of [single, bulk]) {
      expect(handler).toContain("queryClient.invalidateQueries({ queryKey: ['accepted-trades'] })")
      expect(handler).toContain("queryClient.invalidateQueries({ queryKey: ['pilot-mission'] })")
    }
  })
})

describe('unchanged for everyone else', () => {
  it('a non-pilot has full access and nothing is written', async () => {
    seed({ pilot: false, accepted: [executed(SEEDED_AAPL)] })
    const { result } = await load()
    expect(result.current.mode.effectiveIsPilot).toBe(false)
    expect(result.current.mode.accessFor('tradeBook')).toBe('full')
    expect(db.progressWrites.flat()).toEqual([])
  })

  it('a graduated pilot has full access', async () => {
    seed({ accepted: [], progress: { [key('graduated')]: 't' } })
    const { result } = await load()
    expect(result.current.mode.effectiveIsPilot).toBe(false)
    expect(result.current.mode.accessFor('tradeBook')).toBe('full')
    expect(result.current.mode.accessFor('outcomes')).toBe('full')
  })
})
