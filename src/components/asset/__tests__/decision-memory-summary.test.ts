/**
 * Increment 2E regression tests.
 *
 * Each one guards a specific thing the end-to-end validation found, measured
 * against real production shapes rather than invented ones.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  summariseDecisionMemory,
  decisionMemoryHeadline,
} from '../DecisionMemorySummary'
import type { DecisionTimelineEvent, TimelineEventType } from '../../../types/decision-timeline'

const SRC = path.resolve(__dirname, '../../..')
const SUMMARY = fs.readFileSync(path.join(SRC, 'components/asset/DecisionMemorySummary.tsx'), 'utf8')
const TIMELINE = fs.readFileSync(path.join(SRC, 'components/asset/DecisionTimeline.tsx'), 'utf8')
const MOBILE = fs.readFileSync(path.join(SRC, 'components/mobile/asset/MobileInvestmentSnapshot.tsx'), 'utf8')
const SNAPSHOT = fs.readFileSync(path.join(SRC, 'components/asset/InvestmentSnapshot.tsx'), 'utf8')

let seq = 0
const ev = (
  type: TimelineEventType,
  extra: Partial<DecisionTimelineEvent> = {},
): DecisionTimelineEvent => ({
  id: `e${seq++}`,
  type,
  phase: 'formal',
  timestamp: '2026-06-01T00:00:00.000Z',
  title: type,
  subtitle: null,
  actor: null,
  portfolio: null,
  sizing: null,
  rationale: null,
  sourceRef: { type: 'trade_idea', id: 'i1' },
  executionProof: null,
  provenance: { table: 't', rowId: 'r' },
  disposition: 'neutral',
  ...extra,
} as DecisionTimelineEvent)

describe('summariseDecisionMemory', () => {
  it('counts each state separately', () => {
    const s = summariseDecisionMemory([
      ev('proposal_submitted'),
      ev('proposal_submitted'),
      ev('decision_accepted'),
      ev('decision_rejected'),
      ev('trade_committed', { phase: 'execution' }),
      ev('execution_pending', { phase: 'execution' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'verified' }),
      ev('review_recorded', { phase: 'review' }),
    ])
    expect(s.recommended).toBe(2)
    expect(s.decided).toBe(2)
    expect(s.committed).toBe(1)
    expect(s.unfilled).toBe(1)
    expect(s.executed).toBe(1)
    expect(s.reviewed).toBe(1)
  })

  it('counts only observed fills as observed', () => {
    const s = summariseDecisionMemory([
      ev('trade_executed', { phase: 'execution', executionProof: 'verified' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'assumed' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'attested' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'backfilled' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'unattributed' }),
    ])
    expect(s.executed).toBe(5)
    // The number that must not be inflated.
    expect(s.executedObserved).toBe(1)
  })

  it('does not count a withdrawal as a decision', () => {
    // 29 of 111 production requests are withdrawn. Nobody ruled on them.
    const s = summariseDecisionMemory([ev('decision_withdrawn')])
    expect(s.decided).toBe(0)
  })

  it('reports the furthest state by PHASE, not by date', () => {
    /*
     * A recommendation filed AFTER a trade executed is the newest event and
     * the earliest state. Reporting it as the state of play walks the reader
     * backwards.
     */
    const s = summariseDecisionMemory([
      ev('proposal_submitted', { timestamp: '2026-12-01T00:00:00.000Z' }),
      ev('trade_executed', {
        phase: 'execution', timestamp: '2026-01-01T00:00:00.000Z',
        executionProof: 'verified', title: 'the execution',
      }),
    ])
    expect(s.furthest?.title).toBe('the execution')
  })
})

