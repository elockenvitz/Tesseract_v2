/**
 * The landing page's ordering, and the judgments it refuses to make.
 */
import { describe, it, expect } from 'vitest'
import { buildWorkOverview, progressOf, type OverviewRunInput } from '../work-overview'

const NOW = new Date('2026-10-23T00:00:00Z')

const run = (over: Partial<OverviewRunInput> & { workflowId: string }): OverviewRunInput => ({
  name: 'Earnings Season', cycle: 'Q2 2026',
  currentStageId: 's1', currentStageLabel: 'Expectations',
  isStarted: true, isCompleted: false,
  requirementsTotal: 5, requirementsDone: 1,
  nextRequirementId: 'r1', nextRequirementText: 'Read/Summarize News',
  assigneeName: null, dueDate: null, updatedAt: '2026-10-01T00:00:00Z',
  ...over,
})

describe('buildWorkOverview', () => {
  it('leaves completed runs out of the active list', () => {
    const o = buildWorkOverview([run({ workflowId: 'a', isCompleted: true })], { now: NOW })
    expect(o.runs).toEqual([])
  })

  it('puts an overdue run first, and only on a real past date', () => {
    const o = buildWorkOverview([
      run({ workflowId: 'plain' }),
      run({ workflowId: 'late', dueDate: '2026-10-01T00:00:00Z' }),
    ], { now: NOW })
    expect(o.runs[0].workflowId).toBe('late')
    expect(o.runs[0].overdue).toBe(true)
    expect(o.runs[1].overdue).toBe(false)
  })

  it('does not call a future deadline overdue', () => {
    const o = buildWorkOverview([run({ workflowId: 'a', dueDate: '2026-12-01T00:00:00Z' })], { now: NOW })
    expect(o.runs[0].overdue).toBe(false)
  })

  it('treats an unparseable date as no deadline rather than as overdue', () => {
    const o = buildWorkOverview([run({ workflowId: 'a', dueDate: 'not a date' })], { now: NOW })
    expect(o.runs[0].overdue).toBe(false)
  })

  it('offers the run the reader last had open as the thing to continue', () => {
    const o = buildWorkOverview([
      run({ workflowId: 'other', dueDate: '2026-10-01T00:00:00Z' }),
      run({ workflowId: 'mine' }),
    ], { lastOpenedWorkflowId: 'mine', now: NOW })
    expect(o.resume?.workflowId).toBe('mine')
    expect(o.resume?.reason).toBe('where you left off')
    /* The deadline still ranks the LIST; it just does not override what
       the reader was actually doing. */
    expect(o.runs[0].workflowId).toBe('other')
  })

  it('does not offer to resume a run with nothing outstanding', () => {
    const o = buildWorkOverview([
      run({ workflowId: 'done-ish', requirementsDone: 5, requirementsTotal: 5 }),
    ], { lastOpenedWorkflowId: 'done-ish', now: NOW })
    expect(o.resume).toBeNull()
  })

  it('carries the stage and requirement so Resume lands on the work', () => {
    const o = buildWorkOverview([run({ workflowId: 'a' })], { now: NOW })
    expect(o.resume).toMatchObject({
      workflowId: 'a', stageId: 's1', requirementId: 'r1',
      requirementText: 'Read/Summarize News',
    })
  })

  it('is quiet only when there is no work of any kind', () => {
    expect(buildWorkOverview([], { now: NOW }).quiet).toBe(true)
    expect(buildWorkOverview([], { hasIdeas: true, now: NOW }).quiet).toBe(false)
    expect(buildWorkOverview([run({ workflowId: 'a' })], { now: NOW }).quiet).toBe(false)
  })

  it('breaks ties by recency then by input order, never randomly', () => {
    const o = buildWorkOverview([
      run({ workflowId: 'older', updatedAt: '2026-01-01T00:00:00Z' }),
      run({ workflowId: 'newer', updatedAt: '2026-09-01T00:00:00Z' }),
    ], { now: NOW })
    expect(o.runs.map(r => r.workflowId)).toEqual(['newer', 'older'])
  })

  it('never produces a score or a rank field', () => {
    /* Sorting by an invented number would put an unexplained judgment at
       the top of the page. The ordering is categorical and the reason is
       a sentence, so there is nothing to leak. */
    const o = buildWorkOverview([run({ workflowId: 'a' })], { now: NOW })
    expect(o.runs[0]).not.toHaveProperty('score')
    expect(o.runs[0]).not.toHaveProperty('priority')
    expect(o.runs[0]).not.toHaveProperty('urgency')
  })

  it('computes outstanding without going negative on bad counts', () => {
    const o = buildWorkOverview([
      run({ workflowId: 'a', requirementsDone: 9, requirementsTotal: 5 }),
    ], { now: NOW })
    expect(o.runs[0].outstanding).toBe(0)
  })
})

describe('progressOf', () => {
  it('does not divide by zero on a run with no requirements', () => {
    expect(progressOf({ requirementsDone: 0, requirementsTotal: 0 }))
      .toEqual({ label: 'no requirements', fraction: 0 })
  })

  it('reports the real fraction', () => {
    expect(progressOf({ requirementsDone: 2, requirementsTotal: 5 }))
      .toEqual({ label: '2 of 5', fraction: 0.4 })
  })
})
