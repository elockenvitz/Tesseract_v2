import { describe, it, expect } from 'vitest'
import { buildIdeaCard, ideaPromptFor, type IdeaInput } from '../ideas'

const ASSET = { id: 'a1', symbol: 'COIN', companyName: 'Coinbase Global' }

const idea = (over: Partial<IdeaInput> = {}): IdeaInput => ({
  id: 'i1',
  type: 'trade_idea',
  content: 'The re-rate has not happened and the take-rate floor is visible in the Q2 print.',
  createdAt: '2026-06-01T00:00:00Z',
  authorName: 'Priya Raman',
  asset: ASSET,
  action: 'buy',
  ...over,
})

const card = (i: IdeaInput) => {
  const r = buildIdeaCard(i, { openDetail: true })
  if (!r.ok) throw new Error(`suppressed: ${r.reason} ${r.detail ?? ''}`)
  return r.card
}

describe('headline — the author’s own verb, for all four directions', () => {
  it('says what a buy and a sell are', () => {
    expect(card(idea({ action: 'buy' })).headline).toContain('wants to buy COIN')
    expect(card(idea({ action: 'sell' })).headline).toContain('wants to sell COIN')
  })

  /**
   * The regression. `action === 'sell' ? 'sell' : action === 'buy' ? 'buy' :
   * 'trade'` collapsed both adjust verbs to "trade", so an analyst asking the
   * desk to trim had their card say "wants to trade MSFT".
   */
  it('does not flatten add and trim into "trade"', () => {
    expect(card(idea({ action: 'add' })).headline).toContain('wants to add to COIN')
    expect(card(idea({ action: 'trim' })).headline).toContain('wants to trim COIN')
    for (const a of ['add', 'trim']) {
      expect(card(idea({ action: a })).headline).not.toContain('wants to trade')
    }
  })

  it('does not invent a direction the row never stated', () => {
    const h = card(idea({ action: null })).headline
    expect(h).toContain('raised an idea on COIN')
    expect(h).not.toMatch(/\bbuy\b|\bsell\b/)
  })
})

describe('metric — the stated target, or nothing', () => {
  it('shows the author’s target as a stated number dated to the idea', () => {
    const c = card(idea({ targetPrice: 310, createdAt: '2026-06-01T00:00:00Z' }))
    expect(c.metric).toMatchObject({ value: '$310.00', source: 'stated', asOf: '2026-06-01T00:00:00Z' })
  })

  it('carries the horizon in the label when one was set', () => {
    expect(card(idea({ targetPrice: 310, timeHorizon: 'long' })).metric?.label)
      .toBe('Target · long horizon')
    expect(card(idea({ targetPrice: 310 })).metric?.label).toBe('Target price')
  })

  /**
   * The upside is deliberately NOT here: computing it needs a current price,
   * and the only one available at build time is `assets.current_price`, which
   * carries no timestamp. See `ideaMetric`.
   */
  it('shows no metric for an idea with no target', () => {
    expect(card(idea({ targetPrice: null })).metric).toBeNull()
  })

  it('refuses a nonsense target rather than rendering it', () => {
    expect(card(idea({ targetPrice: 0 })).metric).toBeNull()
    expect(card(idea({ targetPrice: -5 })).metric).toBeNull()
  })

  it('still puts no metric on a plain thought', () => {
    expect(card(idea({ type: 'quick_thought', action: null, targetPrice: 310 })).metric).toBeNull()
  })
})

describe('prompt — asked once, and worded by maturity', () => {
  it('asks a finished idea whether to put it on', () => {
    expect(card(idea({ stage: 'ready_for_decision' })).prompt).toBe('Would you put this on?')
    expect(card(idea({ stage: 'deciding' })).prompt).toBe('Would you put this on?')
  })

  it('asks an unfinished idea whether the work points the right way', () => {
    expect(card(idea({ stage: 'investigate' })).prompt).toBe('Is this pointing the right way on COIN?')
  })

  /**
   * `SignalCardView` suppresses the response bar's heading by comparing the
   * two STRINGS, so the builder and the feed must produce the same sentence
   * from the same function or the card asks twice.
   */
  it('is byte-identical to what the feed’s own helper produces', () => {
    const c = card(idea({ stage: 'ready_for_decision' }))
    expect(c.prompt).toBe(ideaPromptFor({ type: 'trade_idea', stage: 'ready_for_decision', symbol: 'COIN' }))
  })

  it('asks nothing of a thought or a note', () => {
    expect(card(idea({ type: 'quick_thought', action: null })).prompt).toBeUndefined()
  })
})

describe('context — the two things only the chips can say', () => {
  it('leads with maturity and conviction, not with facts the headline repeats', () => {
    const c = card(idea({ stage: 'deep_research', conviction: 'high', portfolioName: 'Core Equity' }))
    const labels = c.context.map(x => x.label)
    expect(labels[0]).toBe('RESEARCHING')
    expect(labels[1]).toBe('high conviction')
  })

  it('puts no stance chip beside a headline that already states the verb', () => {
    const c = card(idea({ action: 'buy', stage: 'aware' }))
    expect(c.context.map(x => x.label)).not.toContain('BUY')
  })

  it('shows no maturity chip when the stage is unreadable', () => {
    const c = card(idea({ stage: null, conviction: 'low' }))
    expect(c.context.map(x => x.label)).not.toContain('RESEARCHING')
  })

  it('leaves a thought’s chips exactly as they were', () => {
    const c = card(idea({ type: 'quick_thought', action: null, sentiment: 'concerned' }))
    expect(c.context.map(x => x.label)).toContain('Priya Raman')
  })
})

describe('the detail action names what the reader will find', () => {
  const labelOf = (i: IdeaInput) =>
    card(i).actions.menu.find(a => a.id === 'open_idea')?.label

  it('names the target, the cases, the path or the argument', () => {
    expect(labelOf(idea({ targetPrice: 310 }))).toBe('Review the target')
    expect(labelOf(idea({ ladderCaseCount: 3 }))).toBe('Review the cases')
    expect(labelOf(idea({ hasPriceHistory: true }))).toBe('Revisit this idea')
    expect(labelOf(idea({}))).toBe('Read the full idea')
  })

  it('is not offered to a surface that cannot honour it', () => {
    const r = buildIdeaCard(idea({}), {})
    if (!r.ok) throw new Error('suppressed')
    expect(r.card.actions.menu.find(a => a.id === 'open_idea')).toBeUndefined()
  })

  it('is not offered on a plain thought, which has no idea to open', () => {
    const c = card(idea({ type: 'quick_thought', action: null }))
    expect(c.actions.menu.find(a => a.id === 'open_idea')).toBeUndefined()
  })
})
