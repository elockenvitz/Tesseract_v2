/**
 * The write path and the read path, against a fake that models the real
 * constraints.
 *
 * What is actually being asserted:
 *
 *   - repeated clicks and retries cannot produce two open obligations
 *     (`memory_obligations_open_uk`);
 *   - changing the date is deterministic and preserves the first fact;
 *   - cancelling clears;
 *   - a due obligation resolves back to the right canonical work object,
 *     with no model involved;
 *   - org A cannot see org B's obligations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Ob {
  id: string
  organization_id: string
  kind: string
  subject_type: string
  subject_id: string
  owner_id: string | null
  raised_at: string
  due_at: string | null
  cleared_at: string | null
  source_type: string | null
  source_id: string | null
  provenance: string
}

const db = vi.hoisted(() => ({
  obligations: [] as any[],
  ideas: [] as any[],
  decisions: [] as any[],
  /** The caller's org. Stands in for the RLS SELECT policy. */
  callerOrg: 'org-A',
  rpcError: null as { message: string } | null,
  seq: 0,
}))

const OPEN_KEY = (o: Ob) =>
  `${o.organization_id}|${o.kind}|${o.subject_type}|${o.subject_id}|${o.owner_id ?? 'none'}`

vi.mock('../../supabase', () => {
  /** `raise_memory_obligation`: idempotent on the open-obligation key. */
  function raise(p: any) {
    const candidate = {
      organization_id: p.p_org_id, kind: p.p_kind, subject_type: p.p_subject_type,
      subject_id: p.p_subject_id, owner_id: p.p_owner_id,
    } as Ob
    const existing = db.obligations.find(
      (o: Ob) => o.cleared_at === null && OPEN_KEY(o) === OPEN_KEY(candidate),
    )
    if (existing) return existing.id
    const row: Ob = {
      id: `ob-${++db.seq}`,
      organization_id: p.p_org_id, kind: p.p_kind, subject_type: p.p_subject_type,
      subject_id: p.p_subject_id, owner_id: p.p_owner_id ?? null,
      raised_at: new Date().toISOString(), due_at: p.p_due_at ?? null,
      cleared_at: null, source_type: p.p_source_type ?? null,
      source_id: p.p_source_id ?? null, provenance: p.p_provenance,
    }
    db.obligations.push(row)
    return row.id
  }

  function clear(id: string) {
    const row = db.obligations.find((o: Ob) => o.id === id)
    if (!row || row.cleared_at) return false
    row.cleared_at = new Date().toISOString()
    return true
  }

  /** `supersede_memory_obligation`: no-op when the date has not moved. */
  function supersede(p: any) {
    const candidate = {
      organization_id: p.p_org_id, kind: p.p_kind, subject_type: p.p_subject_type,
      subject_id: p.p_subject_id, owner_id: p.p_owner_id,
    } as Ob
    const existing = db.obligations.find(
      (o: Ob) => o.cleared_at === null && OPEN_KEY(o) === OPEN_KEY(candidate),
    )
    if (existing) {
      if ((existing.due_at ?? null) === (p.p_due_at ?? null)) return existing.id
      clear(existing.id)
    }
    return raise(p)
  }

  const applyFilters = (rows: any[], filters: [string, unknown][]) =>
    rows.filter(r => filters.every(([col, val]) => {
      if (col.endsWith(':null')) return r[col.slice(0, -5)] === null
      if (col.endsWith(':in')) return (val as unknown[]).includes(r[col.slice(0, -3)])
      if (col.endsWith(':lte')) return r[col.slice(0, -4)] !== null && r[col.slice(0, -4)] <= val
      if (col.endsWith(':gt')) return r[col.slice(0, -3)] !== null && r[col.slice(0, -3)] > val
      return r[col] === val
    }))

  function builder(rows: () => any[]) {
    const filters: [string, unknown][] = []
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => (filters.push([c, v]), api),
      is: (c: string, _v: unknown) => (filters.push([`${c}:null`, null]), api),
      in: (c: string, v: unknown) => (filters.push([`${c}:in`, v]), api),
      lte: (c: string, v: unknown) => (filters.push([`${c}:lte`, v]), api),
      gt: (c: string, v: unknown) => (filters.push([`${c}:gt`, v]), api),
      order: () => api,
      limit: () => api,
      then: (resolve: any) => resolve({ data: applyFilters(rows(), filters), error: null }),
    }
    return api
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'memory_obligations') {
          // Stands in for the RLS SELECT policy: org members only. Every
          // isolation assertion below rests on this line, not on the
          // explicit .eq() the query also applies.
          return builder(() => db.obligations.filter((o: Ob) => o.organization_id === db.callerOrg))
        }
        if (table === 'trade_queue_items') return builder(() => db.ideas)
        if (table === 'decision_requests') return builder(() => db.decisions)
        throw new Error(`unexpected table ${table}`)
      },
      rpc: async (name: string, params: any) => {
        if (db.rpcError) return { data: null, error: db.rpcError }
        if (name === 'raise_memory_obligation') return { data: raise(params), error: null }
        if (name === 'supersede_memory_obligation') return { data: supersede(params), error: null }
        if (name === 'clear_memory_obligation') return { data: clear(params.p_obligation_id), error: null }
        throw new Error(`unexpected rpc ${name}`)
      },
    },
  }
})

