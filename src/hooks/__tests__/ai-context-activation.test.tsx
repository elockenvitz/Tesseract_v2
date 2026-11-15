/**
 * Clearing active context changes the request and keeps the association.
 *
 * ── Why this test exists at all ──────────────────────────────────────────
 *
 * `ai_conversation_tags` was answering two questions with one row set:
 *
 *   what the next request carries   -- the request body's `tags: [...]`
 *   what this conversation is about -- how it is DISCOVERED later, because
 *                                      `useAssetConversations` inner-joins
 *                                      that exact table
 *
 * So `removeTag` deleted the row and changed both, and "Clear all" deleted
 * every row for the conversation in one statement. Twenty messages about
 * AAPL, one press, and the thread was gone from AAPL's conversation list
 * permanently with nothing on screen saying so.
 *
 * `context-activation.test.ts` proves the rule. This proves the hook obeys
 * it, which is the separate and more important claim: the rule could be
 * perfect and `removeTag` could still issue the delete.
 *
 * ── Why it is written against a recording Supabase stub ──────────────────
 *
 * There was no `useAI` test. Every suite that needed the hook mocked it,
 * which is why a defect in its write path had nowhere to be caught.
 * `test/supabase-recorder` records every statement the hook builds, so "no
 * DELETE was issued" is an assertion about what would have reached the
 * database rather than a reading of the source.
 *
 * `fetch` is stubbed to fail. That is deliberate and sufficient: the claim is
 * about the request BODY, which is constructed before the response matters,
 * and a failing send still records what travelled.
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

type Hook = ReturnType<typeof useAI>
let api: Hook

function Probe({ initialTags }: { initialTags: { type: string; id: string }[] }) {
  api = useAI(initialTags as never)
  return null
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
const wrap = (node: ReactNode) => <QueryClientProvider client={client()}>{node}</QueryClientProvider>

const AAPL = { type: 'asset', id: 'a1' }
const GROWTH = { type: 'portfolio', id: 'p1' }

/** Request bodies the hook put on the wire, parsed. */
let bodies: Record<string, unknown>[] = []

function mountWith(tags: { type: string; id: string }[] = [AAPL]) {
  return render(wrap(<Probe initialTags={tags} />))
}

/** Put the hook on a saved conversation whose tags are already established. */
async function openSavedConversation(tags: { type: string; id: string }[]) {
  rows.set('ai_conversation_tags', tags.map(t => ({ tag_type: t.type, tag_id: t.id })))
  await act(async () => { await api.selectConversation('c1') })
}

const deletesOf = (table: string) => statementsFor(table, 'delete')

beforeEach(() => {
  resetRecorder()
  bodies = []
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    /* Failing on purpose: the claim is about the body, and a 500 still lets
       the pre-request path run and record what travelled. */
    return { ok: false, json: async () => ({ error: 'stubbed' }) } as unknown as Response
  }))
})

describe('an object that has been asked about is deactivated, not deleted', () => {
  it('leaves the association row in place when it is detached', async () => {
    mountWith([AAPL, GROWTH])
    await openSavedConversation([AAPL, GROWTH])

    await act(async () => { api.removeTag(AAPL as never) })

    /*
     * The whole point. Nothing was deleted, so the conversation is still
     * discoverable from AAPL -- and AAPL is out of the active set, so the
     * next request will not carry it.
     */
    expect(deletesOf('ai_conversation_tags')).toEqual([])
    expect(api.tags.map(t => t.id)).toEqual(['p1'])
    expect(api.associatedTags.map(t => t.id)).toEqual(['a1', 'p1'])
  })

  it('leaves it out of the next request body', async () => {
    mountWith([AAPL, GROWTH])
    await openSavedConversation([AAPL, GROWTH])
    await act(async () => { api.removeTag(AAPL as never) })

    await act(async () => { await api.sendMessageAsync('and LRCX?') })

    expect(bodies).toHaveLength(1)
    expect(bodies[0].tags).toEqual([{ type: 'portfolio', id: 'p1' }])
  })

  it('does not come back when the conversation is reopened', async () => {
    /*
     * The brief's context walkthrough asks this directly: navigate away and
     * back, and confirm stale context does not silently reappear. The rows
     * are all still there, so without the stored activation a reopen would
     * re-attach everything the reader had cleared.
     */
    mountWith([AAPL, GROWTH])
    await openSavedConversation([AAPL, GROWTH])
    await act(async () => { api.removeTag(AAPL as never) })

    await openSavedConversation([AAPL, GROWTH])

    expect(api.tags.map(t => t.id)).toEqual(['p1'])
    expect(api.associatedTags.map(t => t.id)).toEqual(['a1', 'p1'])
  })

  it('comes back when the reader attaches it again', async () => {
    mountWith([AAPL, GROWTH])
    await openSavedConversation([AAPL, GROWTH])
    await act(async () => { api.removeTag(AAPL as never) })

    await act(async () => { api.addTag({ ...AAPL, label: 'AAPL' } as never) })

    expect(api.tags.map(t => t.id)).toEqual(['a1', 'p1'])
  })
})

