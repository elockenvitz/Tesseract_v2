import { describe, it, expect } from 'vitest'

import {
  ID_CHUNK_SIZE,
  IDENTITY_COLUMNS,
  createAssetAccess,
  type AssetQuerySpec,
} from '../asset-access'
import type { SecurityRow } from '../identity'
import { POSTGREST_MAX_ROWS, TruncatedReadError } from '../paging'

/**
 * An in-memory `assets` that behaves like the production one, including the
 * part that causes the bug.
 *
 * ── Why the cap is emulated rather than mocked away ───────────────────────
 *
 * PostgREST on this project is configured `max_rows: 1000`. It does not error
 * past that and it does not say it truncated: it returns the first 1,000 rows
 * and HTTP 200. Twelve production call sites read `assets` with no limit and
 * no filter and are therefore correct only because the table currently holds
 * 911 rows.
 *
 * A test source that returns everything asked for would pass against the code
 * that has the bug, which makes it worthless. This one caps every response the
 * way the server does, so a paging loop that does not actually page fails
 * here.
 */
function table(rows: SecurityRow[], opts: { maxRows?: number } = {}) {
  const cap = opts.maxRows ?? POSTGREST_MAX_ROWS
  const calls: AssetQuerySpec[] = []

  const source = async (spec: AssetQuerySpec): Promise<SecurityRow[]> => {
    calls.push(spec)
    let out = rows.slice()

    if (spec.ids) {
      const want = new Set(spec.ids)
      out = out.filter(r => want.has(r.id))
    }
    if (spec.symbol) {
      const want = spec.symbol.trim().toUpperCase()
      out = out.filter(
        r =>
          (r.symbol ?? '').toUpperCase() === want ||
          (r.current_symbol ?? '').toUpperCase() === want,
      )
    }
    if (spec.mic) {
      const want = spec.mic.toUpperCase()
      out = out.filter(r => (r.mic ?? '').toUpperCase() === want)
    }
    if (spec.search) {
      const want = spec.search.toLowerCase()
      out = out.filter(
        r =>
          (r.symbol ?? '').toLowerCase().includes(want) ||
          (r.company_name ?? '').toLowerCase().includes(want),
      )
    }
    if (spec.afterId) out = out.filter(r => r.id > spec.afterId!)

    if (spec.orderBy === 'symbol') {
      out.sort((a, b) => (a.symbol ?? '').localeCompare(b.symbol ?? '') || a.id.localeCompare(b.id))
    } else if (spec.orderBy === 'id') {
      out.sort((a, b) => a.id.localeCompare(b.id))
    }

    if (spec.offset != null) out = out.slice(spec.offset, spec.offset + (spec.limit ?? 25))
    else if (spec.limit != null) out = out.slice(0, spec.limit)

    // The server cap, applied last and silently. This is the whole point.
    return out.slice(0, cap)
  }

  return { source, calls }
}

/** Ids are zero-padded so lexicographic order matches creation order. */
const id = (n: number) => `asset-${String(n).padStart(6, '0')}`

function universe(count: number, extra: SecurityRow[] = []): SecurityRow[] {
  const rows: SecurityRow[] = []
  for (let i = 0; i < count; i++) {
    rows.push({
      id: id(i),
      symbol: `T${String(i).padStart(5, '0')}`,
      company_name: `Test Issuer ${i}`,
      mic: 'XNAS',
      currency: 'USD',
      asset_type: 'stock',
      lifecycle_status: 'active',
    })
  }
  return rows.concat(extra)
}

