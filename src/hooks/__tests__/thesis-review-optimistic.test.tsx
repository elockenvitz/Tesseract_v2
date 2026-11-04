/**
 * A verdict that is on the record from the press, not from the round trip.
 *
 * ── The defect this exists for ───────────────────────────────────────────
 *
 * The three verdict buttons read their selection from the fetched
 * conclusions. Pressing one wrote a row and then invalidated that query, so
 * between the insert resolving and the refetch landing the surfaces still
 * held the PREVIOUS conclusion -- and the bar lit the old button again for a
 * full round trip before snapping to the new one. Lighting the in-flight
 * answer closed the gap at the front of the press and left this one in the
 * middle, which is the flicker between two buttons a reader sees.
 *
 * These cases drive the real hook against an in-memory `memory_events` whose
 * insert can be held open, so the window between "pressed" and "confirmed" is
 * a thing the test can stand inside and look at. A source-level assertion
 * cannot see this: `onMutate` existing is not the same as the cache holding
 * the right answer while a write is in flight.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'

const ORG = 'org-a'
const ME = 'user-me'
const ASSET = 'asset-wmt'

const env = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** Resolves the insert. Held open so the in-flight window can be inspected. */
  release: null as null | (() => void),
  insertError: null as null | { message: string },
  /** Blocks every read while set, so a refetch cannot stand in for a rollback. */
  selectGate: null as null | Promise<void>,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const filters: Array<[string, unknown]> = []
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => { filters.push([col, val]); return chain }
      chain.order = () => chain
      chain.insert = async (row: Record<string, unknown>) => {
        if (env.release) await new Promise<void>(r => { env.release = r })
        if (env.insertError) return { error: env.insertError }
        env.rows = [{ ...row, occurred_at: new Date().toISOString(), id: `real-${env.rows.length}` }, ...env.rows]
        return { error: null }
      }
      chain.then = async (resolve: (v: unknown) => unknown) => {
        // Held reads, so a case can prove that something OTHER than the
        // refetch restored the surface.
        if (env.selectGate) await env.selectGate
        return resolve({
          data: env.rows.filter(r => filters.every(([col, val]) => r[col] === val)),
          error: null,
        })
      }
      return chain
    },
  },
}))
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: ME } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: ORG }),
}))

import { useRecordThesisReview, useCurrentThesisConclusion } from '../useThesisReview'

/** The pair a verdict bar uses: what is on the record, and how to change it. */
function useReviewBar() {
  const recorder = useRecordThesisReview(ASSET)
  const { current } = useCurrentThesisConclusion(ASSET)
  return { recorder, current }
}

const event = (outcome: string, at: string) => ({
  id: `e-${outcome}-${at}`,
  subject_id: ASSET,
  occurred_at: at,
  payload: { outcome },
  organization_id: ORG,
  actor_id: ME,
  event_type: 'thesis.reviewed',
  subject_type: 'asset',
})

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

beforeEach(() => {
  env.rows = [event('holds', new Date(Date.now() - 86_400_000).toISOString())]
  env.release = null
  env.insertError = null
})

describe('the standing verdict never falls back to the one being replaced', () => {
  it('reads the recorded conclusion before anything is pressed', async () => {
    const { wrapper } = harness()
    const { result } = renderHook(useReviewBar, { wrapper })
    await waitFor(() => expect(result.current.current?.outcome).toBe('holds'))
    expect(result.current.current?.byMe).toBe(true)
  })

  /*
   * The whole case. The insert is held open, so this stands in the window
   * that used to show the old answer -- and then keeps looking AFTER the
   * insert resolves, which is where the second jump lived: `pendingOutcome`
   * had gone, the refetch had not arrived, and the bar lit `holds` again.
   */
  it('holds the new conclusion from the press through to the refetch', async () => {
    const { wrapper } = harness()
    const { result } = renderHook(useReviewBar, { wrapper })
    await waitFor(() => expect(result.current.current?.outcome).toBe('holds'))

    // Hold the insert open.
    env.release = () => {}
    act(() => { result.current.recorder.record('changed') })

    // In flight: the press is already the record's answer.
    await waitFor(() => expect(result.current.current?.outcome).toBe('changed'))
    expect(result.current.recorder.isPending).toBe(true)

    // Let the write finish and the refetch run. The answer must not flip back
    // to `holds` at any point -- sampled across the settle, not just after it.
    const seen: (string | undefined)[] = []
    const stop = setInterval(() => seen.push(result.current.current?.outcome), 1)
    act(() => { env.release?.() })
    await waitFor(() => expect(result.current.recorder.isPending).toBe(false))
    await waitFor(() => expect(env.rows[0]?.payload).toEqual({ outcome: 'changed' }))
    clearInterval(stop)

    expect(result.current.current?.outcome).toBe('changed')
    expect(seen).not.toContain('holds')
  })

  /*
   * A write that failed never happened, so the bar must go back to what the
   * record actually says rather than keeping a conclusion nobody recorded.
   *
   * ── Why the reads are held ─────────────────────────────────────────────
   *
   * The first version of this case just waited for the outcome to return to
   * `holds` after a failed insert, and PASSED with the rollback deleted: the
   * `onSettled` refetch fetches the real rows, which still say `holds`, so
   * eventual consistency satisfied an assertion meant for the rollback. That
   * is the difference between "it comes back eventually" and "the surface
   * never showed a conclusion nobody recorded".
   *
   * Reads are blocked for the duration here, so the refetch cannot answer and
   * the only thing that can restore the previous conclusion is `onError`
   * putting it back.
   */
  it('puts the previous conclusion back when the write fails', async () => {
    const { wrapper } = harness()
    const { result } = renderHook(useReviewBar, { wrapper })
    await waitFor(() => expect(result.current.current?.outcome).toBe('holds'))

    let open!: () => void
    env.selectGate = new Promise<void>(r => { open = r })
    env.insertError = { message: 'permission denied' }

    await act(async () => { result.current.recorder.record('needs_work') })
    await waitFor(() => expect(result.current.recorder.isPending).toBe(false))
    // No read can have answered, so this is the rollback and nothing else.
    expect(result.current.current?.outcome).toBe('holds')

    env.selectGate = null
    open()
  })
})

