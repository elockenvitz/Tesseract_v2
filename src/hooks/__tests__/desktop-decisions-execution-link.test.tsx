/**
 * Desktop Decisions finds the trade that executed a Trade Lab decision.
 *
 * Trade Lab Execute never wrote `decision_requests.accepted_trade_id`, so every
 * Trade Lab execution after the April backfill reached Decisions with no
 * execution and no batch: the pilot's executed trade read "Never executed" and
 * the batch's "Why this decision?" was invisible. Production on 2026-09-15: 10
 * accepted Trade Lab requests unlinked, each with exactly one active, completed
 * trade naming it through `accepted_trades.decision_request_id`, and one
 * withdrawn request whose only trade is inactive.
 *
 * The rule under test: follow the trade's own FK back, for accepted requests
 * only, and only where exactly one active, original trade in the same book
 * answers. Nothing is matched on symbol, portfolio or time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

type Call = { table: string; ops: Array<[string, unknown[]]> }
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  rows: {} as Record<string, unknown[]>,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, ops: [] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'in', 'is', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: db.rows[table] ?? [], error: null }).then(resolve)
      return chain
    },
  },
}))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: 'org-1' }) }))

import { useDecisionScan } from '../useDesktopDecisions'
import { fallbackExecutionFor } from '../../lib/desktop-decisions'

const request = (id: string, over: Record<string, unknown> = {}) => ({
  id, trade_queue_item_id: `tq-${id}`, portfolio_id: 'p1', status: 'accepted', requested_action: 'buy',
  context_note: null, decision_note: 'Self-proposed via Trade Lab Execute', deferred_until: null,
  sizing_weight: 2, sizing_shares: null, submission_snapshot: {},
  created_at: '2026-09-14T16:00:00Z', reviewed_at: '2026-09-14T16:48:00Z', reviewed_by: 'u1', requested_by: 'u1',
  accepted_trade_id: null, accepted_trades: null,
  portfolios: { id: 'p1', name: 'Tech & Consumer Growth', organization_id: 'org-1' },
  reviewer: null, requester: null, trade_queue_items: null,
  ...over,
})

const trade = (id: string, decisionRequestId: string, over: Record<string, unknown> = {}) => ({
  id, decision_request_id: decisionRequestId, portfolio_id: 'p1', is_active: true, corrects_accepted_trade_id: null,
  execution_status: 'complete', execution_completed_at: '2026-09-14T16:48:17Z', executed_by: null, batch_id: null,
  ...over,
})

function scan() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useDecisionScan(null), { wrapper })
}

beforeEach(() => {
  db.calls.length = 0
  db.rows = {
    decision_requests: [
      // The Inbox path: linked directly. Unchanged.
      request('linked', {
        decision_note: 'Looks right, sized to plan.', accepted_trade_id: 'at-linked',
        accepted_trades: { id: 'at-linked', execution_status: 'complete', execution_completed_at: '2026-09-01T00:00:00Z', executed_by: null, batch_id: null },
      }),
      // The pilot's Trade Lab execution: unlinked, one trade names it.
      request('pilot'),
      // Withdrawn: its trade is inactive. Never a fallback.
      request('withdrawn', { status: 'withdrawn', decision_note: 'Withdrawn during cleanup — no active recommendation for this pair' }),
      // Two active originals claim it: ambiguous, so no execution.
      request('ambiguous', { decision_note: 'Accepted via Trade Lab Execute' }),
      // Its only trade is in another book: not this decision's execution.
      request('other-book'),
      // Pending: nothing executed it yet.
      request('pending', { status: 'pending', reviewed_at: null, reviewed_by: null, decision_note: null }),
    ],
    accepted_trades: [
      trade('at-pilot', 'pilot', { batch_id: 'b-1' }),
      trade('at-pilot-correction', 'pilot', { corrects_accepted_trade_id: 'at-pilot', batch_id: 'b-1' }),
      trade('at-withdrawn', 'withdrawn', { is_active: false, execution_status: 'not_started', execution_completed_at: null }),
      trade('at-a1', 'ambiguous'),
      trade('at-a2', 'ambiguous'),
      trade('at-other', 'other-book', { portfolio_id: 'p2' }),
    ],
    trade_batches: [{ id: 'b-1', name: '1 buy · 09/14/2026', description: 'Adding on weakness ahead of the print.' }],
    users: [],
  }
})

describe('Trade Lab executions on desktop Decisions', () => {
  it('shows the pilot trade as executed, with its batch and rationale', async () => {
    const { result } = scan()
    await waitFor(() => expect(result.current.decisions).toHaveLength(6))
    const pilot = result.current.decisions.find(d => d.id === 'pilot')!
    expect(pilot.execution).toMatchObject({ id: 'at-pilot', status: 'complete', completedAt: '2026-09-14T16:48:17Z' })
    expect(pilot.batch).toEqual({ id: 'b-1', name: '1 buy · 09/14/2026', description: 'Adding on weakness ahead of the print.' })
  })

  it('attaches nothing it cannot prove', async () => {
    const { result } = scan()
    await waitFor(() => expect(result.current.decisions).toHaveLength(6))
    const byId = Object.fromEntries(result.current.decisions.map(d => [d.id, d]))
    expect(byId.withdrawn.execution).toBeNull()
    expect(byId.ambiguous.execution).toBeNull()
    expect(byId['other-book'].execution).toBeNull()
    expect(byId.pending.execution).toBeNull()
    // The directly linked record is read as it always was.
    expect(byId.linked.execution?.id).toBe('at-linked')
  })

  it('looks up only accepted, unlinked requests, by the trade’s FK, within their books', async () => {
    const { result } = scan()
    await waitFor(() => expect(result.current.decisions).toHaveLength(6))
    const lookups = db.calls.filter(c => c.table === 'accepted_trades')
    expect(lookups).toHaveLength(1)
    const ins = Object.fromEntries(lookups[0].ops.filter(([op]) => op === 'in').map(([, [col, vals]]) => [col as string, vals]))
    expect(ins.decision_request_id).toEqual(['pilot', 'ambiguous', 'other-book'])
    expect(ins.portfolio_id).toEqual(['p1'])
  })

  it('does not look anything up when every accepted request is linked', async () => {
    db.rows.decision_requests = (db.rows.decision_requests as Array<{ id: string }>).filter(r => r.id === 'linked' || r.id === 'pending')
    const { result } = scan()
    await waitFor(() => expect(result.current.decisions).toHaveLength(2))
    expect(db.calls.some(c => c.table === 'accepted_trades')).toBe(false)
  })
})

describe('the fallback rule itself', () => {
  const req = { id: 'dr', portfolio_id: 'p1', status: 'accepted', accepted_trade_id: null }
  const t = (over: Record<string, unknown> = {}) =>
    ({ id: 'at', decision_request_id: 'dr', portfolio_id: 'p1', is_active: true, corrects_accepted_trade_id: null, ...over })

  it('takes the one active original trade that names the request', () => {
    expect(fallbackExecutionFor(req, [t()])?.id).toBe('at')
    expect(fallbackExecutionFor({ ...req, status: 'accepted_with_modification' }, [t()])?.id).toBe('at')
  })

  it('refuses everything else', () => {
    expect(fallbackExecutionFor({ ...req, accepted_trade_id: 'at-direct' }, [t()])).toBeNull()
    expect(fallbackExecutionFor({ ...req, status: 'rejected' }, [t()])).toBeNull()
    expect(fallbackExecutionFor(req, [t({ decision_request_id: 'someone-else' })])).toBeNull()
    expect(fallbackExecutionFor(req, [t({ portfolio_id: 'p2' })])).toBeNull()
    expect(fallbackExecutionFor(req, [t({ is_active: false })])).toBeNull()
    expect(fallbackExecutionFor(req, [t({ is_active: null })])).toBeNull()
    expect(fallbackExecutionFor(req, [t({ corrects_accepted_trade_id: 'at-0' })])).toBeNull()
    expect(fallbackExecutionFor(req, [t({ id: 'a' }), t({ id: 'b' })])).toBeNull()
    expect(fallbackExecutionFor(req, [])).toBeNull()
  })
})
