/**
 * Two pilot marks in flight at once must not erase each other.
 *
 * `pilot_progress` is a single JSONB column and every writer writes the whole
 * column, so two writers holding two different pictures of it is a lost update
 * waiting to happen. It happened in two places on the real journey:
 *
 *   Trade Book -> Outcomes  "Open Outcomes" marks `tradebook_basics_completed`
 *                           and, through a dispatched event, `outcomes_unlocked`
 *                           from a second component. Losing the first reverts
 *                           mission stage 4; losing the second re-locks Outcomes
 *                           under a reader already standing on it.
 *
 *   Graduation              `tutorial_outcome_reviewed` and `graduated` are
 *                           written a beat apart. The first resolving last used
 *                           to write back a picture with no `graduated_at`.
 *
 * The fake database below answers the two updates OUT OF ORDER on purpose —
 * the first write is slow, the second is quick — which is the exact interleave
 * that loses a key. What is asserted is the invariant, not the mechanism: after
 * everything settles, both keys are in the row AND in the cache.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const ORG = 'org-pilot'

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  /** Each test uses its own user id: the in-flight guard is module-scope and
   *  keyed by (user, progress key), so a fresh id is a fresh session. */
  userId: 'u0',
  users: [] as Row[],
  /** Milliseconds each `update` takes, consumed in the order writes start. */
  delays: [] as number[],
  /** The pilot_progress object each write actually sent, in landing order. */
  landed: [] as Row[],
  /** Make the next update fail, to exercise rollback. */
  failNext: false,
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: db.userId } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: ORG }),
}))
vi.mock('../../lib/pilot/pilot-telemetry', () => ({ logPilotEvent: vi.fn() }))
vi.mock('@sentry/react', () => ({ withScope: vi.fn(), captureException: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const filters: Array<[string, unknown]> = []
      let update: Row | null = null
      const rows = () => db.users.filter(r => filters.every(([k, v]) => r[k] === v))
      const done = async () => {
        if (!update) return { data: rows()[0] ?? null, error: null }
        const payload = update
        const delay = db.delays.shift() ?? 0
        await new Promise(r => setTimeout(r, delay))
        if (db.failNext) {
          db.failNext = false
          return { error: { message: 'write rejected' } }
        }
        for (const r of rows()) Object.assign(r, payload)
        db.landed.push({ ...(payload.pilot_progress as Row) })
        return { error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
        update: (v: Row) => { update = v; return chain },
        maybeSingle: async () => done(),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          done().then(res, rej),
      }
      return chain
    },
  },
}))

import { usePilotProgress } from '../usePilotProgress'

const key = (stage: string) => `${stage}_at_${ORG}`
const stored = () => (db.users[0]?.pilot_progress ?? {}) as Row

function seed(userId: string, progress: Row = {}) {
  db.userId = userId
  db.users = [{ id: userId, pilot_progress: { ...progress } }]
  db.delays = []
  db.landed = []
  db.failNext = false
}

/** One component holding the hook. Each call is its own instance, the way two
 *  separate components on the page are — separate mutations, separate refs. */
function mount(client: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return renderHook(() => usePilotProgress(), { wrapper })
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

async function settle(ms = 250) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)) })
}

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

describe('two components marking different stages', () => {
  it('keeps both keys when the first write lands last', async () => {
    seed('u-tradebook-outcomes')
    const client = newClient()
    const a = mount(client)   // usePilotTradeBookSteps
    const b = mount(client)   // TradeBookPage's event listener
    await waitFor(() => expect(a.result.current.hasReadyProgress).toBe(true))

    // The first write is slow, the second quick: without ordering the slow one
    // lands second and writes its older picture over the quick one's key.
    db.delays = [80, 5]

    await act(async () => { a.result.current.mark('tradebook_basics_completed') })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    await act(async () => { b.result.current.mark('outcomes_unlocked') })
    await settle()

    expect(stored()[key('tradebook_basics_completed')]).toBeTruthy()
    expect(stored()[key('outcomes_unlocked')]).toBeTruthy()

    // ...and the cache agrees, so nothing re-locks until the next refresh.
    expect(a.result.current.hasUnlockedOutcomes).toBe(true)
    expect(b.result.current.progress[key('tradebook_basics_completed')]).toBeTruthy()
  })

  it('keeps graduation when the outcome review lands after it', async () => {
    seed('u-graduation')
    const client = newClient()
    const outcomes = mount(client)  // PilotOutcomesGetStarted
    const mission = mount(client)   // usePilotMission
    await waitFor(() => expect(outcomes.result.current.hasReadyProgress).toBe(true))

    db.delays = [80, 5]
    await act(async () => { outcomes.result.current.mark('tutorial_outcome_reviewed') })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    await act(async () => { mission.result.current.mark('graduated') })
    await settle()

    expect(stored()[key('tutorial_outcome_reviewed')]).toBeTruthy()
    expect(stored()[key('graduated')]).toBeTruthy()
    expect(mission.result.current.hasGraduated).toBe(true)
  })

  it('carries a key written earlier in the session forward', async () => {
    seed('u-carry', { [key('trade_book_unlocked')]: 'earlier' })
    const client = newClient()
    const a = mount(client)
    await waitFor(() => expect(a.result.current.hasReadyProgress).toBe(true))

    await act(async () => { a.result.current.mark('outcomes_unlocked') })
    await settle()

    expect(stored()[key('trade_book_unlocked')]).toBe('earlier')
    expect(stored()[key('outcomes_unlocked')]).toBeTruthy()
  })
})

