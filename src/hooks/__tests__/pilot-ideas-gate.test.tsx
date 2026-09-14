/**
 * The standalone Ideas app stays closed until the pilot graduates.
 *
 * Two ways it opened early:
 *
 *   1. `ideas` had no entry in the pilot tab map, and an unmapped tab type is
 *      ungated — so the app was open from the first screen.
 *   2. The Outcomes page wrote `graduated` on mount once `outcomes_unlocked`
 *      was set, which Trade Book basics step 3 does. Finishing Trade Book
 *      basics and landing on Outcomes graduated the pilot before Close the loop.
 *
 * These run the real `usePilotProgress`, `usePilotMode` and `usePilotMission`
 * against a fake `users.pilot_progress` row. A "refresh" is a new query
 * client over the same row and the same localStorage.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const ORG = 'org1'
const IDEA = 'idea1'

const db = vi.hoisted(() => ({
  progress: {} as Record<string, unknown>,
  stage: 'aware',
  simulated: false,
  decided: false,
  graduationWrites: 0,
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'org1' }) }))
vi.mock('../useMyCoverage', () => ({ useHasCoverage: () => ({ hasCoverage: true, isLoading: false }) }))
vi.mock('../../lib/pilot/pilot-telemetry', () => ({ logPilotEvent: vi.fn() }))
vi.mock('@sentry/react', () => ({ withScope: vi.fn(), captureException: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let update: { pilot_progress: Record<string, unknown> } | null = null
      const result = () => {
        switch (table) {
          case 'organizations':
            return { data: { settings: { pilot_mode: true } }, error: null }
          case 'users':
            if (update) {
              if (update.pilot_progress['graduated_at_org1'] && !db.progress['graduated_at_org1']) db.graduationWrites++
              db.progress = update.pilot_progress
              return { error: null }
            }
            return { data: { pilot_progress: db.progress }, error: null }
          case 'trade_queue_items':
            return { data: { id: 'idea1', stage: db.stage, outcome: db.decided ? 'accepted' : null }, error: null }
          case 'simulation_trades':
            return { count: db.simulated ? 1 : 0, error: null }
          case 'accepted_trades':
            // usePilotMode reads rows; the mission reads a head count.
            return { data: db.decided ? [{ id: 't1' }] : [], count: db.decided ? 1 : 0, error: null }
          default:
            return { data: null, error: null }
        }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: (v: { pilot_progress: Record<string, unknown> }) => { update = v; return chain },
        limit: async () => result(),
        maybeSingle: async () => result(),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
      }
      return chain
    },
  },
}))

import { usePilotMode } from '../usePilotMode'
import { usePilotMission } from '../usePilotMission'
import { TAB_TYPE_TO_PILOT_FEATURE } from '../../lib/pilot/pilot-access'

/** What DashboardPage's tab filter and route guard ask of a tab type. */
function useIdeasGate() {
  const mission = usePilotMission()
  const mode = usePilotMode()
  const gate = (tabType: string) => {
    const feature = TAB_TYPE_TO_PILOT_FEATURE[tabType]
    if (!mode.effectiveIsPilot || !feature) return true
    return mode.accessFor(feature) !== 'hidden'
  }
  return {
    mission, mode,
    ideasOpen: gate('ideas'),
    legacyIdeasOpen: gate('idea-generator'),
    pipelineOpen: gate('trade-queue'),
  }
}

/** Opening the app: a fresh cache over whatever the server row holds. */
async function load() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(() => useIdeasGate(), { wrapper })
  await waitFor(() => {
    const { mode, mission } = hook.result.current
    expect(mode.isLoading).toBe(false)
    expect(mode.accessIsReady).toBe(true)
    expect(mission.isLoading).toBe(false)
  })
  // Let any effect-driven write (graduation) run and settle.
  await new Promise(r => setTimeout(r, 30))
  return hook
}

const pilotKeys = {
  idea: { [`tutorial_idea_id_${ORG}`]: IDEA },
  pipeline: {
    [`pipeline_step_moved_at_${ORG}`]: 't',
    [`pipeline_step_inbox_at_${ORG}`]: 't',
    [`pipeline_step_tradelab_at_${ORG}`]: 't',
  },
  tradeBook: {
    [`trade_book_unlocked_at_${ORG}`]: 't',
    // Trade Book basics step 3, "Open Outcomes".
    [`outcomes_unlocked_at_${ORG}`]: 't',
  },
  outcomeReviewed: { [`tutorial_outcome_reviewed_at_${ORG}`]: 't' },
}

/** Steps 1–4 done, Trade Book basics done, Outcomes opened — Close the loop not. */
function throughTradeBook() {
  db.progress = { ...pilotKeys.idea, ...pilotKeys.pipeline, ...pilotKeys.tradeBook }
  db.stage = 'ready_for_decision'
  db.simulated = false // executing deletes the simulation row
  db.decided = true
}

