/**
 * Asset Research Library data layer.
 *
 * The in-memory Supabase mock applies both the client's filters AND an implicit
 * organization filter, simulating the org-scoped RLS that asset_notes /
 * object_links / file_links actually enforce (verified on the prod-schema
 * replica). So a cross-org row is invisible here exactly as it would be against
 * the real database, and these tests prove the slice relies on that scoping
 * rather than defeating it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const env = vi.hoisted(() => ({
  orgId: 'org-a' as string | null,
  /**
   * What `users.current_organization_id` says, which is NOT always what the
   * app is showing.
   *
   * `set_note_org_id_from_caller` fills `asset_notes.organization_id` from
   * this column when an insert omits it (verified against the live trigger).
   * Modelling it as a separate value is the only way a test can tell a client
   * that STATES its organisation from one that leaves it to the database —
   * while the two agree, both look identical and a passing test proves
   * nothing.
   */
  dbCurrentOrgId: 'org-a' as string | null,
  userId: 'user-1' as string | null,
  asset_notes: [] as any[],
  object_links: [] as any[],
  file_links: [] as any[],
  files: [] as any[],
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: env.userId ? { id: env.userId } : null }) }))
vi.mock('../../contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentOrgId: env.orgId }) }))

vi.mock('../../lib/supabase', () => {
  const rowsFor = (table: string) => (env as any)[table] as any[]
  // Simulate RLS: reads only see the active org's rows.
  const orgScoped = (r: any) =>
    r.organization_id === undefined || r.organization_id === env.orgId
  return {
    supabase: {
      from: (table: string) => {
        const filters: Array<[string, string, any]> = []
        let embedFiles = false
        const chain: any = {}
        chain.select = (cols: string) => { if (/files:file_id/.test(cols)) embedFiles = true; return chain }
        for (const op of ['eq']) chain[op] = (col: string, val: any) => { filters.push([op, col, val]); return chain }
        chain.order = () => chain
        chain.upsert = (rows: any, _opts?: any) => {
          const key = (r: any) => [r.source_type, r.source_id, r.target_type, r.target_id, r.link_type].join('|')
          for (const row of (Array.isArray(rows) ? rows : [rows])) {
            if (!rowsFor(table).some(r => key(r) === key(row))) rowsFor(table).push({ ...row, organization_id: env.orgId })
          }
          return Promise.resolve({ error: null })
        }
        chain.insert = (rows: any) => {
          const inserted = (Array.isArray(rows) ? rows : [rows]).map((row: any) => {
            // The trigger's own rule: an explicit value wins, otherwise fall
            // back to the caller's stored current organisation.
            const withMeta = { id: row.id ?? `gen-${Math.random().toString(36).slice(2, 8)}`, ...row, organization_id: row.organization_id ?? env.dbCurrentOrgId }
            rowsFor(table).push(withMeta)
            return withMeta
          })
          const insertChain: any = {
            select: () => insertChain,
            single: () => Promise.resolve({ data: inserted[0], error: null }),
            then: (resolve: (v: any) => any) => Promise.resolve({ data: inserted, error: null }).then(resolve),
          }
          return insertChain
        }
        chain.then = (resolve: (v: any) => any) => {
          let out = rowsFor(table).filter(r => orgScoped(r) && filters.every(([, col, val]) => r[col] === val))
          if (embedFiles) {
            out = out
              .map(link => ({ ...link, files: env.files.find(f => f.id === link.file_id && orgScoped(f)) ?? null }))
          }
          return Promise.resolve({ data: out, error: null }).then(resolve)
        }
        return chain
      },
    },
  }
})

import { useAssetResearchNotes, useAssetResearchDocuments } from '../useAssetResearchNotes'

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  env.orgId = 'org-a'; env.dbCurrentOrgId = 'org-a'; env.userId = 'user-1'
  env.asset_notes = [
    { id: 'n1', asset_id: 'a1', note_type: 'research', is_deleted: false, title: 'Services deep-dive', content_preview: 'x', created_by: 'user-1', created_at: '2026-01-01', updated_at: '2026-02-01', organization_id: 'org-a' },
    { id: 'n2', asset_id: 'a1', note_type: 'meeting', is_deleted: false, title: 'Call notes', content_preview: null, created_by: 'user-1', created_at: '2026-01-02', updated_at: '2026-01-02', organization_id: 'org-a' },
    { id: 'n3', asset_id: 'a1', note_type: 'research', is_deleted: true, title: 'Deleted', content_preview: null, created_by: 'user-1', created_at: '2026-01-03', updated_at: '2026-01-03', organization_id: 'org-a' },
    { id: 'nB', asset_id: 'a1', note_type: 'research', is_deleted: false, title: 'OTHER ORG research', content_preview: null, created_by: 'user-9', created_at: '2026-01-04', updated_at: '2026-03-01', organization_id: 'org-b' },
  ]
  env.object_links = []
  env.file_links = [
    { id: 'fl1', target_type: 'asset', target_id: 'a1', file_id: 'f1', created_at: '2026-02-02', organization_id: 'org-a' },
    { id: 'fl2', target_type: 'asset', target_id: 'a1', file_id: 'fDel', created_at: '2026-02-03', organization_id: 'org-a' },
    { id: 'flB', target_type: 'asset', target_id: 'a1', file_id: 'fB', created_at: '2026-02-04', organization_id: 'org-b' },
  ]
  env.files = [
    { id: 'f1', original_name: 'Model.xlsx', name: 'model', deleted_at: null, organization_id: 'org-a', storage_bucket: 'assets', storage_path: 'org-a/f1' },
    { id: 'fDel', original_name: 'Old.pdf', name: 'old', deleted_at: '2026-02-05', organization_id: 'org-a', storage_bucket: 'assets', storage_path: 'org-a/fDel' },
    { id: 'fB', original_name: 'OtherOrg.pdf', name: 'other', deleted_at: null, organization_id: 'org-b', storage_bucket: 'assets', storage_path: 'org-b/fB' },
  ]
})

