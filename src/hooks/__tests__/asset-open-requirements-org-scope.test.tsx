/**
 * The Overview's requirement read is org-scoped, and its CACHE has to be too.
 *
 * ── The defect class this pins ───────────────────────────────────────────
 *
 * `asset_checklist_items` is org-scoped by the server: RLS enabled, SELECT
 * policy `organization_id = current_org_id() AND
 * is_active_member_of_current_org()`. So the query sends no organisation
 * filter of its own, and a query key that omits the organisation looks
 * harmless -- right up to an org switch, when React Query serves the previous
 * organisation's rows from cache and no request is made to correct them.
 *
 * That is not hypothetical: two AI reads in this codebase resolved their org
 * server-side, cached without it, and showed a previous organisation's BYOK
 * configuration and admin flag after a switch.
 *
 * The fake database below enforces the policy the real one does -- it returns
 * only rows of the active organisation -- so a key missing the org id shows
 * up here as one organisation reading the other's requirements, exactly as it
 * would in the product.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

type Row = Record<string, unknown>

const env = vi.hoisted(() => ({
  orgId: 'org-a' as string | null,
  rows: [] as Row[],
  reads: 0,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (_table: string) => {
      const filters: Array<[string, unknown]> = []
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => { filters.push([col, val]); return chain }
      chain.order = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => {
        env.reads += 1
        /* The server's own policy, applied here: rows of the ACTIVE org only.
           Nothing in the query asks for this, which is the whole point. */
        const visible = env.rows.filter(r => r.organization_id === env.orgId)
        const data = visible.filter(r => filters.every(([col, val]) => r[col] === val))
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: env.orgId }),
}))

import { useAssetOpenRequirements } from '../useAssetOpenRequirements'

const requirement = (org: string, id: string, text: string): Row => ({
  organization_id: org,
  id,
  item_text: text,
  stage_id: 's-1',
  completed: false,
  due_date: null,
  assignee: null,
  asset_id: 'a-1',
  workflow_id: 'wf-1',
})

/** One client across both renders, so the cache is shared as it is in the app. */
let client: QueryClient
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  env.orgId = 'org-a'
  env.reads = 0
  env.rows = [
    requirement('org-a', 'ci-a', 'Interview two channel partners'),
    requirement('org-b', 'ci-b', 'Read the 10-K'),
  ]
})

describe('the requirement read', () => {
  it('reads the active organisation only', async () => {
    const { result } = renderHook(() => useAssetOpenRequirements('a-1', 'wf-1'), { wrapper: wrap })
    await waitFor(() => expect(result.current.open).toHaveLength(1))
    expect(result.current.open[0].text).toBe('Interview two channel partners')
  })

  it('does not read anything before an organisation is resolved', async () => {
    /* `currentOrgId` is null for the first renders of a session. A read then
       is a read with no org context at all, and the answer it caches is the
       one the next render would serve. */
    env.orgId = null
    const { result } = renderHook(() => useAssetOpenRequirements('a-1', 'wf-1'), { wrapper: wrap })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(env.reads).toBe(0)
    expect(result.current.all).toEqual([])
  })

  it('does not serve the previous organisation after a switch', async () => {
    const first = renderHook(() => useAssetOpenRequirements('a-1', 'wf-1'), { wrapper: wrap })
    await waitFor(() => expect(first.result.current.open).toHaveLength(1))
    expect(first.result.current.open[0].id).toBe('ci-a')

    /* The same asset, the same run, a different organisation. With the org
       absent from the key this serves `ci-a` from cache and never asks. */
    env.orgId = 'org-b'
    const second = renderHook(() => useAssetOpenRequirements('a-1', 'wf-1'), { wrapper: wrap })
    await waitFor(() => expect(second.result.current.open).toHaveLength(1))
    expect(second.result.current.open[0].id).toBe('ci-b')
    expect(env.reads).toBe(2)
  })

  it('separates what is owed from what is done', async () => {
    env.rows = [
      requirement('org-a', 'ci-a', 'Interview two channel partners'),
      { ...requirement('org-a', 'ci-c', 'Build the revenue model'), completed: true },
    ]
    const { result } = renderHook(() => useAssetOpenRequirements('a-1', 'wf-1'), { wrapper: wrap })
    await waitFor(() => expect(result.current.all).toHaveLength(2))
    expect(result.current.open.map(r => r.id)).toEqual(['ci-a'])
    expect(result.current.doneCount).toBe(1)
  })

  it('reads nothing when no run was named', async () => {
    /* The general Overview on a name with no process: the block is not
       rendered, and the hook must not fetch for want of an argument. */
    const { result } = renderHook(() => useAssetOpenRequirements('a-1', null), { wrapper: wrap })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(env.reads).toBe(0)
  })
})
