import { describe, it, expect } from 'vitest'
import { boundHistory, DEFAULT_HISTORY_BUDGET } from '../history'
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
