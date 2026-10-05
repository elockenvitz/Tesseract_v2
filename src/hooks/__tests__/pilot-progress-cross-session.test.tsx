/**
 * A stale session cannot erase progress recorded anywhere else.
 *
 * ── The production loss ──────────────────────────────────────────────────
 *
 * `users.pilot_progress` is one JSONB column holding every mark for every
 * organization the user has ever been in. The client wrote the WHOLE column
 * on every mark, built from its own React Query snapshot. Serialising those
 * writes inside a tab was already done and was never enough, because the
 * snapshot is per-session: the query has `staleTime: 60_000` and the app sets
 * `refetchOnWindowFocus: false`, so a backgrounded tab holds its picture
 * indefinitely and its next mark writes that picture back.
 *
 * Quick Quest `e472e5b7`, 2026-10-05. Telemetry proves six marks committed
 * between 18:01:21 and 18:03:16. `trade_book_unlocked` fired again at
 * 19:03:30 from a second session an hour stale, and that write is the only
 * Quick Quest key left on the row. Every September organization's keys
 * survived, which dates the stale base precisely.
 *
 * ── Why these tests are different from the sibling file ──────────────────
 *
 * `pilot-progress-concurrent-marks` covers two components in ONE session
 * racing each other, which the in-tab queue already handled. These cover what
 * the queue structurally cannot: a second session, a second organization, and
 * a second user. Nothing client-side can fix those — only a server-side merge
 * can — so these are the tests that fail on the old implementation.
 *
 * The double models `mark_pilot_progress` exactly: one statement, merge onto
 * the row as it is NOW, set-once, return the merged document.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const ORG_A = 'org-alpha'
const ORG_B = 'org-beta'

type Progress = Record<string, string>

const db = vi.hoisted(() => ({
  /** The authoritative rows, one per user. */
  rows: {} as Record<string, Record<string, string>>,
  /** Which user the hook under test is authenticated as. */
  userId: 'u-1',
  /** Which org the hook under test is looking at. */
  orgId: 'org-alpha',
  /** Whether the write path is the OLD whole-column overwrite. */
  legacyWholeColumnWrite: false,
  /** Telemetry calls, to assert a duplicate mark does not double-log. */
  events: [] as string[],
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: db.userId } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: db.orgId }),
}))
vi.mock('../../lib/pilot/pilot-telemetry', () => ({
  logPilotEvent: vi.fn((e: { eventType: string }) => { db.events.push(e.eventType) }),
}))
vi.mock('@sentry/react', () => ({ withScope: vi.fn(), captureException: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== 'mark_pilot_progress') return { data: null, error: null }
      const current = db.rows[db.userId] ?? {}
      const k = args.p_key as string
      const merged = k in current
        ? { ...current }
        : { ...current, [k]: args.p_value as string }
      db.rows[db.userId] = merged
      return { data: merged, error: null }
    },
    from: () => {
      const filters: Array<[string, unknown]> = []
      let update: Record<string, unknown> | null = null
      const done = async () => {
        const uid = (filters.find(([k]) => k === 'id')?.[1] as string) ?? db.userId
        if (update) {
          /*
           * The OLD write path, kept behind a flag so the regression test can
           * demonstrate the loss rather than describe it. A whole-column
           * replace from the caller's document.
           */
          db.rows[uid] = { ...(update.pilot_progress as Progress) }
          return { data: null, error: null }
        }
        return { data: { pilot_progress: db.rows[uid] ?? {} }, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
        update: (v: Record<string, unknown>) => { update = v; return chain },
        maybeSingle: async () => done(),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          done().then(res, rej),
      }
      return chain
    },
  },
}))

import { usePilotProgress } from '../usePilotProgress'
import { supabase } from '../../lib/supabase'

/**
 * The double, reached untyped.
 *
 * `Database` is generated from the live schema and has no entry for
 * `mark_pilot_progress` until the migration is applied, so a typed `rpc()`
 * call does not compile. These two tests drive the double directly — they are
 * about the WRITE SHAPES, old and new — so the shape is declared here rather
 * than waiting on generated types.
 */
const raw = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>
  from: (t: string) => {
    update: (v: Record<string, unknown>) => { eq: (k: string, v: unknown) => Promise<unknown> }
  }
}

const key = (stage: string, org: string) => `${stage}_at_${org}`
const row = (user = db.userId): Progress => db.rows[user] ?? {}

/** A fresh QueryClient is a fresh SESSION: its own cache, its own snapshot. */
const newSession = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function mount(client: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return renderHook(() => usePilotProgress(), { wrapper })
}

