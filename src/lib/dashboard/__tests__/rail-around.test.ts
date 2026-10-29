/**
 * The rail's window: what it shows, in what order, and how much of it.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * `railAround` had no behavioural test at all. What guarded it was four
 * SOURCE-TEXT assertions in `convergence.test.ts` -- that the function
 * contains the string `const after = cards.slice(at + 1)`, that the deck
 * contains `railAround(rail, activeId)`. Those catch a rewrite that deletes
 * a line. They cannot catch the window returning the wrong cards, and they
 * did not notice that every caller was silently taking a cap of 5.
 *
 * Measured with a card open on Ideas at 1920x889: five cards came to 470px
 * inside a 733px rail that already scrolls, leaving 209px of empty column,
 * while 50 of the field's 55 peers sat unused in the array that was passed
 * in. Nothing failed, because nothing was asking.
 *
 * ── What the first draft of this file got wrong ───────────────────────────
 *
 * It asserted that widening the window only APPENDS -- that the first five
 * cards are the same bounded or not. That is false, and the test caught it:
 * at a cap of 5 the rail was only what comes AFTER the active card, so
 * removing the cap puts the head of the field ABOVE it. The claim is kept
 * here as the assertion it became, because it is the behavioural difference
 * the cap was hiding and the one thing a reader will notice.
 */
import { describe, it, expect } from 'vitest'
import { railAround, type RailCard } from '../focus'

const card = (id: string): RailCard => ({
  id,
  workspaceLens: 'research',
  objectType: 'asset',
  symbol: id,
  reason: 'framework',
  tone: 'neutral',
  figure: null,
  figureLabel: null,
  detail: null,
})

const ids = (cards: RailCard[]) => cards.map(c => c.id)
const field = (n: number) => Array.from({ length: n }, (_, i) => card(`A${i}`))

describe('the rail is a contiguous slice of the deck, in the deck\'s order', () => {
  it('never shows the active card as a peer', () => {
    expect(ids(railAround(field(6), 'A3'))).not.toContain('A3')
    expect(ids(railAround(field(6), 'A3', 4))).not.toContain('A3')
  })

  it('does not wrap from the end back to the head', () => {
    /* The defect this ordering replaced: wrapping told a reader that rank
       #15 is followed by rank #1. It is not. Whatever the window contains,
       it reads in ascending rank -- a neighbourhood, never a loop. */
    for (const active of ['A0', 'A3', 'A5']) {
      for (const cap of [undefined, 2, 4, 5]) {
        const r = ids(railAround(field(6), active, cap))
        expect([...r].sort()).toEqual(r)
      }
    }
  })

  it('leads with what follows when the window is bounded', () => {
    /* Forward bias: a bounded rail spends its few rows on what comes next,
       not on work the reader has already passed. */
    expect(ids(railAround(field(20), 'A4', 5))).toEqual(['A5', 'A6', 'A7', 'A8', 'A9'])
  })

  it('puts preceding work BEFORE what follows when it must backfill', () => {
    const r = ids(railAround(field(6), 'A4', 3))
    expect(r).toEqual(['A2', 'A3', 'A5'])
    expect(r.indexOf('A3')).toBeLessThan(r.indexOf('A5'))
  })

  it('falls back to the head when the active card is not in the set', () => {
    expect(ids(railAround(field(4), 'nobody'))).toEqual(['A0', 'A1', 'A2', 'A3'])
    expect(ids(railAround(field(4), null))).toEqual(['A0', 'A1', 'A2', 'A3'])
  })

  it('survives an empty population and a one-card one', () => {
    expect(railAround([], 'A0')).toEqual([])
    expect(railAround([card('A0')], 'A0')).toEqual([])
  })
})

describe('the window is unbounded unless a caller bounds it', () => {
  /*
   * `limit` defaulted to 5 and every caller took the default, so a 56-card
   * Ideas field showed five peers and dropped fifty. The rail already
   * scrolls; the cap was protecting nothing.
   */
  it('returns every peer when no limit is given', () => {
    expect(railAround(field(56), 'A0')).toHaveLength(55)
    expect(railAround(field(56), 'A30')).toHaveLength(55)
    expect(railAround(field(56), 'A55')).toHaveLength(55)
  })

  it('is the whole deck with the active card removed, in rank order', () => {
    expect(ids(railAround(field(6), 'A3'))).toEqual(['A0', 'A1', 'A2', 'A4', 'A5'])
  })

  it('keeps the whole head rather than slicing it empty', () => {
    /* `cap - after.length` is Infinity here, and `Math.max(0, -Infinity)`
       is 0 -- the arithmetic that makes "no bound" mean the whole list
       rather than an empty slice. Get this wrong and the rail silently
       loses everything above the active card. */
    expect(ids(railAround(field(5), 'A4'))).toEqual(['A0', 'A1', 'A2', 'A3'])
  })

  it('still honours a limit a caller actually states', () => {
    expect(ids(railAround(field(56), 'A0', 3))).toEqual(['A1', 'A2', 'A3'])
    expect(railAround(field(56), 'A0', 0)).toEqual([])
  })

  it('moves the top of the rail, which is the visible consequence', () => {
    /*
     * THIS is what removing the cap changes for a reader, and it is worth
     * an assertion rather than a comment: bounded, the rail opened on the
     * cards after theirs; unbounded, it opens on the head of the field and
     * their card's followers are further down the column.
     *
     * Deliberate -- the window is contiguous and in rank order, and the
     * alternative (followers, then the head underneath) is the wrap this
     * function exists to prevent. If the rail should instead OPEN scrolled
     * to the active card's position, that is a scroll concern in the deck,
     * not a different window.
     */
    expect(ids(railAround(field(20), 'A4', 5))[0]).toBe('A5')
    expect(ids(railAround(field(20), 'A4'))[0]).toBe('A0')
    /* And nothing is lost in the move: the bounded window is still in there. */
    const all = ids(railAround(field(20), 'A4'))
    for (const id of ids(railAround(field(20), 'A4', 5))) expect(all).toContain(id)
  })
})