import {
  syncIdeaRevisitObligation,
  syncDecisionRevisitObligation,
  clearIdeaRevisitObligation,
} from '../obligation-writer'
import { fetchObligations, resolveRevisitCandidates, describeCandidate } from '../due-obligations'
import { CLEAR_REASONS } from '../obligations'

const NOW = new Date('2026-10-01T12:00:00Z')
const OCT_15 = '2026-10-15T00:00:00Z'
const OCT_30 = '2026-10-30T00:00:00Z'
const SEP_20 = '2026-09-20T00:00:00Z'

const openOnes = () => db.obligations.filter((o: Ob) => o.cleared_at === null)

const SNOOZE = {
  organizationId: 'org-A',
  tradeQueueItemId: 'idea-1',
  ownerId: 'user-1',
  revisitAt: OCT_15,
}

beforeEach(() => {
  db.obligations = []
  db.ideas = [
    { id: 'idea-1', asset_id: 'asset-1', portfolio_id: 'pf-1', revisit_at: OCT_15,
      assets: { id: 'asset-1', symbol: 'NVDA', company_name: 'NVIDIA Corp' },
      portfolios: { id: 'pf-1', name: 'Core Growth' } },
  ]
  db.decisions = []
  db.callerOrg = 'org-A'
  db.rpcError = null
  db.seq = 0
})

/* ── Raising ───────────────────────────────────────────────────────────── */

describe('snoozing raises exactly one obligation', () => {
  it('writes one, with the date the user chose', async () => {
    const r = await syncIdeaRevisitObligation(SNOOZE)
    expect(openOnes()).toHaveLength(1)
    expect(openOnes()[0]).toMatchObject({
      kind: 'idea_revisit', subject_type: 'idea', subject_id: 'idea-1',
      owner_id: 'user-1', due_at: OCT_15, provenance: 'ui:snooze-idea',
    })
    expect(r.obligationId).toBe(openOnes()[0].id)
  })

  it('points back at the canonical row rather than copying it', async () => {
    await syncIdeaRevisitObligation(SNOOZE)
    expect(openOnes()[0]).toMatchObject({
      source_type: 'trade_queue_items', source_id: 'idea-1',
    })
  })

  it('a double-click produces one obligation, not two', async () => {
    await syncIdeaRevisitObligation(SNOOZE)
    await syncIdeaRevisitObligation(SNOOZE)
    await syncIdeaRevisitObligation(SNOOZE)
    expect(openOnes()).toHaveLength(1)
  })

  it('a retry returns the same obligation id', async () => {
    const a = await syncIdeaRevisitObligation(SNOOZE)
    const b = await syncIdeaRevisitObligation(SNOOZE)
    expect(b.obligationId).toBe(a.obligationId)
  })

  it('skips rather than guessing when the org is unknown', async () => {
    // A tenancy-less obligation is one no reader can safely show.
    const r = await syncIdeaRevisitObligation({ ...SNOOZE, organizationId: null })
    expect(r.action).toBe('failed')
    expect(db.obligations).toHaveLength(0)
  })

  it('never throws when the RPC fails — the snooze itself still stands', async () => {
    db.rpcError = { message: 'permission denied' }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(syncIdeaRevisitObligation(SNOOZE)).resolves.toMatchObject({ action: 'failed' })
  })
})

