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
    // The headline is the PROPOSAL now, not a sentence about it — the stance
    // leads it so the card need not repeat it in a pill beside the chart.
    expect(card(idea({ action: 'buy' })).headline).toBe('BUY COIN')
    expect(card(idea({ action: 'sell' })).headline).toBe('SELL COIN')
  })

  /**
   * The regression. `action === 'sell' ? 'sell' : action === 'buy' ? 'buy' :
   * 'trade'` collapsed both adjust verbs to "trade", so an analyst asking the
   * desk to trim had their card say "wants to trade MSFT".
   */
  it('does not flatten add and trim into "trade"', () => {
    // The property is unchanged; the wording is shorter. All four directions
    // still say which one they are.
    expect(card(idea({ action: 'add' })).headline).toBe('ADD COIN')
    expect(card(idea({ action: 'trim' })).headline).toBe('TRIM COIN')
    for (const a of ['add', 'trim']) {
      expect(card(idea({ action: a })).headline).not.toMatch(/trade/i)
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

describe('context — maturity appears exactly once per card', () => {
  /**
   * Reported from the phone: DECIDING in the metadata row AND in the pill.
   * A card with a visual pane shows the pills, so the chip must yield.
   */
  it('carries the maturity chip on EVERY trade idea now, pane or not', () => {
    /**
     * The invariant is unchanged — maturity appears exactly ONCE per card — but
     * its home moved. It used to yield to `IdeaStancePills`, which sat inside
     * the visual pane pairing stance with maturity. Those pills are gone: the
     * stance leads the headline as "SELL COIN", so a pill repeating it was
     * duplication, and maturity now shares one characteristics row with
     * conviction instead of taking a row of its own above the chart.
     */
    for (const over of [{ targetPrice: 310 }, { ladderCaseCount: 3 }, { hasPriceHistory: true }]) {
      const c = card(idea({ stage: 'deciding', ...over }))
      expect(c.context.map(x => x.label)).toContain('DECIDING')
    }
  })

  it('keeps the maturity chip on a narrative card, which never had pills', () => {
    const c = card(idea({ stage: 'deciding' }))
    expect(c.context.map(x => x.label)).toContain('DECIDING')
  })

  it('leads the row with the book, then maturity, then conviction', () => {
    // The book is first because it is the quiet identity line the headline no
    // longer carries; the two characteristics follow it.
    const c = card(idea({ stage: 'deep_research', conviction: 'high', targetPrice: 310, portfolioName: 'Core Equity' }))
    expect(c.context.map(x => x.label)).toEqual(['Core Equity', 'RESEARCHING', 'high conviction'])
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

describe('metadata discipline — the row is for scanning', () => {
  it('shows conviction OR urgency, never both', () => {
    const c = card(idea({ conviction: 'high', urgency: 'medium', targetPrice: 310 }))
    const labels = c.context.map(x => x.label)
    expect(labels).toContain('high conviction')
    expect(labels).not.toContain('medium urgency')
  })

  it('falls back to urgency when there is no conviction', () => {
    const c = card(idea({ urgency: 'high', targetPrice: 310 }))
    expect(c.context.map(x => x.label)).toContain('high urgency')
  })

  it('still suppresses low urgency, which is the default and says nothing', () => {
    const c = card(idea({ urgency: 'low', targetPrice: 310 }))
    expect(c.context.map(x => x.label)).not.toContain('low urgency')
  })

  /** The headline already says "in Core Equity". */
  it('states the book exactly once, and the headline is no longer where', () => {
    /**
     * Still one home, and it moved. The headline used to read "... in Core
     * Equity", so the chip was excluded to avoid saying it twice. The headline
     * is now "SELL COIN" and names no book at all, which makes the chip the
     * one place it appears rather than a second copy.
     */
    const c = card(idea({ portfolioName: 'Core Equity', conviction: 'high', targetPrice: 310 }))
    expect(c.headline).not.toContain('Core Equity')
    expect(c.context.map(x => x.label)).toContain('Core Equity')
    expect(c.context.filter(x => x.label === 'Core Equity')).toHaveLength(1)
  })

  it('keeps the row short enough to breathe', () => {
    /**
     * Three, not two — and it buys back more than it spends. The row now
     * carries the book and the maturity that used to sit in a separate pill
     * block inside the visual pane, so the card trades two stacked rows above
     * the chart for one horizontal one.
     */
    const c = card(idea({
      conviction: 'high', urgency: 'urgent', portfolioName: 'Core Equity',
      stage: 'deciding', targetPrice: 310,
    }))
    expect(c.context.length).toBeLessThanOrEqual(3)
    // Urgency still yields to conviction; the row never carries both.
    expect(c.context.map(x => x.label).join(' ')).not.toMatch(/urgency/)
  })
})