describe('useAssetResearchNotes — retrieval + tenant isolation', () => {
  it('returns only this asset\'s non-deleted research artifacts', async () => {
    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const titles = result.current.notes.map(n => n.title)
    expect(titles).toEqual(['Services deep-dive']) // excludes meeting, deleted, other-org
  })

  it('does NOT leak another org\'s research artifact (RLS-scoped)', async () => {
    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.notes.some(n => n.title === 'OTHER ORG research')).toBe(false)
  })

  it('does not run unscoped: disabled with no organization', async () => {
    env.orgId = null
    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    expect(result.current.ready).toBe(false)
    // query is gated by enabled=false, so nothing is fetched
    expect(result.current.notes).toEqual([])
  })
})

describe('useAssetResearchNotes.ensureAssetLink — the research→asset relationship', () => {
  it('creates an asset_note→asset references link, idempotently', async () => {
    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.ensureAssetLink('n1') })
    await act(async () => { await result.current.ensureAssetLink('n1') }) // second call = no-op
    const links = env.object_links.filter(l => l.source_id === 'n1')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      source_type: 'asset_note', source_id: 'n1', target_type: 'asset', target_id: 'a1',
      link_type: 'references', is_auto: false, created_by: 'user-1', organization_id: 'org-a',
    })
  })
})

describe('useAssetResearchNotes.createArtifact — explicit creation only', () => {
  it('inserts a research note for this asset, links it, and returns its id', async () => {
    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let newId: string | null = null
    await act(async () => { newId = await result.current.createArtifact() })
    expect(newId).toBeTruthy()
    const created = env.asset_notes.find(n => n.id === newId)
    expect(created).toMatchObject({ asset_id: 'a1', note_type: 'research', organization_id: 'org-a', created_by: 'user-1' })
    // the new artifact is connected to the asset
    expect(env.object_links.some(l => l.source_id === newId && l.target_id === 'a1' && l.link_type === 'references')).toBe(true)
  })

  it('states the organisation the app is showing, not the one the row remembers', async () => {
    /*
     * The failure this pins is silent and cross-tenant. `asset_notes` RLS is
     * not organisation-aware, so nothing refuses the write: the note simply
     * lands in the other workspace and never comes back to the person who
     * wrote it. Here the app is showing org-a while the caller's stored
     * current organisation still says org-b — the divergence that makes the
     * trigger's fallback the wrong answer.
     */
    env.orgId = 'org-a'
    env.dbCurrentOrgId = 'org-b'

    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let newId: string | null = null
    await act(async () => { newId = await result.current.createArtifact() })

    const created = env.asset_notes.find(n => n.id === newId)
    expect(created?.organization_id).toBe('org-a')
    // And it is readable by the workspace that created it.
    expect(env.asset_notes.some(n => n.id === newId && n.organization_id === env.orgId)).toBe(true)
  })

  it('refuses to create at all when no organisation is active', async () => {
    // Without one there is no right answer, and the trigger would invent one.
    env.orgId = null
    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    let newId: string | null = 'x'
    await act(async () => { newId = await result.current.createArtifact() })
    expect(newId).toBeNull()
    expect(env.asset_notes.some(n => n.title === 'Untitled')).toBe(false)
  })

  it('does not create without a user or asset', async () => {
    env.userId = null
    const { result } = renderHook(() => useAssetResearchNotes('a1'), { wrapper })
    let newId: string | null = 'x'
    await act(async () => { newId = await result.current.createArtifact() })
    expect(newId).toBeNull()
  })
})

describe('useAssetResearchDocuments — governed asset-level documents', () => {
  it('lists non-deleted files linked to the asset, this org only', async () => {
    const { result } = renderHook(() => useAssetResearchDocuments('a1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const names = result.current.documents.map(d => d.file.original_name)
    expect(names).toEqual(['Model.xlsx']) // excludes deleted file and other-org file
  })
})
