/**
 * Coverage research gaps: the reader's own and assigned coverage, this org
 * only, one best candidate per name, using the phone feed's research rules.
 *
 * The hook and the real scan (`scanResearchInsights`) run against an in-memory
 * database that applies the filters each query sends -- so a query that forgot
 * its organisation filter would read the other organisation's rows here, the
 * same way it would against a database whose RLS is not org-aware.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

type Row = Record<string, unknown>
type Filter = [op: string, col: string, val: unknown]

const DAY = 86_400_000
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString()

const env = vi.hoisted(() => ({
  orgId: 'org-a' as string | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as Array<{ table: string; filters: Array<[string, string, unknown]> }>,
  failing: new Set<string>(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Filter[] = []
      env.calls.push({ table, filters })
      let head = false
      const chain: Record<string, unknown> = {}
      chain.select = (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; return chain }
      for (const op of ['eq', 'neq', 'in', 'gte']) {
        chain[op] = (col: string, val: unknown) => { filters.push([op, col, val]); return chain }
      }
      chain.not = (col: string, _is: string, val: unknown) => { filters.push(['not_is', col, val]); return chain }
      for (const op of ['order', 'limit', 'range']) chain[op] = () => chain
      // Row-at-a-time reads resolve like the real client: the first match, or
      // null. Without these a caller that ends in `.maybeSingle()` threw here
      // and its query looked like a failed read rather than an answered one.
      let one = false
      for (const op of ['maybeSingle', 'single']) chain[op] = () => { one = true; return chain }
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (env.failing.has(table)) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } }).then(resolve)
        const rows =(env.tables[table] ?? []).filter(r => filters.every(([op, col, val]) => {
          const v = (r as Row)[col]
          switch (op) {
            case 'eq': return v === val
            case 'neq': return v !== val
            case 'in': return (val as unknown[]).includes(v)
            case 'gte': return String(v) >= String(val)
            case 'not_is': return v != null
            default: return true
          }
        }))
        const result = head ? { count: rows.length, data: null, error: null }
          : one ? { data: rows[0] ?? null, error: null }
          : { data: rows, error: null }
        return Promise.resolve(result).then(resolve)
      }
      return chain
    },
  },
}))
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: env.orgId }) }))

import { useCoverageResearchGaps } from '../useCoverageResearchGaps'
import { coverageResearchCandidates, COVERAGE_GAP_PRIORITY } from '../../lib/research/coverage-research-gaps'
import type { DerivedInsight } from '../mobile/useDerivedInsights'

const cov = (org: string, userId: string, assetId: string, scope: 'personal' | 'org', active = true) =>
  ({ organization_id: org, user_id: userId, asset_id: assetId, coverage_scope: scope, is_active: active, analyst_name: null })
const core = (org: string, assetId: string, section: string, days: number) =>
  ({ organization_id: org, asset_id: assetId, section, updated_at: ago(days), is_archived: false, content: 'written' })

beforeEach(() => {
  env.orgId = 'org-a'
  env.calls.length = 0
  env.failing.clear()
  localStorage.clear()
  env.tables = {
    coverage: [
      cov('org-a', 'me', 'a-aapl', 'personal'),          // own, nothing written
      cov('org-a', 'me', 'a-msft', 'org'),               // assigned, nothing written
      cov('org-a', 'me', 'a-googl', 'personal'),         // own, complete case + later note
      cov('org-a', 'me', 'a-amzn', 'personal'),          // own, half a case
      cov('org-a', 'colleague', 'a-nvda', 'personal'),   // a colleague's name
      cov('org-a', 'me', 'a-meta', 'personal', false),   // retired coverage
      cov('org-b', 'me', 'a-tsla', 'personal'),          // mine, other workspace
    ],
    asset_contributions: [
      core('org-a', 'a-googl', 'thesis', 200), core('org-a', 'a-googl', 'where_different', 200), core('org-a', 'a-googl', 'risks_to_thesis', 200),
      core('org-a', 'a-amzn', 'thesis', 5),
      // A complete AAPL case in ANOTHER workspace must not satisfy org-a.
      core('org-b', 'a-aapl', 'thesis', 3), core('org-b', 'a-aapl', 'where_different', 3), core('org-b', 'a-aapl', 'risks_to_thesis', 3),
    ],
    asset_notes: [
      { id: 'n-1', organization_id: 'org-a', asset_id: 'a-googl', created_at: ago(10), created_by: 'colleague', title: 'Q3 read', content_preview: 'Cloud reaccelerated', is_deleted: false },
      { id: 'n-2', organization_id: 'org-b', asset_id: 'a-amzn', created_at: ago(1), created_by: 'me', title: 'x', content_preview: 'x', is_deleted: false },
    ],
    quick_thoughts: [],
    portfolio_holdings_snapshots: [],
    // Held in org-a, covered by nobody: in the scan's universe, not this reader's work.
    portfolio_holdings_positions: [
      { organization_id: 'org-a', snapshot_id: 's-1', portfolio_id: 'p-1', asset_id: 'a-intc', weight_pct: 3, created_at: ago(1), portfolios: { name: 'Growth' } },
    ],
    portfolio_holdings: [],
    audit_events: [],
    trade_queue_items: [],
    users: [{ id: 'me', first_name: 'Pilot', last_name: null, email: 'p@x.test' }, { id: 'colleague', first_name: 'Dana', last_name: null, email: 'd@x.test' }],
    assets: ['aapl', 'msft', 'googl', 'amzn', 'nvda', 'meta', 'tsla', 'intc'].map(s => ({ id: `a-${s}`, symbol: s.toUpperCase(), company_name: `${s.toUpperCase()} Inc` })),
    price_history_cache: [],
  }
})

function run(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useCoverageResearchGaps(), { wrapper })
}

const ready = async (r: ReturnType<typeof run>['result']) => {
  await waitFor(() => expect(r.current.status).toBe('ready'))
  return r.current
}

describe('whose coverage', () => {
  it('includes the reader’s own coverage, and fires no-thesis for a newly covered name with no research', async () => {
    const { result } = run()
    const { candidates } = await ready(result)
    const aapl = candidates.find(c => c.symbol === 'AAPL')!
    expect(aapl).toMatchObject({ coverage: 'own', framing: 'no_case', priority: 3 })
    expect(aapl.facts.missingSections).toEqual(['thesis', 'where_different', 'risks_to_thesis'])
  })

  it('includes coverage assigned to the reader', async () => {
    const { result } = run()
    const { candidates } = await ready(result)
    expect(candidates.find(c => c.symbol === 'MSFT')).toMatchObject({ coverage: 'assigned', framing: 'no_case' })
  })

  it('excludes a colleague’s coverage, retired coverage, and held names nobody gave this reader', async () => {
    const { result } = run()
    const { candidates, coveredCount } = await ready(result)
    const symbols = candidates.map(c => c.symbol)
    expect(symbols).not.toContain('NVDA')
    expect(symbols).not.toContain('META')
    expect(symbols).not.toContain('INTC')
    expect(coveredCount).toBe(4)
  })
})

describe('the pilot’s seeded ideas, after graduation', () => {
  /** The seeder's AAPL idea, open and untouched, on a name the reader covers. */
  const seededIdea = () => ({
    id: 'seed-aapl', organization_id: 'org-a', asset_id: 'a-aapl',
    action: 'buy', status: 'idea', origin_metadata: { pilot_seed: true },
  })
  const genuineIdea = () => ({
    id: 'mine-aapl', organization_id: 'org-a', asset_id: 'a-aapl',
    action: 'buy', status: 'idea', origin_metadata: null,
  })
  const graduate = () => {
    env.tables.users = [
      { id: 'me', first_name: 'Pilot', last_name: null, email: 'p@x.test', pilot_progress: { 'graduated_at_org-a': ago(0) } },
      { id: 'colleague', first_name: 'Dana', last_name: null, email: 'd@x.test' },
    ]
  }
  const aapl = async () => {
    const { result } = run()
    const { candidates } = await ready(result)
    return candidates.find(c => c.symbol === 'AAPL')!
  }

  it('stops counting a seeded idea as work in progress on a covered name', async () => {
    env.tables.trade_queue_items = [seededIdea()]
    graduate()
    expect((await aapl()).liveIdeas).toEqual([])
  })

  it('still counts it while the pilot is running', async () => {
    env.tables.trade_queue_items = [seededIdea()]
    expect((await aapl()).liveIdeas.map(i => i.id)).toEqual(['seed-aapl'])
  })

  it('never touches a genuine idea on the same name', async () => {
    env.tables.trade_queue_items = [seededIdea(), genuineIdea()]
    graduate()
    expect((await aapl()).liveIdeas.map(i => i.id)).toEqual(['mine-aapl'])
  })
})

