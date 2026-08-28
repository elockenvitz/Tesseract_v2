import { describe, expect, it } from 'vitest'
import {
  buildCsvCoverageRecords,
  type CsvCoverageRow,
} from '../csv-import'

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const IMPORTER = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const TODAY = '2026-08-28'

const row = (over: Partial<CsvCoverageRow> = {}): CsvCoverageRow => ({
  asset: { id: 'asset-1', symbol: 'AAA' },
  user: { id: 'analyst-1', name: 'Ada Lovelace' },
  orgNode: { id: 'node-1', node_type: 'team' },
  isFirm: false,
  start_date: '2026-01-15',
  end_date: '',
  notes: '',
  ...over,
})

const opts = { changedBy: IMPORTER, today: TODAY }

describe('buildCsvCoverageRecords — the fix', () => {
  it('stamps the current organization on every imported record', () => {
    const built = buildCsvCoverageRecords(
      ORG_A,
      [row(), row({ asset: { id: 'asset-2', symbol: 'BBB' } }), row({ asset: { id: 'asset-3', symbol: 'CCC' } })],
      opts,
    )

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.records).toHaveLength(3)
    expect(built.records.every(r => r.organization_id === ORG_A)).toBe(true)
  })

  /**
   * The regression this closes. A payload without the field walks through the
   * `organization_id IS NULL` branch the coverage policies still carry, and a
   * CSV import is the one path that can create hundreds of such rows at once.
   */
  it('never omits organization_id, on any row', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ asset: { id: `asset-${i}`, symbol: `S${i}` } }),
    )
    const built = buildCsvCoverageRecords(ORG_A, rows, opts)
    if (!built.ok) throw new Error('expected records')

    for (const r of built.records) {
      expect(r).toHaveProperty('organization_id')
      expect(r.organization_id).toBe(ORG_A)
    }
  })

  it('gives every row of one import the same canonical organization', () => {
    const built = buildCsvCoverageRecords(
      ORG_A,
      [
        row({ user: { id: 'analyst-1', name: 'Ada' }, orgNode: { id: 'n1', node_type: 'team' } }),
        row({ user: { id: 'analyst-2', name: 'Grace' }, orgNode: { id: 'n2', node_type: 'division' } }),
        row({ isFirm: true, orgNode: null }),
      ],
      opts,
    )
    if (!built.ok) throw new Error('expected records')

    expect(new Set(built.records.map(r => r.organization_id))).toEqual(new Set([ORG_A]))
  })
})

describe('buildCsvCoverageRecords — fails closed', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('refuses to build records when the organization is %s', (_label, orgId) => {
    const built = buildCsvCoverageRecords(orgId as any, [row(), row()], opts)

    expect(built).toEqual({ ok: false, reason: 'no_organization' })
  })

  /**
   * The refusal has to come before any record exists, not after — a caller that
   * received a partial payload could insert it.
   */
  it('produces no records at all when it refuses', () => {
    const built = buildCsvCoverageRecords(null, [row(), row(), row()], opts)

    expect(built.ok).toBe(false)
    expect(built).not.toHaveProperty('records')
  })
})

describe('buildCsvCoverageRecords — the tenant cannot be influenced', () => {
  /**
   * `row.user` is the analyst being assigned, who may sit in a different
   * organization from the importer. `row.orgNode` selects a team within the
   * workspace, not the workspace. Neither may reach `organization_id`.
   */
  it('ignores the analyst named in the CSV', () => {
    const a = buildCsvCoverageRecords(ORG_A, [row({ user: { id: 'analyst-1', name: 'Ada' } })], opts)
    const b = buildCsvCoverageRecords(ORG_A, [row({ user: { id: 'other-analyst', name: 'Grace' } })], opts)
    if (!a.ok || !b.ok) throw new Error('expected records')

    expect(a.records[0].organization_id).toBe(ORG_A)
    expect(b.records[0].organization_id).toBe(ORG_A)
    expect(a.records[0].user_id).not.toBe(b.records[0].user_id)
  })

  it('ignores the org node the CSV row selects', () => {
    const built = buildCsvCoverageRecords(
      ORG_A,
      [row({ orgNode: { id: ORG_B, node_type: 'division' } })],
      opts,
    )
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].organization_id).toBe(ORG_A)
    expect(built.records[0].team_id).toBe(ORG_B) // carried as the team, not the tenant
  })

  /**
   * A CSV is user-supplied content. Even a row carrying a field literally named
   * `organization_id` must not reach the payload — the stamp is applied last,
   * so a smuggled value is overwritten rather than honoured.
   */
  it('cannot be overridden by an organization_id smuggled into a CSV row', () => {
    const hostile = { ...row(), organization_id: ORG_B } as unknown as CsvCoverageRow
    const built = buildCsvCoverageRecords(ORG_A, [hostile], opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].organization_id).toBe(ORG_A)
    expect(JSON.stringify(built.records)).not.toContain(ORG_B)
  })

  it('records the importer as changed_by, never the assigned analyst', () => {
    const built = buildCsvCoverageRecords(ORG_A, [row()], opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].changed_by).toBe(IMPORTER)
    expect(built.records[0].changed_by).not.toBe(built.records[0].user_id)
  })
})

