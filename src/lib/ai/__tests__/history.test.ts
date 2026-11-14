import { describe, it, expect } from 'vitest'
import { boundHistory, stripStoredExcerpts, DEFAULT_HISTORY_BUDGET } from '../history'
import type { HistoryMessage } from '../history'

function thread(turns: number, chars = 100): HistoryMessage[] {
  const out: HistoryMessage[] = []
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'user', content: `q${i} `.padEnd(chars, 'x') })
    out.push({ role: 'assistant', content: `a${i} `.padEnd(chars, 'y') })
  }
  return out
}

describe('the send side is bounded', () => {
  it('a short thread passes through whole', () => {
    const messages = thread(2)
    const bounded = boundHistory(messages)
    expect(bounded.messages).toHaveLength(4)
    expect(bounded.droppedMessages).toBe(0)
  })

  it('a long thread is capped by turn count', () => {
    const bounded = boundHistory(thread(40))
    expect(bounded.messages.length).toBeLessThanOrEqual(DEFAULT_HISTORY_BUDGET.maxMessages)
    expect(bounded.droppedMessages).toBeGreaterThan(0)
  })

  it('keeps the MOST RECENT exchanges, not the first', () => {
    const bounded = boundHistory(thread(40))
    const last = bounded.messages[bounded.messages.length - 1]
    expect(last.content.startsWith('a39')).toBe(true)
    expect(bounded.messages.some(m => m.content.startsWith('q0'))).toBe(false)
  })

  it('is capped by characters as well as by count', () => {
    // Ten near-maximum messages are under the twelve-message cap and well
    // over the 24,000-character budget.
    const huge: HistoryMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: 'z'.repeat(3_900),
    }))
    const bounded = boundHistory(huge)
    expect(bounded.chars).toBeLessThanOrEqual(DEFAULT_HISTORY_BUDGET.maxTotalChars)
    expect(bounded.messages.length).toBeLessThan(huge.length)
  })

  it('clips a single oversized message rather than dropping the exchange', () => {
    const bounded = boundHistory([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'w'.repeat(20_000) },
    ])
    expect(bounded.clippedMessages).toBe(1)
    const clipped = bounded.messages.find(m => m.role === 'assistant')!
    expect(clipped.content.length).toBeLessThanOrEqual(DEFAULT_HISTORY_BUDGET.maxMessageChars + 1)
    expect(clipped.content.endsWith('…')).toBe(true)
  })

  it('never starts on an orphaned assistant message', () => {
    // A window that begins with an answer shows the model its own assertion
    // with no question above it.
    for (let turns = 1; turns <= 20; turns++) {
      const bounded = boundHistory(thread(turns))
      if (bounded.messages.length > 0) {
        expect(bounded.messages[0].role, `turns=${turns}`).toBe('user')
      }
    }
  })

  it('is deterministic', () => {
    const messages = thread(30)
    const first = boundHistory(messages)
    for (let i = 0; i < 10; i++) expect(boundHistory(messages)).toEqual(first)
  })

  it('honours a tighter budget', () => {
    const bounded = boundHistory(thread(20), { maxMessages: 2, maxTotalChars: 10_000, maxMessageChars: 500 })
    expect(bounded.messages).toHaveLength(2)
    expect(bounded.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(bounded.droppedMessages).toBe(38)
  })
})

describe('degenerate input', () => {
  it('an empty thread is an empty history', () => {
    expect(boundHistory([]).messages).toEqual([])
  })

  it('non-array input does not throw', () => {
    expect(() => boundHistory(undefined as never)).not.toThrow()
    expect(boundHistory(null as never).messages).toEqual([])
  })

  it('skips entries with no string content', () => {
    const bounded = boundHistory([
      { role: 'user', content: 'real' },
      { role: 'assistant', content: undefined as never },
    ])
    expect(bounded.messages).toEqual([{ role: 'user', content: 'real' }])
  })

  it('the current question is never in the history and so can never be dropped', () => {
    // The question is sent as `message`, not inside `conversationHistory`.
    // This asserts the contract rather than the implementation: whatever the
    // budget does, it operates on prior turns only.
    const priorTurns = thread(50)
    const bounded = boundHistory(priorTurns)
    expect(bounded.messages.length).toBeLessThanOrEqual(DEFAULT_HISTORY_BUDGET.maxMessages)
    expect(bounded.messages.every(m => priorTurns.some(p => p.content.startsWith(m.content.slice(0, 3))))).toBe(true)
  })
})

