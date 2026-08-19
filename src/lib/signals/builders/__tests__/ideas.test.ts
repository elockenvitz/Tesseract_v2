import { describe, it, expect, beforeEach } from 'vitest'
import { buildIdeaCard, type IdeaInput } from '../ideas'
import type { CardResult, SignalCard } from '../../contract'

const card = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`expected a card, got: ${r.reason} (${r.detail})`)
  return r.card
}
const reason = (r: CardResult): string => {
  if (r.ok) throw new Error('expected suppression, got a card')
  return r.reason
}

beforeEach(() => localStorage.clear())

const THOUGHT: IdeaInput = {
  id: 't1',
  type: 'quick_thought',
  content: 'The margin story here is consensus now and the multiple has not moved.',
  createdAt: '2026-08-01T09:00:00.000Z',
  authorName: 'Priya Raman',
  asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
}

const TRADE: IdeaInput = {
  id: 'x1',
  type: 'trade_idea',
  content: 'Re-rated past our bull case.',
  createdAt: '2026-08-01T09:00:00.000Z',
  authorName: 'Priya Raman',
  action: 'sell',
  urgency: 'high',
  portfolioName: 'Core Equity',
  asset: { id: 'a2', symbol: 'DASH', companyName: 'DoorDash' },
}

describe('ideas feed cards', () => {
  it('carries the post own timestamp, never now', () => {
    // The whole reason these moved: a feed that re-dates itself on every login
    // tells the reader it was generated for them.
    expect(card(buildIdeaCard(THOUGHT)).provenance.occurredAt).toBe('2026-08-01T09:00:00.000Z')
  })

  it('puts posts on the desk surface, not research', () => {
    // "Priya thinks this" and "the book is 6.2% overweight" are different kinds
    // of claim and must not wear the same badge.
    expect(card(buildIdeaCard(THOUGHT)).surface).toBe('desk')
    expect(card(buildIdeaCard(TRADE)).surface).toBe('desk')
  })

  it('never invents a metric for a post', () => {
    // A reaction count or a "score" in the loudest slot on the card is a number
    // nobody asked for and nothing acts on.
    expect(card(buildIdeaCard(THOUGHT)).metric).toBeNull()
    expect(card(buildIdeaCard(TRADE)).metric).toBeNull()
  })

  it('leads a trade idea with the person and the verb', () => {
    expect(card(buildIdeaCard(TRADE)).headline)
      .toBe('Priya Raman wants to sell DASH in Core Equity')
  })

  it('uses the author own words as the headline of a thought', () => {
    // Not a generated summary: paraphrasing would put words in the mouth of
    // somebody the card names.
    expect(card(buildIdeaCard(THOUGHT)).headline).toContain('margin story')
  })

  it('truncates a long thought on a word boundary', () => {
    // Real prose, because `isQualityContent` correctly rejects repeated
    // characters as keyboard mash — the first version of this test used
    // 'x'.repeat(40) and was suppressed, which is the mash guard doing its job
    // on the new builder rather than a bug.
    const long = {
      ...THOUGHT,
      content: 'The delivery margin story is now entirely consensus and the multiple '
        + 'has re-rated past every case we modelled last spring, which means the '
        + 'position is sized for an outcome that has already happened.',
    }
    const h = card(buildIdeaCard(long)).headline
    expect(h.endsWith('…')).toBe(true)
    expect(h.length).toBeLessThanOrEqual(91)

    // The real property: the kept text is a prefix of the original that ends
    // exactly where a word ends.
    //
    // The first attempt asserted `not.toMatch(/\w…$/)`, which is incoherent —
    // cutting ON a word boundary means the ellipsis necessarily follows a word
    // character. It would only pass if the cut landed mid-punctuation.
    const kept = h.slice(0, -1)
    expect(long.content.startsWith(kept)).toBe(true)
    expect(long.content[kept.length]).toBe(' ')
  })

  it('suppresses a post with no words rather than rendering a frame', () => {
    expect(reason(buildIdeaCard({ ...THOUGHT, content: '   ' }))).toBe('content_quality')
    expect(reason(buildIdeaCard({ ...THOUGHT, content: '<p></p>' }))).toBe('content_quality')
  })

  it('strips markup out of the body', () => {
    const c = card(buildIdeaCard({ ...THOUGHT, content: '<p>Real <b>text</b> here</p>' }))
    expect(c.body).toBe('Real text here')
    expect(c.body).not.toContain('<')
  })

  it('charts a trade idea and never a thought', () => {
    // A sparkline under somebody's musing is decoration; under a trade idea it
    // is the thing being argued about.
    expect(card(buildIdeaCard(TRADE)).evidence?.kind).toBe('sparkline')
    expect(card(buildIdeaCard(THOUGHT)).evidence).toBeUndefined()
  })

  it('offers only the actions the surface says it can honour', () => {
    // The old action rail's verbs must survive the move, and the card must not
    // offer one the caller cannot perform.
    const bare = card(buildIdeaCard(THOUGHT)).actions.menu.map(a => a.id)
    expect(bare).not.toContain('share')
    expect(bare).not.toContain('promote')

    const full = card(buildIdeaCard(THOUGHT, {
      share: true, ask: true, promote: true, readthrough: true,
    })).actions.menu.map(a => a.id)
    for (const id of ['ask', 'share', 'promote', 'readthrough']) {
      expect(full, id).toContain(id)
    }
  })

  it('never offers to resolve somebody else post', () => {
    // The reader is an audience, not an approver.
    expect(card(buildIdeaCard(THOUGHT)).actions.primary.id).not.toBe('resolve')
    expect(card(buildIdeaCard(THOUGHT)).actions.primary.id).toBe('capture')
  })

  it('keeps every post out of critical severity', () => {
    // A red rule on somebody's thought devalues the mark where it means a real
    // problem.
    for (const t of ['quick_thought', 'trade_idea', 'note', 'message'] as const) {
      const c = card(buildIdeaCard({ ...THOUGHT, type: t, title: 'A title' }))
      expect(c.severity, t).not.toBe('critical')
    }
  })

  it('names both sides of a pair trade', () => {
    const c = card(buildIdeaCard({
      ...THOUGHT, id: 'p1', type: 'pair_trade',
      longLegs: [{ symbol: 'AAPL' }], shortLegs: [{ symbol: 'MSFT' }],
    }))
    expect(c.headline).toBe('Priya Raman is long AAPL against MSFT')
  })

  it('dedupes on the post, not on the day it was read', () => {
    const a = card(buildIdeaCard(THOUGHT)).dedupeKey
    const b = card(buildIdeaCard(THOUGHT)).dedupeKey
    expect(a).toBe(b)
    expect(a).toContain('2026-08-01')
  })
})