/**
 * Taking the answer back, from the press through to the refetch.
 *
 * ── Why this needs a behavioural case and not a source one ───────────────
 *
 * The clear travels as `outcome: 'cleared'` through the same insert and the
 * same optimistic cache write as a verdict, and the thing that turns it into
 * "unanswered" is `latestConclusionByAsset` dropping it AFTER resolving
 * newest-per-asset. Three separate pieces have to agree: the writer, the
 * cache, and the reducer. A source assertion can see that each exists and
 * still miss them disagreeing -- and the disagreement has a specific shape,
 * which is the bar snapping back to the verdict the reader just removed the
 * moment the real rows arrive.
 */
describe('pressing the standing answer takes it off the record', () => {
  it('leaves the asset unanswered from the press through to the refetch', async () => {
    const { wrapper } = harness()
    const { result } = renderHook(useReviewBar, { wrapper })
    await waitFor(() => expect(result.current.current?.outcome).toBe('holds'))

    // Hold the insert open, so the in-flight window is a place to stand.
    env.release = () => {}
    act(() => { result.current.recorder.clear() })

    // In flight: already unanswered, not still showing `holds`.
    await waitFor(() => expect(result.current.current).toBeNull())
    expect(result.current.recorder.isPending).toBe(true)

    // Let the write land and the refetch run. `holds` must not come back at
    // any point -- sampled across the settle, because the row that says it is
    // still in the table and only the reducer's ORDER keeps it quiet.
    const seen: (string | null | undefined)[] = []
    const stop = setInterval(() => seen.push(result.current.current?.outcome ?? null), 1)
    act(() => { env.release?.() })
    await waitFor(() => expect(result.current.recorder.isPending).toBe(false))
    await waitFor(() => expect(env.rows[0]?.payload).toEqual({ outcome: 'cleared' }))
    clearInterval(stop)

    expect(result.current.current).toBeNull()
    expect(seen).not.toContain('holds')
  })

  /*
   * And a verdict after a clear answers again. The pair is the case: a clear
   * that could not be undone would be a worse trap than the one it fixed.
   */
  it('takes a new answer after a clear', async () => {
    const { wrapper } = harness()
    const { result } = renderHook(useReviewBar, { wrapper })
    await waitFor(() => expect(result.current.current?.outcome).toBe('holds'))

    await act(async () => { result.current.recorder.clear() })
    await waitFor(() => expect(result.current.current).toBeNull())

    await act(async () => { result.current.recorder.record('needs_work') })
    await waitFor(() => expect(result.current.current?.outcome).toBe('needs_work'))
    // Three events on the record, nothing deleted: the reader's change of mind
    // is auditable, which is the reason the conclusion is an event at all.
    expect(env.rows).toHaveLength(3)
  })

  /* A failed clear never happened, so the answer must still be on the bar
     rather than removed from a record that still holds it. */
  it('puts the answer back when the clear fails', async () => {
    const { wrapper } = harness()
    const { result } = renderHook(useReviewBar, { wrapper })
    await waitFor(() => expect(result.current.current?.outcome).toBe('holds'))

    let open!: () => void
    env.selectGate = new Promise<void>(r => { open = r })
    env.insertError = { message: 'permission denied' }

    await act(async () => { result.current.recorder.clear() })
    await waitFor(() => expect(result.current.recorder.isPending).toBe(false))
    // Reads are blocked, so this is `onError` and not eventual consistency.
    expect(result.current.current?.outcome).toBe('holds')

    env.selectGate = null
    open()
  })
})
