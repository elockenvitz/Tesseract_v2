/**
 * Every withdrawal path records a withdrawal, and none records a decision.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `withdrawn` is in `RESOLVED_DECISION_REQUEST_STATUSES`, so the single
 * resolved-status gate in `updateDecisionRequest` sent it to
 * `recordDecisionRecorded` — writing a PM decision for an act no PM
 * performed. Meanwhile three `TradeIdeaDetailModal` sites wrote `status`,
 * `reviewed_at` and `reviewed_by` straight to the table and recorded nothing.
 * One act, two code paths, two different wrong answers.
 *
 * ── Why this file tests FOUR paths, not one ───────────────────────────────
 *
 * The lesson from `decision-review-subject-type.test.tsx`, which asserted one
 * of three call paths and passed 16/16 against the exact mistake it existed
 * to catch. An injection into a covered path proves that path only. So every
 * path the claim covers is driven here:
 *
 *   1. updateDecisionRequest('withdrawn')          the service path
 *   2. withdrawDecisionRequestsForProposal         the modal paths, now one
 *      function called from three sites — collapsing them IS the fix, so the
 *      three sites are proven by proving they call it, which `3. and 4.`
 *      below cover at the source level because the alternative is rendering
 *      a 7,000-line modal
 *
 * and the four PM outcomes are kept as a regression guard so the change
 * cannot silently reclassify a real ruling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Op = [string, unknown[]]

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  /** Rows the "which requests are still open" lookup should return. */
  openRequests: [] as Array<Record<string, unknown>>,
  /** The row `updateDecisionRequest`'s UPDATE reads back. */
  updatedRow: {} as Record<string, unknown>,
  org: 'org-1' as string | null,
}))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)
const memoryRows = () => db.calls.filter(c => c.table === 'memory_events')
  .map(c => (c.ops.find(([op]) => op === 'insert')?.[1][0]) as Record<string, unknown>)
  .filter(Boolean)

vi.mock('../../supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'analyst-1' } } }) },
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in',
                        'is', 'not', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      const settle = () => {
        if (table === 'portfolios') {
          return { data: db.org ? { organization_id: db.org } : null, error: null }
        }
        if (table === 'decision_requests') {
          if (has(call.ops, 'update')) return { data: db.updatedRow, error: null }
          return { data: db.openRequests, error: null }
        }
        return { data: null, error: null }
      }
      chain.maybeSingle = async () => settle()
      chain.single = async () => settle()
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(settle()).then(res)
      return chain
    },
  },
}))

import {
  updateDecisionRequest,
  withdrawDecisionRequestsForProposal,
} from '../decision-request-service'
import { __resetOrgCacheForTests } from '../../memory/lifecycle-events'

beforeEach(() => {
  db.calls.length = 0
  db.openRequests = []
  db.updatedRow = {}
  db.org = 'org-1'
  __resetOrgCacheForTests()
  vi.restoreAllMocks()
})

describe('path 1 — updateDecisionRequest', () => {
  it('a withdrawal records recommendation.withdrawn, NOT decision.recorded', async () => {
    db.updatedRow = {
      id: 'dr-1', portfolio_id: 'pf-1', trade_queue_item_id: 'tqi-1',
      proposal_id: 'prop-1', reviewed_at: '2026-11-16T10:00:00.000Z',
    }
    await updateDecisionRequest('dr-1', { status: 'withdrawn', previousStatus: 'under_review' })

    const rows = memoryRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].event_type).toBe('recommendation.withdrawn')
    expect(memoryRows().map(r => r.event_type)).not.toContain('decision.recorded')
  })

  it('carries the prior status the caller read, and the server timestamp', async () => {
    db.updatedRow = {
      id: 'dr-1', portfolio_id: 'pf-1', reviewed_at: '2026-11-16T10:00:00.000Z',
    }
    await updateDecisionRequest('dr-1', { status: 'withdrawn', previousStatus: 'needs_discussion' })

    const row = memoryRows()[0]
    expect((row.payload as Record<string, unknown>).from_status).toBe('needs_discussion')
    expect((row.payload as Record<string, unknown>).to_status).toBe('withdrawn')
    // Identity derives from what the server stored, not a fresh clock.
    expect(row.dedupe_key).toContain(String(Date.parse('2026-11-16T10:00:00.000Z')))
  })

  it('records the prior status as unknown rather than guessing it', async () => {
    // The UPDATE has already destroyed it. A plausible default would be a
    // fabricated fact in a history whose only job is to be accurate.
    db.updatedRow = { id: 'dr-1', portfolio_id: 'pf-1', reviewed_at: '2026-11-16T10:00:00.000Z' }
    await updateDecisionRequest('dr-1', { status: 'withdrawn' })
    expect((memoryRows()[0].payload as Record<string, unknown>).from_status).toBe('unknown')
  })

  it('carries a rationale only when the caller passed one on THIS call', async () => {
    db.updatedRow = { id: 'dr-1', portfolio_id: 'pf-1', reviewed_at: '2026-11-16T10:00:00.000Z' }
    await updateDecisionRequest('dr-1', {
      status: 'withdrawn', previousStatus: 'pending', decisionNote: 'Pulled, cheaper entry later.',
    })
    expect((memoryRows()[0].payload as Record<string, unknown>).rationale)
      .toBe('Pulled, cheaper entry later.')

    db.calls.length = 0
    db.updatedRow = { id: 'dr-2', portfolio_id: 'pf-1', reviewed_at: '2026-11-16T10:00:00.000Z' }
    await updateDecisionRequest('dr-2', { status: 'withdrawn', previousStatus: 'pending' })
    expect(memoryRows()[0].payload).not.toHaveProperty('rationale')
  })

  it('REGRESSION: the four PM outcomes still record decision.recorded', async () => {
    for (const status of ['accepted', 'accepted_with_modification', 'rejected', 'deferred'] as const) {
      db.calls.length = 0
      db.updatedRow = { id: 'dr-x', portfolio_id: 'pf-1', reviewed_at: '2026-11-16T10:00:00.000Z' }
      await updateDecisionRequest('dr-x', { status })
      const rows = memoryRows()
      expect(rows.map(r => r.event_type), status).toEqual(['decision.recorded'])
      expect((rows[0].payload as Record<string, unknown>).status, status).toBe(status)
    }
  })

  it('reopening to pending still records nothing', async () => {
    db.updatedRow = { id: 'dr-1', portfolio_id: 'pf-1' }
    await updateDecisionRequest('dr-1', { status: 'pending' })
    expect(memoryRows()).toHaveLength(0)
  })
})

