/**
 * Increment 2B — Decision Memory.
 *
 * These tests guard the distinctions the timeline exists to make. Each one
 * is written so that it FAILS if the distinction collapses, which is the
 * only way a test about "we tell these apart" is worth anything.
 *
 * Two of them are source assertions rather than behavioural ones. That is
 * deliberate: "the PM ruling is not read from `trade_idea_portfolios`" and
 * "`accepted_trades` is read at all" are facts about which table is queried,
 * and mocking Supabase to assert them would only prove the mock.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  timelineSortKey,
  gradeExecutionProof,
  parseTimelineDate,
  isDateOnly,
} from '../../lib/asset-decisions/timeline'
import {
  EVENT_PHASE,
  EVENT_LABELS,
  OBSERVED_PROOFS,
  TERMINAL_DECISION_STATUSES,
} from '../../types/decision-timeline'
import type { TimelineEventType, ExecutionProof } from '../../types/decision-timeline'

const SRC = path.resolve(__dirname, '../..')
const HOOK = fs.readFileSync(path.join(SRC, 'hooks/useAssetDecisionTimeline.ts'), 'utf8')
const TIMELINE = fs.readFileSync(path.join(SRC, 'components/asset/DecisionTimeline.tsx'), 'utf8')

// ---------------------------------------------------------------------------
// The sort bug: DATE vs timestamptz
// ---------------------------------------------------------------------------

describe('timelineSortKey', () => {
  /*
   * `portfolio_trade_events.event_date` is a DATE (verified against
   * production). Every other timestamp is timestamptz. Comparing them as
   * STRINGS put every execution below its own day's decisions, because
   * '2026-06-02' < '2026-06-02T09:00:00Z' on the shared prefix.
   */
  it('sorts a bare date AFTER a same-day timestamp, not before it', () => {
    const decision = '2026-06-02T09:00:00.000Z'
    const execution = '2026-06-02' // a DATE from portfolio_trade_events

    // The defect, reproduced: string comparison puts the execution first.
    expect(execution.localeCompare(decision)).toBeLessThan(0)

    // The fix: the execution sorts after the decision that caused it.
    expect(timelineSortKey(execution)).toBeGreaterThan(timelineSortKey(decision))
  })

  it('orders a full day of mixed-precision events causally', () => {
    const events = [
      { id: 'executed', ts: '2026-06-02' },
      { id: 'recommended', ts: '2026-06-02T08:00:00.000Z' },
      { id: 'decided', ts: '2026-06-02T14:30:00.000Z' },
    ]
    // Ascending, the way a reader follows the story forward.
    const order = [...events]
      .sort((a, b) => timelineSortKey(a.ts) - timelineSortKey(b.ts))
      .map(e => e.id)

    expect(order).toEqual(['recommended', 'decided', 'executed'])
  })

  it('still orders across days correctly', () => {
    expect(timelineSortKey('2026-06-01')).toBeLessThan(timelineSortKey('2026-06-02'))
    expect(timelineSortKey('2026-06-03T00:00:00.000Z'))
      .toBeGreaterThan(timelineSortKey('2026-06-02'))
  })

  it('does not throw or NaN on an unparseable timestamp', () => {
    expect(timelineSortKey('not a date')).toBe(0)
    expect(Number.isNaN(timelineSortKey(''))).toBe(false)
  })

  it('keeps the calendar date intact for DISPLAY', () => {
    /*
     * The sort nudges a DATE to end-of-day UTC. If display used the same
     * value, a reader west of UTC would see the previous day — which is
     * exactly what `new Date('2026-06-02')` already did: it parses as UTC
     * midnight and formats as Jun 1 in Eastern time.
     */
    const d = parseTimelineDate('2026-06-02')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5) // June
    expect(d.getDate()).toBe(2)  // the 2nd, not the 1st

    // The defect, reproduced: the naive parse loses a day in any negative offset.
    const naive = new Date('2026-06-02')
    if (naive.getTimezoneOffset() > 0) {
      expect(naive.getDate()).toBe(1)
      expect(d.getDate()).not.toBe(naive.getDate())
    }
  })

  it('parses a full timestamp as an instant, unchanged', () => {
    const iso = '2026-06-02T14:30:00.000Z'
    expect(parseTimelineDate(iso).getTime()).toBe(Date.parse(iso))
  })

  it('knows which timestamps carry no time of day', () => {
    expect(isDateOnly('2026-06-02')).toBe(true)
    expect(isDateOnly('2026-06-02T14:30:00.000Z')).toBe(false)
  })

  it('is used for sorting — localeCompare must not come back', () => {
    // The regression this guards: reverting to a string sort silently
    // restores the bug, and no behavioural test of the merged list would
    // notice unless it happened to contain a same-day pair.
    expect(HOOK).toContain('timelineSortKey(b.timestamp) - timelineSortKey(a.timestamp)')
    expect(HOOK).not.toMatch(/events\.sort\([^)]*localeCompare/)
  })
})