describe('the tutorial idea is written through the same queue', () => {
  it('is readable before the row is written, and goes away if the write fails', async () => {
    seed('u-tutorial-optimistic')
    const client = newClient()
    const capture = mount(client)
    await waitFor(() => expect(capture.result.current.hasReadyProgress).toBe(true))

    db.delays = [300]
    let write: Promise<void> | undefined
    act(() => { write = capture.result.current.setTutorialIdea('idea-1') })
    // The mission module can read the id while the round trip is still open.
    await waitFor(() => expect(capture.result.current.tutorialIdeaId).toBe('idea-1'))
    expect(stored()[`tutorial_idea_id_${ORG}`]).toBeUndefined()
    await act(async () => { await write })
    expect(stored()[`tutorial_idea_id_${ORG}`]).toBe('idea-1')
    expect(capture.result.current.tutorialIdeaId).toBe('idea-1')

    // A second capture whose write fails must not leave a claim behind.
    seed('u-tutorial-failed')
    const failing = mount(newClient())
    await waitFor(() => expect(failing.result.current.hasReadyProgress).toBe(true))
    db.failNext = true
    await act(async () => { await failing.result.current.setTutorialIdea('idea-2') })
    await settle(40)
    expect(failing.result.current.tutorialIdeaId).toBeNull()
  })

  it('survives a stage mark racing it', async () => {
    seed('u-tutorial')
    const client = newClient()
    const capture = mount(client)
    const other = mount(client)
    await waitFor(() => expect(capture.result.current.hasReadyProgress).toBe(true))

    db.delays = [80, 5]
    await act(async () => { void capture.result.current.setTutorialIdea('idea-1') })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    await act(async () => { other.result.current.mark('pipeline_step_moved') })
    await settle()

    expect(stored()[`tutorial_idea_id_${ORG}`]).toBe('idea-1')
    expect(stored()[key('pipeline_step_moved')]).toBeTruthy()
    expect(capture.result.current.tutorialIdeaId).toBe('idea-1')
  })
})

describe('a burst of the same mark', () => {
  it('writes once even across separate components', async () => {
    seed('u-burst')
    const client = newClient()
    const a = mount(client)
    const b = mount(client)
    await waitFor(() => expect(a.result.current.hasReadyProgress).toBe(true))

    await act(async () => {
      a.result.current.mark('outcomes_unlocked')
      b.result.current.mark('outcomes_unlocked')
      a.result.current.mark('outcomes_unlocked')
    })
    await settle()

    expect(db.landed).toHaveLength(1)
  })
})

describe('a failed write', () => {
  it('rolls back only its own key', async () => {
    seed('u-rollback')
    const client = newClient()
    const a = mount(client)
    const b = mount(client)
    await waitFor(() => expect(a.result.current.hasReadyProgress).toBe(true))

    // The first write fails; the second succeeds.
    db.failNext = true
    await act(async () => { a.result.current.mark('outcomes_unlocked') })
    await settle(60)
    await act(async () => { b.result.current.mark('trade_book_unlocked') })
    await settle()

    expect(a.result.current.hasUnlockedOutcomes).toBe(false)
    expect(b.result.current.hasUnlockedTradeBook).toBe(true)
    expect(stored()[key('trade_book_unlocked')]).toBeTruthy()
  })
})
