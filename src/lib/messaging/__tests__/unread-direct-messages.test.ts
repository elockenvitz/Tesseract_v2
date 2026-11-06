/**
 * The header's unread-message check.
 *
 * This is tested against a stub client rather than asserted against source,
 * because the thing worth protecting is the rule -- "a message from someone
 * else, newer than my last_read_at" -- and the query COUNT, which is the whole
 * point of the change. Source text cannot show either.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../supabase', () => ({ supabase: {} }))

import { readUnreadDirectMessages, resetUnreadRpcAvailability } from '../unread-direct-messages'

const ME = 'user-me'
const OTHER = 'user-other'

type Row = Record<string, unknown>

interface StubOptions {
  rpc?: { data?: boolean | null; error?: { code: string; message?: string } | null }
  participants?: Row[]
  messages?: Row[]
  participantsError?: { code: string } | null
  messagesError?: { code: string } | null
}

/**
 * A client that records what it was asked for.
 *
 * `tables` is the assertion that matters: the loop this replaced produced
 * ['conversation_participants', 'conversation_messages', 'conversation_messages', ...]
 * with one entry per conversation.
 */
function stubClient(options: StubOptions) {
  const seen = { rpcCalls: 0, tables: [] as string[], limited: false, filters: [] as unknown[][] }

  const builder = (rows: Row[], error: unknown) => {
    const self: Record<string, unknown> = {}
    const chain = () => self
    Object.assign(self, {
      select: chain,
      order: chain,
      eq: (c: string, v: unknown) => { seen.filters.push(['eq', c, v]); return self },
      in: (c: string, v: unknown) => { seen.filters.push(['in', c, v]); return self },
      neq: (c: string, v: unknown) => { seen.filters.push(['neq', c, v]); return self },
      gt: (c: string, v: unknown) => { seen.filters.push(['gt', c, v]); return self },
      limit: () => { seen.limited = true; return self },
      then: (resolve: (r: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: error ?? null }).then(resolve),
    })
    return self
  }

  const client = {
    rpc: async () => {
      seen.rpcCalls += 1
      return { data: options.rpc?.data ?? null, error: options.rpc?.error ?? null }
    },
    from: (table: string) => {
      seen.tables.push(table)
      if (table === 'conversation_participants') {
        return builder(options.participants ?? [], options.participantsError)
      }
      return builder(options.messages ?? [], options.messagesError)
    },
  }

  return { client: client as never, seen }
}

beforeEach(() => {
  resetUnreadRpcAvailability()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the RPC path', () => {
  it('answers from one round trip and touches no table', async () => {
    const { client, seen } = stubClient({ rpc: { data: true } })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(true)
    expect(seen.rpcCalls).toBe(1)
    // The point of the change: no per-conversation queries at all.
    expect(seen.tables).toEqual([])
  })

  it('reports no unread without falling back', async () => {
    const { client, seen } = stubClient({ rpc: { data: false } })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(false)
    expect(seen.tables).toEqual([])
  })

  it('does not fall back on a real failure', async () => {
    /* A timeout or a permission error must not silently double the query
       count on every poll from then on. Only "function not found" falls back. */
    const { client, seen } = stubClient({ rpc: { error: { code: '57014' } } })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(false)
    expect(seen.tables).toEqual([])
  })

  it('returns false for a missing user without calling anything', async () => {
    const { client, seen } = stubClient({ rpc: { data: true } })
    await expect(readUnreadDirectMessages('', client)).resolves.toBe(false)
    expect(seen.rpcCalls).toBe(0)
    expect(seen.tables).toEqual([])
  })
})