describe('path 2 — withdrawDecisionRequestsForProposal, the modal paths', () => {
  it('records one withdrawal per open request, each with its own prior status', async () => {
    db.openRequests = [
      { id: 'dr-a', status: 'pending', portfolio_id: 'pf-1', trade_queue_item_id: 'tqi-1' },
      { id: 'dr-b', status: 'needs_discussion', portfolio_id: 'pf-2', trade_queue_item_id: 'tqi-1' },
    ]
    db.updatedRow = { id: 'dr-a', reviewed_at: '2026-11-16T11:00:00.000Z', portfolio_id: 'pf-1' }

    const { withdrawnIds } = await withdrawDecisionRequestsForProposal('prop-9', 'analyst-1')

    expect(withdrawnIds).toEqual(['dr-a', 'dr-b'])
    const rows = memoryRows()
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.event_type === 'recommendation.withdrawn')).toBe(true)
    expect(rows.map(r => (r.payload as Record<string, unknown>).from_status))
      .toEqual(['pending', 'needs_discussion'])
    expect(rows.map(r => r.subject_id)).toEqual(['dr-a', 'dr-b'])
  })

  it('selects `status`, because the UPDATE is about to destroy it', async () => {
    // The inline copies selected only `id`, which discarded the prior status
    // irrecoverably. This is the assertion that stops that regressing.
    db.openRequests = [{ id: 'dr-a', status: 'pending', portfolio_id: 'pf-1' }]
    await withdrawDecisionRequestsForProposal('prop-9', 'analyst-1')

    const read = db.calls.find(c =>
      c.table === 'decision_requests' && has(c.ops, 'select') && !has(c.ops, 'update'))
    const selected = String(read?.ops.find(([op]) => op === 'select')?.[1][0] ?? '')
    expect(selected).toContain('status')
  })

  it('shares ONE instant across the batch, because it was one user action', async () => {
    db.openRequests = [
      { id: 'dr-a', status: 'pending', portfolio_id: 'pf-1' },
      { id: 'dr-b', status: 'pending', portfolio_id: 'pf-1' },
    ]
    // No reviewed_at read back, so the batch's own timestamp is used.
    db.updatedRow = { id: 'dr-a', portfolio_id: 'pf-1' }
    await withdrawDecisionRequestsForProposal('prop-9', 'analyst-1')

    const keys = memoryRows().map(r => String(r.dedupe_key))
    const instants = keys.map(k => k.split(':').pop())
    expect(new Set(instants).size).toBe(1)
    // Different requests, so still two distinct events.
    expect(new Set(keys).size).toBe(2)
  })

  it('records nothing and reports nothing when no request is open', async () => {
    db.openRequests = []
    const { withdrawnIds } = await withdrawDecisionRequestsForProposal('prop-9', 'analyst-1')
    expect(withdrawnIds).toEqual([])
    expect(memoryRows()).toHaveLength(0)
  })

  it('refuses without an actor rather than recording an unattributed withdrawal', async () => {
    const { withdrawnIds } = await withdrawDecisionRequestsForProposal('prop-9', undefined)
    expect(withdrawnIds).toEqual([])
    expect(memoryRows()).toHaveLength(0)
    // And it must not even have touched the table.
    expect(db.calls).toHaveLength(0)
  })

  it('records nothing when the organisation cannot be derived', async () => {
    // Org comes from the portfolio, server-side. No org means no event — it
    // must never fall back to a client-supplied or guessed tenant.
    db.org = null
    db.openRequests = [{ id: 'dr-a', status: 'pending', portfolio_id: 'pf-1' }]
    const { withdrawnIds } = await withdrawDecisionRequestsForProposal('prop-9', 'analyst-1')
    expect(withdrawnIds).toEqual(['dr-a'])   // the withdrawal still happened
    expect(memoryRows()).toHaveLength(0)     // but nothing was attributed
  })

  it('every event is stamped with the org derived from the portfolio', async () => {
    db.org = 'org-7'
    db.openRequests = [{ id: 'dr-a', status: 'pending', portfolio_id: 'pf-1' }]
    await withdrawDecisionRequestsForProposal('prop-9', 'analyst-1')
    expect(memoryRows()[0].organization_id).toBe('org-7')
    expect(memoryRows()[0].actor_id).toBe('analyst-1')
  })
})

