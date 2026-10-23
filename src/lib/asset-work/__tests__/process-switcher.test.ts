/**
 * What the switcher offers, and what it must never offer.
 *
 * The failures this guards are navigational: sending someone to a cycle
 * that is not this process's, offering to "add" a process already running,
 * or inviting a return to a current cycle that does not exist.
 */
import { describe, it, expect } from 'vitest'
import {
  groupProcesses, splitProcessRun, type SwitcherRunRow,
} from '../process-switcher'

const run = (
  id: string,
  over: Partial<SwitcherRunRow['workflows']> & { completed?: boolean; at?: string } = {},
): SwitcherRunRow => {
  const { completed, at, ...wf } = over
  return {
    workflow_id: id,
    is_completed: !!completed,
    is_started: true,
    created_at: at ?? '2026-01-01T00:00:00Z',
    workflows: {
      id,
      name: 'Earnings Season - Q2 2026',
      branch_suffix: 'Q2 2026',
      status: 'active',
      parent_workflow_id: null,
      archived: false,
      created_at: at ?? '2026-01-01T00:00:00Z',
      ...wf,
    },
  }
}

describe('splitProcessRun', () => {
  it('splits a name on the separator the builder emits', () => {
    expect(splitProcessRun('Earnings Season - Q2 2026', 'Q2 2026'))
      .toEqual({ name: 'Earnings Season', run: 'Q2 2026' })
  })

  it('does not print the run twice when the suffix is already in the name', () => {
    /* The bug this replaces rendered "Earnings Season - Q2 2026  Q2 2026". */
    const out = splitProcessRun('Earnings Season - Q2 2026', 'Q2 2026')
    expect(out.name).not.toContain(out.run!)
  })

  it('returns an unrecognised name whole rather than guessing', () => {
    expect(splitProcessRun('Quarterly Review', null))
      .toEqual({ name: 'Quarterly Review', run: null })
  })

  it('keeps a hyphenated process name intact when there is no suffix separator', () => {
    expect(splitProcessRun('Pre-Mortem', null).name).toBe('Pre-Mortem')
  })

  it('survives a missing name', () => {
    expect(splitProcessRun(null, 'Q1').name).toBe('Process')
  })
})

describe('groupProcesses', () => {
  it('states the open run instead of listing it as a choice', () => {
    const g = groupProcesses([run('a'), run('b', { name: 'Onboarding', branch_suffix: null })], 'a')
    expect(g.current?.workflowId).toBe('a')
    expect(g.active.map(e => e.workflowId)).not.toContain('a')
    expect(g.previousCycles.map(e => e.workflowId)).not.toContain('a')
  })

  it('counts only same-lineage runs as previous cycles', () => {
    /*
     * The grouping error worth catching: a finished Onboarding Review is
     * not a previous cycle of Earnings Season. Lineage is the root
     * workflow, not "anything completed".
     */
    const g = groupProcesses([
      run('cur', { at: '2026-04-10T00:00:00Z' }),
      run('prev', { parent_workflow_id: 'cur', completed: true, at: '2026-03-27T00:00:00Z' }),
      run('other', { name: 'Onboarding Review', branch_suffix: null, completed: true }),
    ], 'cur')

    expect(g.previousCycles.map(e => e.workflowId)).toEqual(['prev'])
    expect(g.otherCompleted.map(e => e.workflowId)).toEqual(['other'])
  })

  it('treats a sibling cycle as the same lineage as the open one', () => {
    /* Both runs are branches of one root, and neither IS the root. */
    const g = groupProcesses([
      run('apr', { parent_workflow_id: 'root', at: '2026-04-10T00:00:00Z' }),
      run('mar', { parent_workflow_id: 'root', completed: true, at: '2026-03-27T00:00:00Z' }),
    ], 'apr')
    expect(g.previousCycles.map(e => e.workflowId)).toEqual(['mar'])
  })

  it('orders cycles newest first', () => {
    const g = groupProcesses([
      run('cur', { at: '2026-04-10T00:00:00Z' }),
      run('old', { parent_workflow_id: 'cur', completed: true, at: '2026-02-01T00:00:00Z' }),
      run('mid', { parent_workflow_id: 'cur', completed: true, at: '2026-03-27T00:00:00Z' }),
    ], 'cur')
    expect(g.previousCycles.map(e => e.workflowId)).toEqual(['mid', 'old'])
  })

  it('offers a way back only when a live cycle exists to go back to', () => {
    const stranded = groupProcesses([
      run('cur', { completed: true }),
      run('older', { parent_workflow_id: 'cur', completed: true, at: '2026-01-01T00:00:00Z' }),
    ], 'cur')
    expect(stranded.viewingPast).toBe(true)
    expect(stranded.returnTo).toBeNull()

    const hasLive = groupProcesses([
      run('cur', { completed: true, at: '2026-03-27T00:00:00Z' }),
      run('live', { parent_workflow_id: 'cur', at: '2026-04-10T00:00:00Z' }),
    ], 'cur')
    expect(hasLive.returnTo?.workflowId).toBe('live')
  })

  it('never offers to add a process the asset already runs', () => {
    const g = groupProcesses(
      [run('a')],
      'a',
      [{ id: 'a', name: 'Earnings Season' }, { id: 'z', name: 'Pre-Mortem' }],
    )
    expect(g.joinable.map(j => j.id)).toEqual(['z'])
  })

  it('hides archived runs entirely', () => {
    const g = groupProcesses([run('a'), run('gone', { archived: true })], 'a')
    expect([...g.active, ...g.previousCycles, ...g.otherCompleted]
      .map(e => e.workflowId)).not.toContain('gone')
  })

  it('still groups when nothing is open yet', () => {
    const g = groupProcesses([run('a'), run('b', { completed: true })], null)
    expect(g.current).toBeNull()
    expect(g.previousCycles).toEqual([])
    expect(g.active.map(e => e.workflowId)).toEqual(['a'])
    expect(g.otherCompleted.map(e => e.workflowId)).toEqual(['b'])
  })

  it('puts an ended process under finished, not among the live ones', () => {
    const g = groupProcesses([
      run('a'),
      run('dead', { name: 'Retired Process', branch_suffix: null, status: 'ended' }),
    ], 'a')
    expect(g.active.map(e => e.workflowId)).toEqual([])
    expect(g.otherCompleted.map(e => e.workflowId)).toEqual(['dead'])
  })
})
