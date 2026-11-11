/**
 * get_decisions / get_workflows: the facts the AI must not merge.
 *
 * ── What is being protected ──────────────────────────────────────────────
 *
 * The decision record is four separate things, and the sentence "we decided to
 * buy AAPL" is true of one and false of another:
 *
 *   recommendation    an analyst proposed it
 *   pm_ruling         the PM answered (accepted / rejected / deferred / ...)
 *   committed_trade   a Trade Book row exists -- the ONLY committed trade
 *   execution         that row's execution_status says it actually traded
 *
 * An accepted ruling whose trade sits at execution_status 'not_started' is a
 * real and common state. Reporting it as "we bought AAPL" is a false statement
 * about the firm's book, so these tests assert the four stay distinguishable
 * end to end: distinct `kind`s, distinct titles, and explicit link ids.
 *
 * ── And the process side ─────────────────────────────────────────────────
 *
 * `asset_checklist_items.stage_id` and `asset_workflow_progress`'s
 * `current_stage_key` are both TEXT and production holds BOTH conventions plus
 * values that resolve to nothing: measured 2026-11-11, 129 of 141 checklist
 * rows hold a `stage_key`, 10 hold a `workflow_stages.id`, 2 hold neither, and
 * 364 of 874 progress rows name a stage absent from their own workflow. So the
 * resolver must answer "unresolved" rather than guess a stage name, and these
 * tests pin that.
 *
 * Tenant isolation is NOT tested here -- it is a policy property and belongs in
 * supabase/tests/ai-decisions-workflows-tenant-isolation.sql, which was run
 * against production and proven non-vacuous by widening the policies.
 */
import { describe, expect, it } from 'vitest'
import {
  bucketChecklist,
  peopleMap,
  personLabel,
  resolveStageLabel,
  summarizeToolResult,
  toolEmpty,
  toolError,
  toolOk,
  type StageRow,
} from '../../../../supabase/functions/_shared/research-results'

const quiet = () => {
  const lines: string[] = []
  return { log: (m: string, d?: string) => { lines.push(`${m} ${d ?? ''}`) }, lines }
}

// ─── The chain, as the tool actually emits it ──────────────────────────────

const REC = 'rec-1'
const RULING = 'ruling-1'
const TRADE = 'trade-1'

/** An accepted ruling whose committed trade has NOT been executed. */
function acceptedButUnexecuted() {
  return toolOk('get_decisions', {
    asset_id: 'asset-1',
    symbol: 'AAPL',
    records_returned: 3,
    recommendations: [{
      id: REC, action: 'buy', queue_status: 'deciding', pipeline_stage: 'ready_for_decision',
      lifecycle_outcome: null, rationale: 'Services mix', created_at: '2026-09-01T00:00:00Z',
    }],
    pm_rulings: [{
      id: RULING, recommendation_id: REC, committed_trade_id: TRADE, status: 'accepted',
      decision_note: 'sized to 2%', reviewed_at: '2026-09-02T00:00:00Z',
    }],
    committed_trades: [{
      id: TRADE, recommendation_id: REC, pm_ruling_id: RULING, action: 'buy',
      execution_status: 'not_started', reconciliation_status: 'pending',
      is_active: true, created_at: '2026-09-02T01:00:00Z',
    }],
    decision_reviews: [],
    price_target_outcomes: [],
  })
}

