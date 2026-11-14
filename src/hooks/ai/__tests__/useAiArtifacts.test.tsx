/**
 * The probe that decides whether kept answers exist at all.
 *
 * `public.ai_artifacts` is not in any environment: the migration is authored
 * and unapplied. So the state that ships today is `available: false`, and it
 * is reached by ASKING -- one list query whose missing-table error turns the
 * feature off -- rather than by a flag someone has to remember to flip when
 * the migration lands.
 *
 * Three outcomes, and the middle one is the case nobody would notice going
 * wrong:
 *
 *   table absent    off, and not an error the reader is shown
 *   read DENIED     ON, and the error reported. A policy refusing a read
 *                   means the table is there; swallowing that as "off" would
 *                   hide an RLS fault behind a feature flag.
 *   rows returned   on, with the rows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ArtifactDraft } from '../../../lib/ai/artifact-store'

/** What the next list query resolves to. Set per test. */
let listResult: { data: unknown; error: unknown } = { data: [], error: null }
const upsertSpy = vi.fn()
const updateSpy = vi.fn()

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve(listResult),
        upsert: (payload: unknown) => {
          upsertSpy(payload)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'art-1', ...(payload as object) }, error: null }),
            }),
          }
        },
        update: (payload: unknown) => {
          updateSpy(payload)
          return { eq: () => Promise.resolve({ error: null }) }
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
      return builder
    },
  },
}))

vi.mock('../../useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganizationOptional: () => ({ currentOrgId: 'org-1' }),
}))

const { useAiArtifacts } = await import('../useAiArtifacts')

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
  >
    {children}
  </QueryClientProvider>
)

const mount = () => renderHook(() => useAiArtifacts(), { wrapper: wrap })

beforeEach(() => {
  listResult = { data: [], error: null }
  upsertSpy.mockReset()
  updateSpy.mockReset()
})
afterEach(cleanup)

describe('whether the feature is on', () => {
  it('is off, and silent, while the table does not exist', async () => {
    listResult = {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.ai_artifacts' in the schema cache" },
    }
    const { result } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.available).toBe(false)
    /* Not an error the reader is shown: nothing is broken, the feature is
       simply not deployed. */
    expect(result.current.lastError).toBeNull()
    expect(result.current.artifacts).toEqual([])
  })

  it('is off before the probe answers', () => {
    /* Nothing may appear and then vanish from a menu the reader is reading. */
    const { result } = mount()
    expect(result.current.available).toBe(false)
  })

  it('reports a DENIED read instead of reading it as absence', async () => {
    /*
     * THE case. `42501` means the table exists and the policy refused -- an
     * RLS finding worth seeing. Treating it as "not deployed" would make a
     * real hole indistinguishable from an unapplied migration.
     */
    listResult = { data: null, error: { code: '42501', message: 'permission denied for table ai_artifacts' } }
    const { result } = mount()
    await waitFor(() => expect(result.current.lastError).toBeTruthy())
    expect(result.current.lastError).toMatch(/permission denied/i)
    expect(result.current.available).toBe(false)
  })

  it('is on, with the rows, once the table is there', async () => {
    listResult = {
      data: [{
        id: 'art-1', user_id: 'user-1', organization_id: 'org-1',
        conversation_id: 'c-1', message_id: 'm-1', title: 'Bear case',
        created_at: '2026-11-13T10:00:00Z', updated_at: '2026-11-13T10:00:00Z',
      }],
      error: null,
    }
    const { result } = mount()
    await waitFor(() => expect(result.current.available).toBe(true))
    expect(result.current.artifacts).toHaveLength(1)
    expect(result.current.artifacts[0].title).toBe('Bear case')
  })
})

/**
 * The reader's choices, as the save form hands them over.
 *
 * `keep` takes a draft rather than a loose title now, because the subject and
 * the folder travel with it and the two subject columns have to be produced
 * together.
 */
const draft = (over: Partial<ArtifactDraft> = {}): ArtifactDraft => ({
  title: 'Bear case', subject: null, folderId: null, ...over,
})