async function settle(ms = 200) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)) })
}

beforeEach(() => {
  localStorage.clear()
  db.rows = {}
  db.events = []
  db.legacyWholeColumnWrite = false
  db.orgId = ORG_A
})
afterEach(cleanup)

describe('1. a stale session cannot erase another session, same org', () => {
  it('keeps both marks when the second session is an hour behind', async () => {
    /*
     * The exact Quick Quest shape. Session A marks, then session B — whose
     * snapshot was taken BEFORE A's mark and never refreshed, because
     * `refetchOnWindowFocus` is off — marks something else.
     */
    db.userId = 'u-stale-same-org'
    db.rows[db.userId] = {}

    const sessionB = newSession()
    const b = mount(sessionB)
    await waitFor(() => expect(b.result.current.hasReadyProgress).toBe(true))
    // B's snapshot is now empty, and will stay empty: it never refetches.

    const sessionA = newSession()
    const a = mount(sessionA)
    await waitFor(() => expect(a.result.current.hasReadyProgress).toBe(true))
    await act(async () => { a.result.current.mark('pipeline_step_moved') })
    await settle()
    expect(row()[key('pipeline_step_moved', ORG_A)]).toBeTruthy()

    // B marks from its stale picture.
    await act(async () => { b.result.current.mark('trade_book_unlocked') })
    await settle()

    expect(row()[key('trade_book_unlocked', ORG_A)]).toBeTruthy()
    expect(row()[key('pipeline_step_moved', ORG_A)]).toBeTruthy()
  })

  it('keeps all six Quick Quest marks against a stale sixth write', async () => {
    db.userId = 'u-quick-quest'
    db.rows[db.userId] = {}

    const stale = newSession()
    const s = mount(stale)
    await waitFor(() => expect(s.result.current.hasReadyProgress).toBe(true))

    // Five marks land from live sessions.
    for (const stage of ['pipeline_step_moved', 'pipeline_step_inbox',
                         'pipeline_step_tradelab', 'outcomes_unlocked',
                         'tradebook_basics_completed'] as const) {
      const live = newSession()
      const h = mount(live)
      await waitFor(() => expect(h.result.current.hasReadyProgress).toBe(true))
      await act(async () => { h.result.current.mark(stage) })
      await settle(60)
    }
    expect(Object.keys(row())).toHaveLength(5)

    // The stale session marks the sixth, an hour later.
    await act(async () => { s.result.current.mark('trade_book_unlocked') })
    await settle()

    expect(Object.keys(row())).toHaveLength(6)
  })
})

describe('2. a stale write in org B cannot erase org A', () => {
  it('preserves graduated_at for the other organization', async () => {
    /*
     * The worst case, because `graduated_at_<orgId>` gates pilot-seed
     * suppression and the graduation experience. A pilot who finished
     * onboarding in org A days ago must not lose it by marking a step in B.
     */
    db.userId = 'u-two-orgs'
    db.rows[db.userId] = {
      [key('graduated', ORG_A)]: '2026-09-29T12:30:01.187Z',
      [key('outcomes_unlocked', ORG_A)]: '2026-09-29T12:29:42.380Z',
    }

    db.orgId = ORG_B
    const session = newSession()
    const h = mount(session)
    await waitFor(() => expect(h.result.current.hasReadyProgress).toBe(true))
    await act(async () => { h.result.current.mark('trade_book_unlocked') })
    await settle()

    expect(row()[key('graduated', ORG_A)]).toBe('2026-09-29T12:30:01.187Z')
    expect(row()[key('outcomes_unlocked', ORG_A)]).toBe('2026-09-29T12:29:42.380Z')
    expect(row()[key('trade_book_unlocked', ORG_B)]).toBeTruthy()
  })

  it('does not leak the new org key into the other org', async () => {
    db.userId = 'u-no-leak'
    db.rows[db.userId] = {}
    db.orgId = ORG_B
    const h = mount(newSession())
    await waitFor(() => expect(h.result.current.hasReadyProgress).toBe(true))
    await act(async () => { h.result.current.mark('trade_book_unlocked') })
    await settle()
    expect(row()[key('trade_book_unlocked', ORG_A)]).toBeUndefined()
  })
})