/* ── Changing the date ─────────────────────────────────────────────────── */

describe('changing the snooze date is deterministic', () => {
  it('leaves exactly one open obligation, on the new date', async () => {
    await syncIdeaRevisitObligation(SNOOZE)
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: OCT_30 })
    expect(openOnes()).toHaveLength(1)
    expect(openOnes()[0].due_at).toBe(OCT_30)
  })

  it('preserves the first fact instead of rewriting it', async () => {
    // "Parked until the 15th, then moved to the 30th" is two things that
    // happened. Updating due_at in place would make the record say the user
    // always meant the 30th.
    await syncIdeaRevisitObligation(SNOOZE)
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: OCT_30 })
    expect(db.obligations).toHaveLength(2)
    const cleared = db.obligations.filter((o: Ob) => o.cleared_at !== null)
    expect(cleared).toHaveLength(1)
    expect(cleared[0].due_at).toBe(OCT_15)
  })

  it('an unchanged date churns nothing', async () => {
    await syncIdeaRevisitObligation(SNOOZE)
    await syncIdeaRevisitObligation(SNOOZE)
    // No cleared/raised pair in the timeline for someone who pressed the
    // same button twice.
    expect(db.obligations).toHaveLength(1)
    expect(db.obligations[0].cleared_at).toBeNull()
  })
})

/* ── Clearing ──────────────────────────────────────────────────────────── */

describe('clearing', () => {
  it('cancelling the snooze clears the obligation', async () => {
    await syncIdeaRevisitObligation(SNOOZE)
    const r = await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: null })
    expect(r.action).toBe('cleared')
    expect(openOnes()).toHaveLength(0)
  })

  it('work resuming clears it regardless of who parked it', async () => {
    await syncIdeaRevisitObligation(SNOOZE)
    const r = await clearIdeaRevisitObligation({
      organizationId: 'org-A', tradeQueueItemId: 'idea-1', reason: CLEAR_REASONS.workResumed,
    })
    expect(r.action).toBe('cleared')
    expect(openOnes()).toHaveLength(0)
  })

  it('clearing twice is safe', async () => {
    await syncIdeaRevisitObligation(SNOOZE)
    await clearIdeaRevisitObligation({ organizationId: 'org-A', tradeQueueItemId: 'idea-1', reason: CLEAR_REASONS.terminal })
    const second = await clearIdeaRevisitObligation({ organizationId: 'org-A', tradeQueueItemId: 'idea-1', reason: CLEAR_REASONS.terminal })
    expect(second.action).toBe('unchanged')
  })

  it('clearing something that was never raised is a no-op', async () => {
    const r = await clearIdeaRevisitObligation({ organizationId: 'org-A', tradeQueueItemId: 'idea-9', reason: CLEAR_REASONS.terminal })
    expect(r.action).toBe('unchanged')
  })

  it('the due date passing does NOT clear it', async () => {
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: SEP_20 })
    const due = await fetchObligations({ organizationId: 'org-A', dueStates: ['due'], now: NOW })
    expect(due).toHaveLength(1)
    // Still open. Due means eligible, not satisfied.
    expect(openOnes()).toHaveLength(1)
  })
})

/* ── Deferrals ─────────────────────────────────────────────────────────── */