describe('decisionMemoryHeadline', () => {
  it('says nothing when there is nothing', () => {
    expect(decisionMemoryHeadline(summariseDecisionMemory([]))).toBeNull()
  })

  it('leads with unfilled commitments — the state most worth surfacing', () => {
    const h = decisionMemoryHeadline(summariseDecisionMemory([
      ev('execution_pending', { phase: 'execution' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'verified' }),
    ]))
    expect(h).toMatch(/committed and not yet executed/)
  })

  it('NEVER claims all observed when some are not', () => {
    const h = decisionMemoryHeadline(summariseDecisionMemory([
      ev('trade_executed', { phase: 'execution', executionProof: 'verified' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'assumed' }),
    ]))
    expect(h).toBe('2 executed · 1 observed, 1 not')
    expect(h).not.toMatch(/all observed/)
  })

  it('says all observed only when they all are', () => {
    const h = decisionMemoryHeadline(summariseDecisionMemory([
      ev('trade_executed', { phase: 'execution', executionProof: 'verified' }),
      ev('trade_executed', { phase: 'execution', executionProof: 'verified' }),
    ]))
    expect(h).toBe('2 executed, all observed')
  })

  it('does not imply execution when only decisions exist', () => {
    const h = decisionMemoryHeadline(summariseDecisionMemory([ev('decision_accepted')]))
    expect(h).toBe('1 decided, none executed')
  })
})

describe('a failed read is not an empty history', () => {
  /*
   * Found in 2E. Both surfaces rendered "No decision history yet" when the
   * read FAILED — a claim about the data made on the basis of not having any,
   * on the one surface whose purpose is to report what was decided.
   */
  it('the summary distinguishes error from empty', () => {
    expect(SUMMARY).toContain('isError')
    expect(SUMMARY).toContain('could not be loaded')
    expect(SUMMARY).toContain('decision-memory-summary-error')
    /*
     * Matched with whitespace collapsed: the copy is JSX and wraps across
     * source lines, so a literal substring match is a test of the formatter
     * rather than of the message.
     */
    expect(SUMMARY.replace(/\s+/g, ' '))
      .toContain('not a statement that there is none')
  })

  it('the timeline distinguishes error from empty', () => {
    expect(TIMELINE).toContain('isError')
    expect(TIMELINE).toContain('decision-timeline-error')
    expect(TIMELINE).toContain('This is not a statement that there is none')
  })
})

describe('the authorization gap is disclosed, not hidden', () => {
  /*
   * Measured in production: holdings are ORG-scoped, so the position read
   * returns every book in the org holding the name. Decisions, commitments
   * and executions are PORTFOLIO-TEAM scoped — all three policies require
   * `user_is_portfolio_member(portfolio_id)`. A Tesseract analyst can
   * therefore see AAPL held in 3 books and 0-2 of its executions, depending
   * on their team memberships.
   *
   * Rendering a count beside "held in 3 books" with no note reads as a
   * complete history.
   */
  it('the summary takes the held books so it can detect the gap', () => {
    expect(SUMMARY).toContain('heldBookIds')
    expect(SUMMARY).toContain('decision-memory-coverage-note')
    expect(SUMMARY).toContain('you have decision')
  })

  it('both snapshots supply them', () => {
    expect(SNAPSHOT).toContain('heldBookIds={data.positions.map(p => p.portfolioId)}')
    expect(MOBILE).toContain('heldBookIds={data.positions.map(p => p.portfolioId)}')
  })

  it('says nothing when a book was deliberately selected', () => {
    // A scoped view is not an incomplete one, and a note there would be noise.
    expect(SUMMARY).toContain('if (portfolioId) return null')
  })

  it('names no book the reader cannot see', () => {
    /*
     * The note counts; it must not enumerate. Naming an inaccessible book
     * would leak the thing the policy exists to withhold.
     */
    const block = SUMMARY.slice(
      SUMMARY.indexOf('decision-memory-coverage-note') - 1200,
      SUMMARY.indexOf('decision-memory-coverage-note') + 600,
    )
    expect(block).not.toMatch(/portfolioName/)
  })
})

describe('the summary never re-queries', () => {
  it('reads the same hook as the timeline', () => {
    // A second query would be a second definition of "executed".
    expect(SUMMARY).toContain("from '../../hooks/useAssetDecisionTimeline'")
    expect(SUMMARY).not.toContain("from '../../lib/supabase'")
  })
})