describe('the universe is read completely past the cap', () => {
  it('returns 1,001 assets rather than the first 1,000', async () => {
    // One past the cap: the smallest universe at which the current call sites
    // start being wrong, and the one where an off-by-one in the paging loop
    // hides.
    const { source } = table(universe(1001))
    const rows = await createAssetAccess(source).allRows()
    expect(rows.length).toBe(1001)
  })

  it('returns all 5,000 of a universe half the size of the stated target', async () => {
    // docs/asset-universe.md targets ~10,000 names. 5,000 is cheap and well
    // past the point where a single request is wrong by 80%.
    const { source } = table(universe(5000))
    const rows = await createAssetAccess(source).allRows()
    expect(rows.length).toBe(5000)
    expect(new Set(rows.map(r => r.id)).size).toBe(5000)
  })

  it('reaches an asset that sits beyond index 1,000', async () => {
    const { source } = table(universe(5000))
    const rows = await createAssetAccess(source).allRows()
    // The row a single unpaged request can never see.
    expect(rows.some(r => r.id === id(4321))).toBe(true)
    expect(rows[1000].id).toBe(id(1000))
  })

  it('pages by keyset rather than offset, and advances every time', async () => {
    const { source, calls } = table(universe(2500))
    await createAssetAccess(source).allRows()
    const universeCalls = calls.filter(c => c.orderBy === 'id')
    expect(universeCalls.length).toBe(3)
    expect(universeCalls[0].afterId).toBeUndefined()
    expect(universeCalls[0].offset).toBeUndefined()
    const cursors = universeCalls.slice(1).map(c => c.afterId)
    expect(cursors).toEqual([id(998), id(1997)])
  })

  it('refuses rather than looping when a source ignores the cursor', async () => {
    // A source that drops `afterId` would otherwise return page one forever and
    // hang the tab. Loud beats silent, and silent beats nothing here.
    const rows = universe(3000)
    const stuck = async (spec: AssetQuerySpec) => rows.slice(0, spec.limit ?? 999)
    await expect(createAssetAccess(stuck).allRows()).rejects.toThrow(/did not advance/)
  })

  it('stops at the ceiling instead of returning an incomplete universe', async () => {
    const { source } = table(universe(5000))
    await expect(createAssetAccess(source).allRows({ maxRows: 2000 })).rejects.toThrow(
      TruncatedReadError,
    )
  })

  it('collects every id for a set-complement rule', async () => {
    // The shape UniversePreviewModal and CreateWorkflowWizard use for an
    // `exclude` rule. A truncated id set silently turns "everything except
    // these" into "the first thousand except these".
    const { source, calls } = table(universe(3500))
    const ids = await createAssetAccess(source).allIds()
    expect(ids.size).toBe(3500)
    expect(ids.has(id(3499))).toBe(true)
    // Only `id` is fetched: the complement never needs a company name.
    expect(calls.every(c => c.columns.length === 1 && c.columns[0] === 'id')).toBe(true)
  })
})

describe('search is server-side and pages', () => {
  const rows = universe(0, [
    { id: id(1), symbol: 'AAPL', company_name: 'Apple Inc', mic: 'XNAS', lifecycle_status: 'active' },
    { id: id(2), symbol: 'APP', company_name: 'AppLovin', mic: 'XNAS', lifecycle_status: 'active' },
    { id: id(3), symbol: 'APPF', company_name: 'AppFolio', mic: 'XNAS', lifecycle_status: 'active' },
    { id: id(4), symbol: 'APLE', company_name: 'Apple Hospitality', mic: 'XNYS', lifecycle_status: 'active' },
    { id: id(5), symbol: 'MSFT', company_name: 'Microsoft', mic: 'XNAS', lifecycle_status: 'active' },
  ])

  it('narrows in the query rather than in React', async () => {
    const { source, calls } = table(rows)
    const page = await createAssetAccess(source).search('app')
    expect(page.rows.map(r => r.recordedSymbol)).toEqual(['AAPL', 'APLE', 'APP', 'APPF'])
    // The defining property: the search term reached the source. A client-side
    // filter would have asked for everything.
    expect(calls[0].search).toBe('app')
    expect(calls[0].columns).toEqual([...IDENTITY_COLUMNS])
  })

  it('makes a result beyond the first page discoverable', async () => {
    const { source } = table(rows)
    const access = createAssetAccess(source)
    const first = await access.search('app', { limit: 2 })
    expect(first.rows.map(r => r.recordedSymbol)).toEqual(['AAPL', 'APLE'])
    expect(first.nextPage).toBe(1)

    const second = await access.search('app', { limit: 2, page: first.nextPage! })
    expect(second.rows.map(r => r.recordedSymbol)).toEqual(['APP', 'APPF'])
    expect(second.nextPage).toBeNull()
  })

  it('detects the last page without a counting request', async () => {
    const { source, calls } = table(rows)
    const page = await createAssetAccess(source).search('app', { limit: 4 })
    expect(page.nextPage).toBeNull()
    // One request, and it asked for limit + 1 so a short answer proves the end.
    expect(calls.length).toBe(1)
    expect(calls[0].limit).toBe(5)
  })

  it('finds a match past the thousandth row of a large universe', async () => {
    const needle: SecurityRow = {
      id: id(999_999),
      symbol: 'ZZZZ',
      company_name: 'Needle Corp',
      mic: 'XNAS',
      lifecycle_status: 'active',
    }
    const { source } = table(universe(5000, [needle]))
    const page = await createAssetAccess(source).search('Needle')
    expect(page.rows.map(r => r.recordedSymbol)).toEqual(['ZZZZ'])
  })

  it('caps the page size rather than letting a caller defeat paging', async () => {
    const { source, calls } = table(rows)
    await createAssetAccess(source).search('app', { limit: 100_000 })
    expect(calls[0].limit).toBeLessThanOrEqual(POSTGREST_MAX_ROWS)
  })

  it('returns nothing for an empty query instead of the whole table', async () => {
    const { source, calls } = table(rows)
    const page = await createAssetAccess(source).search('   ')
    expect(page.rows).toEqual([])
    expect(calls.length).toBe(0)
  })
})

