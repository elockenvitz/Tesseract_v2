/**
 * "Needs review" stops being a pill nobody outside Trade Book can see.
 *
 * `tradeLifecyclePhase` has always been able to say a committed trade needs
 * review -- reconciliation came back partial, deviated or unmatched, or the
 * staleness sweeper flagged it. Nothing outside that page read it. A trade
 * whose fills never matched sat there indefinitely and the only way to find
 * out was for somebody to open that portfolio and look.
 *
 * What is under test is that the obligation tracks the EXISTING rule exactly:
 * no new interval, no new threshold, and no second definition of reviewed.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  needsReview,
  planTradeReviewObligations,
  TRADE_REVIEW_KIND,
} from '../trade-review-obligation'
import { evaluateTradeReviewOwed } from '../../../engine/decisionEngine/evaluators/tradeReviewOwed'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const trade = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  execution_status: 'complete',
  reconciliation_status: 'matched',
  staleness_flagged_at: null,
  accepted_by: 'pm-1',
  execution_expected_by: null,
  ...over,
})

describe('the predicate is the existing lifecycle rule', () => {
  it.each([
    ['partial reconciliation', { reconciliation_status: 'partial' }],
    ['deviated reconciliation', { reconciliation_status: 'deviated' }],
    ['unmatched reconciliation', { reconciliation_status: 'unmatched' }],
    ['flagged stale', { reconciliation_status: 'pending', staleness_flagged_at: '2026-09-01T00:00:00Z' }],
  ])('needs review: %s', (_name, over) => {
    expect(needsReview(trade(over))).toBe(true)
  })

  it('a settled trade does not', () => {
    expect(needsReview(trade())).toBe(false)
  })

  /* Cancelled is terminal and wins in the lifecycle rule. Raising an
     obligation on it would be asking for work on an abandoned trade. */
  it('a cancelled trade does not, even when flagged stale', () => {
    expect(needsReview(trade({
      execution_status: 'cancelled', staleness_flagged_at: '2026-09-01T00:00:00Z',
    }))).toBe(false)
  })
})

describe('the plan', () => {
  it('raises one for a trade that needs review', () => {
    const plan = planTradeReviewObligations([trade({ reconciliation_status: 'unmatched' })], new Set())
    expect(plan.raise.map(t => t.id)).toEqual(['t1'])
    expect(plan.clearSubjectIds).toEqual([])
  })

  /* Re-evaluation is constant -- every mount of the page runs it. */
  it('raises nothing when one is already open', () => {
    const plan = planTradeReviewObligations(
      [trade({ reconciliation_status: 'unmatched' })], new Set(['t1']))
    expect(plan.raise).toEqual([])
    expect(plan.clearSubjectIds).toEqual([])
  })

  /* The satisfying action is the condition going away -- reconciliation
     resolved, or the stale flag lifted. */
  it('clears when the trade no longer needs review', () => {
    const plan = planTradeReviewObligations([trade()], new Set(['t1']))
    expect(plan.raise).toEqual([])
    expect(plan.clearSubjectIds).toEqual(['t1'])
  })

  /* A trade can deviate again after being reconciled once. The partial unique
     index allows it; the plan has to ask for it. */
  it('raises again after a cleared obligation, when the condition returns', () => {
    const plan = planTradeReviewObligations(
      [trade({ reconciliation_status: 'deviated' })], new Set())
    expect(plan.raise.map(t => t.id)).toEqual(['t1'])
  })

  it('does nothing for a settled trade with nothing open', () => {
    const plan = planTradeReviewObligations([trade()], new Set())
    expect(plan.raise).toEqual([])
    expect(plan.clearSubjectIds).toEqual([])
  })
})

describe('viewing is not doing', () => {
  /* An obligation that clears when noticed is a reminder that deletes itself
     on sight. Clearing is driven by the predicate only. */
  it('clears on the predicate, never on a view', () => {
    const lib = src('lib/memory/trade-review-obligation.ts')
    expect(lib).not.toContain('last_viewed')
    expect(lib).not.toContain('viewed')
    const hook = src('hooks/useTradeReviewObligations.ts')
    expect(hook).not.toContain('last_viewed')
    // The only clear path is the plan's, which is computed from needsReview.
    expect(hook).toContain('for (const subjectId of plan.clearSubjectIds)')
  })

  it('writes obligation state only through the RPCs', () => {
    const hook = src('hooks/useTradeReviewObligations.ts')
    expect(hook).toContain("supabase.rpc('raise_memory_obligation'")
    expect(hook).toContain("supabase.rpc('clear_memory_obligation'")
    expect(hook).not.toContain("from('memory_obligations').insert")
    expect(hook).not.toContain("from('memory_obligations').update")
  })

  /* Existing semantics: the PM who committed it owns reconciling it, and the
     only deadline in the model is the one already on the trade. */
  it('carries the existing owner and due date, inventing neither', () => {
    const hook = src('hooks/useTradeReviewObligations.ts')
    expect(hook).toContain('p_owner_id: t.accepted_by ?? null')
    expect(hook).toContain('p_due_at: t.execution_expected_by ?? null')
  })

  it('uses one stable kind', () => {
    expect(TRADE_REVIEW_KIND).toBe('trade_review')
  })
})

describe('the obligation is visible outside Trade Book', () => {
  const NOW = new Date('2026-09-16T12:00:00Z')
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
  const ob = (over: Record<string, unknown> = {}) => ({
    id: 'o1', subject_id: 't1', owner_id: 'pm-1',
    raised_at: daysAgo(1), due_at: null, asset_symbol: 'AAPL',
    ...over,
  })

  it('surfaces one item per open obligation', () => {
    const items = evaluateTradeReviewOwed({ tradeReviewObligations: [ob()], now: NOW })
    expect(items).toHaveLength(1)
    expect(items[0].titleKey).toBe('TRADE_REVIEW_OWED')
  })

  it('says nothing when nothing is owed', () => {
    expect(evaluateTradeReviewOwed({ tradeReviewObligations: [], now: NOW })).toHaveLength(0)
    expect(evaluateTradeReviewOwed({ now: NOW })).toHaveLength(0)
  })

  /* A deadline that was set deliberately on the trade and has passed. */
  it('is red past the trade own expected date', () => {
    const items = evaluateTradeReviewOwed({
      tradeReviewObligations: [ob({ due_at: daysAgo(1) })], now: NOW,
    })
    expect(items[0].severity).toBe('red')
  })

  /* An id carrying the age would change every morning and make each dismissal
     a new orphan row -- the defect lib/attention-state/suppression warns of. */
  it('uses a stable id that does not change with age', () => {
    const young = evaluateTradeReviewOwed({ tradeReviewObligations: [ob()], now: NOW })
    const old = evaluateTradeReviewOwed({
      tradeReviewObligations: [ob({ raised_at: daysAgo(40) })], now: NOW,
    })
    expect(young[0].id).toBe(old[0].id)
    expect(young[0].id).toBe('trade-review-o1')
  })
})