describe('deferred recommendations stay discoverable', () => {
  const DEFER = {
    organizationId: 'org-A', decisionRequestId: 'dr-1', ownerId: 'pm-1', stillDeferred: true,
  }

  it('a date-based deferral gets a due date and resurfaces', async () => {
    await syncDecisionRevisitObligation({ ...DEFER, deferredUntil: SEP_20 })
    const due = await fetchObligations({ organizationId: 'org-A', kinds: ['decision_revisit'], dueStates: ['due'], now: NOW })
    expect(due).toHaveLength(1)
  })

  it('a condition-based deferral is kept but never becomes due', async () => {
    await syncDecisionRevisitObligation({ ...DEFER, deferredUntil: null })
    const due = await fetchObligations({ organizationId: 'org-A', kinds: ['decision_revisit'], dueStates: ['due'], now: NOW })
    expect(due).toHaveLength(0)

    // Kept, though — the dead end was a deferral appearing in NO list.
    const all = await fetchObligations({
      organizationId: 'org-A', kinds: ['decision_revisit'],
      dueStates: ['due', 'scheduled', 'open_ended'], now: NOW,
    })
    expect(all).toHaveLength(1)
    expect(all[0].due_at).toBeNull()
  })

  it('resolving the request clears the obligation', async () => {
    await syncDecisionRevisitObligation({ ...DEFER, deferredUntil: SEP_20 })
    const r = await syncDecisionRevisitObligation({ ...DEFER, deferredUntil: null, stillDeferred: false })
    expect(r.action).toBe('cleared')
    expect(openOnes()).toHaveLength(0)
  })
})

/* ── Part 9: the resurfacing primitive ────────────────────────────────── */

describe('fetchObligations', () => {
  beforeEach(async () => {
    await syncIdeaRevisitObligation({ ...SNOOZE, tradeQueueItemId: 'idea-due', revisitAt: SEP_20 })
    await syncIdeaRevisitObligation({ ...SNOOZE, tradeQueueItemId: 'idea-later', revisitAt: OCT_30 })
    await syncDecisionRevisitObligation({
      organizationId: 'org-A', decisionRequestId: 'dr-open', ownerId: 'pm-1',
      deferredUntil: null, stillDeferred: true,
    })
  })

  it('returns only due obligations by default', async () => {
    const rows = await fetchObligations({ organizationId: 'org-A', now: NOW })
    expect(rows.map(r => r.subject_id)).toEqual(['idea-due'])
  })

  it('filters by kind', async () => {
    const rows = await fetchObligations({
      organizationId: 'org-A', kinds: ['decision_revisit'],
      dueStates: ['open_ended'], now: NOW,
    })
    expect(rows.map(r => r.subject_id)).toEqual(['dr-open'])
  })

  it('filters by owner', async () => {
    const rows = await fetchObligations({
      organizationId: 'org-A', ownerId: 'pm-1',
      dueStates: ['due', 'scheduled', 'open_ended'], now: NOW,
    })
    expect(rows.every(r => r.owner_id === 'pm-1')).toBe(true)
  })

  it('filters by subject type', async () => {
    const rows = await fetchObligations({
      organizationId: 'org-A', subjectType: 'idea',
      dueStates: ['due', 'scheduled'], now: NOW,
    })
    expect(rows.map(r => r.subject_id).sort()).toEqual(['idea-due', 'idea-later'])
  })

  it('never returns a cleared obligation', async () => {
    await clearIdeaRevisitObligation({ organizationId: 'org-A', tradeQueueItemId: 'idea-due', reason: CLEAR_REASONS.workResumed })
    const rows = await fetchObligations({ organizationId: 'org-A', now: NOW })
    expect(rows).toHaveLength(0)
  })

  it('open-ended obligations are not swept up as due', async () => {
    const due = await fetchObligations({ organizationId: 'org-A', dueStates: ['due'], now: NOW })
    expect(due.some(r => r.due_at === null)).toBe(false)
  })
})

describe('tenant isolation', () => {
  it('org A cannot see org B obligations', async () => {
    await syncIdeaRevisitObligation({ ...SNOOZE, organizationId: 'org-B', tradeQueueItemId: 'idea-b', revisitAt: SEP_20 })
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: SEP_20 })

    db.callerOrg = 'org-A'
    const a = await fetchObligations({ organizationId: 'org-A', now: NOW })
    expect(a.map(r => r.subject_id)).toEqual(['idea-1'])

    db.callerOrg = 'org-B'
    const b = await fetchObligations({ organizationId: 'org-B', now: NOW })
    expect(b.map(r => r.subject_id)).toEqual(['idea-b'])
  })

  it('asking for another org returns nothing, policy first', async () => {
    // The explicit .eq('organization_id') is a convenience. The isolation
    // boundary is the RLS SELECT policy, modelled by callerOrg here — so
    // this asserts the row is unreachable even when the caller names it.
    await syncIdeaRevisitObligation({ ...SNOOZE, organizationId: 'org-B', tradeQueueItemId: 'idea-b', revisitAt: SEP_20 })
    db.callerOrg = 'org-A'
    const rows = await fetchObligations({ organizationId: 'org-B', now: NOW })
    expect(rows).toHaveLength(0)
  })
})

