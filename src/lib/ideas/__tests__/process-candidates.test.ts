import { describe, expect, it } from 'vitest'
import {
  canonicalProcessType, flattenProcessFindings, processDispositionRef,
  processPriorityInput, processSupportsTriage, type ProcessFinding,
} from '../process-candidates'
import { rankMixedCandidates } from '../idea-priority'
import { LEAD_TIER, priorityFor } from '../../signals/feed-priority'
import { SEVERELY_OVERDUE_DAYS, DAY_MS } from '../../signals/thresholds'
import { dispositionKey } from '../../signals/dispositions'
import type { CoverageIndex } from '../../signals/coverage-relevance'
import type { SignalCard } from '../../signals/contract'

const NOW = Date.UTC(2026, 7, 28, 12)
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString()

const NVDA = 'aaaaaaa1-0000-4000-8000-000000000000'
const MSFT = 'aaaaaaa2-0000-4000-8000-000000000000'

const INDEX: CoverageIndex = {
  ready: true, direct: new Set([NVDA]), assigned: new Set(), held: new Set(),
}
const CTX = { userId: 'me', followedIds: [] as string[], coverageIndex: INDEX }

const execution = (over: Partial<ProcessFinding> = {}): ProcessFinding => ({
  id: 'a2-execution-t1',
  titleKey: 'EXECUTION_NOT_CONFIRMED',
  title: 'Execution Not Confirmed',
  description: 'Approved trade has not been logged as executed.',
  severity: 'red',
  createdAt: ago(3),
  context: { assetId: MSFT, assetTicker: 'MSFT', tradeIdeaId: 't1', action: 'Buy' },
  ...over,
})

const deliverable = (over: Partial<ProcessFinding> = {}): ProcessFinding => ({
  id: 'a4-deliverable-d1',
  titleKey: 'OVERDUE_DELIVERABLE',
  title: 'Q3 sector review',
  description: 'Due 5d ago in Semis deep-dive.',
  severity: 'red',
  createdAt: ago(12),
  context: { projectId: 'p1', projectName: 'Semis deep-dive', overdueDays: 5 },
  ...over,
})

const post = (over: Record<string, any> = {}) => ({
  id: 'p1', type: 'quick_thought', created_at: ago(0.1),
  content: 'A view.', author: { id: 'someone' }, ...over,
})

const ids = (rows: any[]) => rows.map(r => String(r.input.id))

// ── 1–3. execution_unconfirmed ─────────────────────────────────────────────

describe('an unconfirmed execution becomes a canonical candidate', () => {
  it('[1] enters the candidate set', () => {
    const rows = rankMixedCandidates({ posts: [post()], process: [execution()] }, CTX, NOW)
    expect(ids(rows)).toContain('a2-execution-t1')
  })

  it('[2] receives the canonical type, named for the condition', () => {
    expect(canonicalProcessType('EXECUTION_NOT_CONFIRMED')).toBe('execution_unconfirmed')
    expect(processPriorityInput(execution(), {})!.type).toBe('execution_unconfirmed')
  })

  it('[3] reaches Attention', () => {
    const p = priorityFor(processPriorityInput(execution(), { coverageIndex: INDEX })!, NOW)
    expect(p.tier).toBeLessThanOrEqual(LEAD_TIER)
  })

  it('[3b] leads a fresh post, because tier sorts before score', () => {
    const rows = rankMixedCandidates(
      { posts: [post({ id: 'fresh', created_at: ago(0.001) })], process: [execution()] },
      CTX, NOW,
    )
    expect(ids(rows)[0]).toBe('a2-execution-t1')
  })

  it('translates the engine colour ladder rather than re-judging it', () => {
    expect(processPriorityInput(execution({ severity: 'red' }), {})!.severity).toBe('critical')
    expect(processPriorityInput(execution({ severity: 'orange' }), {})!.severity).toBe('attention')
    expect(processPriorityInput(execution({ severity: 'blue' }), {})!.severity).toBe('informational')
  })

  it('takes its event time from when the failure started', () => {
    expect(processPriorityInput(execution(), {})!.occurredAt).toBe(ago(3))
  })
})

