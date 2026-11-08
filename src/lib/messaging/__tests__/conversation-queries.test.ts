/**
 * The direct-messaging reads.
 *
 * Tested against a recording stub client, because the whole change is the
 * number of round trips and how the results are folded together. A source
 * assertion cannot see either, and the component these came out of needs auth,
 * an organization context, a router and a live client to render.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../supabase', () => ({ supabase: {} }))

import { readConversationList, readConversationMessages } from '../conversation-queries'

const ME = 'user-me'
const OTHER = 'user-other'

type Row = Record<string, unknown>

interface Responses {
  participants?: Row[]
  conversations?: Row[]
  lastMessage?: Row | null
  unreadCount?: number
  messages?: Row[]
  replied?: Row[]
  participantsError?: unknown
  conversationsError?: unknown
  repliedError?: unknown
}

/**
 * Records every query. `calls` is the assertion that matters: the list used to
 * produce 2 + 3N entries and the message read 1 + R.
 */
function stubClient(responses: Responses) {
  const calls: Array<{ table: string; select: string; filters: unknown[][]; head: boolean }> = []

  const client = {
    from: (table: string) => {
      const record = { table, select: '', filters: [] as unknown[][], head: false }
      calls.push(record)

      const self: Record<string, unknown> = {}
      const chain = () => self

      const resolve = () => {
        if (table === 'conversation_participants') {
          return { data: responses.participants ?? [], error: responses.participantsError ?? null }
        }
        if (table === 'conversations') {
          return { data: responses.conversations ?? [], error: responses.conversationsError ?? null }
        }
        // conversation_messages, told apart by what was asked of it
        if (record.head) return { count: responses.unreadCount ?? 0, data: null, error: null }
        if (record.filters.some(f => f[0] === 'in')) {
          return { data: responses.replied ?? [], error: responses.repliedError ?? null }
        }
        if (record.select.includes('content, user_id, created_at')) {
          return { data: responses.lastMessage ?? null, error: null }
        }
        return { data: responses.messages ?? [], error: null }
      }

      Object.assign(self, {
        select: (sel: string, opts?: { head?: boolean }) => {
          record.select = sel
          if (opts?.head) record.head = true
          return self
        },
        eq: (c: string, v: unknown) => { record.filters.push(['eq', c, v]); return self },
        in: (c: string, v: unknown) => { record.filters.push(['in', c, v]); return self },
        neq: (c: string, v: unknown) => { record.filters.push(['neq', c, v]); return self },
        gt: (c: string, v: unknown) => { record.filters.push(['gt', c, v]); return self },
        order: chain,
        limit: chain,
        maybeSingle: () => Promise.resolve(resolve()),
        single: () => Promise.resolve(resolve()),
        then: (onResolve: (r: unknown) => unknown) => Promise.resolve(resolve()).then(onResolve),
      })
      return self
    },
  }

  return { client: client as never, calls }
}

