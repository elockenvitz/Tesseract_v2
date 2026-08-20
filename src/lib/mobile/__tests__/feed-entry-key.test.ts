import { describe, expect, it } from 'vitest'

import { feedEntryKeys } from '../feed-entry-key'

describe('feed entry keys', () => {
  it('survives the rebuild the pipeline does on every recompute', () => {
    /**
     * The composition rebuilds every entry object — `{...e, subject}`, then
     * `{...r.item, score}` — so object identity is worthless. A key that
     * changed between recomputes would remount the card and throw away the
     * carousel pane the reader had paged to.
     */
    const entry = { kind: 'idea', idea: { id: 'abc' } }
    const rebuilt = { ...entry, subject: 'NVDA', score: 12 }
    expect(feedEntryKeys([rebuilt])).toEqual(feedEntryKeys([entry]))
  })

  it('reads each kind from wherever that kind hides its id', () => {
    expect(feedEntryKeys([
      { kind: 'attention', attention: { attention_id: 'a1' } },
      { kind: 'signal', signal: { id: 's1' } },
      { kind: 'news', news: { id: 'n1' } },
      { kind: 'template', card: { id: 't1' } },
      { kind: 'scenario', card: { id: 'sc1' } },
    ])).toEqual(['attention:a1', 'signal:s1', 'news:n1', 'template:t1', 'scenario:sc1'])
  })

  it('falls back to the ticker for a scenario card with no id', () => {
    expect(feedEntryKeys([{ kind: 'scenario', card: { entity: { ticker: 'MSFT' } } }]))
      .toEqual(['scenario:MSFT'])
  })

  it('keeps a repeated insight distinct per cycle', () => {
    // Insights are re-presented once per scroll cycle by design, so the same
    // insight legitimately appears several times. The round is part of what
    // the entry IS.
    const keys = feedEntryKeys([
      { kind: 'insight', insight: { id: 'i1' }, round: 0 },
      { kind: 'insight', insight: { id: 'i1' }, round: 1 },
    ])
    expect(keys[0]).not.toBe(keys[1])
  })

  it('identifies a lens by its type and its subject', () => {
    // A lens has no id of its own — it is a view over one position.
    const keys = feedEntryKeys([
      { kind: 'lens', lens: { type: 'stale', target: { symbol: 'AAPL' } } },
      { kind: 'lens', lens: { type: 'untargeted', position: { symbol: 'AAPL' } } },
    ])
    expect(keys).toEqual(['lens:stale:AAPL', 'lens:untargeted:AAPL'])
  })

  it('never returns a duplicate, whatever the data does', () => {
    /**
     * Enforced rather than trusted. A duplicate React key does not raise — it
     * shows up much later as one card that mysteriously stops updating, which
     * is far harder to trace back than a suffix here.
     */
    const keys = feedEntryKeys([
      { kind: 'news', news: {} },
      { kind: 'news', news: {} },
      { kind: 'news', news: {} },
    ])
    expect(new Set(keys).size).toBe(3)
  })

  it('assigns collision suffixes deterministically', () => {
    // Same list in, same keys out — otherwise the dedupe would itself become a
    // source of remounts.
    const list = [{ kind: 'lens', lens: { type: 'stale' } }, { kind: 'lens', lens: { type: 'stale' } }]
    expect(feedEntryKeys(list)).toEqual(feedEntryKeys(list))
  })

  it('still produces a key for a kind it has never seen', () => {
    expect(feedEntryKeys([{ kind: 'brand_new' } as any])).toEqual(['entry:brand_new'])
  })
})
