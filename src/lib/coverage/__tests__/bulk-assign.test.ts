import { describe, expect, it } from 'vitest'
import {
  BULK_ASSIGN_REFUSAL_MESSAGE,
  buildBulkCoverageRecords,
  type BulkAssignInput,
} from '../bulk-assign'

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const ANALYST = 'cccccccc-3333-4333-8333-cccccccccccc'
const OTHER_ANALYST = 'dddddddd-4444-4444-8444-dddddddddddd'
const ACTOR = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const TEAM = 'ffffffff-6666-4666-8666-ffffffffffff'

const base = (over: Partial<BulkAssignInput> = {}): BulkAssignInput => ({
  organizationId: ORG_A,
  assetIds: ['asset-1', 'asset-2'],
  analystId: ANALYST,
  analystName: 'Ada Lovelace',
  groupId: TEAM,
  nodeType: 'team',
  startDate: '2026-08-28',
  changedBy: ACTOR,
  ...over,
})

describe('buildBulkCoverageRecords — the fix', () => {
  it('stamps the current organization on every record', () => {
    const built = buildBulkCoverageRecords(base())

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.records).toHaveLength(2)
    expect(built.records.every(r => r.organization_id === ORG_A)).toBe(true)
  })

  /**
   * The regression this whole branch exists to prevent. A payload without the
   * field walks straight through the `organization_id IS NULL` branch that the
   * coverage INSERT policy still carries, producing a row readable by every
   * active member of every organization.
   */
  it('never omits organization_id', () => {
    const built = buildBulkCoverageRecords(base())
    if (!built.ok) throw new Error('expected records')

    for (const r of built.records) {
      expect(r).toHaveProperty('organization_id')
      expect(r.organization_id).toBeTruthy()
    }
  })
})

describe('buildBulkCoverageRecords — fails closed', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('refuses to build records when the organization is %s', (_label, orgId) => {
    const built = buildBulkCoverageRecords(base({ organizationId: orgId as any }))

    expect(built).toEqual({ ok: false, reason: 'no_organization' })
  })

  /**
   * An unknown tenant is not a payload problem to be reported after the other
   * validations pass — it is checked first, so a caller cannot reach a
   * different refusal and conclude the organization was fine.
   */
  it('reports no_organization even when the rest of the input is also invalid', () => {
    const built = buildBulkCoverageRecords(
      base({ organizationId: null, analystId: '', groupId: null, assetIds: [] }),
    )

    expect(built).toEqual({ ok: false, reason: 'no_organization' })
  })

  it('refuses an incomplete selection', () => {
    expect(buildBulkCoverageRecords(base({ analystId: '' })))
      .toEqual({ ok: false, reason: 'incomplete_selection' })
    expect(buildBulkCoverageRecords(base({ groupId: null })))
      .toEqual({ ok: false, reason: 'incomplete_selection' })
  })

  it('refuses when nothing is selected', () => {
    expect(buildBulkCoverageRecords(base({ assetIds: [] })))
      .toEqual({ ok: false, reason: 'no_assets' })
  })

  it('has a message for every refusal, so none can reach the user unexplained', () => {
    for (const reason of ['no_organization', 'no_assets', 'incomplete_selection'] as const) {
      expect(BULK_ASSIGN_REFUSAL_MESSAGE[reason]).toBeTruthy()
    }
  })
})

describe('buildBulkCoverageRecords — the tenant cannot be influenced', () => {
  /**
   * The analyst being assigned is a different person from the caller and may
   * belong to a different organization. Their identity must not reach
   * `organization_id` by any route — which is why the input carries them as two
   * opaque strings and holds no user object at all.
   */
  it('ignores the selected analyst entirely when stamping the tenant', () => {
    const a = buildBulkCoverageRecords(base({ analystId: ANALYST, analystName: 'Ada' }))
    const b = buildBulkCoverageRecords(
      base({ analystId: OTHER_ANALYST, analystName: 'Grace' }),
    )
    if (!a.ok || !b.ok) throw new Error('expected records')

    expect(a.records[0].organization_id).toBe(ORG_A)
    expect(b.records[0].organization_id).toBe(ORG_A)
    expect(a.records[0].user_id).not.toBe(b.records[0].user_id)
  })

  it('writes exactly the organization it was given and no other', () => {
    const built = buildBulkCoverageRecords(base({ organizationId: ORG_B }))
    if (!built.ok) throw new Error('expected records')

    expect(built.records.every(r => r.organization_id === ORG_B)).toBe(true)
    expect(JSON.stringify(built.records)).not.toContain(ORG_A)
  })
})

describe('buildBulkCoverageRecords — existing payload is unchanged', () => {
  it('produces the same fields the inline version produced', () => {
    const built = buildBulkCoverageRecords(base())
    if (!built.ok) throw new Error('expected records')

    // organization_id is the only addition; every other key and value is what
    // handleBulkAssign built before this change.
    expect(built.records[0]).toEqual({
      asset_id: 'asset-1',
      user_id: ANALYST,
      analyst_name: 'Ada Lovelace',
      team_id: TEAM,
      visibility: 'team',
      start_date: '2026-08-28',
      changed_by: ACTOR,
      organization_id: ORG_A,
    })
  })

  it('carries no field beyond the eight it declares', () => {
    const built = buildBulkCoverageRecords(base())
    if (!built.ok) throw new Error('expected records')

    expect(Object.keys(built.records[0]).sort()).toEqual([
      'analyst_name', 'asset_id', 'changed_by', 'organization_id',
      'start_date', 'team_id', 'user_id', 'visibility',
    ])
  })

  it('keeps the firm-wide shape: no team, firm visibility', () => {
    const built = buildBulkCoverageRecords(base({ groupId: '__firm__', nodeType: null }))
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].team_id).toBeNull()
    expect(built.records[0].visibility).toBe('firm')
    expect(built.records[0].organization_id).toBe(ORG_A)
  })

  it.each([
    ['division', 'division'],
    ['department', 'division'],
    ['team', 'team'],
    [null, 'team'],
  ])('maps node type %s to visibility %s', (nodeType, expected) => {
    const built = buildBulkCoverageRecords(base({ nodeType: nodeType as string | null }))
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].visibility).toBe(expected)
  })

  it('normalises a missing actor to null rather than dropping the key', () => {
    const built = buildBulkCoverageRecords(base({ changedBy: undefined }))
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0]).toHaveProperty('changed_by', null)
  })
})

describe('buildBulkCoverageRecords — one record per asset, no duplicates', () => {
  it('emits exactly one record per selected asset, in order', () => {
    const built = buildBulkCoverageRecords(
      base({ assetIds: ['a', 'b', 'c'] }),
    )
    if (!built.ok) throw new Error('expected records')

    expect(built.records).toHaveLength(3)
    expect(built.records.map(r => r.asset_id)).toEqual(['a', 'b', 'c'])
  })

  /**
   * The component passes `Array.from(selectedGapAssets)` — a Set, so it cannot
   * contain duplicates. This pins the builder's own behaviour: it is a pure
   * map, so it neither invents nor collapses rows, and the caller's row count
   * is exactly what reaches the database in a single insert.
   */
  it('is a pure map over the input, adding no extra writes', () => {
    const assetIds = Array.from({ length: 25 }, (_, i) => `asset-${i}`)
    const built = buildBulkCoverageRecords(base({ assetIds }))
    if (!built.ok) throw new Error('expected records')

    expect(built.records).toHaveLength(25)
    expect(new Set(built.records.map(r => r.asset_id)).size).toBe(25)
  })
})
