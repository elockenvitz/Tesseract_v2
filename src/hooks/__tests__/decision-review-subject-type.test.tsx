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
  /** The upsert payload, as sent. */
  upsertPayload: null as Row | null,
  /** The argument to `.select()` after the upsert, as sent. */
  selectArg: undefined as unknown,
  /**
   * Behave like a database on which 20261115120000 has NOT been applied.
   *
   * PostgREST fails the WHOLE statement with 42703 on an unknown column, so
   * on a pre-migration database naming any of the four new columns — in the
   * payload or in a select list — takes the review panel out entirely rather
   * than degrading. That is the broken path the gate below exists to catch.
   */
  preMigration: false,
}))

/** `decision_reviews` as it stands in production today. */
const PRE_MIGRATION_COLUMNS = vi.hoisted(() => new Set([
  'id', 'decision_id', 'organization_id',
  'decision_quality', 'thesis_played_out', 'sizing_quality', 'process_note',
  'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
]))

const MIGRATION_PENDING_COLUMNS = vi.hoisted(() => [
  'subject_type', 'trade_queue_item_id', 'decision_request_id',
  'portfolio_trade_event_id',
])

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
      let failure: { message: string; code: string } | null = null
      const undefinedColumn = (name: string) => ({
        code: '42703',
        message: `column decision_reviews.${name} does not exist`,
      })
      const chain: Record<string, unknown> = {}
      chain.upsert = (payload: Row) => {
        db.upsertPayload = payload
        if (db.preMigration) {
          const unknown = Object.keys(payload).find(k => !PRE_MIGRATION_COLUMNS.has(k))
          if (unknown) failure = undefinedColumn(unknown)
        }
        return chain
      }
      chain.select = (arg?: unknown) => {
        db.selectArg = arg
        if (db.preMigration && typeof arg === 'string' && arg !== '*') {
          const unknown = arg.split(',').map(s => s.trim())
            .find(c => c && !PRE_MIGRATION_COLUMNS.has(c))
          if (unknown) failure = undefinedColumn(unknown)
        }
        return chain
      }
      chain.single = async () => failure
        ? { data: null, error: failure }
        : { data: db.upserted, error: null }
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
  db.upsertPayload = null
  db.selectArg = undefined
  db.preMigration = false
})

/**
 * The review panel must work on a database where the migration is NOT applied.
 *
 * This is a shipping constraint, not a nicety. The frontend change and the
 * migration are reviewed together but deploy separately, and the frontend goes
 * first — so for some window the code runs against today's `decision_reviews`.
 * If any statement named a column the migration adds, PostgREST would fail the
 * whole statement with 42703 and saving a review would simply stop working.
 *
 * The protection is a backward-compatible READER, not a feature flag: reads
 * use `select('*')` and the write names only columns that already exist, so
 * the typed columns appear by themselves once the migration lands and no
 * second deploy is needed. These cases hold that shape in place.
 */
describe('the review panel is safe while the migration is unapplied', () => {
  it('saves and records the event against a pre-migration database', async () => {
    db.preMigration = true
    // What such a database returns: the row, without the four new columns.
    db.upserted = serverRow({
      subject_type: undefined,
      trade_queue_item_id: undefined,
      decision_request_id: undefined,
      portfolio_trade_event_id: undefined,
    })

    const result = await save({ ...baseArgs, subjectType: 'idea', assetId: 'asset-9' })

    expect(result.current.isError).toBe(false)
    expect(db.events).toHaveLength(1)
    expect(db.events[0].subject_type).toBe('idea')
    expect(db.events[0].related).toEqual({ asset_id: 'asset-9' })
  })

  it('writes no column the migration has yet to add', async () => {
    db.preMigration = true
    await save({ ...baseArgs, subjectType: 'decision' })

    const written = Object.keys(db.upsertPayload ?? {})
    for (const column of MIGRATION_PENDING_COLUMNS) {
      expect(written, `upsert must not write ${column}`).not.toContain(column)
    }
    // Belt and braces: the double would have failed the statement, so this
    // also proves the assertion above is not the only thing holding the line.
    expect(written.length).toBeGreaterThan(0)
  })

  it('reads the row whole rather than naming columns', async () => {
    // `select('*')` is what makes this forward-compatible in BOTH directions:
    // it cannot 42703 before the migration, and it starts returning the typed
    // columns the moment the migration lands, with no second deploy.
    db.preMigration = true
    await save({ ...baseArgs, subjectType: 'decision' })

    expect(db.selectArg === undefined || db.selectArg === '*').toBe(true)
  })

  it('the pre-migration double is not a rubber stamp', async () => {
    // Standing Rule 3 applied to the double itself. If `preMigration` did not
    // actually reject an unknown column, the three cases above would pass on
    // a frontend that names `subject_type` and breaks in production.
    db.preMigration = true
    const { supabase } = await import('../../lib/supabase')
    const { error } = await (supabase.from('decision_reviews') as never as {
      upsert: (p: Row) => { select: () => { single: () => Promise<{ error: unknown }> } }
    }).upsert({ decision_id: 'dr-7', subject_type: 'decision' }).select().single()

    expect(error).toMatchObject({ code: '42703' })
    expect((error as { message: string }).message).toContain('subject_type')
  })
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
