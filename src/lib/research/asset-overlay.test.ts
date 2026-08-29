/**
 * The organisation overlay is what makes saved screens keep working after C1
 * moved eight columns off the global `assets` row. These tests pin the two
 * things that matter: the merge preserves screen semantics, and it fails closed.
 *
 * The Supabase client is mocked at the module boundary rather than hit for real
 * — the tenant boundary itself is proven behaviourally against a live database
 * by `scripts/sql/security-c1/90-synthetic-matrix.sql` (77 cases, including
 * cross-org and multi-org callers). What is worth asserting HERE is the part
 * SQL cannot see: that the client asks the right questions, merges the answers
 * onto the right fields, and asks nothing at all when it has no organisation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Records every query the module builds, so the test can assert on the filters. */
const queries: Array<{ table: string; filters: Record<string, unknown> }> = []

function builder(table: string, rows: unknown[]) {
  const record = { table, filters: {} as Record<string, unknown> }
  queries.push(record)
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => { record.filters[col] = val; return chain },
    in: (col: string, val: unknown) => { record.filters[col] = val; return chain },
    order: () => chain,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  }
  return chain
}

const tables: Record<string, unknown[]> = {}

vi.mock('../supabase', () => ({
  supabase: { from: (t: string) => builder(t, tables[t] ?? []) },
}))

const { fetchAssetOverlays, applyAssetOverlay, EMPTY_OVERLAY } = await import('./asset-overlay')

const ORG_A = 'org-a'
const ASSET = 'asset-1'

beforeEach(() => {
  queries.length = 0
  for (const k of Object.keys(tables)) delete tables[k]
})

describe('fetchAssetOverlays', () => {
  it('scopes every proprietary query to the organisation', async () => {
    tables.asset_contributions = []
    tables.workflows = []
    tables.asset_workflow_priorities = []

    await fetchAssetOverlays([ASSET], ORG_A)

    const contributions = queries.find(q => q.table === 'asset_contributions')
    expect(contributions?.filters.organization_id).toBe(ORG_A)
    const workflows = queries.find(q => q.table === 'workflows')
    expect(workflows?.filters.organization_id).toBe(ORG_A)
  })

  it('issues no query at all without an organisation', async () => {
    const out = await fetchAssetOverlays([ASSET], null)
    // Fails closed. The important half is `queries` being empty: an unscoped
    // read that RLS happens to filter is still an unscoped read.
    expect(out.size).toBe(0)
    expect(queries).toHaveLength(0)
  })

  it('issues no query for an empty asset list', async () => {
    const out = await fetchAssetOverlays([], ORG_A)
    expect(out.size).toBe(0)
    expect(queries).toHaveLength(0)
  })

  it('maps contribution sections onto the legacy field names', async () => {
    tables.asset_contributions = [
      { asset_id: ASSET, section: 'thesis', content: 'operating leverage', updated_at: '2026-08-02' },
      { asset_id: ASSET, section: 'where_different', content: 'consensus too low', updated_at: '2026-08-02' },
      { asset_id: ASSET, section: 'risks_to_thesis', content: 'input costs', updated_at: '2026-08-02' },
      { asset_id: ASSET, section: 'quick_note', content: 'watch Q3', updated_at: '2026-08-03' },
    ]
    tables.workflows = []
    tables.asset_workflow_priorities = []

    const o = (await fetchAssetOverlays([ASSET], ORG_A)).get(ASSET)!
    expect(o.thesis).toBe('operating leverage')
    expect(o.where_different).toBe('consensus too low')
    expect(o.risks_to_thesis).toBe('input costs')
    expect(o.quick_note).toBe('watch Q3')
    expect(o.quick_note_updated_at).toBe('2026-08-03')
  })

  it('takes the most recent contribution per section', async () => {
    // Contributions are one row per author per section, where the column held
    // one value. Newest wins, matching the asset page's collapsed view.
    tables.asset_contributions = [
      { asset_id: ASSET, section: 'thesis', content: 'newer', updated_at: '2026-08-05' },
      { asset_id: ASSET, section: 'thesis', content: 'older', updated_at: '2026-01-01' },
    ]
    tables.workflows = []
    tables.asset_workflow_priorities = []

    const o = (await fetchAssetOverlays([ASSET], ORG_A)).get(ASSET)!
    expect(o.thesis).toBe('newer')
  })

  it('ignores priorities belonging to another organisation\'s workflow', async () => {
    // asset_workflow_priorities carries no organization_id; its tenant is the
    // workflow's. A row whose workflow is not in this org's set must not leak.
    tables.asset_contributions = []
    tables.workflows = [{ id: 'wf-a' }]
    tables.asset_workflow_priorities = [
      { asset_id: ASSET, workflow_id: 'wf-foreign', priority: 'critical' },
    ]

    const o = (await fetchAssetOverlays([ASSET], ORG_A)).get(ASSET)
    expect(o?.priority ?? null).toBeNull()
  })

  it('accepts a priority from this organisation\'s workflow', async () => {
    tables.asset_contributions = []
    tables.workflows = [{ id: 'wf-a' }]
    tables.asset_workflow_priorities = [
      { asset_id: ASSET, workflow_id: 'wf-a', priority: 'high' },
    ]

    const o = (await fetchAssetOverlays([ASSET], ORG_A)).get(ASSET)!
    expect(o.priority).toBe('high')
  })

  it('derives completeness from this organisation\'s research', async () => {
    tables.asset_contributions = [
      { asset_id: ASSET, section: 'thesis', content: 'x', updated_at: '2026-08-01' },
      { asset_id: ASSET, section: 'where_different', content: 'y', updated_at: '2026-08-01' },
      { asset_id: ASSET, section: 'risks_to_thesis', content: 'z', updated_at: '2026-08-01' },
    ]
    tables.workflows = []
    tables.asset_workflow_priorities = []

    // All three research fields, no price targets → 50% by the shared formula.
    const o = (await fetchAssetOverlays([ASSET], ORG_A)).get(ASSET)!
    expect(o.completeness).toBe(50)
  })
})

describe('applyAssetOverlay', () => {
  const globalAsset = { id: ASSET, symbol: 'AAPL', sector: 'Tech' }

  it('keeps global reference fields and adds the proprietary ones', () => {
    const merged = applyAssetOverlay(globalAsset, {
      ...EMPTY_OVERLAY, thesis: 'mine', priority: 'high', process_stage: 'analysis',
    })
    expect(merged.symbol).toBe('AAPL')
    expect(merged.sector).toBe('Tech')
    expect(merged.thesis).toBe('mine')
    expect(merged.priority).toBe('high')
    expect(merged.process_stage).toBe('analysis')
  })

  it('nulls every proprietary field when there is no overlay', () => {
    // The unaffiliated-user and foreign-org case: a screen filtering on thesis
    // or priority matches nothing rather than matching another tenant.
    const merged = applyAssetOverlay(globalAsset, undefined)
    expect(merged.symbol).toBe('AAPL')
    for (const k of ['thesis', 'where_different', 'risks_to_thesis', 'quick_note',
                     'priority', 'process_stage', 'completeness'] as const) {
      expect(merged[k]).toBeNull()
    }
  })

  it('cannot carry a proprietary value in from the global row', () => {
    // Defensive: if a stale `assets` select ever put thesis back on the row,
    // the merge must still take the overlay's answer, not the row's.
    const contaminated = { ...globalAsset, thesis: 'LEAKED FROM GLOBAL ROW' } as any
    const merged = applyAssetOverlay(contaminated, undefined)
    expect(merged.thesis).toBeNull()
  })
})