const conversation = (id: string, participants: Row[]) => ({
  id,
  name: null,
  is_group: false,
  conversation_participants: participants,
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the conversation list', () => {
  it('spends two queries per conversation, not three', async () => {
    const { client, calls } = stubClient({
      participants: [{ conversation_id: 'c1' }, { conversation_id: 'c2' }],
      conversations: [
        conversation('c1', [{ user_id: ME, last_read_at: '2026-01-01T00:00:00Z' }]),
        conversation('c2', [{ user_id: ME, last_read_at: '2026-01-01T00:00:00Z' }]),
      ],
    })
    await readConversationList(ME, client)

    /* Two upfront, then a last message and an unread count each. The read
       position now rides along in the `conversations` select. */
    expect(calls.map(c => c.table)).toEqual([
      'conversation_participants',
      'conversations',
      'conversation_messages',
      'conversation_messages',
      'conversation_messages',
      'conversation_messages',
    ])
  })

  it('never queries conversation_participants per conversation again', async () => {
    const { client, calls } = stubClient({
      participants: [{ conversation_id: 'c1' }, { conversation_id: 'c2' }, { conversation_id: 'c3' }],
      conversations: [
        conversation('c1', [{ user_id: ME, last_read_at: null }]),
        conversation('c2', [{ user_id: ME, last_read_at: null }]),
        conversation('c3', [{ user_id: ME, last_read_at: null }]),
      ],
    })
    await readConversationList(ME, client)

    const participantReads = calls.filter(c => c.table === 'conversation_participants')
    expect(participantReads, 'the per-conversation last_read_at query is back').toHaveLength(1)
  })

  it('asks for last_read_at in the conversations select', async () => {
    /* The one added column is what removes the loop. Without it the fold below
       silently reads undefined and every conversation looks never-read. */
    const { client, calls } = stubClient({
      participants: [{ conversation_id: 'c1' }],
      conversations: [conversation('c1', [{ user_id: ME, last_read_at: null }])],
    })
    await readConversationList(ME, client)
    expect(calls.find(c => c.table === 'conversations')!.select).toContain('last_read_at')
  })

  it('counts only messages newer than the reader\'s own read position', async () => {
    const { client, calls } = stubClient({
      participants: [{ conversation_id: 'c1' }],
      conversations: [
        conversation('c1', [
          { user_id: OTHER, last_read_at: '2020-01-01T00:00:00Z' },
          { user_id: ME, last_read_at: '2026-06-01T00:00:00Z' },
        ]),
      ],
      unreadCount: 4,
    })
    const result = (await readConversationList(ME, client)) as Array<{ unread_count: number }>

    /* The participant rows are EVERY participant. Taking the first would show
       the reader somebody else's read position, and so somebody else's badge:
       here, the one from 2020 would count six years of messages as unread. */
    const countQuery = calls.find(c => c.head)!
    expect(countQuery.filters).toContainEqual(['gt', 'created_at', '2026-06-01T00:00:00Z'])
    expect(countQuery.filters).toContainEqual(['neq', 'user_id', ME])
    expect(result[0].unread_count).toBe(4)
  })

  it('counts everything from others when the conversation was never read', async () => {
    const { client, calls } = stubClient({
      participants: [{ conversation_id: 'c1' }],
      conversations: [conversation('c1', [{ user_id: ME, last_read_at: null }])],
      unreadCount: 9,
    })
    const result = (await readConversationList(ME, client)) as Array<{ unread_count: number }>

    const countQuery = calls.find(c => c.head)!
    expect(countQuery.filters.some(f => f[0] === 'gt')).toBe(false)
    expect(countQuery.filters).toContainEqual(['neq', 'user_id', ME])
    expect(result[0].unread_count).toBe(9)
  })

  it('treats a missing participant row as never read rather than crashing', async () => {
    const { client } = stubClient({
      participants: [{ conversation_id: 'c1' }],
      conversations: [conversation('c1', [{ user_id: OTHER, last_read_at: '2026-06-01T00:00:00Z' }])],
      unreadCount: 2,
    })
    const result = (await readConversationList(ME, client)) as Array<{ unread_count: number }>
    expect(result[0].unread_count).toBe(2)
  })

  it('still exposes the participants for the conversation title', async () => {
    const people = [
      { user_id: ME, last_read_at: null, user: { id: ME, email: 'me@x.com' } },
      { user_id: OTHER, last_read_at: null, user: { id: OTHER, email: 'other@x.com' } },
    ]
    const { client } = stubClient({
      participants: [{ conversation_id: 'c1' }],
      conversations: [conversation('c1', people)],
    })
    const result = (await readConversationList(ME, client)) as Array<{ participants: unknown }>
    expect(result[0].participants).toEqual(people)
  })

  it('queries nothing further when the user is in no conversation', async () => {
    const { client, calls } = stubClient({ participants: [] })
    await expect(readConversationList(ME, client)).resolves.toEqual([])
    expect(calls.map(c => c.table)).toEqual(['conversation_participants'])
  })

  it('returns nothing for a missing user', async () => {
    const { client, calls } = stubClient({ participants: [{ conversation_id: 'c1' }] })
    await expect(readConversationList('', client)).resolves.toEqual([])
    expect(calls).toEqual([])
  })

  it('propagates a failure instead of showing an empty inbox', async () => {
    const { client } = stubClient({ participantsError: { code: '42501' } })
    await expect(readConversationList(ME, client)).rejects.toBeTruthy()
  })
})

/*
 * Why this block exists, written while the defect was in the file.
 *
 * Moving these reads out of the component took the `conversations` query with
 * them, and it was the only P0 entry the frontend tenant lint held against
 * DirectMessaging.tsx. Removing `.in('id', conversationIds)` from the new
 * module -- which makes the list ask for EVERY conversation in the database --
 * was measured against both gates and neither noticed:
 *
 *   tenant:lint:frontend   PASS: current findings exactly match the inventory
 *   the 18 tests above     18 passed
 *
 * The lint matches `supabase.from('<table>')`, and the module calls
 * `.from(...)` on an injected `client` parameter, so the refactor moved the
 * query out of the lint's sight. The tests assert how MANY queries run, which
 * is what they were written for, and nothing asserted WHICH rows are asked
 * for. So the one gate that is left is this one: it must fail when the filter
 * goes, which is the state it was written in.
 */