// ---------------------------------------------------------------------------
// Assumed vs evidenced execution
// ---------------------------------------------------------------------------

describe('gradeExecutionProof', () => {
  const base = { detected_by_system: null, source_type: null, metadata: null }

  it('grades an observed apply as verified', () => {
    expect(gradeExecutionProof({
      detected_by_system: true,
      source_type: 'holdings_diff',
      metadata: { origin: 'paper_execute' },
    })).toBe('verified')
  })

  it('grades a PM-assumed fill as assumed, never as verified', () => {
    const grade = gradeExecutionProof({
      detected_by_system: false,
      source_type: 'manual',
      metadata: { origin: 'pm_assumed_execution' },
    })
    expect(grade).toBe('assumed')
    // The claim this must never make.
    expect(OBSERVED_PROOFS).not.toContain(grade)
  })

  it('grades a trader attestation as attested, and not as observed', () => {
    const grade = gradeExecutionProof({
      detected_by_system: false,
      source_type: 'manual',
      metadata: { origin: 'trader_attested' },
    })
    expect(grade).toBe('attested')
    expect(OBSERVED_PROOFS).not.toContain(grade)
  })

  it('grades a migration-written row as backfilled', () => {
    // 33 of 52 production rows carry this origin. Calling them verified
    // would assert 33 fills the app never watched.
    expect(gradeExecutionProof({
      detected_by_system: true,
      source_type: 'holdings_diff',
      metadata: { origin: 'paper_execute_backfill' },
    })).toBe('backfilled')
  })

  it('grades a row with no provenance as unattributed', () => {
    // 7 production rows predate stamping. "We do not know" is the honest
    // rendering; defaulting them to verified is not.
    expect(gradeExecutionProof(base)).toBe('unattributed')
  })

  it('requires BOTH stamps for verified — either alone is not observation', () => {
    expect(gradeExecutionProof({
      detected_by_system: true, source_type: 'manual', metadata: null,
    })).toBe('unattributed')
    expect(gradeExecutionProof({
      detected_by_system: false, source_type: 'holdings_diff', metadata: null,
    })).toBe('unattributed')
  })

  it('treats only `verified` as an observed fill', () => {
    const all: ExecutionProof[] =
      ['verified', 'attested', 'assumed', 'backfilled', 'unattributed']
    expect(all.filter(p => OBSERVED_PROOFS.includes(p))).toEqual(['verified'])
  })
})

// ---------------------------------------------------------------------------
// Which record each fact is read from
// ---------------------------------------------------------------------------

describe('canonical sources', () => {
  it('does NOT read the PM ruling from trade_idea_portfolios', () => {
    /*
     * `trade_idea_portfolios.decision_outcome` is 95% blank in production:
     * 37 rows, 2 outcomes, ZERO reasons. A timeline built on it showed
     * almost no decisions and never a reason.
     */
    expect(HOOK).not.toMatch(/decision_outcome\s*&&/)
    expect(HOOK).not.toContain('`decision_${track.decision_outcome}`')
    // And it says why, so the next person does not "restore" it.
    expect(HOOK).toContain('95% blank in production')
  })

  it('reads the PM ruling from decision_requests.status + reviewed_at', () => {
    expect(HOOK).toContain("from('decision_requests')")
    expect(HOOK).toMatch(/status,\s*\n\s*reviewed_at/)
    expect(HOOK).toContain('TERMINAL_DECISION_STATUSES.includes(rec.status)')
  })

  it('reads accepted_trades — without it "decided but not executed" cannot render', () => {
    expect(HOOK).toContain("from('accepted_trades')")
    expect(HOOK).toContain('execution_pending')
  })

  it('reads the three execution-provenance fields', () => {
    // Without all three the grades of proof are indistinguishable.
    expect(HOOK).toMatch(/source_type,\s*\n\s*detected_by_system,\s*\n\s*metadata/)
  })

  it('reads decision_reviews and memory_events', () => {
    expect(HOOK).toContain("from('decision_reviews')")
    expect(HOOK).toContain("from('memory_events')")
    expect(HOOK).toContain("eq('subject_type', 'asset')")
  })

  it('adds no org predicate of its own to decision_reviews', () => {
    /*
     * The table's own policy scopes the read (PR #251). A client-side org
     * filter here would be a second, weaker boundary that looks like
     * security but is not — and it would silently diverge from the policy.
     */
    const block = HOOK.slice(
      HOOK.indexOf("from('decision_reviews')"),
      HOOK.indexOf("from('decision_reviews')") + 700,
    )
    expect(block).not.toMatch(/organization_id/)
  })

  it('degrades to an empty list rather than blanking the timeline', () => {
    // A missing grant on a secondary source must not take the whole
    // narrative down with it.
    expect(HOOK).toContain('[DecisionTimeline] decision_reviews read failed')
    expect(HOOK).toContain('[DecisionTimeline] memory_events read failed')
  })

  it('excludes reverted commitments', () => {
    // A reverted trade is not a commitment that stands.
    expect(HOOK).toContain("eq('is_active', true)")
  })
})