describe('buildCsvCoverageRecords — existing payload and CSV behaviour unchanged', () => {
  it('produces exactly the fields the inline version produced', () => {
    const built = buildCsvCoverageRecords(ORG_A, [row({ end_date: '2026-12-31', notes: 'handover' })], opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0]).toEqual({
      asset_id: 'asset-1',
      user_id: 'analyst-1',
      analyst_name: 'Ada Lovelace',
      team_id: 'node-1',
      visibility: 'team',
      start_date: '2026-01-15',
      end_date: '2026-12-31',
      notes: 'handover',
      changed_by: IMPORTER,
      organization_id: ORG_A,
    })
  })

  it('carries no field beyond the ten it declares', () => {
    const built = buildCsvCoverageRecords(ORG_A, [row()], opts)
    if (!built.ok) throw new Error('expected records')

    expect(Object.keys(built.records[0]).sort()).toEqual([
      'analyst_name', 'asset_id', 'changed_by', 'end_date', 'notes',
      'organization_id', 'start_date', 'team_id', 'user_id', 'visibility',
    ])
  })

  it('still falls back to today when the start_date cell is blank', () => {
    const built = buildCsvCoverageRecords(ORG_A, [row({ start_date: '' })], opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].start_date).toBe(TODAY)
  })

  it('still maps blank end_date and notes cells to null', () => {
    const built = buildCsvCoverageRecords(ORG_A, [row({ end_date: '', notes: '' })], opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].end_date).toBeNull()
    expect(built.records[0].notes).toBeNull()
  })

  it('still writes firm-wide rows with no team and firm visibility', () => {
    const built = buildCsvCoverageRecords(ORG_A, [row({ isFirm: true, orgNode: null })], opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].team_id).toBeNull()
    expect(built.records[0].visibility).toBe('firm')
  })

  it.each([
    ['division', 'division'],
    ['department', 'division'],
    ['team', 'team'],
    ['portfolio', 'team'],
  ])('still maps node type %s to visibility %s', (nodeType, expected) => {
    const built = buildCsvCoverageRecords(
      ORG_A, [row({ orgNode: { id: 'n', node_type: nodeType } })], opts,
    )
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].visibility).toBe(expected)
  })

  it('still maps a missing org node to a null team', () => {
    const built = buildCsvCoverageRecords(ORG_A, [row({ orgNode: null })], opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records[0].team_id).toBeNull()
  })
})

describe('buildCsvCoverageRecords — one record per row, no extra writes', () => {
  it('emits exactly one record per CSV row, in order', () => {
    const rows = ['a', 'b', 'c', 'd'].map(id => row({ asset: { id, symbol: id.toUpperCase() } }))
    const built = buildCsvCoverageRecords(ORG_A, rows, opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records).toHaveLength(4)
    expect(built.records.map(r => r.asset_id)).toEqual(['a', 'b', 'c', 'd'])
  })

  /**
   * A pure map: it neither invents rows nor collapses duplicates. The import
   * issues one insert with exactly this many records, so the row count the user
   * was shown in the progress message is the row count that reaches the table.
   */
  it('does not deduplicate or expand rows', () => {
    const dupes = [row(), row(), row()] // identical rows
    const built = buildCsvCoverageRecords(ORG_A, dupes, opts)
    if (!built.ok) throw new Error('expected records')

    expect(built.records).toHaveLength(3)
  })

  it('maps an empty import to an empty payload rather than refusing', () => {
    const built = buildCsvCoverageRecords(ORG_A, [], opts)

    expect(built).toEqual({ ok: true, records: [] })
  })
})