describe('get_decisions: four stages stay four stages', () => {
  it('gives the recommendation, the ruling and the committed trade different kinds', () => {
    const s = summarizeToolResult('get_decisions', acceptedButUnexecuted(), quiet().log)
    expect(s.status).toBe('ok')
    const kinds = (s.sources ?? []).map((x) => x.kind)
    expect(kinds).toEqual(['recommendation', 'decision_request', 'accepted_trade'])
    // Three kinds, three ids: nothing is deduplicated into one "decision".
    expect(new Set((s.sources ?? []).map((x) => x.id)).size).toBe(3)
  })

  it('says "accepted" on the ruling and "not_started" on the trade, in the titles', () => {
    // The titles are what the reader sees in the Research panel without
    // opening anything, so the distinction has to survive into them.
    const s = summarizeToolResult('get_decisions', acceptedButUnexecuted(), quiet().log)
    const byKind = Object.fromEntries((s.sources ?? []).map((x) => [x.kind, x]))
    expect(byKind.decision_request.title).toContain('accepted')
    expect(byKind.accepted_trade.title).toContain('not_started')
    // And the trade is never labelled as a decision.
    expect(byKind.accepted_trade.title).not.toContain('PM ruling')
  })

  it('a rejected ruling reads as rejected, not as an absence of a decision', () => {
    const raw = toolOk('get_decisions', {
      asset_id: 'a1', symbol: 'AAPL', records_returned: 1,
      recommendations: [], committed_trades: [], decision_reviews: [], price_target_outcomes: [],
      pm_rulings: [{ id: 'r9', recommendation_id: REC, status: 'rejected', reviewed_at: '2026-10-01T00:00:00Z' }],
    })
    const s = summarizeToolResult('get_decisions', raw, quiet().log)
    expect(s.status).toBe('ok')
    expect(s.sources?.[0]).toMatchObject({ kind: 'decision_request', id: 'r9' })
    expect(s.sources?.[0].title).toContain('rejected')
  })

  it('every stage of the chain is openable on the asset it belongs to', () => {
    const s = summarizeToolResult('get_decisions', acceptedButUnexecuted(), quiet().log)
    for (const src of s.sources ?? []) {
      expect(src.asset_id).toBe('asset-1')
      expect(src.symbol).toBe('AAPL')
      expect(src.id).toBeTruthy()
      expect(src.title).toBeTruthy()
    }
  })

  it('carries each record\'s own timestamp, not one shared date', () => {
    const s = summarizeToolResult('get_decisions', acceptedButUnexecuted(), quiet().log)
    const stamps = (s.sources ?? []).map((x) => x.timestamp)
    expect(stamps).toEqual([
      '2026-09-01T00:00:00Z', // proposed
      '2026-09-02T00:00:00Z', // ruled on
      '2026-09-02T01:00:00Z', // committed
    ])
  })

  it('surfaces reviews and outcomes as retrospective kinds, not decisions', () => {
    const raw = toolOk('get_decisions', {
      asset_id: 'a1', symbol: 'AAPL', records_returned: 2,
      recommendations: [], pm_rulings: [], committed_trades: [],
      decision_reviews: [{ id: 'rv1', recommendation_id: REC, decision_quality: 'good', reviewed_at: '2026-10-10T00:00:00Z' }],
      price_target_outcomes: [{ id: 'o1', scenario_type: 'bull', status: 'expired', evaluated_at: '2026-10-11T00:00:00Z' }],
    })
    const s = summarizeToolResult('get_decisions', raw, quiet().log)
    expect((s.sources ?? []).map((x) => x.kind)).toEqual(['decision_review', 'outcome'])
    expect(s.sources?.[1].title).toContain('expired')
  })

  it('MISSING RECORDS: an asset with no decision record is empty, and says what was searched', () => {
    const s = summarizeToolResult('get_decisions',
      toolEmpty('get_decisions', {
        symbol: 'AAPL',
        scope: 'committed trades in portfolios you are a member of',
      }), quiet().log)
    expect(s.status).toBe('empty')
    // The scope is the honest part: it bounds the absence instead of implying
    // the firm has never decided anything about this name.
    expect(s.searched).toBe('AAPL in committed trades in portfolios you are a member of')
  })

  it('FAILED QUERY: a broken stage is an error, never an empty decision record', () => {
    const s = summarizeToolResult('get_decisions',
      toolError('get_decisions', 'committed_trades'), quiet().log)
    expect(s.status).toBe('error')
    expect(s.status).not.toBe('empty')
    expect(s.result_count).toBeUndefined()
    expect(s.sources).toBeUndefined()
    // And the stage name does not travel to the client.
    expect(JSON.stringify(s)).not.toContain('committed_trades')
  })

  it('an unknown or absent status is an error, so a legacy payload cannot pass as empty', () => {
    expect(summarizeToolResult('get_decisions', '{"recommendations":[]}', quiet().log).status).toBe('error')
  })

  it('drops records with no id rather than emitting a link that goes nowhere', () => {
    const raw = toolOk('get_decisions', {
      asset_id: 'a1', symbol: 'AAPL', records_returned: 1,
      recommendations: [{ id: 'ok1', action: 'buy' }, { action: 'buy' }],
      pm_rulings: [{ status: 'accepted' }],
      committed_trades: [], decision_reviews: [], price_target_outcomes: [],
    })
    const s = summarizeToolResult('get_decisions', raw, quiet().log)
    expect((s.sources ?? []).map((x) => x.id)).toEqual(['ok1'])
  })

  it('never leaks a rationale, note or thesis into the client summary', () => {
    const SECRET = 'CONFIDENTIAL-RATIONALE-TEXT'
    const raw = toolOk('get_decisions', {
      asset_id: 'a1', symbol: 'AAPL', records_returned: 1,
      recommendations: [{ id: 'r1', action: 'buy', rationale: SECRET, thesis: SECRET }],
      pm_rulings: [{ id: 'd1', status: 'accepted', decision_note: SECRET }],
      committed_trades: [], decision_reviews: [], price_target_outcomes: [],
    })
    const s = summarizeToolResult('get_decisions', raw, quiet().log)
    expect(JSON.stringify(s)).not.toContain(SECRET)
  })
})