describe('what a write sends', () => {
  it('stamps the organization at write time and stores no text', async () => {
    /*
     * Both halves matter. The org is stamped rather than derived from a
     * mutable `current_org_id()` later, and there is NO content column: the
     * answer stays the one copy in `ai_conversations.messages`, so a
     * restricted or deleted original cannot leave a copy behind.
     */
    const { result } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await result.current.keep({ conversationId: 'c-1', messageId: 'm-1', draft: draft() })

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const payload = upsertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(payload.organization_id).toBe('org-1')
    expect(payload.user_id).toBe('user-1')
    expect(payload.conversation_id).toBe('c-1')
    expect(payload.message_id).toBe('m-1')
    /*
     * The association columns joined this list when the save form gained a
     * subject and a project. `content` must still never be among them: the
     * answer stays the one copy in `ai_conversations.messages`.
     */
    expect(Object.keys(payload).sort()).toEqual([
      'conversation_id', 'folder_id', 'message_id', 'organization_id',
      'subject_id', 'subject_type', 'title', 'user_id',
    ])
  })

  it('sends the association as a pair, or as two nulls', async () => {
    /*
     * The table's CHECK is `(subject_type IS NULL) = (subject_id IS NULL)`,
     * so one of them written alone is a rejected row. They are produced
     * together by `artifactAssociation` for that reason, and this is the
     * assertion that the hook does not reassemble them by hand.
     */
    const { result } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await result.current.keep({ conversationId: 'c-1', messageId: 'm-1', draft: draft() })
    expect(upsertSpy.mock.calls[0][0]).toMatchObject({
      subject_type: null, subject_id: null, folder_id: null,
    })

    await result.current.keep({
      conversationId: 'c-1',
      messageId: 'm-2',
      draft: draft({
        subject: { type: 'asset', id: 'a-1', label: 'AAPL' },
        folderId: 'f-1',
      }),
    })
    expect(upsertSpy.mock.calls[1][0]).toMatchObject({
      subject_type: 'asset', subject_id: 'a-1', folder_id: 'f-1',
    })
  })

  it('sends no folder for an empty choice, rather than an empty string', async () => {
    /* The select's "No project" option has a value of `''`, and `''` is not
       a uuid -- it would be rejected by the column rather than read as
       "unfiled". */
    const { result } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await result.current.keep({
      conversationId: 'c-1', messageId: 'm-1', draft: draft({ folderId: '' }),
    })
    expect((upsertSpy.mock.calls[0][0] as { folder_id: unknown }).folder_id).toBeNull()
  })

  it('clamps a long title to what the column accepts', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await result.current.keep({
      conversationId: 'c-1', messageId: 'm-1',
      draft: draft({ title: 'word '.repeat(100) }),
    })
    const payload = upsertSpy.mock.calls[0][0] as { title: string }
    expect(payload.title.length).toBeLessThanOrEqual(200)
  })

  it('refuses a rename to a blank name, and says which refusal it was', async () => {
    /*
     * This path had no test at all, and that is how `artifactTitleError`
     * went missing from the hook's imports while every other suite stayed
     * green: the check it guards is reached only by renaming, so the real
     * behaviour was a `ReferenceError` no reader would meet until they
     * cleared the field.
     *
     * So the assertion is on the MESSAGE as well as on the absence of a
     * write -- a ReferenceError also leaves `updateSpy` untouched, and
     * would have passed a test that only checked that.
     */
    const { result } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await result.current.rename('art-1', '   ')

    expect(updateSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.lastError).toMatch(/name you will recognise/i))
  })

  it('clamps a rename the same way it clamps a first save', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await result.current.rename('art-1', 'word '.repeat(100))
    const payload = updateSpy.mock.calls[0][0] as { title: string }
    expect(payload.title.length).toBeLessThanOrEqual(200)
  })

  it('writes nothing without an organization to stamp', async () => {
    /* A row with no org could be read from the reader's other firm. Better
       no row: the policy would refuse it anyway, and failing here says so
       without a round trip. */
    vi.doMock('../../../contexts/OrganizationContext', () => ({
      useOrganizationOptional: () => ({ currentOrgId: null }),
    }))
    vi.resetModules()
    const { useAiArtifacts: hook } = await import('../useAiArtifacts')
    const { result } = renderHook(() => hook(), { wrapper: wrap })
    const row = await result.current.keep({
      conversationId: 'c-1', messageId: 'm-1', draft: draft(),
    })
    expect(row).toBeNull()
    expect(upsertSpy).not.toHaveBeenCalled()
    vi.doUnmock('../../../contexts/OrganizationContext')
  })
})