describe('3. two users in one org stay isolated', () => {
  it('one user marking does not touch the other user row', async () => {
    db.rows['u-first'] = { [key('graduated', ORG_A)]: '2026-09-01T00:00:00.000Z' }
    db.rows['u-second'] = {}

    db.userId = 'u-second'
    const h = mount(newSession())
    await waitFor(() => expect(h.result.current.hasReadyProgress).toBe(true))
    await act(async () => { h.result.current.mark('trade_book_unlocked') })
    await settle()

    expect(row('u-second')[key('trade_book_unlocked', ORG_A)]).toBeTruthy()
    // The other user is untouched, and gained nothing.
    expect(row('u-first')).toEqual({ [key('graduated', ORG_A)]: '2026-09-01T00:00:00.000Z' })
  })
})

describe('4. a duplicate mark is idempotent', () => {
  it('keeps the FIRST timestamp when a second session re-marks', async () => {
    const first = '2026-10-05T18:03:16.000Z'
    db.userId = 'u-dup'
    db.rows[db.userId] = { [key('trade_book_unlocked', ORG_A)]: first }

    // A session that does not know the key exists marks it again — which is
    // what produced the second `pilot_trade_book_unlocked` event in production.
    const h = mount(newSession())
    await waitFor(() => expect(h.result.current.hasReadyProgress).toBe(true))
    await act(async () => { h.result.current.mark('trade_book_unlocked') })
    await settle()

    expect(row()[key('trade_book_unlocked', ORG_A)]).toBe(first)
  })

  it('does not log telemetry again for a mark that already existed', async () => {
    db.userId = 'u-dup-telemetry'
    db.rows[db.userId] = { [key('trade_book_unlocked', ORG_A)]: '2026-10-05T18:03:16.000Z' }
    const h = mount(newSession())
    await waitFor(() => expect(h.result.current.hasReadyProgress).toBe(true))
    await act(async () => { h.result.current.mark('trade_book_unlocked') })
    await settle()
    expect(db.events).not.toContain('pilot_trade_book_unlocked')
  })
})

describe('6. the old whole-column write loses the data', () => {
  /*
   * Non-vacuity, as a test rather than a claim. This drives the double's
   * legacy path directly — the same `.update({ pilot_progress })` the hook
   * used to issue — and asserts the loss, so the scenarios above are known to
   * be testing something real.
   */
  it('a stale whole-column replace erases a sibling key', async () => {
    db.userId = 'u-legacy'
    db.rows[db.userId] = {}

    // A session reads the column: empty.
    const staleSnapshot = { ...row() }

    // Another session records a mark.
    await raw.rpc('mark_pilot_progress', {
      p_key: key('pipeline_step_moved', ORG_A),
      p_value: '2026-10-05T18:01:30.000Z',
    })
    expect(row()[key('pipeline_step_moved', ORG_A)]).toBeTruthy()

    // The stale session writes the WHOLE column from its snapshot — the old
    // behaviour — and the sibling key is gone.
    await raw
      .from('users')
      .update({
        pilot_progress: {
          ...staleSnapshot,
          [key('trade_book_unlocked', ORG_A)]: '2026-10-05T19:03:30.120Z',
        },
      })
      .eq('id', db.userId)

    expect(row()[key('trade_book_unlocked', ORG_A)]).toBeTruthy()
    expect(row()[key('pipeline_step_moved', ORG_A)]).toBeUndefined()
  })

  it('the atomic merge keeps both, same interleave', async () => {
    db.userId = 'u-atomic'
    db.rows[db.userId] = {}

    await raw.rpc('mark_pilot_progress', {
      p_key: key('pipeline_step_moved', ORG_A),
      p_value: '2026-10-05T18:01:30.000Z',
    })
    await raw.rpc('mark_pilot_progress', {
      p_key: key('trade_book_unlocked', ORG_A),
      p_value: '2026-10-05T19:03:30.120Z',
    })

    expect(row()[key('pipeline_step_moved', ORG_A)]).toBeTruthy()
    expect(row()[key('trade_book_unlocked', ORG_A)]).toBeTruthy()
  })
})

describe('the write path contains no whole-column replace', () => {
  it('usePilotProgress never updates pilot_progress directly', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '../usePilotProgress.ts'), 'utf8')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    // The function name, however the call is spelled — it is currently
    // reached through a cast, because `Database` has no entry for it yet.
    expect(src).toContain('mark_pilot_progress')
    expect(src).toMatch(/supabase\.rpc/)
    // And no whole-column write survives anywhere in the hook.
    expect(src).not.toMatch(/update\(\s*\{\s*pilot_progress/)
    expect(src).not.toMatch(/from\('users'\)[\s\S]{0,120}update/)
  })
})
