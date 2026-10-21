/**
 * Stage deadlines — the unique key, the workflow, and the query keys.
 *
 * What was wrong on main, all three silent:
 *
 *   · the upsert named `asset_id,stage_id`, which matches no unique index, so
 *     every save failed with 42P10 and the UI showed a generic alert;
 *   · no read, write or delete carried `workflow_id`, so a deadline could be
 *     read from or deleted across a different workflow than the one on screen;
 *   · saving invalidated `['asset-deadlines', assetId]`, a key no query uses,
 *     so the timeline kept showing the old value.
 *
 * Production's policies now resolve a deadline's organization through its
 * workflow, which makes `workflow_id` load-bearing for authorization too: a
 * write without one is refused by the server.
 *
 * The source-scanning assertions are the ones that would have caught any of
 * it. The pure helpers can be perfect while a call site still sends the wrong
 * conflict target.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STAGE_DEADLINE_CONFLICT_TARGET,
  STAGE_DEADLINE_UNIQUE_COLUMNS,
  NO_WORKFLOW_MESSAGE,
  buildStageDeadlineRow,
  stageDeadlineKey,
  workflowDeadlinesKey,
} from '../stage-deadlines'

const root = join(__dirname, '..', '..', '..')
const src = (f: string) => readFileSync(join(root, f), 'utf8')
const MANAGER = src('components/ui/StageDeadlineManager.tsx')
const TIMELINE = src('components/ui/InvestmentTimeline.tsx')

describe('the conflict target matches the real unique constraint', () => {
  it('is exactly (asset_id, workflow_id, stage_id)', () => {
    // Verified against production:
    // asset_stage_deadlines_asset_id_workflow_id_stage_id_key
    expect(STAGE_DEADLINE_CONFLICT_TARGET).toBe('asset_id,workflow_id,stage_id')
  })

  it('is derived from the same column list the lookups use, so they cannot drift', () => {
    expect(STAGE_DEADLINE_CONFLICT_TARGET.split(',')).toEqual([...STAGE_DEADLINE_UNIQUE_COLUMNS])
  })

  it('includes workflow_id — one asset at one stage has a deadline per workflow', () => {
    expect(STAGE_DEADLINE_UNIQUE_COLUMNS).toContain('workflow_id')
  })

  it('the manager upserts on the shared target, never the two-column literal', () => {
    expect(MANAGER).toContain('onConflict: STAGE_DEADLINE_CONFLICT_TARGET')
    expect(MANAGER).not.toMatch(/onConflict:\s*['"]asset_id,stage_id['"]/)
  })
})

describe('creating and editing a deadline', () => {
  const input = {
    assetId: 'asset-1', workflowId: 'wf-1', stageId: 'research',
    deadlineDate: '2026-11-01', notes: 'check the filing', setBy: 'user-1',
  }

  it('builds a row carrying the workflow, which is both the key and the tenant anchor', () => {
    expect(buildStageDeadlineRow(input)).toMatchObject({
      asset_id: 'asset-1', workflow_id: 'wf-1', stage_id: 'research',
      deadline_date: '2026-11-01', notes: 'check the filing', set_by: 'user-1',
    })
  })

  it('never writes organization_id — the column does not exist on this table', () => {
    expect(Object.keys(buildStageDeadlineRow(input))).not.toContain('organization_id')
  })

  it('normalises empty notes to null rather than storing an empty string', () => {
    expect(buildStageDeadlineRow({ ...input, notes: '' }).notes).toBeNull()
  })

  it('reads with the full unique key, so another workflow\'s deadline cannot surface', () => {
    const read = MANAGER.slice(MANAGER.indexOf('queryKey: stageDeadlineKey'))
    expect(read).toMatch(/\.eq\('asset_id', assetId\)/)
    expect(read).toMatch(/\.eq\('workflow_id', workflowId\)/)
    expect(read).toMatch(/\.eq\('stage_id', stageId\)/)
  })
})

describe('deleting a deadline', () => {
  it('scopes the delete by workflow, not just asset and stage', () => {
    const del = MANAGER.slice(MANAGER.indexOf('deleteDeadlineMutation'))
    expect(del).toMatch(/\.delete\(\)[\s\S]{0,200}\.eq\('workflow_id', workflowId\)/)
  })
})

describe('an invalid workflow context', () => {
  it('refuses to build a row instead of inserting a duplicate', () => {
    expect(() => buildStageDeadlineRow({ ...input0, workflowId: '' }))
      .toThrow(/workflowId is required/)
  })

  it('explains itself in the user\'s terms rather than saying "error"', () => {
    expect(NO_WORKFLOW_MESSAGE).toMatch(/workflow/i)
    expect(NO_WORKFLOW_MESSAGE).not.toMatch(/error|failed|invalid/i)
  })

  it('renders the explanation instead of a control that cannot succeed', () => {
    expect(MANAGER).toContain('stage-deadline-no-workflow')
    expect(MANAGER).toMatch(/if \(!workflowId\) \{[\s\S]{0,400}NO_WORKFLOW_MESSAGE/)
  })

  it('blocks the save before the request rather than inventing an id', () => {
    const save = MANAGER.slice(MANAGER.indexOf('const handleSave'))
    expect(save.slice(0, 500)).toMatch(/if \(!workflowId\) return/)
    // Nothing anywhere may conjure a workflow id to satisfy the key.
    expect(MANAGER).not.toMatch(/workflowId\s*\|\|\s*['"]/)
    expect(MANAGER).not.toMatch(/workflowId\s*\?\?\s*['"]/)
  })

  it('does not query for a deadline it cannot identify', () => {
    expect(MANAGER).toMatch(/enabled: !!workflowId/)
  })
})

describe('query keys', () => {
  it('separates two workflows for the same asset and stage', () => {
    expect(stageDeadlineKey('asset-1', 'wf-1', 'research'))
      .not.toEqual(stageDeadlineKey('asset-1', 'wf-2', 'research'))
  })

  it('distinguishes a missing workflow from the string "null"', () => {
    expect(stageDeadlineKey('asset-1', undefined, 'research')[2]).toBeNull()
  })

  it('separates workflows on the asset-wide key too', () => {
    expect(workflowDeadlinesKey('asset-1', 'wf-1'))
      .not.toEqual(workflowDeadlinesKey('asset-1', 'wf-2'))
  })

  it('saving invalidates the key the timeline actually reads', () => {
    expect(MANAGER).toContain('workflowDeadlinesKey(assetId, workflowId)')
    expect(MANAGER).not.toMatch(/queryKey:\s*\[\s*['"]asset-deadlines['"]/)
  })

  it('the timeline reads under that same builder', () => {
    expect(TIMELINE).toContain('workflowDeadlinesKey(assetId, workflowId)')
    expect(TIMELINE).not.toMatch(/queryKey:\s*\[\s*['"]asset-workflow-deadlines['"]/)
  })

  it('the timeline passes its workflow down to the manager', () => {
    expect(TIMELINE).toMatch(/workflowId=\{workflowId\}/)
  })
})

describe('the client does not re-implement the server boundary', () => {
  it('never filters this table on an organization_id it does not have', () => {
    for (const [name, body] of [['manager', MANAGER], ['timeline', TIMELINE]] as const) {
      const deadlineCalls = body.split("from('asset_stage_deadlines')").slice(1)
      for (const call of deadlineCalls) {
        expect(call.slice(0, 400), `${name} filters a deadline organization_id`)
          .not.toMatch(/\.eq\(\s*['"]organization_id['"]/)
      }
    }
  })
})

const input0 = {
  assetId: 'asset-1', workflowId: 'wf-1', stageId: 'research',
  deadlineDate: '2026-11-01', notes: null, setBy: null,
}
