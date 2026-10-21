/**
 * Stage deadlines — ownership, keys, and the org boundary.
 *
 * The bug these cover: a pass added `organization_id` to every read and write
 * of `asset_stage_deadlines`. That column does not exist, so the Command
 * Center's deadline section, the timeline's deadline rendering, and setting or
 * deleting a deadline all failed with `42703`. The upsert's conflict target
 * was separately wrong — `asset_id,stage_id` matches no unique index, and the
 * real one is `(asset_id, workflow_id, stage_id)`.
 *
 * The source-scanning assertions at the bottom are the ones that would have
 * caught it: the pure helpers can be perfect while a call site still names a
 * column the database has never had.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STAGE_DEADLINE_ORG_SELECT,
  STAGE_DEADLINE_ORG_FILTER,
  STAGE_DEADLINE_CONFLICT_TARGET,
  STAGE_DEADLINE_UNIQUE_COLUMNS,
  buildStageDeadlineRow,
  stageDeadlineKey,
  workflowDeadlinesKey,
} from '../stage-deadlines'

const root = join(__dirname, '..', '..', '..')
const src = (f: string) => readFileSync(join(root, f), 'utf8')

const CALL_SITES = [
  'components/ui/StageDeadlineManager.tsx',
  'components/ui/InvestmentTimeline.tsx',
  'hooks/useCommandCenter.ts',
]

describe('the conflict target matches the real unique constraint', () => {
  it('is exactly (asset_id, workflow_id, stage_id)', () => {
    // Verified against production: asset_stage_deadlines_asset_id_workflow_id_stage_id_key.
    expect(STAGE_DEADLINE_CONFLICT_TARGET).toBe('asset_id,workflow_id,stage_id')
  })

  it('is derived from the same column list the lookups use, so they cannot drift', () => {
    expect(STAGE_DEADLINE_CONFLICT_TARGET.split(',')).toEqual([...STAGE_DEADLINE_UNIQUE_COLUMNS])
  })

  it('includes workflow_id — the same asset and stage under two workflows are two rows', () => {
    expect(STAGE_DEADLINE_UNIQUE_COLUMNS).toContain('workflow_id')
  })
})

describe('the row written to the table', () => {
  const input = {
    assetId: 'asset-1', workflowId: 'wf-1', stageId: 'research',
    deadlineDate: '2026-11-01', notes: 'check the filing', setBy: 'user-1',
  }

  it('carries the workflow id, which is both the tenant anchor and part of the key', () => {
    expect(buildStageDeadlineRow(input)).toMatchObject({
      asset_id: 'asset-1', workflow_id: 'wf-1', stage_id: 'research',
      deadline_date: '2026-11-01', notes: 'check the filing', set_by: 'user-1',
    })
  })

  it('never writes organization_id — the column does not exist', () => {
    expect(Object.keys(buildStageDeadlineRow(input))).not.toContain('organization_id')
  })

  it('refuses to build a row with no workflow, rather than inserting a duplicate', () => {
    // Without it the upsert cannot match the unique key, so a second save
    // would add a row instead of replacing the first.
    expect(() => buildStageDeadlineRow({ ...input, workflowId: '' }))
      .toThrow(/workflowId is required/)
  })

  it('normalises empty notes to null rather than storing an empty string', () => {
    expect(buildStageDeadlineRow({ ...input, notes: '' }).notes).toBeNull()
  })
})

describe('tenant scope travels through the workflow', () => {
  it('filters on the embedded workflow, not on a column of the deadline table', () => {
    expect(STAGE_DEADLINE_ORG_FILTER).toBe('workflows.organization_id')
    expect(STAGE_DEADLINE_ORG_FILTER.startsWith('workflows.')).toBe(true)
  })

  it('embeds the workflow with !inner so the filter restricts the parent rows', () => {
    // A left join would null the embedded object and still return the
    // deadline — the filter would read as applied while leaking every org's.
    expect(STAGE_DEADLINE_ORG_SELECT).toContain('workflows!inner')
    expect(STAGE_DEADLINE_ORG_SELECT).toContain('organization_id')
  })
})

describe('query keys keep organizations apart', () => {
  it('gives two organizations different keys for the same stage', () => {
    const a = stageDeadlineKey('org-a', 'asset-1', 'wf-1', 'research')
    const b = stageDeadlineKey('org-b', 'asset-1', 'wf-1', 'research')
    expect(a).not.toEqual(b)
  })

  it('gives two workflows different keys for the same asset and stage', () => {
    expect(stageDeadlineKey('org-a', 'asset-1', 'wf-1', 'research'))
      .not.toEqual(stageDeadlineKey('org-a', 'asset-1', 'wf-2', 'research'))
  })

  it('puts the org before the asset so an org switch cannot serve a cached row', () => {
    const key = stageDeadlineKey('org-a', 'asset-1', 'wf-1', 'research')
    expect(key.indexOf('org-a')).toBeLessThan(key.indexOf('asset-1'))
  })

  it('separates organizations on the workflow-wide key too', () => {
    expect(workflowDeadlinesKey('org-a', 'asset-1', 'wf-1'))
      .not.toEqual(workflowDeadlinesKey('org-b', 'asset-1', 'wf-1'))
  })

  it('distinguishes a missing org from the string "null"', () => {
    expect(stageDeadlineKey(undefined, 'asset-1', 'wf-1', 'research')[1]).toBeNull()
    expect(stageDeadlineKey(null, 'asset-1', 'wf-1', 'research')[1]).toBeNull()
  })
})

describe('the call sites agree with the schema', () => {
  it.each(CALL_SITES)('%s never filters or writes a deadline organization_id', file => {
    const body = src(file)
    // The phantom column, in either the filter or the payload form. The
    // workflow-qualified path is the legitimate one and is excluded.
    const phantom = /(\.eq\(\s*['"]organization_id['"]|organization_id:\s*currentOrgId)/g
    const offenders = (body.match(phantom) ?? [])
    expect(offenders, `${file} still references a deadline organization_id`).toEqual([])
  })

  it.each(CALL_SITES)('%s scopes deadlines through the workflow', file => {
    expect(src(file)).toContain('STAGE_DEADLINE_ORG_FILTER')
  })

  it('the manager upserts on the shared conflict target, not a literal', () => {
    const body = src('components/ui/StageDeadlineManager.tsx')
    expect(body).toContain('onConflict: STAGE_DEADLINE_CONFLICT_TARGET')
    expect(body).not.toMatch(/onConflict:\s*['"]asset_id,stage_id['"]/)
  })

  it('the manager requires a workflow id as a prop', () => {
    expect(src('components/ui/StageDeadlineManager.tsx')).toMatch(/workflowId:\s*string/)
  })

  it('the timeline passes its workflow down to the manager', () => {
    expect(src('components/ui/InvestmentTimeline.tsx')).toMatch(/workflowId=\{workflowId/)
  })

  it('saving invalidates the key the timeline actually reads', () => {
    // It previously invalidated 'asset-deadlines', which no query uses, so a
    // saved deadline did not appear on the timeline until something else
    // refetched.
    const body = src('components/ui/StageDeadlineManager.tsx')
    expect(body).toContain('workflowDeadlinesKey(')
    expect(body).not.toMatch(/queryKey:\s*\[\s*['"]asset-deadlines['"]/)
  })

  it('the timeline reads under the shared key builder', () => {
    expect(src('components/ui/InvestmentTimeline.tsx')).toContain('workflowDeadlinesKey(')
  })
})