describe('paths 3-5 — the three modal call sites are wired to the one writer', () => {
  /**
   * These assert on source text, which this repo does elsewhere and which is
   * weaker than driving the component. The honest reason: the call sites are
   * inline arrow handlers inside a 7,000-line modal with no seam to render
   * one in isolation, and the previous attempt to assert this area by
   * READING the source is exactly what produced the vacuous gate.
   *
   * So the division is deliberate. The BEHAVIOUR is proven above against the
   * real `withdrawDecisionRequestsForProposal`. What is proven here is only
   * the wiring: that no site still writes `status: 'withdrawn'` by hand, and
   * that each one calls the writer. If a fourth site appears, the first
   * assertion fails.
   */
  const modal = readFileSync(
    resolve(__dirname, '../../../components/trading/TradeIdeaDetailModal.tsx'), 'utf8')

  it('no site writes a withdrawal directly any more', () => {
    expect(modal).not.toMatch(/status:\s*'withdrawn'/)
  })

  it('all three sites call the shared writer, with distinct provenance', () => {
    const calls = modal.match(/withdrawDecisionRequestsForProposal\([^)]*\)/g) ?? []
    expect(calls).toHaveLength(3)
    const provenances = calls.map(c => c.match(/'(ui:[^']+)'/)?.[1]).filter(Boolean)
    expect(new Set(provenances).size).toBe(3)
  })

  it('SELF-TEST: the direct-write pattern would be caught if it came back', () => {
    // Without this, the first assertion passes against a regex that matches
    // nothing — the vacuity that let the last source-level gate read green.
    const regressed = "supabase.from('decision_requests').update({ status: 'withdrawn' })"
    expect(regressed).toMatch(/status:\s*'withdrawn'/)
  })
})

describe('the migration that admits the event type', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../../../supabase/migrations/20261116020000_memory_events_recommendation_withdrawn.sql'),
    'utf8')

  it('adds the new value and keeps all nine existing ones', () => {
    expect(sql).toContain("'recommendation.withdrawn'")
    for (const existing of [
      'thesis.reviewed', 'decision.reviewed', 'obligation.raised', 'obligation.cleared',
      'rationale.captured', 'recommendation.submitted', 'decision.recorded',
      'decision.reverted', 'execution.recorded',
    ]) {
      expect(sql, existing).toContain(`'${existing}'`)
    }
  })

  it('verifies its own postcondition and proves the constraint still rejects', () => {
    expect(sql).toMatch(/raise exception/i)
    expect(sql).toMatch(/check_violation/i)
  })

  it('does not backfill, and does not touch policies or grants', () => {
    // Comments must be stripped first. The file EXPLAINS its RLS posture in
    // prose ("anon keeps no grant"), and asserting against the prose would
    // fail on documentation while saying nothing about the statements — the
    // test has to look at the SQL it claims to be about.
    const statements = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')

    expect(statements).not.toMatch(/\binsert\s+into\s+public\.memory_events\s*\([^)]*\)\s*select/i)
    expect(statements).not.toMatch(/create\s+policy|alter\s+policy|drop\s+policy/i)
    expect(statements).not.toMatch(/^\s*(grant|revoke)\b/im)

    // SELF-TEST: the stripper must not simply empty the file, or all three
    // assertions above pass vacuously.
    expect(statements).toMatch(/alter table public\.memory_events/i)
    expect(statements).toContain("'recommendation.withdrawn'")
  })
})
