/**
 * The shared workflow summary.
 *
 * The rule every assertion here enforces: UNKNOWN IS NOT ZERO. The first
 * version of this summary reported null progress as "none running" and an
 * unfetched stage as "no open stage", and both read as statements of fact
 * about an asset that had a running process with an open stage.
 */
import { describe, it, expect } from 'vitest'
import {
  buildStageProgress, activeStage, nextDeadline, processStatus,
} from '../process-summary'

const stages = [{ id: 's1', name: 'Expectations' }, { id: 's2', name: 'Earnings Print' }]

describe('stage progress folds the checklist onto the stages', () => {
  const tpl = (stage_id: string, n: number) =>
    Array.from({ length: n }, () => ({ stage_id }))

  it('takes the TOTAL from the template, not from the saved rows', () => {
    /*
     * The defect this replaces: counting `asset_checklist_items` gave 0/0 for
     * a stage whose template holds four items and which the Process rail
     * showed as "0/4". Saved rows exist only for items somebody has touched.
     */
    const rows = buildStageProgress(stages, [], 's1', [...tpl('s1', 4), ...tpl('s2', 3)])
    expect(rows[0]).toMatchObject({ id: 's1', label: 'Expectations', done: 0, total: 4, active: true })
    expect(rows[1]).toMatchObject({ id: 's2', done: 0, total: 3, active: false })
  })

  it('counts completed against that total', () => {
    const rows = buildStageProgress(stages, [
      { stage_id: 's1', completed: true },
      { stage_id: 's1', completed: false },
    ], 's1', tpl('s1', 4))
    expect(rows[0]).toMatchObject({ done: 1, total: 4 })
  })

  it('counts "not applicable" as resolved, the way the Process surface does', () => {
    const rows = buildStageProgress(stages, [
      { stage_id: 's1', status: 'na' },
      { stage_id: 's1', status: 'completed' },
      { stage_id: 's1', status: 'unchecked' },
    ], null, tpl('s1', 3))
    expect(rows[0]).toMatchObject({ done: 2, total: 3 })
  })

  it('adds custom items to the total, since they have no template', () => {
    const rows = buildStageProgress(stages, [
      { stage_id: 's1', is_custom: true, completed: true },
    ], null, tpl('s1', 2))
    expect(rows[0]).toMatchObject({ done: 1, total: 3 })
  })

  it('never reports more done than total', () => {
    // A saved row for a template item that has since been removed.
    const rows = buildStageProgress(stages, [
      { stage_id: 's1', completed: true },
      { stage_id: 's1', completed: true },
    ], null, tpl('s1', 1))
    expect(rows[0]).toMatchObject({ done: 1, total: 1 })
  })

  it('reports a stage with no template and no items as 0/0, a real answer', () => {
    const rows = buildStageProgress(stages, [], null, [])
    expect(rows[0].done).toBe(0)
    expect(rows[0].total).toBe(0)
  })

  it('reports UNFETCHED items as null, never zero', () => {
    // The difference between "nothing to do" and "I have not looked".
    const rows = buildStageProgress(stages, undefined, 's1', [])
    expect(rows[0].done).toBeNull()
    expect(rows[0].total).toBeNull()
  })

  it('reports UNFETCHED templates as null too', () => {
    // Without the template the total is unknowable, not zero.
    const rows = buildStageProgress(stages, [], 's1', undefined)
    expect(rows[0].done).toBeNull()
    expect(rows[0].total).toBeNull()
  })

  it('returns no rows at all when the stages have not arrived', () => {
    expect(buildStageProgress(undefined, [], null, [])).toEqual([])
  })

  it('accepts the branch stage shape as well as the root one', () => {
    // A branch reads stages from workflow_template_versions as
    // stage_key/stage_label; a root workflow from workflow_stages.
    const rows = buildStageProgress(
      [{ id: 'k1', label: 'From template' }],
      [{ stage_id: 'k1', completed: true }],
      'k1',
      tpl('k1', 1),
    )
    expect(rows[0]).toMatchObject({ label: 'From template', done: 1, total: 1, active: true })
  })

  it('ignores rows with no stage rather than miscounting them', () => {
    const rows = buildStageProgress(
      stages,
      [{ stage_id: null, completed: true, is_custom: true }],
      null,
      [{ stage_id: null }],
    )
    expect(rows[0].total).toBe(0)
    expect(rows[0].done).toBe(0)
  })
})

describe('the active stage', () => {
  it('is the one the progress row names', () => {
    expect(activeStage(buildStageProgress(stages, [], 's2', []))?.id).toBe('s2')
  })

  it('is null when none is marked, so the caller can stay silent', () => {
    expect(activeStage(buildStageProgress(stages, [], null, []))).toBeNull()
  })

  it('is null when the stages have not arrived', () => {
    expect(activeStage(buildStageProgress(undefined, undefined, 's1', undefined))).toBeNull()
  })
})

describe('the next deadline', () => {
  const today = new Date('2026-10-21T12:00:00Z')

  it('is the nearest date that has not passed', () => {
    expect(nextDeadline([
      { deadline_date: '2026-12-01' }, { deadline_date: '2026-11-01' },
    ], today)).toBe('2026-11-01')
  })

  it('includes today', () => {
    expect(nextDeadline([{ deadline_date: '2026-10-21' }], today)).toBe('2026-10-21')
  })

  it('excludes the past, because "next" means next', () => {
    expect(nextDeadline([{ deadline_date: '2026-01-01' }], today)).toBeNull()
  })

  it('is null when unfetched and when empty alike — neither invents a date', () => {
    expect(nextDeadline(undefined, today)).toBeNull()
    expect(nextDeadline([], today)).toBeNull()
  })
})

describe('status separates "no workflow" from "not loaded"', () => {
  it('is none only when there is genuinely no workflow', () => {
    expect(processStatus(null, undefined)).toBe('none')
    expect(processStatus(undefined, [])).toBe('none')
  })

  it('is loading when a workflow exists but its stages have not arrived', () => {
    // This is the case that previously rendered "none running".
    expect(processStatus('wf-1', undefined)).toBe('loading')
  })

  it('is ready once the stages are here, even if there are none', () => {
    expect(processStatus('wf-1', [])).toBe('ready')
  })
})