// ─── Workflows ─────────────────────────────────────────────────────────────

const STAGES: StageRow[] = [
  { id: 'uuid-stage-1', workflow_id: 'wf-1', stage_key: 'diligence', stage_label: 'Diligence', sort_order: 1 },
  { id: 'uuid-stage-2', workflow_id: 'wf-1', stage_key: 'decision', stage_label: 'Decision', sort_order: 2 },
  { id: 'uuid-stage-9', workflow_id: 'wf-2', stage_key: 'diligence', stage_label: 'Other firm diligence', sort_order: 1 },
]

describe('resolveStageLabel: both conventions, and honest when neither fits', () => {
  it('resolves a stage_key', () => {
    expect(resolveStageLabel('diligence', 'wf-1', STAGES)).toEqual({ label: 'Diligence', resolved: true })
  })

  it('resolves a workflow_stages uuid, which 10 of 141 production rows hold', () => {
    expect(resolveStageLabel('uuid-stage-2', 'wf-1', STAGES)).toEqual({ label: 'Decision', resolved: true })
  })

  it('reports unresolved rather than guessing, for the 364 progress rows that point nowhere', () => {
    expect(resolveStageLabel('stage_that_was_renamed', 'wf-1', STAGES))
      .toEqual({ label: null, resolved: false })
  })

  it('does not borrow a label from a different workflow that happens to share the key', () => {
    // 'diligence' exists in both wf-1 and wf-2. Scoping is the whole point:
    // naming another workflow's stage would invent process state.
    expect(resolveStageLabel('diligence', 'wf-2', STAGES).label).toBe('Other firm diligence')
    expect(resolveStageLabel('decision', 'wf-2', STAGES)).toEqual({ label: null, resolved: false })
  })

  it('treats a null or empty reference as unresolved, not as an error', () => {
    expect(resolveStageLabel(null, 'wf-1', STAGES)).toEqual({ label: null, resolved: false })
    expect(resolveStageLabel('', 'wf-1', STAGES)).toEqual({ label: null, resolved: false })
  })
})

