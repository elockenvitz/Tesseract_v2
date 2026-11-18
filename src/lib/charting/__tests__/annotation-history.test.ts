/**
 * Undo and redo for chart drawings, which did not exist before.
 *
 * `grep -rniE "undo|redo"` over `pages/ChartingPage.tsx` and all of
 * `components/charting` returned nothing: the only way back from a misplaced
 * mark was "Clear All Annotations", which takes every other mark with it.
 */
import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  LIMIT,
  present,
  redo,
  reset,
  undo,
  type History,
} from '../annotation-history'

/** The subject is an array of marks; a string per state is enough to track it. */
type S = readonly string[]
const h0 = () => createHistory<S>([])

/** Commit a fresh array each time, as the page does on every edit. */
const add = (h: History<S>, mark: string) => commit(h, [...present(h), mark])

describe('a new history', () => {
  it('holds the present and nothing before it', () => {
    const h = h0()
    expect(present(h)).toEqual([])
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('reports no undo rather than offering a no-op one', () => {
    /*
     * An undo that silently returned the same state would leave the control
     * looking available and doing nothing. The caller asks `canUndo` and the
     * answer at the start is no.
     */
    const h = h0()
    expect(undo(h)).toBe(h)
  })
})

describe('drawing, then taking it back', () => {
  it('returns the chart to the state before the mark', () => {
    const drawn = add(h0(), 'trend-line')
    expect(present(drawn)).toEqual(['trend-line'])
    expect(present(undo(drawn))).toEqual([])
  })

  it('walks back through several marks one at a time', () => {
    let h = h0()
    h = add(h, 'a'); h = add(h, 'b'); h = add(h, 'c')
    expect(present(h)).toEqual(['a', 'b', 'c'])
    h = undo(h); expect(present(h)).toEqual(['a', 'b'])
    h = undo(h); expect(present(h)).toEqual(['a'])
    h = undo(h); expect(present(h)).toEqual([])
    expect(canUndo(h)).toBe(false)
  })

  it('redoes exactly what was undone', () => {
    const drawn = add(h0(), 'rectangle')
    const back = undo(drawn)
    expect(canRedo(back)).toBe(true)
    expect(present(redo(back))).toEqual(['rectangle'])
  })

  it('redoes in the order the steps were undone', () => {
    let h = h0()
    h = add(h, 'a'); h = add(h, 'b')
    h = undo(undo(h))
    h = redo(h); expect(present(h)).toEqual(['a'])
    h = redo(h); expect(present(h)).toEqual(['a', 'b'])
    expect(canRedo(h)).toBe(false)
  })

  it('refuses a redo with nothing ahead', () => {
    const h = add(h0(), 'a')
    expect(redo(h)).toBe(h)
  })
})

describe('drawing after an undo closes the branch', () => {
  it('discards the redo future', () => {
    /*
     * The standard rule. Keeping the future would let a later redo splice a
     * mark the analyst had already rejected back onto a chart they have
     * since changed.
     */
    let h = h0()
    h = add(h, 'a'); h = add(h, 'b')
    h = undo(h)                       // present ['a'], future holds ['a','b']
    expect(canRedo(h)).toBe(true)
    h = add(h, 'c')                   // a new branch
    expect(canRedo(h)).toBe(false)
    expect(present(h)).toEqual(['a', 'c'])
  })
})

describe('a redundant commit does not consume a step', () => {
  it('ignores a commit of the identical reference', () => {
    /*
     * A canvas emits many redundant updates -- a mouse-up after a drag that
     * moved nothing, a style re-applied with the same value. Each would
     * otherwise eat an undo step, so the reader presses Ctrl+Z and watches
     * nothing happen.
     */
    const h = add(h0(), 'a')
    const same = commit(h, present(h))
    expect(same).toBe(h)
    expect(same.past.length).toBe(h.past.length)
  })

  it('keeps a commit that is equal by value but a new array', () => {
    /* Reference equality only, by design: deep-comparing every commit costs
       more than the step it would save. */
    const h = add(h0(), 'a')
    const next = commit(h, ['a'])
    expect(next).not.toBe(h)
    expect(canUndo(next)).toBe(true)
  })
})

describe('the history is bounded, and drops the oldest end', () => {
  it(`keeps at most ${LIMIT} states`, () => {
    let h = h0()
    for (let i = 0; i < LIMIT * 2; i++) h = add(h, `m${i}`)
    expect(h.past.length).toBe(LIMIT)
  })

  it('keeps the PRESENT when it trims, not the oldest', () => {
    /*
     * Trimming the wrong end would quietly discard the analyst's current
     * drawing and leave an ancient state showing.
     *
     * (That sentence avoids the word "screen" followed by a full stop on
     * purpose: `vitest.config.ts` classifies a test as needing a DOM by
     * regex over its SOURCE TEXT, and `screen\.` in a comment was enough to
     * route this pure module into jsdom.)
     */
    let h = h0()
    for (let i = 0; i < LIMIT * 2; i++) h = add(h, `m${i}`)
    const now = present(h)
    expect(now[now.length - 1]).toBe(`m${LIMIT * 2 - 1}`)
    expect(canUndo(h)).toBe(true)
  })

  it('can still undo the full depth after trimming', () => {
    let h = h0()
    for (let i = 0; i < LIMIT * 2; i++) h = add(h, `m${i}`)
    let steps = 0
    while (canUndo(h)) { h = undo(h); steps++ }
    expect(steps).toBe(LIMIT - 1)
  })
})

describe('every operation leaves the previous history untouched', () => {
  it('does not mutate on commit, undo or redo', () => {
    const start = add(h0(), 'a')
    const snapshot = { past: [...start.past], future: [...start.future] }
    const after = redo(undo(add(start, 'b')))
    expect(start.past).toEqual(snapshot.past)
    expect(start.future).toEqual(snapshot.future)
    /* And the new history really is new. */
    expect(after).not.toBe(start)
  })
})

describe('reset is for a change that is not an edit', () => {
  it('replaces the present and offers no way back', () => {
    /*
     * Switching the panel to another symbol. Were that an undoable step,
     * Ctrl+Z would put the previous asset's drawings onto this chart -- a
     * cross-asset mark that looks like analysis and is not.
     */
    const drawn = add(h0(), 'aapl-line')
    /* There really was a step to lose, so the assertions below mean
       something: a reset of an already-empty history proves nothing. */
    expect(canUndo(drawn)).toBe(true)
    const switched = reset<S>([])
    expect(present(switched)).toEqual([])
    expect(canUndo(switched)).toBe(false)
    expect(canRedo(switched)).toBe(false)
  })

  it('drops a pending redo future as well', () => {
    let h = h0()
    h = add(h, 'a'); h = add(h, 'b'); h = undo(h)
    expect(canRedo(h)).toBe(true)
    expect(canRedo(reset<S>(present(h)))).toBe(false)
  })
})
