/**
 * What the work pane remembers about itself across a tab switch.
 *
 * ── The complaint ─────────────────────────────────────────────────────────
 *
 * Open an asset from a Dashboard alert, expand a supporting section, scroll,
 * go to the canonical Asset page to edit the case, come back. The pane
 * "appeared to reload and rebuild its content" -- which it had: this
 * application renders the active tab only, so the whole Dashboard subtree is
 * unmounted the moment the reader looks at anything else.
 *
 * `place.ts` already returns the lens, the selected name and the open work
 * pane, so the reader does not have to reopen the event. This module covers
 * the two things they had done BY HAND inside the pane, which are the two
 * things they notice are gone.
 *
 * The restore itself touches the DOM and is not verified here: no browser
 * was available, and jsdom has no layout, so `scrollTop` cannot be clamped
 * by a content height that does not exist. What is verified is the contract
 * the restore reads from, including the cases where handing back a value
 * would be wrong.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readPaneView, rememberPaneScroll, isDisclosed, rememberDisclosure,
  forgetPaneViews, NO_PANE_VIEW, LIMIT,
} from '../pane-place'

beforeEach(forgetPaneViews)

describe('where the reader was in the pane', () => {
  it('hands the offset back for the object they left it in', () => {
    rememberPaneScroll('feed:target_hit:AAPL', 820)
    expect(readPaneView('feed:target_hit:AAPL').scrollTop).toBe(820)
  })

  it('starts an object the reader has not been in at the top', () => {
    expect(readPaneView('feed:target_hit:MSFT')).toEqual(NO_PANE_VIEW)
    expect(NO_PANE_VIEW.scrollTop).toBe(0)
  })

  it('keeps the offset for one object out of another', () => {
    rememberPaneScroll('a', 400)
    rememberPaneScroll('b', 90)
    expect(readPaneView('a').scrollTop).toBe(400)
    expect(readPaneView('b').scrollTop).toBe(90)
  })

  it('remembers scrolling back to the top', () => {
    /* Zero is a position, not an absence. Treating it as "nothing stored"
       would hand the reader back the offset they had just left. */
    rememberPaneScroll('a', 600)
    rememberPaneScroll('a', 0)
    expect(readPaneView('a').scrollTop).toBe(0)
  })

  it('refuses a value the DOM could not give it', () => {
    /* A stored NaN is applied on the way back and moves the reader nowhere
       in particular, which reads as the surface jumping. */
    rememberPaneScroll('a', 500)
    rememberPaneScroll('a', Number.NaN)
    rememberPaneScroll('a', Number.POSITIVE_INFINITY)
    expect(readPaneView('a').scrollTop).toBe(500)
  })

  it('never hands back a negative offset', () => {
    rememberPaneScroll('a', -40)
    expect(readPaneView('a').scrollTop).toBe(0)
  })

  it('ignores an object with no identity', () => {
    rememberPaneScroll(null, 300)
    expect(readPaneView(null)).toEqual(NO_PANE_VIEW)
    expect(readPaneView(undefined)).toEqual(NO_PANE_VIEW)
  })
})

describe('the memory is bounded', () => {
  it('drops the least recently touched object past the limit', () => {
    /* A reader works through dozens of names in a session, and a map that
       only grows is a leak however small each entry is. */
    for (let i = 0; i < LIMIT; i++) rememberPaneScroll(`k${i}`, (i + 1) * 10)
    expect(readPaneView('k0').scrollTop).toBe(10)

    rememberPaneScroll('overflow', 999)
    expect(readPaneView('k0')).toEqual(NO_PANE_VIEW)
    /* And the rest survive, so the eviction is a limit and not a flush. */
    expect(readPaneView('k1').scrollTop).toBe(20)
    expect(readPaneView('overflow').scrollTop).toBe(999)
  })

  it('counts recency by the last write, not the first', () => {
    for (let i = 0; i < LIMIT; i++) rememberPaneScroll(`k${i}`, 10)
    /* The reader comes back to the oldest one, which makes it the newest. */
    rememberPaneScroll('k0', 55)
    rememberPaneScroll('overflow', 999)

    expect(readPaneView('k0').scrollTop).toBe(55)
    /* `k1` is now the one nobody has touched longest. */
    expect(readPaneView('k1')).toEqual(NO_PANE_VIEW)
  })

  it('does not grow when the same object is written repeatedly', () => {
    for (let i = 0; i < LIMIT * 4; i++) rememberPaneScroll('a', i)
    rememberPaneScroll('b', 1)
    expect(readPaneView('a').scrollTop).toBe(LIMIT * 4 - 1)
    expect(readPaneView('b').scrollTop).toBe(1)
  })
})

describe('what the reader had open', () => {
  it('remembers a disclosure they opened', () => {
    expect(isDisclosed('a-aapl')).toBe(false)
    rememberDisclosure('a-aapl', true)
    expect(isDisclosed('a-aapl')).toBe(true)
  })

  it('forgets one they closed again', () => {
    rememberDisclosure('a-aapl', true)
    rememberDisclosure('a-aapl', false)
    expect(isDisclosed('a-aapl')).toBe(false)
  })

  it('keys the choice to the name, not to the card that opened it', () => {
    /* "Show me what else is on record for AAPL" is a decision about AAPL,
       so arriving at the same name from a different finding keeps it, while
       a different name does not inherit it. */
    rememberDisclosure('a-aapl', true)
    expect(isDisclosed('a-aapl')).toBe(true)
    expect(isDisclosed('a-msft')).toBe(false)
  })

  it('is independent of the scroll memory', () => {
    /* They are about different things and are evicted differently: the
       offset belongs to a rendered surface, the disclosure to a name. */
    rememberDisclosure('a-aapl', true)
    for (let i = 0; i < LIMIT * 2; i++) rememberPaneScroll(`k${i}`, 10)
    expect(isDisclosed('a-aapl')).toBe(true)
  })

  it('ignores a disclosure with no identity', () => {
    rememberDisclosure(null, true)
    expect(isDisclosed(null)).toBe(false)
    expect(isDisclosed(undefined)).toBe(false)
  })
})