// ── 5. project_overdue ─────────────────────────────────────────────────────

describe('an overdue deliverable reuses the type that already existed', () => {
  it('[5] maps to project_overdue', () => {
    expect(canonicalProcessType('OVERDUE_DELIVERABLE')).toBe('project_overdue')
    expect(processPriorityInput(deliverable(), {})!.type).toBe('project_overdue')
  })

  it('[5b] sits in the workflow tier, not in Attention', () => {
    const p = priorityFor(processPriorityInput(deliverable(), {})!, NOW)
    expect(p.tier).toBeGreaterThan(LEAD_TIER)
    expect(p.tier).toBe(3)
  })

  /**
   * The ranker's own promotion rule, reachable from this source because
   * `overdueDays` is passed. A project two days late is housekeeping; one three
   * weeks late with somebody waiting is a real failure.
   */
  it('[5c] is promoted out of the workflow tier once severely overdue', () => {
    const severe = deliverable({ context: { projectId: 'p1', overdueDays: SEVERELY_OVERDUE_DAYS + 1 } })
    expect(priorityFor(processPriorityInput(severe, {})!, NOW).tier).toBe(2)
  })

  /** [9] It is not a position, and does not claim to be one. */
  it('[9] fabricates neither a holding nor a scope relationship', () => {
    const input = processPriorityInput(deliverable(), { coverageIndex: INDEX })!
    expect(input.held).toBe(false)
    expect(input.weightPct).toBeNull()
    expect(input.deviationPct).toBeNull()
    expect(input.scope!.kind).toBe('unknown')
  })

  it('[9b] a scoped asset on an execution finding still resolves', () => {
    const scoped = execution({ context: { assetId: NVDA, tradeIdeaId: 't9' } })
    expect(processPriorityInput(scoped, { coverageIndex: INDEX })!.scope!.kind).toBe('personal_scope')
  })
})

// ── 4, 6. identity ─────────────────────────────────────────────────────────

describe('identity is the workflow object, never the ticker', () => {
  it('[4] keys an unconfirmed execution on the trade, not the asset', () => {
    const ref = processDispositionRef(execution())!
    expect(ref).toEqual({ type: 'execution_unconfirmed', entityId: 't1' })
    expect(ref.entityId).not.toBe(MSFT)
  })

  /**
   * [4b] The failure this guards against: two approved trades on one name are
   * two failures with two fixes, and an asset-keyed identity would answer both
   * with one tap.
   */
  it('[4b] two unexecuted trades on one name keep separate identities', () => {
    const a = processDispositionRef(execution({ id: 'a2-execution-t1', context: { assetId: NVDA, tradeIdeaId: 't1' } }))!
    const b = processDispositionRef(execution({ id: 'a2-execution-t2', context: { assetId: NVDA, tradeIdeaId: 't2' } }))!
    expect(dispositionKey(a.type, a.entityId)).not.toBe(dispositionKey(b.type, b.entityId))
  })

  it('[6] keys an overdue item on the deliverable, not the project', () => {
    const a = processDispositionRef(deliverable({ id: 'a4-deliverable-d1' }))!
    const b = processDispositionRef(deliverable({ id: 'a4-deliverable-d2' }))!
    expect(a.entityId).toBe('d1')
    expect(b.entityId).toBe('d2')
    expect(a.entityId).not.toBe('p1')
  })

  it('has no identity, and so no disposition, when the object id is missing', () => {
    expect(processDispositionRef(execution({ context: { assetId: NVDA } }))).toBeNull()
    expect(processDispositionRef(deliverable({ id: 'unexpected-shape' }))).toBeNull()
  })

  /**
   * [10] Both resolve themselves the moment the underlying object changes, and
   * both are shared rather than personal state. Snoozing would hide a fact that
   * is still true; dismissing would prejudge the durable-attention contract
   * being settled elsewhere.
   */
  it('[10] neither is triageable, and the ranker is told so', () => {
    expect(processSupportsTriage()).toBe(false)
    expect(processPriorityInput(execution(), {})!.judgment).toBeNull()
    expect(processPriorityInput(deliverable(), {})!.judgment).toBeNull()
  })
})

