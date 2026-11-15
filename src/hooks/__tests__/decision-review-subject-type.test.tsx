/**
 * The review row and the memory event must not disagree about what was
 * reviewed.
 *
 * ── The gap ──────────────────────────────────────────────────────────────
 *
 * `decision_reviews.decision_id` is TEXT and polymorphic: it holds a
 * `trade_queue_items` id, a `decision_requests` id, or a
 * `portfolio_trade_events` id depending on which Outcomes row was open.
 * Nothing on the row said which.
 *
 * `DecisionAccountabilityPage` already derives the answer from
 * (source, category) and passes it as `subjectType`. That value reached
 * `memory_events.subject_type` and was then dropped — the authoritative table
 * was the one place the discriminator was not kept. So the Spine's event
 * claimed a subject kind inferred in the UI, and the review row claimed
 * nothing at all.
 *
 * 20261115120000_decision_review_typed_subject resolves it in the database and
 * returns it on the upserted row. This file pins the client half: the event
 * now follows the SERVER's answer, and the UI inference survives only as a
 * fallback for the two cases where the server has none.
 *
 * Drives the real `useUpsertDecisionReview` over a recording Supabase double.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  /** What the upsert's `.select().single()` hands back. */
  upserted: null as Row | null,
  /** Every row written to `memory_events`. */
  events: [] as Row[],
  /** Rejection for the event insert, when a test wants one. */
  eventError: null as { message: string } | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'memory_events') {
        return {
          insert: async (row: Row) => {
            db.events.push(row)
            return { error: db.eventError }
          },
        }
      }
      // decision_reviews
      const chain: Record<string, unknown> = {}
      chain.upsert = () => chain
      chain.select = () => chain
      chain.single = async () => ({ data: db.upserted, error: null })
      return chain
    },
  },
}))

import { useUpsertDecisionReview } from '../useDecisionReview'

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** The row the database returns after the trigger has run. */
const serverRow = (over: Row = {}): Row => ({
  id: 'rev-1',
  decision_id: 'dr-7',
  subject_type: 'decision',
  decision_request_id: 'dr-7',
  trade_queue_item_id: null,
  portfolio_trade_event_id: null,
  decision_quality: 'good',
  thesis_played_out: 'yes',
  sizing_quality: 'appropriate',
  process_note: 'sized too late',
  reviewed_by: 'u1',
  reviewed_at: '2026-11-15T10:00:00Z',
  created_at: '2026-11-15T10:00:00Z',
  updated_at: '2026-11-15T10:00:00Z',
  ...over,
})

const save = async (args: Record<string, unknown>) => {
  const { result } = renderHook(() => useUpsertDecisionReview(), { wrapper })
  result.current.mutate(args as never)
  await waitFor(() => expect(result.current.isPending).toBe(false))
  return result
}

const baseArgs = {
  decisionId: 'dr-7',
  userId: 'u1',
  patch: { decision_quality: 'good' as const },
  organizationId: 'org-1',
}

beforeEach(() => {
  db.events.length = 0
  db.eventError = null
  db.upserted = serverRow()
})

