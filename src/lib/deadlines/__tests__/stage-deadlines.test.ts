/**
 * Stage deadlines — ownership, keys, the org boundary, and the no-workflow case.
 *
 * Three bugs are covered here, from two lanes that fixed this module in
 * parallel. All three were silent.
 *
 *   · A pass added `organization_id` to every read and write of
 *     `asset_stage_deadlines`. That column does not exist, so the Command
 *     Center's deadline section, the timeline's deadline rendering, and
 *     setting or deleting a deadline all failed with `42703`.
 *   · The upsert's conflict target named `asset_id,stage_id`, which matches no
 *     unique index. The real one is `(asset_id, workflow_id, stage_id)`, so
 *     every save failed with `42P10` behind a generic alert.
 *   · No read, write or delete carried `workflow_id`, so a deadline could be
 *     read from or deleted across a different workflow than the one on screen,
 *     and saving invalidated `['asset-deadlines', assetId]` — a key no query
 *     uses — so the timeline kept showing the old value.
 *
 * Production's policies resolve a deadline's organization through its
 * workflow, which makes `workflow_id` load-bearing for authorization too: a
 * write without one is refused by the server.
 *
 * The source-scanning assertions at the bottom are the ones that would have
 * caught any of it. The pure helpers can be perfect while a call site still
 * names a column the database has never had, or sends the wrong conflict
 * target.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STAGE_DEADLINE_ORG_SELECT,
  STAGE_DEADLINE_ORG_FILTER,
  STAGE_DEADLINE_CONFLICT_TARGET,
  STAGE_DEADLINE_UNIQUE_COLUMNS,
  NO_WORKFLOW_MESSAGE,
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

const MANAGER = src('components/ui/StageDeadlineManager.tsx')
const TIMELINE = src('components/ui/InvestmentTimeline.tsx')

const input = {
  assetId: 'asset-1', workflowId: 'wf-1', stageId: 'research',
  deadlineDate: '2026-11-01', notes: 'check the filing', setBy: 'user-1',
}

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

  it('separates two workflows on the workflow-wide key', () => {
    expect(workflowDeadlinesKey('org-a', 'asset-1', 'wf-1'))
      .not.toEqual(workflowDeadlinesKey('org-a', 'asset-1', 'wf-2'))
  })

  it('distinguishes a missing org from the string "null"', () => {
    expect(stageDeadlineKey(undefined, 'asset-1', 'wf-1', 'research')[1]).toBeNull()
    expect(stageDeadlineKey(null, 'asset-1', 'wf-1', 'research')[1]).toBeNull()
  })

  it('distinguishes a missing workflow from the string "null"', () => {
    expect(stageDeadlineKey('org-a', 'asset-1', undefined, 'research')[3]).toBeNull()
  })
})

describe('an invalid workflow context', () => {
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
    // The guard is stricter than workflow alone: the read also filters on the
    // active organization through the embedded workflow, so firing before
    // currentOrgId resolves would send `organization_id=eq.undefined`.
    expect(MANAGER).toMatch(/enabled:[^\n]*!!workflowId/)
    expect(MANAGER).toMatch(/enabled:[^\n]*!!currentOrgId/)
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
    expect(MANAGER).toContain('onConflict: STAGE_DEADLINE_CONFLICT_TARGET')
    expect(MANAGER).not.toMatch(/onConflict:\s*['"]asset_id,stage_id['"]/)
  })

  it('the manager takes a workflow id as a prop', () => {
    // Optional, deliberately: the timeline's own workflowId is optional, and
    // the component answers an absent one with NO_WORKFLOW_MESSAGE rather
    // than offering a control whose save cannot succeed.
    expect(MANAGER).toMatch(/workflowId\??:\s*string/)
  })

  it('reads with the full unique key, so another workflow\'s deadline cannot surface', () => {
    const read = MANAGER.slice(MANAGER.indexOf('queryKey: stageDeadlineKey'))
    expect(read).toMatch(/\.eq\('asset_id', assetId\)/)
    expect(read).toMatch(/\.eq\('workflow_id', workflowId\)/)
    expect(read).toMatch(/\.eq\('stage_id', stageId\)/)
  })

  it('scopes the delete by workflow, not just asset and stage', () => {
    const del = MANAGER.slice(MANAGER.indexOf('deleteDeadlineMutation'))
    expect(del).toMatch(/\.delete\(\)[\s\S]{0,400}\.eq\('workflow_id', workflowId\)/)
  })

  it('the timeline passes its workflow down to the manager', () => {
    expect(TIMELINE).toMatch(/workflowId=\{workflowId/)
  })

  it('saving invalidates the key the timeline actually reads', () => {
    // It previously invalidated 'asset-deadlines', which no query uses, so a
    // saved deadline did not appear on the timeline until something else
    // refetched.
    expect(MANAGER).toContain('workflowDeadlinesKey(')
    expect(MANAGER).not.toMatch(/queryKey:\s*\[\s*['"]asset-deadlines['"]/)
  })

  it('the timeline reads under the shared key builder', () => {
    expect(TIMELINE).toContain('workflowDeadlinesKey(')
  })
})