// ── 7, 8, 11. one stream ───────────────────────────────────────────────────

describe('process findings compete in the one stream', () => {
  const scenario: SignalCard = {
    id: 'scenario_gap:nvda', type: 'scenario_gap', surface: 'research', severity: 'critical',
    headline: 'NVDA below bear case', body: '',
    metric: { value: '14% below', label: 'vs bear', direction: 'bad', source: 'quote', asOf: ago(0.2) },
    entity: { kind: 'asset', id: NVDA, name: 'NVIDIA', ticker: 'NVDA' },
  } as any

  it('[7] posts, signals, cards, lenses and process share one total order', () => {
    const rows = rankMixedCandidates({
      posts: [post({ id: 'p-a' })],
      signals: [{
        id: 'signal-conflict-nvda', signalType: 'conflict', headline: 'split', body: 'x',
        relatedAssets: [{ id: NVDA, symbol: 'NVDA' }], createdAt: ago(0), priority: 0.8,
      } as any],
      cards: [scenario],
      lenses: [{ type: 'crowded', name: { assetId: NVDA, maxWeightPct: 3.2, asOf: ago(3) } }],
      process: [execution(), deliverable()],
    }, CTX, NOW)

    const tiers = rows.map(r => r.priority.tier)
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers)
    expect(rows).toHaveLength(6)
  })

  /**
   * The scenario ladder still leads: base 1.00 against the unconfirmed
   * execution's 0.90, both tier 0. A process failure competes; it does not
   * pre-empt.
   */
  it('an urgent investment finding still outranks a process failure', () => {
    const rows = rankMixedCandidates({ cards: [scenario], process: [execution()] }, CTX, NOW)
    expect(ids(rows)).toEqual(['scenario_gap:nvda', 'a2-execution-t1'])
  })

  it('being a process finding does not itself grant Attention', () => {
    const rows = rankMixedCandidates({ process: [execution(), deliverable()] }, CTX, NOW)
    const attention = rows.filter(r => r.priority.tier <= LEAD_TIER)
    expect(ids(attention)).toEqual(['a2-execution-t1'])
  })

  it('[11] no Decision Engine score reaches the canonical ranking', () => {
    const withScore = { ...execution(), sortScore: 999, decisionTier: 'capital' } as any
    const a = priorityFor(processPriorityInput(withScore, {})!, NOW)
    const b = priorityFor(processPriorityInput(execution(), {})!, NOW)
    expect(a.total).toBe(b.total)
  })

  it('declines the five evaluators that have not migrated', () => {
    for (const key of [
      'PROPOSAL_AWAITING_DECISION', 'THESIS_STALE', 'IDEA_NOT_SIMULATED',
      'RATING_NO_FOLLOWUP', 'HIGH_EV_NO_IDEA',
    ]) {
      expect(canonicalProcessType(key)).toBeNull()
      expect(processPriorityInput(execution({ titleKey: key }), {})).toBeNull()
    }
    // …and they do not enter the stream through a default tier.
    const rows = rankMixedCandidates(
      { posts: [post({ id: 'kept' })], process: [execution({ titleKey: 'THESIS_STALE' })] },
      CTX, NOW,
    )
    expect(ids(rows)).toEqual(['kept'])
  })

  it('[8] the order is reproducible', () => {
    const sources = { posts: [post()], cards: [scenario], process: [execution(), deliverable()] }
    expect(ids(rankMixedCandidates(sources, CTX, NOW)))
      .toEqual(ids(rankMixedCandidates(sources, CTX, NOW)))
  })
})

describe('rollups cannot swallow their children', () => {
  it('flattens to leaves', () => {
    const rolled: ProcessFinding = {
      id: 'rollup', severity: 'red', titleKey: 'SOMETHING',
      children: [execution(), deliverable()],
    }
    expect(flattenProcessFindings([rolled]).map(f => f.id))
      .toEqual(['a2-execution-t1', 'a4-deliverable-d1'])
    expect(flattenProcessFindings(null)).toEqual([])
  })
})