describe('the fallback path, used until the migration is applied', () => {
  const missing = { rpc: { error: { code: 'PGRST202' } } }

  it('uses exactly two queries regardless of how many conversations exist', async () => {
    const { client, seen } = stubClient({
      ...missing,
      participants: [
        { conversation_id: 'c1', last_read_at: '2026-01-01T00:00:00Z' },
        { conversation_id: 'c2', last_read_at: '2026-01-01T00:00:00Z' },
        { conversation_id: 'c3', last_read_at: '2026-01-01T00:00:00Z' },
        { conversation_id: 'c4', last_read_at: '2026-01-01T00:00:00Z' },
        { conversation_id: 'c5', last_read_at: '2026-01-01T00:00:00Z' },
      ],
      messages: [{ conversation_id: 'c5', created_at: '2026-02-01T00:00:00Z' }],
    })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(true)
    /* Five conversations, two queries. The replaced loop would have issued
       six, and the measured production average was 5.32 conversations. */
    expect(seen.tables).toEqual(['conversation_participants', 'conversation_messages'])
  })

  it('never limits the message query', async () => {
    /* A limit makes the boolean WRONG, not merely approximate: messages are
       not partitioned by conversation, so a limit can be filled entirely by
       one already-read conversation and hide an unread message in another. */
    const { client, seen } = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messages: [{ conversation_id: 'c1', created_at: '2026-02-01T00:00:00Z' }],
    })
    await readUnreadDirectMessages(ME, client)
    expect(seen.limited).toBe(false)
  })

  it('excludes the reader\'s own messages at the database', async () => {
    const { client, seen } = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messages: [],
    })
    await readUnreadDirectMessages(ME, client)
    expect(seen.filters).toContainEqual(['neq', 'user_id', ME])
  })

  it('does not count a message older than last_read_at', async () => {
    const { client } = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: '2026-03-01T00:00:00Z' }],
      messages: [{ conversation_id: 'c1', created_at: '2026-02-01T00:00:00Z' }],
    })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(false)
  })

  it('counts a message newer than last_read_at', async () => {
    const { client } = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: '2026-03-01T00:00:00Z' }],
      messages: [{ conversation_id: 'c1', created_at: '2026-03-01T00:00:01Z' }],
    })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(true)
  })

  it('treats a never-read conversation as having everything unread', async () => {
    const { client } = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messages: [{ conversation_id: 'c1', created_at: '1999-01-01T00:00:00Z' }],
    })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(true)
  })

  it('compares each message against its OWN conversation\'s last_read_at', async () => {
    /* The bug a single shared cutoff would introduce: c1 is read up to date,
       c2 was never read. A message in c1 older than its own cutoff must not
       count, and the one in c2 must. */
    const { client } = stubClient({
      ...missing,
      participants: [
        { conversation_id: 'c1', last_read_at: '2026-06-01T00:00:00Z' },
        { conversation_id: 'c2', last_read_at: '2026-01-01T00:00:00Z' },
      ],
      messages: [{ conversation_id: 'c1', created_at: '2026-05-01T00:00:00Z' }],
    })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(false)

    const second = stubClient({
      ...missing,
      participants: [
        { conversation_id: 'c1', last_read_at: '2026-06-01T00:00:00Z' },
        { conversation_id: 'c2', last_read_at: '2026-01-01T00:00:00Z' },
      ],
      messages: [{ conversation_id: 'c2', created_at: '2026-05-01T00:00:00Z' }],
    })
    resetUnreadRpcAvailability()
    await expect(readUnreadDirectMessages(ME, second.client)).resolves.toBe(true)
  })

  it('ignores a message with no timestamp', async () => {
    const { client } = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messages: [{ conversation_id: 'c1', created_at: null }],
    })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(false)
  })

  it('does not query messages when the reader is in no conversation', async () => {
    const { client, seen } = stubClient({ ...missing, participants: [] })
    await expect(readUnreadDirectMessages(ME, client)).resolves.toBe(false)
    expect(seen.tables).toEqual(['conversation_participants'])
  })

  it('reports false when either query errors', async () => {
    const a = stubClient({ ...missing, participantsError: { code: '42501' } })
    await expect(readUnreadDirectMessages(ME, a.client)).resolves.toBe(false)

    resetUnreadRpcAvailability()
    const b = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messagesError: { code: '42501' },
    })
    await expect(readUnreadDirectMessages(ME, b.client)).resolves.toBe(false)
  })

  it('stops retrying the missing RPC after the first discovery', async () => {
    /* Without the latch this costs one wasted round trip on every poll, which
       would partly undo the saving it is meant to protect. */
    const { client, seen } = stubClient({
      ...missing,
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messages: [],
    })
    await readUnreadDirectMessages(ME, client)
    await readUnreadDirectMessages(ME, client)
    await readUnreadDirectMessages(ME, client)
    expect(seen.rpcCalls).toBe(1)
    expect(seen.tables.filter(t => t === 'conversation_participants')).toHaveLength(3)
  })
})

describe('authorization is not widened by the move', () => {
  it('still scopes the participant read to the caller', async () => {
    /* The SELECT policy on conversation_participants is broader than "my own
       rows": it also admits any participant row of a non-group conversation.
       So the explicit user_id filter is load-bearing, not redundant with RLS,
       and the RPC keeps the same predicate for the same reason. */
    const { client, seen } = stubClient({
      rpc: { error: { code: 'PGRST202' } },
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messages: [],
    })
    await readUnreadDirectMessages(ME, client)
    expect(seen.filters).toContainEqual(['eq', 'user_id', ME])
  })

  it('never reads a message authored by the caller', async () => {
    const { client, seen } = stubClient({
      rpc: { error: { code: 'PGRST202' } },
      participants: [{ conversation_id: 'c1', last_read_at: null }],
      messages: [],
    })
    await readUnreadDirectMessages(OTHER, client)
    expect(seen.filters).toContainEqual(['neq', 'user_id', OTHER])
    expect(seen.filters).not.toContainEqual(['neq', 'user_id', ME])
  })
})