describe('the conversation list asks only for the caller own conversations', () => {
  it('filters conversations by the ids the caller participates in', async () => {
    const { client, calls } = stubClient({
      participants: [{ conversation_id: 'c1' }, { conversation_id: 'c2' }],
      conversations: [
        conversation('c1', [{ user_id: ME, last_read_at: null }]),
        conversation('c2', [{ user_id: ME, last_read_at: null }]),
      ],
    })
    await readConversationList(ME, client)

    const conversationRead = calls.find(c => c.table === 'conversations')
    expect(conversationRead, 'the conversations read vanished').toBeTruthy()
    expect(
      conversationRead!.filters,
      'the conversations read is unfiltered, so it asks for every conversation in the database'
    ).toEqual([['in', 'id', ['c1', 'c2']]])
  })

  it('derives those ids from the caller own participant rows, never from an argument', async () => {
    const { client, calls } = stubClient({
      participants: [{ conversation_id: 'mine' }],
      conversations: [conversation('mine', [{ user_id: ME, last_read_at: null }])],
    })
    await readConversationList(ME, client)

    const participantRead = calls.find(c => c.table === 'conversation_participants')
    expect(participantRead!.filters).toEqual([['eq', 'user_id', ME]])

    const conversationRead = calls.find(c => c.table === 'conversations')
    expect(conversationRead!.filters).toEqual([['in', 'id', ['mine']]])
  })

  it('asks for nothing at all when the caller participates in nothing', async () => {
    const { client, calls } = stubClient({ participants: [] })
    await expect(readConversationList(ME, client)).resolves.toEqual([])

    expect(
      calls.map(c => c.table),
      'an empty participant set must not fall through to an unfiltered read'
    ).toEqual(['conversation_participants'])
  })
})

describe('the messages in one conversation', () => {
  const msg = (id: string, reply_to: string | null = null) => ({
    id,
    conversation_id: 'c1',
    reply_to,
    content: `body ${id}`,
  })

  it('spends two queries however many replies the thread holds', async () => {
    const { client, calls } = stubClient({
      messages: [msg('m1'), msg('m2', 'm1'), msg('m3', 'm1'), msg('m4', 'm2'), msg('m5', 'm2')],
      replied: [msg('m1'), msg('m2')],
    })
    await readConversationMessages('c1', client)

    /* The loop this replaces issued one query per reply, on a timer, so the
       cost of reading a conversation grew as the conversation grew. */
    expect(calls).toHaveLength(2)
    expect(calls.every(c => c.table === 'conversation_messages')).toBe(true)
  })

  it('asks for each quoted message exactly once', async () => {
    const { client, calls } = stubClient({
      messages: [msg('m2', 'm1'), msg('m3', 'm1'), msg('m4', 'm1')],
      replied: [msg('m1')],
    })
    await readConversationMessages('c1', client)
    expect(calls[1].filters).toContainEqual(['in', 'id', ['m1']])
  })

  it('does not query at all for a thread with no replies', async () => {
    const { client, calls } = stubClient({ messages: [msg('m1'), msg('m2')] })
    await readConversationMessages('c1', client)
    expect(calls).toHaveLength(1)
  })

  it('attaches each quoted message to the message quoting it', async () => {
    const { client } = stubClient({
      messages: [msg('m1'), msg('m2', 'm1'), msg('m3')],
      replied: [{ id: 'm1', content: 'body m1', user_id: OTHER }],
    })
    const result = (await readConversationMessages('c1', client)) as Array<{
      id: string
      replied_message?: { id: string } | null
    }>

    expect(result.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(result[1].replied_message!.id).toBe('m1')
    expect(result[0].replied_message).toBeUndefined()
    expect(result[2].replied_message).toBeUndefined()
  })

  it('attaches the right quoted message when several are quoted', async () => {
    const { client } = stubClient({
      messages: [msg('m3', 'm1'), msg('m4', 'm2')],
      replied: [
        { id: 'm2', content: 'body m2', user_id: ME },
        { id: 'm1', content: 'body m1', user_id: OTHER },
      ],
    })
    const result = (await readConversationMessages('c1', client)) as Array<{
      replied_message?: { id: string } | null
    }>
    /* The loop could not get this wrong; a map can, if it is keyed by position
       rather than by id. The stub deliberately returns them out of order. */
    expect(result[0].replied_message!.id).toBe('m1')
    expect(result[1].replied_message!.id).toBe('m2')
  })

  it('leaves the reply null when the quoted message is gone or unreadable', async () => {
    /* What `maybeSingle()` did per message. A deleted message, or one in a
       conversation the reader has since lost access to, must not throw. */
    const { client } = stubClient({ messages: [msg('m2', 'deleted')], replied: [] })
    const result = (await readConversationMessages('c1', client)) as Array<{
      replied_message?: unknown
    }>
    expect(result[0].replied_message).toBeNull()
  })

  it('still shows the conversation when the quoted-message query fails', async () => {
    const { client } = stubClient({
      messages: [msg('m1'), msg('m2', 'm1')],
      repliedError: { code: '57014' },
    })
    const result = (await readConversationMessages('c1', client)) as Array<{ id: string }>
    expect(result.map(m => m.id)).toEqual(['m1', 'm2'])
  })

  it('returns nothing for no conversation, without querying', async () => {
    const { client, calls } = stubClient({ messages: [msg('m1')] })
    await expect(readConversationMessages('', client)).resolves.toEqual([])
    expect(calls).toEqual([])
  })
})
