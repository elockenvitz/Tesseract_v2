/**
 * Resolving references by reading the objects, which is also the permission check.
 *
 * ── What is actually at risk ──────────────────────────────────────────────
 *
 * A chip's label is cached text. A destination has to be a row the reader can
 * read right now, because between attaching a reference and pressing it the
 * object can be deleted, the reader can lose the portfolio, or the firm can
 * archive the theme. A link built from the cached label opens a tab on an id
 * that resolves to nothing.
 *
 * So the rule under test is: a reference is followable exactly when a read of
 * it comes back. There is no second predicate about who may open what -- RLS
 * answers it, and a row that does not come back is gone or not theirs, which
 * are the same thing from here.
 *
 * The queries are faked at the client boundary, so what is observed is which
 * tables are read, with which filters, and what the hook concludes from the
 * answers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/** Every `from(...)` the hook made, with the filters it applied. */
type Probe = { table: string; select: string; in?: string[]; neq?: [string, unknown] }
let probes: Probe[] = []
/** table -> rows the fake returns for an `in` query. */
let rows: Record<string, Record<string, unknown>[]> = {}

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const probe: Probe = { table, select: '' }
      probes.push(probe)
      const result = () => ({ data: rows[table] ?? [], error: null })
      const builder: Record<string, unknown> = {
        select(cols: string) { probe.select = cols; return builder },
        in(_col: string, ids: string[]) { probe.in = ids; return builder },
        neq(col: string, value: unknown) { probe.neq = [col, value]; return builder },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(result()).then(resolve) },
      }
      return builder
    },
  },
}))

import { useReferenceTargets } from '../useReferenceTargets'

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    {node}
  </QueryClientProvider>
)

const resolve = async (tags: { type: string; id: string }[]) => {
  const { result } = renderHook(() => useReferenceTargets(tags), { wrapper: ({ children }) => wrap(children) })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  return result.current.targets
}

const probed = (table: string) => probes.find(p => p.table === table)

beforeEach(() => {
  probes = []
  rows = {}
})