describe('inactive securities are explicit, never implicit', () => {
  const rows: SecurityRow[] = [
    { id: id(1), symbol: 'SIVB', company_name: 'SVB Financial', lifecycle_status: 'delisted' },
    { id: id(2), symbol: 'SIVBQ', company_name: 'SVB Financial Group', lifecycle_status: 'active' },
  ]

  it('hides delisted names from a picker by default', async () => {
    const { source } = table(rows)
    const page = await createAssetAccess(source).search('SVB')
    expect(page.rows.map(r => r.recordedSymbol)).toEqual(['SIVBQ'])
  })

  it('returns them when a caller asks, rather than making them unreachable', async () => {
    // A 2023 holdings file references instruments that no longer trade. They
    // must stay findable, or reconciling that file becomes impossible.
    const { source } = table(rows)
    const page = await createAssetAccess(source).search('SVB', { includeDelisted: true })
    expect(page.rows.map(r => r.recordedSymbol).sort()).toEqual(['SIVB', 'SIVBQ'])
  })

  it('still resolves a delisted instrument by its ticker', async () => {
    const { source } = table(rows)
    const r = await createAssetAccess(source).resolveSymbol('SIVB')
    expect(r.status).toBe('resolved')
    if (r.status !== 'resolved') throw new Error('unreachable')
    expect(r.ref.lifecycle).toBe('delisted')
  })
})

describe('symbol resolution does not read the universe', () => {
  const tsla = [
    { id: id(1), symbol: 'TSLA', mic: 'XNAS', currency: 'USD', lifecycle_status: 'active' as const },
    { id: id(2), symbol: 'TSLA', mic: 'XFRA', currency: 'EUR', lifecycle_status: 'active' as const },
  ]

  it('narrows on the ticker at the source, not after', async () => {
    const { source, calls } = table(universe(5000, tsla))
    await createAssetAccess(source).resolveSymbol('TSLA')
    expect(calls.length).toBe(1)
    expect(calls[0].symbol).toBe('TSLA')
    // Bounded by the number of venues, not by the size of the universe.
    expect(calls[0].limit).toBeLessThanOrEqual(32)
  })

  it('still refuses a two-venue ticker after the narrowed read', async () => {
    // Asking the source for one row would have turned this into a silent pick,
    // which is why the narrowed read asks for several.
    const { source } = table(universe(5000, tsla))
    const r = await createAssetAccess(source).resolveSymbol('TSLA')
    expect(r.status).toBe('ambiguous')
  })

  it('resolves once a venue is named', async () => {
    const { source } = table(universe(5000, tsla))
    const r = await createAssetAccess(source).resolveSymbol('TSLA', { mic: 'XNAS' })
    expect(r.status).toBe('resolved')
    if (r.status !== 'resolved') throw new Error('unreachable')
    expect(r.ref.currency).toBe('USD')
  })

  it('reports not_found for an empty ticker without a request', async () => {
    const { source, calls } = table(universe(10))
    expect((await createAssetAccess(source).resolveSymbol('  ')).status).toBe('not_found')
    expect(calls.length).toBe(0)
  })
})

describe('batch lookup by canonical id', () => {
  it('chunks so a large batch cannot exceed the URL or the row cap', async () => {
    const rows = universe(1500)
    const { source, calls } = table(rows)
    const wanted = rows.map(r => r.id)
    const found = await createAssetAccess(source).byIds(wanted)
    expect(found.size).toBe(1500)
    expect(calls.length).toBe(Math.ceil(1500 / ID_CHUNK_SIZE))
    expect(calls.every(c => (c.ids?.length ?? 0) <= ID_CHUNK_SIZE)).toBe(true)
  })

  it('deduplicates rather than issuing the same lookup twice', async () => {
    const { source, calls } = table(universe(10))
    const found = await createAssetAccess(source).byIds([id(1), id(1), id(2)])
    expect(found.size).toBe(2)
    expect(calls[0].ids).toEqual([id(1), id(2)])
  })

  it('omits an id that does not exist rather than mapping it to a blank', async () => {
    const { source } = table(universe(10))
    const found = await createAssetAccess(source).byIds([id(1), 'no-such-asset'])
    expect(found.has(id(1))).toBe(true)
    expect(found.has('no-such-asset')).toBe(false)
  })

  it('returns null from byId for a missing asset', async () => {
    const { source } = table(universe(10))
    expect(await createAssetAccess(source).byId(id(999))).toBeNull()
    expect(await createAssetAccess(source).byId('')).toBeNull()
  })
})
