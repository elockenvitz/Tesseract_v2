/**
 * A reviewed decision leaves the Review Queue.
 *
 * The queue and the verdict engine both keyed off
 * `matched_executions[].rationale_status`, which comes from
 * `trade_event_rationales` -- a table holding ZERO rows in production, whose
 * only writer is Trade Book. `decision_reviews`, the table Outcomes actually
 * writes, was read by nothing.
 *
 * So a PM answered "did the thesis play out", saved it, and watched the red
 * "Review Queue" tile ignore them. `getReviewState`'s 'reviewed' branch was
 * unreachable, and its comment claimed it meant "the user has captured a
 * reflection" -- which it never did.
 *
 * Capturing a REASON (Trade Book) and reviewing an OUTCOME (Outcomes) are
 * different acts, so the rationale branches stay; the authoritative review is
 * added ahead of them.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { inferDecisionIntelligence } from '../../decision-intelligence'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

/** An executed decision with no rationale and no review: the queue case. */
const executedRow = (over: Record<string, unknown> = {}) => ({
  decision_id: 'dec-1',
  source: 'decision', category: 'acted',
  execution_status: 'executed',
  created_at: '2026-06-01T00:00:00Z',
  approved_at: '2026-06-01T00:00:00Z',
  direction: 'long', stage: 'executed',
  asset_id: 'a1', asset_symbol: 'AAPL', asset_name: 'Apple',
  matched_executions: [],
  batches: [],
  ...over,
} as never)

describe('the verdict engine reads the authoritative review', () => {
  it('an executed decision with no review needs one', () => {
    const intel = inferDecisionIntelligence(executedRow())
    expect(intel.verdict).not.toBe('resolved')
  })

  it('a reviewed decision is resolved', () => {
    const intel = inferDecisionIntelligence(executedRow({ has_decision_review: true }))
    expect(intel.verdict).toBe('resolved')
  })

  /* Trade Book's own path still works: a reason captured there is not a
     review, but a rationale marked reviewed there always resolved and must
     keep doing so. */
  it('still honours a Trade Book rationale marked reviewed', () => {
    const intel = inferDecisionIntelligence(executedRow({
      matched_executions: [{ rationale_status: 'reviewed', has_rationale: true }],
    }))
    expect(intel.verdict).toBe('resolved')
  })
})

describe('the Review Queue counts', () => {
  const hook = src('hooks/useDecisionAccountability.ts')

  it('exclude a decision that has been reviewed', () => {
    const summary = hook.slice(hook.indexOf('needsReviewCount:'))
    const body = summary.slice(0, summary.indexOf('reviewCapturedCount:'))
    expect(body).toContain('!r.has_decision_review')
  })

  it('count a reviewed decision as captured', () => {
    const captured = hook.slice(hook.indexOf('reviewCapturedCount:'))
    expect(captured.slice(0, 220)).toContain('r.has_decision_review')
  })

  /* The fact has to come from the same place the rows do, or the strip and
     the table can disagree about the same decision. */
  it('read the authoritative table, in this hook', () => {
    expect(hook).toContain('useDecisionReviewsByIds(reviewIds)')
    expect(hook).toContain('has_decision_review: !!reviewsByDecision?.get(r.decision_id)')
  })
})

describe('the review emits one immutable conclusion per version', () => {
  const hook = src('hooks/useDecisionReview.ts')

  it('references the authoritative row rather than copying it', () => {
    expect(hook).toContain("source_type: 'decision_reviews'")
    expect(hook).toContain('source_id: review.id')
    expect(hook).toContain("provenance: 'ui:outcomes'")
  })

  /* Prose has an authoritative home and can be corrected there. The event
     keeps only the normalised verdict fields. */
  it('does not duplicate the process note', () => {
    const insert = hook.slice(hook.indexOf("event_type: 'decision.reviewed'"))
    const body = insert.slice(0, insert.indexOf('dedupe_key'))
    expect(body).toContain('thesis_played_out')
    expect(body).not.toContain('process_note')
  })

  /* Saving the same version twice lands once; a later edit is a genuinely new
     conclusion and gets its own event. A calendar-day key would swallow a
     same-afternoon correction. */
  it('dedupes on the review version, not the day', () => {
    expect(hook).toContain('dedupe_key: `decision.reviewed:${review.id}:${review.updated_at}`')
    expect(hook).not.toMatch(/dedupe_key.*toISOString\(\)\.slice/)
  })

  it('treats a duplicate as success, not failure', () => {
    expect(hook).toContain('duplicate key|unique constraint')
  })

  /* The authoritative write must not be lost because the memory write failed;
     it has already committed by then. */
  it('never fails the review because the event failed', () => {
    const after = hook.slice(hook.indexOf('memory_events'))
    expect(after).toContain('console.warn')
    expect(after.slice(0, after.indexOf('return review'))).not.toContain('throw')
  })

  /* `decision_id` is polymorphic across three tables. The caller resolves it
     from (source, category); the writer must not guess. */
  it('is told which table the subject belongs to', () => {
    expect(hook).toContain("subjectType?: 'idea' | 'decision' | 'trade'")
    const page = src('pages/DecisionAccountabilityPage.tsx')
    expect(page).toContain("row.source === 'discretionary' ? 'trade'")
    expect(page).toContain("row.category === 'passed' ? 'decision'")
  })
})