describe('the four kinds resolve from their own tables', () => {
  it('reads an asset by id and keeps the symbol the destination needs', async () => {
    rows.assets = [{ id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple Inc.' }]
    const targets = await resolve([{ type: 'asset', id: 'a-aapl' }])

    expect(targets.get('asset:a-aapl')).toMatchObject({
      type: 'asset', id: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc.',
    })
    expect(probed('assets')?.in).toEqual(['a-aapl'])
  })

  it('reads a portfolio through the table with its own permission predicate', async () => {
    rows.portfolios = [{ id: 'p-core', name: 'Core Equity', benchmark: 'SPY' }]
    const targets = await resolve([{ type: 'portfolio', id: 'p-core' }])

    expect(targets.get('portfolio:p-core')).toMatchObject({ type: 'portfolio', label: 'Core Equity' })
    expect(probed('portfolios')).toBeTruthy()
  })

  it('reads a theme through the org-scoped view, not the base table', async () => {
    /* `org_themes_v` is what the entity search reads. Going to `themes`
       directly would be a second, wider definition of "a theme I can see". */
    rows.org_themes_v = [{ id: 't-ai', name: 'AI infrastructure' }]
    const targets = await resolve([{ type: 'theme', id: 't-ai' }])

    expect(targets.get('theme:t-ai')).toMatchObject({ type: 'theme', label: 'AI infrastructure' })
    expect(probed('org_themes_v')).toBeTruthy()
    expect(probed('themes')).toBeUndefined()
  })

  it('finds which of the three note tables holds a note, and whose it is', async () => {
    rows.portfolio_notes = [{
      id: 'n-2', title: 'Rebalance rationale', portfolio_id: 'p-core',
      portfolios: { id: 'p-core', name: 'Core Equity' },
    }]
    const targets = await resolve([{ type: 'note', id: 'n-2' }])

    expect(targets.get('note:n-2')).toMatchObject({
      type: 'note', id: 'n-2', label: 'Rebalance rationale',
      entityType: 'portfolio', entityId: 'p-core', entityName: 'Core Equity',
    })
  })

  it('names an asset note by its symbol, which is what the tab title shows', async () => {
    rows.asset_notes = [{
      id: 'n-1', title: 'Channel checks', asset_id: 'a-aapl',
      assets: { id: 'a-aapl', symbol: 'AAPL' },
    }]
    const targets = await resolve([{ type: 'note', id: 'n-1' }])
    expect(targets.get('note:n-1')).toMatchObject({ entityName: 'AAPL', entityType: 'asset' })
  })
})

describe('a reference the reader cannot follow', () => {
  it('is absent when the object does not come back', async () => {
    /* Deleted, or no longer visible to this reader. From here those are the
       same answer, and both mean the chip is not a link. */
    rows.portfolios = []
    const targets = await resolve([{ type: 'portfolio', id: 'p-lost' }])
    expect(targets.has('portfolio:p-lost')).toBe(false)
  })

  it('does not take one object being present as evidence for another', async () => {
    rows.assets = [{ id: 'a-aapl', symbol: 'AAPL' }]
    rows.portfolios = []
    const targets = await resolve([
      { type: 'asset', id: 'a-aapl' },
      { type: 'portfolio', id: 'p-lost' },
    ])
    expect(targets.has('asset:a-aapl')).toBe(true)
    expect(targets.has('portfolio:p-lost')).toBe(false)
  })

  it('refuses a trashed note at the query, not after the fact', async () => {
    const targets = await resolve([{ type: 'note', id: 'n-gone' }])
    expect(targets.has('note:n-gone')).toBe(false)
    for (const table of ['asset_notes', 'portfolio_notes', 'theme_notes']) {
      expect(probed(table)?.neq).toEqual(['is_deleted', true])
    }
  })

  it('never looks in the notebook table, which the shell cannot render', async () => {
    /* A notebook note has no destination -- the shell's note tab knows asset,
       portfolio and theme notes. Resolving one would make a chip into a link
       to a tab reading "Note data not available". */
    await resolve([{ type: 'note', id: 'n-x' }])
    expect(probed('custom_notebook_notes')).toBeUndefined()
  })

  it('drops a note row whose owning entity is missing', async () => {
    /* An orphan: the note is readable, the thing it hangs off is not, so the
       tab id cannot be built and there is nowhere to go. */
    rows.asset_notes = [{ id: 'n-3', title: 'Orphan', asset_id: null, assets: null }]
    const targets = await resolve([{ type: 'note', id: 'n-3' }])
    expect(targets.has('note:n-3')).toBe(false)
  })
})

describe('what is not asked for is not read', () => {
  it('queries only the types actually attached', async () => {
    rows.assets = [{ id: 'a-aapl', symbol: 'AAPL' }]
    await resolve([{ type: 'asset', id: 'a-aapl' }])

    expect(probed('assets')).toBeTruthy()
    expect(probed('portfolios')).toBeUndefined()
    expect(probed('org_themes_v')).toBeUndefined()
    expect(probed('asset_notes')).toBeUndefined()
  })

  it('reads nothing at all for a conversation with no references', async () => {
    const { result } = renderHook(() => useReferenceTargets([]), {
      wrapper: ({ children }) => wrap(children),
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.targets.size).toBe(0)
    expect(probes).toEqual([])
  })

  it('ignores a reference type the tag table does not accept', async () => {
    await resolve([{ type: 'trade_idea', id: 'ti-1' }])
    expect(probes).toEqual([])
  })

  it('batches several ids of one type into a single read', async () => {
    rows.assets = [{ id: 'a-1', symbol: 'A' }, { id: 'a-2', symbol: 'B' }]
    await resolve([{ type: 'asset', id: 'a-1' }, { type: 'asset', id: 'a-2' }])

    expect(probes.filter(p => p.table === 'assets').length).toBe(1)
    expect(probed('assets')?.in?.sort()).toEqual(['a-1', 'a-2'])
  })
})