describe('when a read fails', () => {
  it('reports error, not an endless loading, when the coverage read fails', async () => {
    env.failing.add('coverage')
    const { result } = run()
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.candidates).toEqual([])
  })
})

describe('cost', () => {
  it('owns no query: a second lens mounting it inside the cache window reads nothing', async () => {
    /*
     * Counted over the hook's own sources.
     *
     * It also reads the pilot's graduation flag, which decides whether a
     * seeded idea still counts as live work. That is one shared, cached read
     * of `users` owned by `usePilotProgress` and paid for once by the whole
     * Dashboard; it answers after the candidates do, so counting it here
     * would measure when it resolved rather than what this hook costs.
     */
    const sources = () => env.calls.filter(c => c.table !== 'users').length
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = run(client)
    const a = await ready(first.result)
    const requests = sources()
    expect(requests).toBeGreaterThan(0)

    const second = run(client)
    const b = await ready(second.result)
    expect(sources()).toBe(requests)
    expect(b.candidates.map(c => c.id)).toEqual(a.candidates.map(c => c.id))
  })
})

describe('which organisation', () => {
  it('reads only the current workspace’s coverage and research', async () => {
    const { result } = run()
    const { candidates } = await ready(result)
    // org-b's coverage never appears in org-a…
    expect(candidates.map(c => c.symbol)).not.toContain('TSLA')
    // …and org-b's complete AAPL case does not answer org-a's missing one.
    expect(candidates.find(c => c.symbol === 'AAPL')!.framing).toBe('no_case')
    // org-b's note on AMZN is not new evidence for org-a.
    expect(candidates.find(c => c.symbol === 'AMZN')!.framing).toBe('incomplete_case')
  })

  it('filters every coverage, notes and research read on the current organisation', async () => {
    const { result } = run()
    await ready(result)
    for (const table of ['coverage', 'asset_contributions', 'asset_notes', 'quick_thoughts', 'portfolio_holdings_positions', 'portfolio_holdings_snapshots']) {
      const reads = env.calls.filter(c => c.table === table)
      expect(reads.length, table).toBeGreaterThan(0)
      for (const r of reads) expect(r.filters, table).toContainEqual(['eq', 'organization_id', 'org-a'])
    }
  })

  it('switching workspace yields that workspace’s candidates', async () => {
    env.orgId = 'org-b'
    const { result } = run()
    const { candidates } = await ready(result)
    expect(candidates.map(c => [c.symbol, c.framing])).toEqual([['TSLA', 'no_case']])
  })
})