describe('bucketChecklist: what remains, counted correctly', () => {
  const rows = [
    { id: '1', status: 'unchecked' },
    { id: '2', status: 'completed' },
    { id: '3', status: 'na' },
    { id: '4', status: null, completed: true },
    { id: '5', status: null, completed: false },
  ]

  it('splits open, completed and not-applicable', () => {
    const b = bucketChecklist(rows)
    expect(b).toMatchObject({ total: 5, open: 2, completed: 2, not_applicable: 1 })
  })

  it('does NOT count a not-applicable requirement as outstanding work', () => {
    // The reason `status` is the authority and the older `completed` boolean is
    // not: the boolean cannot express 'na', and folding it into either bucket
    // misstates what is left to do.
    const b = bucketChecklist([{ id: 'x', status: 'na' }])
    expect(b.open).toBe(0)
    expect(b.completed).toBe(0)
    expect(b.not_applicable).toBe(1)
  })

  it('falls back to the legacy boolean only when status is absent', () => {
    expect(bucketChecklist([{ id: 'x', status: null, completed: true }]).completed).toBe(1)
    expect(bucketChecklist([{ id: 'x', status: 'unchecked', completed: true }]).open).toBe(1)
  })

  it('returns only open items, bounded, and flags the truncation', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, status: 'unchecked' }))
    const b = bucketChecklist(many, 15)
    expect(b.open).toBe(30)
    expect(b.open_items).toHaveLength(15)
    expect(b.open_items_truncated).toBe(true)
    // The count is the truth; the list is a sample, and says so.
    expect(b.open_items.every((r) => r.status === 'unchecked')).toBe(true)
  })

  it('does not flag truncation when everything fits', () => {
    expect(bucketChecklist(rows, 20).open_items_truncated).toBe(false)
  })

  it('survives null and id-less rows', () => {
    expect(bucketChecklist(null).total).toBe(0)
    expect(bucketChecklist([{ id: '', status: 'unchecked' }] as never).total).toBe(0)
  })
})

describe('get_workflows: current state and outstanding work', () => {
  function workflowPayload(over: Record<string, unknown> = {}) {
    return toolOk('get_workflows', {
      asset_id: 'asset-1',
      symbol: 'AAPL',
      records_returned: 1,
      open_requirements_total: 2,
      workflows: [{
        workflow_id: 'wf-1',
        name: 'Earnings Season',
        current_stage_key: 'diligence',
        current_stage_label: 'Diligence',
        current_stage_unresolved: false,
        requirement_counts: { total: 10, open: 2, completed: 7, not_applicable: 1 },
        open_requirements_truncated: false,
        open_requirements: [
          { id: 'ci-1', requirement: 'Confirm segment margins', updated_at: '2026-10-01T00:00:00Z' },
          { id: 'ci-2', requirement: 'Model the buyback', updated_at: '2026-10-02T00:00:00Z' },
        ],
        ...over,
      }],
    })
  }

  it('names the workflow and the stage it is at, and links both the workflow and each open requirement', () => {
    const s = summarizeToolResult('get_workflows', workflowPayload(), quiet().log)
    expect(s.status).toBe('ok')
    const kinds = (s.sources ?? []).map((x) => x.kind)
    expect(kinds).toEqual(['workflow', 'checklist_item', 'checklist_item'])
    expect(s.sources?.[0].title).toBe('Earnings Season at Diligence')
    expect(s.sources?.[1].title).toBe('Confirm segment margins')
    for (const src of s.sources ?? []) expect(src.asset_id).toBe('asset-1')
  })

  it('omits the stage from the title when the stored stage does not resolve', () => {
    const s = summarizeToolResult('get_workflows',
      workflowPayload({ current_stage_label: null, current_stage_unresolved: true }), quiet().log)
    expect(s.sources?.[0].title).toBe('Earnings Season')
    expect(s.sources?.[0].title).not.toContain('at ')
    expect(s.sources?.[0].title).not.toContain('null')
  })

  it('counts workflows, not requirements, as the record count', () => {
    const s = summarizeToolResult('get_workflows', workflowPayload(), quiet().log)
    expect(s.result_count).toBe(1)
  })

  it('MISSING RECORDS: an asset in no workflow is empty, with the scope stated', () => {
    const s = summarizeToolResult('get_workflows',
      toolEmpty('get_workflows', { symbol: 'AAPL', scope: 'workflows on this asset that you have access to' }),
      quiet().log)
    expect(s.status).toBe('empty')
    expect(s.searched).toContain('AAPL')
    expect(s.searched).toContain('you have access to')
  })

  it('FAILED QUERY: a broken requirements read is an error, not "no work remains"', () => {
    // The dangerous reading. "No outstanding requirements" is an instruction to
    // stop working on a name; it must never come from a failed query.
    const s = summarizeToolResult('get_workflows', toolError('get_workflows', 'requirements'), quiet().log)
    expect(s.status).toBe('error')
    expect(s.result_count).toBeUndefined()
  })

  it('never leaks requirement notes or takeaways into the client summary', () => {
    const SECRET = 'INTERNAL-TAKEAWAY-TEXT'
    const s = summarizeToolResult('get_workflows', workflowPayload({
      open_requirements: [{ id: 'ci-1', requirement: 'Visible', takeaway: SECRET, notes: SECRET }],
      recently_completed: [{ id: 'ci-9', takeaway: SECRET }],
    }), quiet().log)
    expect(JSON.stringify(s)).not.toContain(SECRET)
  })
})

