/**
 * A pair trade is a trade, everywhere one row is asked what it is.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * MEASURED on the live field, reading the item off each tile's own fiber:
 *
 *   MCD    signalType 'thought'      postKind 'trade_idea'
 *   LLY    signalType 'thought'      postKind 'trade_idea'
 *
 * One row, two answers. `ideaSignalType` admitted only `trade` and
 * `trade_idea`, so a `pair_trade` fell to `thought` -- and `ideasToExplore`
 * computed its own `isTrade` the same narrow way, so the tile also took the
 * quote treatment a colleague's written thought gets. The consequence reaches
 * the chip the reader sees, the pill filter that chip feeds, the family the
 * ranker tiers on, and the headline the tile prints.
 *
 * ── Why this is a fix and not a re-coarsening ─────────────────────────────
 *
 * `ideaSignalType` collapses `note`, `thesis_update`, `insight` and `message`
 * into `thought` ON PURPOSE -- all four are somebody writing something, and
 * the tail of the feed ranks more coherently for it. That argument does not
 * reach a pair trade, which is a proposed position with a direction and a
 * size. `ideaCardType` has always typed it `pair_trade`; only the coarse
 * trade-or-not question got it wrong.
 *
 * The deliberate collapses are asserted here too, so a later edit cannot cite
 * this fix as licence to un-collapse them.
 */
import { describe, it, expect } from 'vitest'
import { ideaSignalType, isTradePostType, postKindOf, entrySignalType } from '../entry-signal-type'
import { ideasToExplore } from '../explore-adapters'

const post = (type: string) => ({
  id: 'p1', type, content: 'Long MCD short YUM',
  asset: { id: 'a1', symbol: 'MCD', company_name: "McDonald's" },
  author: { first_name: 'John', last_name: 'Homler' },
})

describe('every reader agrees a pair trade is a trade', () => {
  it.each(['trade', 'trade_idea', 'pair_trade'])('types %s as a trade', type => {
    expect(isTradePostType(type)).toBe(true)
    expect(ideaSignalType(type)).toBe('trade_idea')
    expect(postKindOf({ type })).toBe('trade_idea')
  })

  /** THE case: the two answers that disagreed on the live field. */
  it('gives a pair trade one identity, not two', () => {
    const [item] = ideasToExplore([post('pair_trade')])
    expect(item.signalType).toBe('trade_idea')
    expect(item.postKind).toBe('trade_idea')
  })

  /** The chip and the pill filter read this one. */
  it('names the trade family on the entry resolver too', () => {
    expect(entrySignalType({ kind: 'idea', idea: { type: 'pair_trade' } })).toBe('trade_idea')
  })

  /**
   * A trade is titled as a trade. The quote treatment is for a colleague's
   * written thought, and a pair trade was taking it.
   */
  it('does not dress a pair trade as somebody’s written thought', () => {
    const [pair] = ideasToExplore([post('pair_trade')])
    const [trade] = ideasToExplore([post('trade_idea')])
    const [thought] = ideasToExplore([post('quick_thought')])
    expect(pair.title).toBe(trade.title)
    expect(pair.title).not.toBe(thought.title)
  })
})

describe('the deliberate collapses are left exactly as they are', () => {
  /**
   * Not an oversight and not licence: these four are all somebody writing
   * something, and the feed's tail ranks more coherently for ranking them
   * alike. Asserted so the pair-trade fix cannot be cited to undo them.
   */
  it.each(['note', 'thesis_update', 'insight', 'message'])(
    'still ranks %s as a thought',
    type => {
      expect(isTradePostType(type)).toBe(false)
      expect(ideaSignalType(type)).toBe('thought')
    },
  )

  it('still claims nothing for an unknown type', () => {
    expect(ideaSignalType('something_else')).toBe('thought')
    expect(postKindOf({ type: 'something_else' })).toBeNull()
  })
})
