/**
 * A conversation started inside a project is SAVED inside it.
 *
 * ── Why this needs a test and not just a prop ───────────────────────────
 *
 * "New conversation in Earnings season" has nothing to write when it is
 * pressed. A conversation row does not exist until the first answer comes
 * back, so the project is an intention held in the client for as long as the
 * reader takes to type their question -- and if it is dropped anywhere in
 * that window, the sidebar says one thing and the saved row says another.
 * That is worse than not offering the control, because the reader has no
 * reason to check.
 *
 * So the claim is specifically about the INSERT: the row that is finally
 * written carries `folder_id`. Everything else here guards the ways the
 * intention must NOT leak -- onto a plain new conversation, onto a saved
 * thread that already has its own filing, or onto the next thread after it
 * has been spent once.
 *
 * `test/supabase-recorder` captures the statements; see its own note.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, act } from '@testing-library/react'
import { rows, resetRecorder, statementsFor } from '../../test/supabase-recorder'

vi.mock('../../lib/supabase', async () => {
  const { recorder } = await import('../../test/supabase-recorder')
  return { supabase: recorder }
})

vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

vi.mock('../useAIConfig', () => ({
  useAIConfig: () => ({
    effectiveConfig: {
      provider: 'anthropic', model: 'm', isConfigured: true, isResolving: false, mode: 'byok',
    },
    updateUserPrefs: vi.fn(),
  }),
  AI_PROVIDERS: [], AI_MODELS: {},
}))

import { useAI } from '../useAI'

let api: ReturnType<typeof useAI>

function Probe() {
  api = useAI()
  return null
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
const wrap = (node: ReactNode) => <QueryClientProvider client={client()}>{node}</QueryClientProvider>

/**
 * A response the hook can actually finish reading.
 *
 * The send path streams, so a plain JSON body is not enough: it needs a
 * readable body carrying SSE frames, and a `final` frame, or the hook treats
 * the answer as interrupted and never reaches the insert this file is about.
 */
function sseResponse(text = 'Here is the answer.') {
  const frames = [
    `data: ${JSON.stringify({ type: 'delta', text })}\n\n`,
    `data: ${JSON.stringify({ type: 'final', raw: text, model: 'm' })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  const encoded = new TextEncoder().encode(frames)
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    }),
    json: async () => ({}),
  } as unknown as Response
}

/** The `folder_id` on the conversation row the hook inserted, if any. */
function insertedFolderId(): unknown {
  const inserts = statementsFor('ai_conversations', 'insert')
  expect(inserts).toHaveLength(1)
  return (inserts[0].payload as Record<string, unknown>).folder_id
}

beforeEach(() => {
  resetRecorder()
  /* The insert reads `data.id` back off a `.single()`, so the recorder has to
     have a row to hand it -- otherwise the hook treats the create as failed
     and the assertions below would pass for the wrong reason. */
  rows.set('ai_conversations', [{ id: 'new-conversation' }])
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse()))
})

describe('starting a thread in a project', () => {
  it('writes the project onto the row it creates', async () => {
    render(wrap(<Probe />))
    act(() => { api.newConversation('f-earnings') })

    await act(async () => { await api.sendMessageAsync('how did the quarter land?') })

    expect(insertedFolderId()).toBe('f-earnings')
  })

  it('says where it will be saved before it is saved', async () => {
    /* The reader's only confirmation during the window where the assignment
       exists in the client and nowhere else. */
    render(wrap(<Probe />))
    act(() => { api.newConversation('f-earnings') })

    expect(api.draftFolderId).toBe('f-earnings')
  })

  it('files nothing when the thread was not started in a project', async () => {
    render(wrap(<Probe />))
    act(() => { api.newConversation() })

    await act(async () => { await api.sendMessageAsync('a general question') })

    /* Absent rather than null: a plain new conversation leaves the column to
       its own default instead of asserting a value over it. */
    expect(insertedFolderId()).toBeUndefined()
  })

  it('spends the intention once, and not on the next thread', async () => {
    /*
     * The leak worth guarding. The intention outlives the press by design --
     * it has to survive until the first answer -- so forgetting to clear it
     * silently files every later conversation into a project the reader
     * chose once.
     */
    render(wrap(<Probe />))
    act(() => { api.newConversation('f-earnings') })
    await act(async () => { await api.sendMessageAsync('first question') })
    expect(api.draftFolderId).toBeNull()

    resetRecorder()
    rows.set('ai_conversations', [{ id: 'second-conversation' }])
    act(() => { api.newConversation() })
    await act(async () => { await api.sendMessageAsync('an unrelated question') })

    expect(insertedFolderId()).toBeUndefined()
  })

  it('abandons it when a saved thread is opened instead', async () => {
    /*
     * The reader pressed New conversation in a project, then changed their
     * mind and opened an existing thread. That thread has its own filing, and
     * spending the intention on its next message would move it.
     */
    render(wrap(<Probe />))
    act(() => { api.newConversation('f-earnings') })

    await act(async () => { await api.selectConversation('c-existing') })

    expect(api.draftFolderId).toBeNull()
    await act(async () => { await api.sendMessageAsync('a follow-up') })
    /* An existing thread updates; it must not be re-created or re-filed. */
    expect(statementsFor('ai_conversations', 'insert')).toEqual([])
    const updates = statementsFor('ai_conversations', 'update')
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) {
      expect(Object.keys(u.payload as object)).not.toContain('folder_id')
    }
  })
})