describe('the memory event follows the server-resolved subject', () => {
  it('uses the server subject_type over the UI inference when they disagree', async () => {
    // The UI said "idea"; the database resolved the id to a decision request.
    // The whole point of moving the derivation into the trigger is that this
    // disagreement resolves in the data's favour.
    await save({ ...baseArgs, subjectType: 'idea' })

    expect(db.events).toHaveLength(1)
    expect(db.events[0].subject_type).toBe('decision')
  })

  it('falls back to the UI inference before the migration is applied', async () => {
    // A pre-migration database returns no `subject_type` at all. Losing the
    // event here would be worse than carrying a UI inference, so the
    // inference stands.
    db.upserted = serverRow({ subject_type: undefined, decision_request_id: undefined })

    await save({ ...baseArgs, subjectType: 'idea' })

    expect(db.events).toHaveLength(1)
    expect(db.events[0].subject_type).toBe('idea')
  })

  it('falls back for a legacy row the server could not resolve', async () => {
    // `unknown` is not a value `memory_events.subject_type` permits — its
    // CHECK allows asset/idea/decision/trade/batch/portfolio/obligation — so
    // writing it through would make the insert fail outright.
    db.upserted = serverRow({ subject_type: 'unknown', decision_request_id: null })

    await save({ ...baseArgs, subjectType: 'trade' })

    expect(db.events[0].subject_type).toBe('trade')
  })

  it('never writes `unknown` as a subject type', async () => {
    db.upserted = serverRow({ subject_type: 'unknown', decision_request_id: null })

    // No UI inference either: the writer must still land on a value the
    // table's CHECK accepts rather than on `unknown` or undefined.
    await save({ ...baseArgs })

    expect(db.events[0].subject_type).toBe('decision')
    expect(db.events[0].subject_type).not.toBe('unknown')
  })

  it('still records the review itself when the subject is unresolved', async () => {
    db.upserted = serverRow({ subject_type: 'unknown', decision_request_id: null })

    await save({ ...baseArgs, subjectType: 'idea' })

    // subject_id stays the decision_id — the only identifier that exists for
    // an unresolved subject. Dropping the event instead would lose the
    // conclusion to save a label.
    expect(db.events[0].subject_id).toBe('dr-7')
    expect(db.events[0].source_type).toBe('decision_reviews')
    expect(db.events[0].source_id).toBe('rev-1')
  })

  it('carries the normalised verdict and not the prose', async () => {
    await save({ ...baseArgs, subjectType: 'decision' })

    const payload = db.events[0].payload as Row
    expect(payload).toEqual({
      thesis_played_out: 'yes',
      decision_quality: 'good',
      sizing_quality: 'appropriate',
    })
    // `process_note` has an authoritative home and can be corrected there;
    // an immutable event must not freeze a copy of it.
    expect(JSON.stringify(db.events[0])).not.toContain('sized too late')
  })

  /*
   * `related` is how a lifecycle event is reachable from anything other than
   * its own subject_id. Measured on production 2026-11-15: both
   * `decision.reviewed` rows carry `related = {}`, while every
   * `execution.recorded` row names the asset, the portfolio, the trade, the
   * request and the idea. So the Spine's record of what the desk CONCLUDED
   * was the one kind of event that answered nothing about an asset.
   */
  describe('the conclusion is reachable from the asset and the portfolio', () => {
    it('carries the asset, the portfolio and the server-resolved typed id', async () => {
      await save({ ...baseArgs, assetId: 'asset-9', portfolioId: 'pf-3' })

      expect(db.events[0].related).toEqual({
        asset_id: 'asset-9',
        portfolio_id: 'pf-3',
        decision_request_id: 'dr-7',
      })
    })

    it('takes the typed pointer from the server row, not from the caller', async () => {
      // The row came back resolved as an idea. The event must point at the
      // idea, even though this call passed the same `decisionId` it always
      // does — the trigger decided which table it names.
      db.upserted = serverRow({
        subject_type: 'idea',
        decision_request_id: null,
        trade_queue_item_id: 'tqi-4',
      })

      await save({ ...baseArgs, assetId: 'asset-9', portfolioId: 'pf-3' })

      const related = db.events[0].related as Row
      expect(related.trade_queue_item_id).toBe('tqi-4')
      expect(related.decision_request_id).toBeUndefined()
    })

    it('omits an absent pointer rather than recording a known absence', async () => {
      // A null in `related` would read as "this decision has no portfolio",
      // which is a claim. An absent key is the absence of a claim.
      await save({ ...baseArgs, assetId: 'asset-9', portfolioId: null })

      const related = db.events[0].related as Row
      expect(Object.keys(related)).not.toContain('portfolio_id')
      expect(related.asset_id).toBe('asset-9')
    })

    it('still carries the asset before the migration is applied', async () => {
      // Pre-migration the row has no typed columns at all. Falling back to
      // `{}` here would reproduce exactly the state production is in.
      db.upserted = serverRow({
        subject_type: undefined,
        decision_request_id: undefined,
        trade_queue_item_id: undefined,
        portfolio_trade_event_id: undefined,
      })

      await save({ ...baseArgs, assetId: 'asset-9', portfolioId: 'pf-3', subjectType: 'decision' })

      expect(db.events[0].related).toEqual({ asset_id: 'asset-9', portfolio_id: 'pf-3' })
    })
  })

  it('emits no event when no organisation is known', async () => {
    await save({ ...baseArgs, organizationId: null, subjectType: 'decision' })
    expect(db.events).toHaveLength(0)
  })

  it('does not fail the review when the event cannot be written', async () => {
    db.eventError = { message: 'memory_events down' }

    const result = await save({ ...baseArgs, subjectType: 'decision' })

    // The review is authoritative and is already saved. A failed history
    // write must not surface as a failed save.
    expect(result.current.isError).toBe(false)
  })
})
