/**
 * The address both entry routes share.
 *
 * The failures here are silent ones: a deep link that lands on the wrong
 * stage after a Process was reordered, or an arrival that re-applies on
 * every remount and drags the reader out of wherever they went next.
 */
import { describe, it, expect } from 'vitest'
import {
  WORK_OVERVIEW_KEY, isOverviewKey, destinationFromTabData,
  processKey, shouldApplyArrival, arrivalKey,
} from '../work-destination'
import { resolveSelection, type WorkItem } from '../work-items'

const item = (key: string, over: Partial<WorkItem> = {}): WorkItem => ({
  key, kind: 'process', id: key.split(':')[1] ?? key,
  group: 'in-progress', label: 'Earnings Season', ...over,
})

describe('the overview is a destination, not an absence', () => {
  it('recognises its own sentinel', () => {
    expect(isOverviewKey(WORK_OVERVIEW_KEY)).toBe(true)
    expect(isOverviewKey('process:abc')).toBe(false)
    expect(isOverviewKey(null)).toBe(false)
  })

  it('opens on the overview when nothing is saved', () => {
    /* This is the behaviour change: it used to auto-open the first item,
       which made the landing page unreachable on any asset that had work. */
    const r = resolveSelection([item('process:a', { group: 'needs-you' })], null)
    expect(r.selected).toBeNull()
    expect(r.recovered).toBe(false)
  })

  it('stays on the overview when the reader chose it', () => {
    const r = resolveSelection([item('process:a', { group: 'needs-you' })], WORK_OVERVIEW_KEY)
    expect(r.selected).toBeNull()
    expect(r.recovered).toBe(false)
  })

  it('still honours an explicit saved selection', () => {
    const r = resolveSelection([item('process:a'), item('process:b')], 'process:b')
    expect(r.selected?.key).toBe('process:b')
    expect(r.recovered).toBe(false)
  })

  it('reports a saved selection that has vanished, rather than swapping one in', () => {
    const r = resolveSelection([item('process:a')], 'process:gone')
    expect(r.selected).toBeNull()
    expect(r.recovered).toBe(true)
  })

  it('keeps a historical cycle selected even though the navigator omits it', () => {
    /*
     * The navigator lists LIVE runs only. Switching AAPL to its completed
     * Feb 2026 cycle left the reader holding `process:<feb>`, which no
     * row matched, so the resolver called it a vanished selection and
     * bounced them to the overview — while that very cycle was open on
     * screen. The workspace's own run is the tiebreaker.
     */
    const r = resolveSelection([item('process:live')], 'process:feb', {
      activeProcessWorkflowId: 'feb',
      activeProcessLabel: 'Earnings Season - Feb 2026',
    })
    expect(r.recovered).toBe(false)
    expect(r.selected).toMatchObject({ key: 'process:feb', kind: 'process', id: 'feb' })
  })

  it('still reports a vanished selection that is not the open run', () => {
    const r = resolveSelection([item('process:live')], 'process:deleted', {
      activeProcessWorkflowId: 'live',
    })
    expect(r.recovered).toBe(true)
    expect(r.selected).toBeNull()
  })

  it('never auto-selects a conversation', () => {
    const r = resolveSelection([item('conversation:c', { launchesPane: true })], 'conversation:c')
    expect(r.selected).toBeNull()
    expect(r.recovered).toBe(true)
  })
})

describe('destinationFromTabData', () => {
  it('reads a full address', () => {
    expect(destinationFromTabData({ workflowId: 'w', stageId: 's', requirementId: 'r' }))
      .toEqual({ workflowId: 'w', stageId: 's', requirementId: 'r' })
  })

  it('accepts the older taskId spelling for the requirement', () => {
    expect(destinationFromTabData({ workflowId: 'w', taskId: 'r' })?.requirementId).toBe('r')
  })

  it('prefers the explicit requirementId when both are present', () => {
    expect(destinationFromTabData({ workflowId: 'w', requirementId: 'new', taskId: 'old' })?.requirementId)
      .toBe('new')
  })

  it('refuses a stage or task with no run to resolve it against', () => {
    /* Requirement rows are per-run, so an id without its run is not
       addressable and guessing a run would open the wrong cycle. */
    expect(destinationFromTabData({ stageId: 's', taskId: 'r' })).toBeNull()
    expect(destinationFromTabData({})).toBeNull()
    expect(destinationFromTabData(null)).toBeNull()
  })

  it('ignores non-string identifiers instead of coercing them', () => {
    expect(destinationFromTabData({ workflowId: 123 })).toBeNull()
    expect(destinationFromTabData({ workflowId: 'w', stageId: 5 })?.stageId).toBeNull()
  })

  it('builds the navigator key a process destination selects', () => {
    expect(processKey('w1')).toBe('process:w1')
  })
})

describe('an arrival is applied once', () => {
  it('applies a request that has not been consumed', () => {
    expect(shouldApplyArrival('req-1', null)).toBe(true)
    expect(shouldApplyArrival('req-2', 'req-1')).toBe(true)
  })

  it('does not re-apply the same request on a remount', () => {
    /* Tab data is durable; without this the reader is dragged back to the
       deep-linked requirement every time they return to the tab. */
    expect(shouldApplyArrival('req-1', 'req-1')).toBe(false)
  })

  it('does nothing without a request id', () => {
    expect(shouldApplyArrival(null, null)).toBe(false)
    expect(shouldApplyArrival(undefined, 'x')).toBe(false)
  })

  it('keys on the whole address, so a new target re-applies', () => {
    const a = arrivalKey({ workflowId: 'w', stageId: 's', requirementId: 'r1' }, 'req')
    const b = arrivalKey({ workflowId: 'w', stageId: 's', requirementId: 'r2' }, 'req')
    expect(a).not.toBe(b)
    expect(arrivalKey(null, 'req')).toBeNull()
  })
})