/*
 * An excerpt is shown, and is not written down.
 *
 * ── The boundary ─────────────────────────────────────────────────────────
 *
 * The research trail quotes each record it consulted. Showing it is safe: it
 * came back through the reader's own RLS-scoped query, so it is content they
 * can already open. Storing it is not the same act.
 * `ai_conversations.messages` is one jsonb column under the conversation
 * owner's policy, so a note's words written there become a second copy living
 * outside that note's own policy, and if the note is later restricted to a
 * narrower audience, or deleted, the copy stays readable, because nothing
 * knows it is there to re-check.
 *
 * It is also the honest choice on provenance: an excerpt is a snapshot, and a
 * months-old snapshot shown beside a live link to a record that has since
 * changed is worse than no snapshot.
 */
describe('what the transcript writes to disk', () => {
  const withExcerpt = () => [{
    role: 'assistant',
    content: 'The PM ruling is pending.',
    tool_calls: [{
      name: 'search_team_notes',
      input: { query: 'moat' },
      status: 'ok',
      scope: 'caller_visible',
      sources: [{
        kind: 'note', id: 'n1', asset_id: 'a1', symbol: 'AAPL', title: 'Channel checks',
        timestamp: '2026-11-01T00:00:00Z', state: 'shared',
        excerpt: 'Supplier lead times extended again in the March quarter.',
      }],
    }],
  }]

  /** The first source of the first lookup, after the strip. */
  const storedSource = () => {
    const calls = stripStoredExcerpts(withExcerpt())[0].tool_calls as Array<Record<string, any>>
    return calls[0].sources[0] as Record<string, unknown>
  }

  it('drops the record text', () => {
    expect(JSON.stringify(stripStoredExcerpts(withExcerpt()))).not.toContain('Supplier lead times')
  })

  it('removes the field rather than nulling it', () => {
    /* An `excerpt: null` on disk is a claim that the record had nothing to
       say, which is not what happened. */
    expect('excerpt' in storedSource()).toBe(false)
  })

  it('keeps everything a reopened trail needs to stay navigable', () => {
    expect(storedSource()).toEqual({
      kind: 'note', id: 'n1', asset_id: 'a1', symbol: 'AAPL', title: 'Channel checks',
      timestamp: '2026-11-01T00:00:00Z', state: 'shared',
    })
  })

  it('keeps the lookup s own fields, including how far it could see', () => {
    const calls = stripStoredExcerpts(withExcerpt())[0].tool_calls as Array<Record<string, any>>
    expect(calls[0]).toMatchObject({
      name: 'search_team_notes', status: 'ok', scope: 'caller_visible', input: { query: 'moat' },
    })
  })

  it('does not mutate the messages the pane is rendering', () => {
    /* The live thread keeps its excerpts: the reader is looking at them. */
    const live = withExcerpt()
    stripStoredExcerpts(live)
    expect(live[0].tool_calls[0].sources[0].excerpt).toMatch(/Supplier lead times/)
  })

  it('returns a message with no lookups unchanged, by identity', () => {
    const plain = [{ role: 'user', content: 'Where did we land?' }]
    expect(stripStoredExcerpts(plain)[0]).toBe(plain[0])
  })

  it('survives a malformed tool call rather than losing the transcript', () => {
    /* A message from an older deploy, or a half-written one. Dropping the
       whole thread to be safe would cost the reader their history. */
    const odd = [
      { role: 'assistant', content: 'a', tool_calls: [] },
      { role: 'assistant', content: 'b', tool_calls: [{ name: 'x', input: {} }] },
      { role: 'assistant', content: 'c', tool_calls: [{ name: 'x', input: {}, sources: null }] },
      { role: 'assistant', content: 'd', tool_calls: [{ name: 'x', input: {}, sources: [null] }] },
    ] as Array<Record<string, any>>
    expect(() => stripStoredExcerpts(odd)).not.toThrow()
    expect(stripStoredExcerpts(odd)).toHaveLength(4)
  })
})