describe('one best candidate per name, in the canonical order', () => {
  it('orders new evidence, then no thesis, then an incomplete thesis', async () => {
    const { result } = run()
    const { candidates } = await ready(result)
    expect(candidates.map(c => [c.symbol, c.framing])).toEqual([
      ['GOOGL', 'new_evidence'],
      ['AAPL', 'no_case'],
      ['MSFT', 'no_case'],
      ['AMZN', 'incomplete_case'],
    ])
    expect(new Set(candidates.map(c => c.assetId)).size).toBe(candidates.length)
    const googl = candidates[0]
    expect(googl.facts.evidenceSince.map(e => e.id)).toEqual(['n-1'])
    // Points at the existing research surface for the asset.
    expect(googl.open).toMatchObject({ assetId: 'a-googl', symbol: 'GOOGL', focus: 'research', origin: 'coverage-research' })
  })

  it('keeps the stronger framing when the scan offers a name twice', () => {
    const insight = (assetId: string, framing: string, score: number) =>
      ({ assetId, symbol: assetId.toUpperCase(), score, issue: { framing, missing: [], present: [] }, held: false, portfolioCount: 0, liveIdeas: [], evidenceCount: 0 }) as unknown as DerivedInsight
    const coverage = { ready: true, direct: new Set(['x', 'y']), assigned: new Set<string>(), held: new Set<string>() }
    const out = coverageResearchCandidates([
      insight('x', 'long_silence', 0.9),
      insight('x', 'price_move', 0.7),
      insight('y', 'incomplete_case', 0.5),
      insight('y', 'incomplete_case', 0.52),
    ], coverage)
    expect(out.map(c => [c.assetId, c.framing, c.score])).toEqual([['x', 'price_move', 0.7], ['y', 'incomplete_case', 0.52]])
    expect(COVERAGE_GAP_PRIORITY).toEqual(['new_evidence', 'price_move', 'no_case', 'incomplete_case', 'long_silence'])
  })

  it('returns nothing until coverage is known, never the org-wide universe', () => {
    const i = { assetId: 'x', symbol: 'X', score: 1, issue: { framing: 'no_case', missing: [], present: [] } } as unknown as DerivedInsight
    expect(coverageResearchCandidates([i], { ready: false, direct: new Set(['x']), assigned: new Set(), held: new Set() })).toEqual([])
  })
})