describe('personLabel: a name, or nothing', () => {
  const people = peopleMap([
    { id: 'u1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.invalid' },
    { id: 'u2', first_name: null, last_name: null, email: 'noname@example.invalid' },
    { id: 'u3', first_name: null, last_name: null, email: null },
  ])

  it('prefers the full name', () => {
    expect(personLabel('u1', people)).toBe('Ada Lovelace')
  })

  it('falls back to the email when there is no name', () => {
    expect(personLabel('u2', people)).toBe('noname@example.invalid')
  })

  it('returns null rather than a raw uuid for an unresolved id', () => {
    // A uuid printed where a person's name belongs reads as corruption, and
    // gives the model a string it may mistake for a citable identifier.
    expect(personLabel('u-unknown', people)).toBeNull()
    expect(personLabel('u3', people)).toBeNull()
    expect(personLabel(null, people)).toBeNull()
    expect(personLabel(undefined, people)).toBeNull()
  })

  it('peopleMap ignores rows with no id', () => {
    expect(peopleMap([{ id: '' }, { id: 'u1' }]).size).toBe(1)
    expect(peopleMap(null).size).toBe(0)
  })
})

/**
 * ── Non-vacuity ──────────────────────────────────────────────────────────
 *
 * The two collapses these tests exist to prevent, reconstructed, with the
 * assertions pointed at them. If the implementation ever reverts to either
 * shape, the tests above fail.
 */
describe('non-vacuity: the collapses are caught', () => {
  it('a merged "decisions" list loses the distinction the tool is for', () => {
    // The tempting shape: one array, one kind, a `type` string nobody honours.
    const merged = toolOk('get_decisions', {
      asset_id: 'asset-1', symbol: 'AAPL', records_returned: 3,
      results: [
        { id: REC, type: 'recommendation' },
        { id: RULING, type: 'ruling', status: 'accepted' },
        { id: TRADE, type: 'trade', execution_status: 'not_started' },
      ],
    })
    const collapsed = summarizeToolResult('get_decisions', merged, quiet().log)
    // No named arrays, so nothing becomes a source: the trail would show a
    // count with no records behind it.
    expect(collapsed.sources).toEqual([])

    // The real shape produces three distinct kinds from the same three records.
    const real = summarizeToolResult('get_decisions', acceptedButUnexecuted(), quiet().log)
    expect(new Set((real.sources ?? []).map((x) => x.kind)).size).toBe(3)
  })

  it('a stage resolver that echoes the raw key invents a stage name', () => {
    const naive = (ref: string | null) => ({ label: ref, resolved: Boolean(ref) })
    expect(naive('stage_that_was_renamed').label).toBe('stage_that_was_renamed')
    expect(naive('stage_that_was_renamed').resolved).toBe(true)

    // The real resolver refuses, which is what lets the prompt say "unrecorded".
    expect(resolveStageLabel('stage_that_was_renamed', 'wf-1', STAGES))
      .toEqual({ label: null, resolved: false })
  })

  it('a bucket that reads the boolean counts a not-applicable item as outstanding', () => {
    const naive = (rows: Array<{ completed?: boolean | null }>) =>
      rows.filter((r) => r.completed !== true).length
    expect(naive([{ completed: false }])).toBe(1)          // an 'na' row, as the boolean sees it
    expect(bucketChecklist([{ id: 'x', status: 'na' }]).open).toBe(0)
  })
})