describe('an object that was never asked about is deleted', () => {
  it('removes the row, because no association was established', async () => {
    /*
     * Attached by mistake and removed before anything was sent. Keeping the
     * row would file the thread under an object it never discussed, which is
     * the mirror of the defect this split exists for.
     */
    mountWith([AAPL])
    await openSavedConversation([AAPL])

    await act(async () => { api.addTag({ type: 'theme', id: 't9' } as never) })
    await act(async () => { api.removeTag({ type: 'theme', id: 't9' } as never) })

    const deletes = deletesOf('ai_conversation_tags')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].filters).toContainEqual(['eq', 'tag_id', 't9'])
    expect(api.tags.some(t => t.id === 't9')).toBe(false)
  })

  it('becomes established once it has travelled, and then survives detaching', async () => {
    mountWith([AAPL])
    await openSavedConversation([AAPL])
    await act(async () => { api.addTag({ type: 'theme', id: 't9' } as never) })

    await act(async () => { await api.sendMessageAsync('what about this theme?') })
    await act(async () => { api.removeTag({ type: 'theme', id: 't9' } as never) })

    expect(deletesOf('ai_conversation_tags')).toEqual([])
    expect(api.associatedTags.some(t => t.id === 't9')).toBe(true)
  })
})

describe('clear all', () => {
  it('empties the request without emptying the conversation', async () => {
    mountWith([AAPL, GROWTH])
    await openSavedConversation([AAPL, GROWTH])

    await act(async () => { api.clearContext() })

    expect(deletesOf('ai_conversation_tags')).toEqual([])
    expect(api.tags).toEqual([])
    expect(api.associatedTags.map(t => t.id)).toEqual(['a1', 'p1'])
  })

  it('sends no tags at all afterwards', async () => {
    mountWith([AAPL, GROWTH])
    await openSavedConversation([AAPL, GROWTH])
    await act(async () => { api.clearContext() })

    await act(async () => { await api.sendMessageAsync('general question') })

    expect(bodies[0].tags).toEqual([])
  })

  it('never issues an unscoped delete on the conversation', async () => {
    /*
     * The first version of `clearContext` was exactly that:
     * `.delete().eq('conversation_id', id)` with no tag filter, which took
     * the established rows with it. Any delete it issues now must name the
     * ids it is allowed to remove.
     */
    mountWith([AAPL])
    await openSavedConversation([AAPL])
    await act(async () => { api.addTag({ type: 'theme', id: 't9' } as never) })

    await act(async () => { api.clearContext() })

    for (const d of deletesOf('ai_conversation_tags')) {
      expect(
        d.filters.some(([op, col]) => op === 'in' && col === 'tag_id'),
        `an unscoped delete reached the tag table: ${JSON.stringify(d.filters)}`,
      ).toBe(true)
    }
    /* And the established one is still associated. */
    expect(api.associatedTags.map(t => t.id)).toContain('a1')
  })

  it('leaves the transcript alone', async () => {
    mountWith([AAPL])
    await openSavedConversation([AAPL])
    await act(async () => { await api.sendMessageAsync('first question') })
    const before = api.messages.length

    await act(async () => { api.clearContext() })

    expect(api.messages.length).toBe(before)
    expect(deletesOf('ai_conversations')).toEqual([])
  })
})