beforeEach(() => {
  db.progress = {}
  db.stage = 'aware'
  db.simulated = false
  db.decided = false
  db.graduationWrites = 0
  localStorage.clear()
})
afterEach(cleanup)

describe('the standalone Ideas app during the mission', () => {
  it('is locked at step 1', async () => {
    db.progress = { ...pilotKeys.idea }
    const { result } = await load()
    expect(result.current.mission.currentStepId).toBe('pipeline_advanced')
    expect(result.current.mode.effectiveIsPilot).toBe(true)
    expect(result.current.ideasOpen).toBe(false)
    expect(result.current.legacyIdeasOpen).toBe(false)
  })

  it('is locked through the Pipeline and Trade Lab steps, while the Pipeline itself stays open', async () => {
    db.progress = { ...pilotKeys.idea, ...pilotKeys.pipeline }
    db.stage = 'investigate'
    db.simulated = true
    const { result } = await load()
    expect(result.current.mission.currentStepId).toBe('decision_submitted')
    expect(result.current.ideasOpen).toBe(false)
    expect(result.current.pipelineOpen).toBe(true)
  })

  it('is still locked after execute, Trade Book basics and opening Outcomes, and nothing graduates', async () => {
    throughTradeBook()
    const { result } = await load()
    expect(result.current.mission.completedCount).toBe(4)
    expect(result.current.mission.currentStepId).toBe('outcome_reviewed')
    // Trade Book and Outcomes did unlock — that is what those steps are for.
    expect(result.current.mode.accessFor('tradeBook')).toBe('full')
    expect(result.current.mode.accessFor('outcomes')).toBe('full')
    // Ideas did not, and no graduation was written.
    expect(result.current.mode.hasGraduated).toBe(false)
    expect(result.current.ideasOpen).toBe(false)
    expect(db.progress[`graduated_at_${ORG}`]).toBeUndefined()
    expect(db.graduationWrites).toBe(0)
  })
})

describe('Close the loop', () => {
  it('graduates the pilot durably, and that opens Ideas', async () => {
    throughTradeBook()
    db.progress = { ...db.progress, ...pilotKeys.outcomeReviewed }
    const { result } = await load()
    await waitFor(() => expect(result.current.ideasOpen).toBe(true))
    expect(result.current.mission.complete).toBe(true)
    expect(result.current.mode.hasGraduated).toBe(true)
    // Written to the server row, not only the cache.
    expect(db.progress[`graduated_at_${ORG}`]).toEqual(expect.any(String))
    expect(db.graduationWrites).toBe(1)
  })
})

describe('a hard refresh', () => {
  it('before graduation keeps Ideas locked, even with a stale graduated hint in localStorage', async () => {
    throughTradeBook()
    const first = await load()
    expect(first.result.current.ideasOpen).toBe(false)
    first.unmount()

    // A graduated hint left over from an earlier run of this org (e.g. before
    // an ops reset). The server row is what decides.
    localStorage.setItem(`pilot_graduated_u1_${ORG}`, '1')
    const second = await load()
    expect(second.result.current.mode.hasGraduated).toBe(false)
    expect(second.result.current.mode.effectiveIsPilot).toBe(true)
    expect(second.result.current.ideasOpen).toBe(false)
    expect(db.graduationWrites).toBe(0)
  })

  it('after graduation keeps Ideas open', async () => {
    throughTradeBook()
    db.progress = { ...db.progress, ...pilotKeys.outcomeReviewed }
    const first = await load()
    await waitFor(() => expect(first.result.current.ideasOpen).toBe(true))
    first.unmount()

    const second = await load()
    expect(second.result.current.mode.hasGraduated).toBe(true)
    expect(second.result.current.ideasOpen).toBe(true)
    expect(db.graduationWrites).toBe(1)
  })
})

describe('where graduation is written', () => {
  const root = path.join(process.cwd(), 'src')
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })

  it('only the mission marks it', () => {
    const writers = walk(root)
      .filter(f => /\bmark\w*\(\s*['"]graduated['"]\s*\)/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(root, f).replace(/\\/g, '/'))
    expect(writers).toEqual(['hooks/usePilotMission.ts'])
  })

  it('and only once the mission is complete', () => {
    const hook = readFileSync(path.join(root, 'hooks/usePilotMission.ts'), 'utf8')
    const effect = hook.slice(hook.lastIndexOf('useEffect(', hook.indexOf("mark('graduated')")), hook.indexOf("mark('graduated')"))
    expect(effect).toContain('if (!state.complete || hasGraduated) return')
  })
})

describe('what this does not change', () => {
  it('leaves the Dashboard to its own gate', () => {
    // `today` renders the pilot home for a pilot; it is not the Ideas app key.
    expect(TAB_TYPE_TO_PILOT_FEATURE['today']).toBeUndefined()
    expect(TAB_TYPE_TO_PILOT_FEATURE['trade-queue']).toBe('ideaPipeline')
  })
})