// ---------------------------------------------------------------------------
// The four states stay distinct
// ---------------------------------------------------------------------------

describe('recommended / decided / executed / reviewed stay distinct', () => {
  it('gives each state its own event type', () => {
    const types: TimelineEventType[] = [
      'proposal_submitted',   // recommended
      'decision_accepted',    // decided
      'trade_committed',      // committed, not proven
      'execution_pending',    // decided and NOT executed
      'trade_executed',       // the book moved
      'review_recorded',      // reviewed
    ]
    for (const t of types) {
      expect(EVENT_PHASE[t]).toBeDefined()
      expect(EVENT_LABELS[t]).toBeTruthy()
    }
  })

  it('never labels a commitment as an execution', () => {
    expect(EVENT_LABELS.trade_committed).toBe('Trade Committed')
    expect(EVENT_LABELS.trade_executed).toBe('Trade Executed')
    expect(EVENT_LABELS.trade_committed).not.toBe(EVENT_LABELS.trade_executed)
    // And the row chips differ too, which is what a reader actually sees.
    expect(TIMELINE).toMatch(/trade_committed: 'Committed'/)
    expect(TIMELINE).toMatch(/trade_executed: 'Executed'/)
  })

  it('separates an accepted-with-modification from a plain acceptance', () => {
    expect(TERMINAL_DECISION_STATUSES).toContain('accepted_with_modification')
    expect(HOOK).toContain("rec.status === 'accepted_with_modification'")
    expect(HOOK).toContain('Accepted (modified)')
  })

  it('treats a withdrawal as neither a rejection nor a decision', () => {
    // 29 of 111 production requests are withdrawn. Nobody ruled on them.
    expect(EVENT_LABELS.decision_withdrawn).toBe('Withdrawn')
    expect(TERMINAL_DECISION_STATUSES).not.toContain('withdrawn')
    expect(HOOK).toContain("rec.status !== 'withdrawn'")
  })

  it('does not treat `pending` as a decision', () => {
    expect(TERMINAL_DECISION_STATUSES).not.toContain('pending')
    expect(TERMINAL_DECISION_STATUSES).not.toContain('under_review')
    expect(TERMINAL_DECISION_STATUSES).not.toContain('needs_discussion')
  })

  it('attaches a proof grade ONLY to the event that claims a fill', () => {
    /*
     * Acceptance events set executionProof to null on purpose. Attaching a
     * grade to a commitment would imply the portfolio moved.
     */
    expect(HOOK).toContain('executionProof: gradeExecutionProof(te)')
    const graded = HOOK.match(/executionProof: gradeExecutionProof/g) ?? []
    expect(graded).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Provenance and navigation
// ---------------------------------------------------------------------------

describe('provenance and navigation', () => {
  it('records the source table and row id on every event', () => {
    // Provenance is enforced on this codebase: a figure a user sees must be
    // traceable to the record it came from.
    const pushes = HOOK.match(/sourceRef:\s*\{/g) ?? []
    const provenances = HOOK.match(/provenance:\s*\{/g) ?? []
    expect(provenances.length).toBe(pushes.length)
  })

  it('routes through the existing openers, not a hardcoded tab id', () => {
    /*
     * The previous version dispatched a hardcoded `'trade-queue'`
     * descriptor, which is not where ideas live any more.
     */
    expect(TIMELINE).toContain('ideasTabFor')
    expect(TIMELINE).toContain('openTradeBookFor')
    expect(TIMELINE).toContain('openOutcomesFor')
    expect(TIMELINE).not.toContain("id: 'trade-queue'")
  })

  it('does not offer a click with no destination', () => {
    // A thesis change has no route of its own.
    expect(TIMELINE).toMatch(/case 'memory_event':\s*\n\s*return false/)
  })
})

/*
 * Found by looking at the rendered page during release validation, not by a
 * test: every execution row printed its book twice, once as the subtitle and
 * again in the meta line, on BOTH the phone and the desktop.
 */
describe('an execution states its book once', () => {
  it('carries no subtitle, because the portfolio field already holds it', () => {
    const CODE = fs.readFileSync(
      path.join(__dirname, '../useAssetDecisionTimeline.ts'), 'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    // The trade_executed branch must not reuse the portfolio name as prose.
    expect(CODE).not.toContain('subtitle: te.portfolio_name')
    // And must still carry the portfolio itself, which is what both meta
    // lines and the book filter read.
    expect(CODE).toContain('portfolio: te.portfolio_id')
  })
})
