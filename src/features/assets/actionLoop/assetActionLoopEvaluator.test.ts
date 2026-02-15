/**
 * Action Loop Evaluator — Unit Tests
 *
 * Tests for:
 *   - Conflict prevention (contradictions cannot occur)
 *   - Deterministic priority ordering
 *   - Correct trigger conditions
 *   - Workflow summary computation
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateActionLoop,
  computeWorkflowSummary,
  STALLED_DAYS_THRESHOLD,
  type EvaluatorInput,
  type WorkflowSummaryInput,
} from './assetActionLoopEvaluator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyInput(): EvaluatorInput {
  return {
    expectedReturn: null,
    hasEVData: false,
    activeIdeaCount: 0,
    unsimulatedIdeas: [],
    stalledProposals: [],
    unexecutedApprovals: [],
    thesisDaysStale: null,
    ratingChangesWithoutFollowup: [],
  }
}

// ---------------------------------------------------------------------------
// Conflict Prevention
// ---------------------------------------------------------------------------

describe('Conflict prevention', () => {
  it('"No Active Idea" does NOT show if idea exists', () => {
    const input = emptyInput()
    input.hasEVData = true
    input.expectedReturn = 0.25  // 25% upside — above threshold
    input.activeIdeaCount = 1     // idea exists

    const items = evaluateActionLoop(input)
    const a1 = items.find(i => i.type === 'opportunity_no_idea')
    expect(a1).toBeUndefined()
  })

  it('"No Active Idea" suppressed when process items fire (P2)', () => {
    const input = emptyInput()
    input.hasEVData = true
    input.expectedReturn = 0.25
    input.activeIdeaCount = 0
    input.unsimulatedIdeas = [
      { id: 'idea-1', action: 'buy', rationale: 'test' },
    ]

    const items = evaluateActionLoop(input)
    const a1 = items.find(i => i.type === 'opportunity_no_idea')
    const p2 = items.find(i => i.type === 'idea_not_simulated')
    expect(a1).toBeUndefined()
    expect(p2).toBeDefined()
  })

  it('"No Active Idea" suppressed when process items fire (P1)', () => {
    const input = emptyInput()
    input.hasEVData = true
    input.expectedReturn = 0.25
    input.activeIdeaCount = 0
    input.stalledProposals = [
      { id: 'prop-1', action: 'buy', portfolio: 'Fund A', daysPending: 5 },
    ]

    const items = evaluateActionLoop(input)
    const a1 = items.find(i => i.type === 'opportunity_no_idea')
    const p1 = items.find(i => i.type === 'proposal_stalled')
    expect(a1).toBeUndefined()
    expect(p1).toBeDefined()
  })

  it('"No Active Idea" suppressed when process items fire (P3)', () => {
    const input = emptyInput()
    input.hasEVData = true
    input.expectedReturn = 0.25
    input.activeIdeaCount = 0
    input.unexecutedApprovals = [
      { id: 'app-1', action: 'buy', portfolio: 'Fund A' },
    ]

    const items = evaluateActionLoop(input)
    const a1 = items.find(i => i.type === 'opportunity_no_idea')
    const p3 = items.find(i => i.type === 'execution_not_confirmed')
    expect(a1).toBeUndefined()
    expect(p3).toBeDefined()
  })

  it('"Idea Not Simulated" does NOT show if unsimulatedIdeas is empty', () => {
    const input = emptyInput()
    input.activeIdeaCount = 2
    input.unsimulatedIdeas = []  // all ideas have proposals

    const items = evaluateActionLoop(input)
    const p2 = items.find(i => i.type === 'idea_not_simulated')
    expect(p2).toBeUndefined()
  })

  it('"Execution Not Logged" does NOT show if no approval exists', () => {
    const input = emptyInput()
    input.unexecutedApprovals = []

    const items = evaluateActionLoop(input)
    const p3 = items.find(i => i.type === 'execution_not_confirmed')
    expect(p3).toBeUndefined()
  })

  it('A1 fires only when no ideas exist AND no process items', () => {
    const input = emptyInput()
    input.hasEVData = true
    input.expectedReturn = 0.25
    input.activeIdeaCount = 0

    const items = evaluateActionLoop(input)
    const a1 = items.find(i => i.type === 'opportunity_no_idea')
    expect(a1).toBeDefined()
    expect(a1!.severity).toBe('orange')
    expect(a1!.category).toBe('alpha')
  })
})

// ---------------------------------------------------------------------------
// Trigger Conditions
// ---------------------------------------------------------------------------

describe('Trigger conditions', () => {
  it('P1 only fires when daysPending >= threshold', () => {
    const input = emptyInput()
    input.stalledProposals = [
      { id: 'p-1', action: 'buy', portfolio: 'Fund A', daysPending: STALLED_DAYS_THRESHOLD - 1 },
    ]

    const items = evaluateActionLoop(input)
    expect(items.find(i => i.type === 'proposal_stalled')).toBeUndefined()

    input.stalledProposals[0].daysPending = STALLED_DAYS_THRESHOLD
    const items2 = evaluateActionLoop(input)
    expect(items2.find(i => i.type === 'proposal_stalled')).toBeDefined()
  })

  it('R1 fires at 90d (orange) and 180d (red)', () => {
    const input = emptyInput()

    input.thesisDaysStale = 89
    expect(evaluateActionLoop(input).find(i => i.type === 'thesis_stale')).toBeUndefined()

    input.thesisDaysStale = 90
    const orange = evaluateActionLoop(input).find(i => i.type === 'thesis_stale')!
    expect(orange.severity).toBe('orange')
    expect(orange.dismissible).toBe(true)

    input.thesisDaysStale = 180
    const red = evaluateActionLoop(input).find(i => i.type === 'thesis_stale')!
    expect(red.severity).toBe('red')
    expect(red.dismissible).toBe(false)
  })

  it('R2 only fires within 14-day window', () => {
    const input = emptyInput()
    input.ratingChangesWithoutFollowup = [{
      ratingId: 'r-1',
      oldValue: 'SELL',
      newValue: 'HOLD',
      changedAt: new Date().toISOString(),
      changedBy: 'user-1',
      daysSince: 15,
    }]

    expect(evaluateActionLoop(input).find(i => i.type === 'rating_no_followup')).toBeUndefined()

    input.ratingChangesWithoutFollowup[0].daysSince = 14
    expect(evaluateActionLoop(input).find(i => i.type === 'rating_no_followup')).toBeDefined()
  })

  it('A1 requires EV above threshold', () => {
    const input = emptyInput()
    input.hasEVData = true
    input.activeIdeaCount = 0

    input.expectedReturn = 0.10  // below 15% threshold
    expect(evaluateActionLoop(input).find(i => i.type === 'opportunity_no_idea')).toBeUndefined()

    input.expectedReturn = 0.15  // exactly at threshold
    expect(evaluateActionLoop(input).find(i => i.type === 'opportunity_no_idea')).toBeDefined()

    input.expectedReturn = -0.20  // negative, above absolute threshold
    const item = evaluateActionLoop(input).find(i => i.type === 'opportunity_no_idea')!
    expect(item.meta[0].label).toContain('downside')
  })

  it('returns empty array when no triggers fire', () => {
    const items = evaluateActionLoop(emptyInput())
    expect(items).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Priority Ordering
// ---------------------------------------------------------------------------

describe('Priority ordering', () => {
  it('sorts Red+Process before Red+Risk', () => {
    const input = emptyInput()
    input.unexecutedApprovals = [{ id: 'a-1', action: 'buy', portfolio: 'Fund A' }]
    input.thesisDaysStale = 200  // Red+Risk

    const items = evaluateActionLoop(input)
    expect(items.length).toBe(2)
    expect(items[0].type).toBe('execution_not_confirmed')  // Red+Process
    expect(items[1].type).toBe('thesis_stale')              // Red+Risk
  })

  it('sorts Red before Orange', () => {
    const input = emptyInput()
    input.stalledProposals = [{ id: 'p-1', action: 'buy', portfolio: 'Fund A', daysPending: 5 }]
    input.ratingChangesWithoutFollowup = [{
      ratingId: 'r-1', oldValue: 'BUY', newValue: 'SELL',
      changedAt: new Date().toISOString(), changedBy: 'u', daysSince: 3,
    }]

    const items = evaluateActionLoop(input)
    expect(items[0].severity).toBe('red')
    expect(items[1].severity).toBe('orange')
  })

  it('sorts Orange+Process before Orange+Risk before Orange+Alpha', () => {
    const input = emptyInput()
    input.unsimulatedIdeas = [{ id: 'i-1', action: 'buy', rationale: 'test' }]
    input.ratingChangesWithoutFollowup = [{
      ratingId: 'r-1', oldValue: 'SELL', newValue: 'BUY',
      changedAt: new Date().toISOString(), changedBy: 'u', daysSince: 2,
    }]
    // A1 would be suppressed by P2 (process item exists), so manually verify P and R ordering
    const items = evaluateActionLoop(input)
    const types = items.map(i => `${i.category}`)
    expect(types).toEqual(['process', 'risk'])
  })

  it('within same group, sorts by age descending', () => {
    const input = emptyInput()
    input.stalledProposals = [
      { id: 'p-1', action: 'buy', portfolio: 'Fund A', daysPending: 3 },
      { id: 'p-2', action: 'sell', portfolio: 'Fund B', daysPending: 7 },
    ]
    // Only first stalled is used currently, but testing sort stability
    input.unexecutedApprovals = [{ id: 'a-1', action: 'buy', portfolio: 'Fund C' }]

    const items = evaluateActionLoop(input)
    const redProcess = items.filter(i => i.severity === 'red' && i.category === 'process')
    expect(redProcess.length).toBe(2)
    // P1 (7d) should come before P3 (0d) within red+process
    expect(redProcess[0].ageDays).toBeGreaterThanOrEqual(redProcess[1].ageDays)
  })

  it('deterministic tiebreak by id', () => {
    const input = emptyInput()
    input.thesisDaysStale = 100
    input.ratingChangesWithoutFollowup = [{
      ratingId: 'r-1', oldValue: 'BUY', newValue: 'SELL',
      changedAt: new Date().toISOString(), changedBy: 'u', daysSince: 0,
    }]

    const items1 = evaluateActionLoop(input)
    const items2 = evaluateActionLoop(input)
    expect(items1.map(i => i.id)).toEqual(items2.map(i => i.id))
  })
})

// ---------------------------------------------------------------------------
// Metadata Presentation
// ---------------------------------------------------------------------------

describe('Metadata presentation', () => {
  it('descriptions contain no portfolio names', () => {
    const input = emptyInput()
    input.unexecutedApprovals = [{ id: 'a-1', action: 'buy', portfolio: 'My Portfolio' }]
    input.stalledProposals = [{ id: 'p-1', action: 'buy', portfolio: 'My Portfolio', daysPending: 5 }]

    const items = evaluateActionLoop(input)
    for (const item of items) {
      expect(item.description).not.toContain('My Portfolio')
    }
  })

  it('portfolio names appear in meta chips', () => {
    const input = emptyInput()
    input.unexecutedApprovals = [{ id: 'a-1', action: 'buy', portfolio: 'Large Cap' }]

    const items = evaluateActionLoop(input)
    const p3 = items.find(i => i.type === 'execution_not_confirmed')!
    const chipLabels = p3.meta.map(m => m.label)
    expect(chipLabels).toContain('Portfolio: Large Cap')
  })

  it('rating change chips use structured format', () => {
    const input = emptyInput()
    input.ratingChangesWithoutFollowup = [{
      ratingId: 'r-1', oldValue: 'SELL', newValue: 'HOLD',
      changedAt: new Date().toISOString(), changedBy: 'u', daysSince: 3,
    }]

    const items = evaluateActionLoop(input)
    const r2 = items.find(i => i.type === 'rating_no_followup')!
    const chipLabels = r2.meta.map(m => m.label)
    expect(chipLabels).toContain('From: SELL')
    expect(chipLabels).toContain('To: HOLD')
    expect(chipLabels).toContain('Changed: 3d ago')
  })
})

// ---------------------------------------------------------------------------
// Dismissibility
// ---------------------------------------------------------------------------

describe('Dismissibility', () => {
  it('red items are NOT dismissible', () => {
    const input = emptyInput()
    input.unexecutedApprovals = [{ id: 'a-1', action: 'buy', portfolio: 'Fund' }]
    input.stalledProposals = [{ id: 'p-1', action: 'buy', portfolio: 'Fund', daysPending: 5 }]

    const items = evaluateActionLoop(input)
    const redItems = items.filter(i => i.severity === 'red')
    expect(redItems.length).toBeGreaterThan(0)
    for (const item of redItems) {
      expect(item.dismissible).toBe(false)
    }
  })

  it('orange items ARE dismissible (except R1 at 180d+)', () => {
    const input = emptyInput()
    input.unsimulatedIdeas = [{ id: 'i-1', action: 'buy', rationale: 'test' }]

    const items = evaluateActionLoop(input)
    const orange = items.filter(i => i.severity === 'orange')
    for (const item of orange) {
      expect(item.dismissible).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Single Next Step
// ---------------------------------------------------------------------------

describe('Single next step', () => {
  it('each item has exactly one primary action', () => {
    const input = emptyInput()
    input.unexecutedApprovals = [{ id: 'a-1', action: 'buy', portfolio: 'Fund' }]
    input.stalledProposals = [{ id: 'p-1', action: 'buy', portfolio: 'Fund', daysPending: 5 }]
    input.unsimulatedIdeas = [{ id: 'i-1', action: 'buy', rationale: 'test' }]
    input.thesisDaysStale = 100

    const items = evaluateActionLoop(input)
    for (const item of items) {
      expect(item.primaryAction).toBeDefined()
      expect(item.primaryAction.label).toBeTruthy()
      expect(item.primaryAction.actionKey).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// Workflow Summary
// ---------------------------------------------------------------------------

describe('Workflow summary', () => {
  it('all none when no data', () => {
    const summary = computeWorkflowSummary({
      thesisDaysStale: null,
      activeIdeaCount: 0,
      simulatedIdeaCount: 0,
      stalledProposalCount: 0,
      unexecutedApprovalCount: 0,
      completedExecutionCount: 0,
    })
    expect(summary.research).toBe('none')
    expect(summary.idea).toBe('none')
    expect(summary.proposal).toBe('none')
    expect(summary.decision).toBe('none')
    expect(summary.execution).toBe('none')
  })

  it('research done when thesis < 90d', () => {
    const summary = computeWorkflowSummary({
      thesisDaysStale: 30,
      activeIdeaCount: 0,
      simulatedIdeaCount: 0,
      stalledProposalCount: 0,
      unexecutedApprovalCount: 0,
      completedExecutionCount: 0,
    })
    expect(summary.research).toBe('done')
  })

  it('research pending when thesis >= 90d', () => {
    const summary = computeWorkflowSummary({
      thesisDaysStale: 90,
      activeIdeaCount: 0,
      simulatedIdeaCount: 0,
      stalledProposalCount: 0,
      unexecutedApprovalCount: 0,
      completedExecutionCount: 0,
    })
    expect(summary.research).toBe('pending')
  })

  it('proposal pending when ideas exist but none simulated', () => {
    const summary = computeWorkflowSummary({
      thesisDaysStale: null,
      activeIdeaCount: 2,
      simulatedIdeaCount: 0,
      stalledProposalCount: 0,
      unexecutedApprovalCount: 0,
      completedExecutionCount: 0,
    })
    expect(summary.idea).toBe('done')
    expect(summary.proposal).toBe('pending')
  })

  it('decision blocked when proposals stalled', () => {
    const summary = computeWorkflowSummary({
      thesisDaysStale: null,
      activeIdeaCount: 1,
      simulatedIdeaCount: 1,
      stalledProposalCount: 2,
      unexecutedApprovalCount: 0,
      completedExecutionCount: 0,
    })
    expect(summary.decision).toBe('blocked')
  })

  it('execution blocked when approvals unexecuted', () => {
    const summary = computeWorkflowSummary({
      thesisDaysStale: null,
      activeIdeaCount: 1,
      simulatedIdeaCount: 1,
      stalledProposalCount: 0,
      unexecutedApprovalCount: 1,
      completedExecutionCount: 0,
    })
    expect(summary.decision).toBe('done')
    expect(summary.execution).toBe('blocked')
  })

  it('execution done when completed', () => {
    const summary = computeWorkflowSummary({
      thesisDaysStale: null,
      activeIdeaCount: 0,
      simulatedIdeaCount: 0,
      stalledProposalCount: 0,
      unexecutedApprovalCount: 0,
      completedExecutionCount: 3,
    })
    expect(summary.execution).toBe('done')
    expect(summary.decision).toBe('done')
  })
})