/* ── Part 11: the first candidate ─────────────────────────────────────── */

describe('a due obligation resolves to its canonical work object', () => {
  it('produces every fact the first feed tile needs, with no model', async () => {
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: SEP_20 })
    const due = await fetchObligations({ organizationId: 'org-A', now: NOW })
    const [c] = await resolveRevisitCandidates(due, NOW)

    expect(c.resolved).toBe(true)
    expect(c.symbol).toBe('NVDA')
    expect(c.companyName).toBe('NVIDIA Corp')
    expect(c.subjectId).toBe('idea-1')
    expect(c.assetId).toBe('asset-1')
    expect(c.portfolioId).toBe('pf-1')
    expect(c.portfolioName).toBe('Core Growth')
    expect(c.dueAt).toBe(SEP_20)
    expect(c.dueState).toBe('due')
    expect(c.parkedAt).toBeTruthy()
    expect(c.daysOverdue).toBe(11)
    expect(c.href).toBe('/trade-queue?idea=idea-1')
  })

  it('voices the sentence from facts alone', async () => {
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: SEP_20 })
    const due = await fetchObligations({ organizationId: 'org-A', now: NOW })
    const [c] = await resolveRevisitCandidates(due, NOW)
    expect(describeCandidate(c)).toBe('You asked to revisit NVDA 11 days ago.')
  })

  it('says "today" on the day', async () => {
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: NOW.toISOString() })
    const due = await fetchObligations({ organizationId: 'org-A', now: NOW })
    const [c] = await resolveRevisitCandidates(due, NOW)
    expect(describeCandidate(c)).toBe('You asked to revisit NVDA today.')
  })

  it('says nothing when the subject could not be read', async () => {
    // RLS hid it, or the idea is gone. A candidate that cannot name its
    // subject must not be voiced as though we know what it is about.
    await syncIdeaRevisitObligation({ ...SNOOZE, tradeQueueItemId: 'idea-missing', revisitAt: SEP_20 })
    const due = await fetchObligations({ organizationId: 'org-A', now: NOW })
    const c = (await resolveRevisitCandidates(due, NOW)).find(x => x.subjectId === 'idea-missing')!
    expect(c.resolved).toBe(false)
    expect(describeCandidate(c)).toBeNull()
  })

  it('says nothing for an obligation that is not yet due', async () => {
    await syncIdeaRevisitObligation({ ...SNOOZE, revisitAt: OCT_30 })
    const all = await fetchObligations({ organizationId: 'org-A', dueStates: ['scheduled'], now: NOW })
    const [c] = await resolveRevisitCandidates(all, NOW)
    expect(c.dueState).toBe('scheduled')
    expect(describeCandidate(c)).toBeNull()
  })

  it('resolves a deferred recommendation through its idea', async () => {
    db.decisions = [{
      id: 'dr-1', trade_queue_item_id: 'idea-1', portfolio_id: 'pf-1',
      idea: db.ideas[0],
    }]
    await syncDecisionRevisitObligation({
      organizationId: 'org-A', decisionRequestId: 'dr-1', ownerId: 'pm-1',
      deferredUntil: SEP_20, stillDeferred: true,
    })
    const due = await fetchObligations({ organizationId: 'org-A', kinds: ['decision_revisit'], now: NOW })
    const [c] = await resolveRevisitCandidates(due, NOW)
    expect(c.symbol).toBe('NVDA')
    expect(describeCandidate(c)).toBe('You asked to revisit the recommendation on NVDA 11 days ago.')
  })
})
