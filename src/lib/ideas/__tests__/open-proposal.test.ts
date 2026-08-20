import { describe, expect, it } from 'vitest'

import {
  MAX_LEGS_PER_PAIR, OPEN_PROPOSAL_STATUSES, PAIRS_PER_PAGE,
  pairIsOpen, pairLegWindow, pairPageSlice,
} from '../open-proposal'

const PAGE = 15

describe('what counts as an idea', () => {
  it('keeps proposals that are still arguable', () => {
    // Everything a colleague could still change your mind about.
    for (const s of ['idea', 'discussing', 'deciding', 'simulating', 'approved']) {
      expect(pairIsOpen([s])).toBe(true)
    }
  })

  it('drops proposals whose argument is over', () => {
    /**
     * Executed, rejected, cancelled and archived trades are history. They may
     * be worth seeing, but as decisions rather than as ideas — filing them
     * under Ideas turns that filter into a list of everything that ever
     * happened, which is what it had become.
     */
    for (const s of ['executed', 'rejected', 'cancelled', 'archived', 'deleted']) {
      expect(pairIsOpen([s])).toBe(false)
      expect(OPEN_PROPOSAL_STATUSES).not.toContain(s)
    }
  })

  it('treats a pair as open when any leg is', () => {
    // Legs do not move together. A pair whose long side is approved while the
    // short is still being modelled is very much a live question, and
    // requiring unanimity would hide it exactly when a second opinion matters.
    expect(pairIsOpen(['executed', 'deciding'])).toBe(true)
    expect(pairIsOpen(['executed', 'executed'])).toBe(false)
  })

  it('ignores legs with no status at all', () => {
    expect(pairIsOpen([null, undefined])).toBe(false)
  })
})

describe('pair pagination', () => {
  it('gives each page its own pairs', () => {
    /**
     * The defect this replaces: the pair source had no offset, so every page
     * regrouped the same slab of legs and returned the same pairs. On a phone
     * that was "the same pair trade shows a bunch of times" — once per page
     * scrolled — and, because single ideas advanced properly while pairs were
     * re-added, the pair share of the Ideas filter grew until it was nearly
     * all of it.
     */
    const seen = new Set<number>()
    for (let page = 0; page < 10; page++) {
      const [from, to] = pairPageSlice(page * PAGE, PAGE)
      for (let i = from; i < to; i++) {
        expect(seen.has(i)).toBe(false)
        seen.add(i)
      }
    }
    expect(seen.size).toBe(10 * PAIRS_PER_PAGE)
  })

  it('advances by exactly one page-worth', () => {
    expect(pairPageSlice(0, PAGE)).toEqual([0, PAIRS_PER_PAGE])
    expect(pairPageSlice(PAGE, PAGE)).toEqual([PAIRS_PER_PAGE, PAIRS_PER_PAGE * 2])
  })

  it('reads enough legs to satisfy its own slice, at every depth', () => {
    /**
     * The invariant tying the two together. Grouping must happen before
     * slicing, so the window has to COVER the slice rather than slide to it —
     * and it has to hold in the worst case, where every pair carries the
     * maximum number of legs. If this ever fails, deep pages silently return
     * fewer pairs than they claim.
     */
    for (let page = 0; page < 40; page++) {
      const offset = page * PAGE
      const [, to] = pairPageSlice(offset, PAGE)
      expect(pairLegWindow(offset, PAGE)).toBeGreaterThanOrEqual(to * MAX_LEGS_PER_PAIR)
    }
  })

  it('stays bounded rather than growing with the whole table', () => {
    // Linear in scroll depth, not in how many pairs exist. Page 3 reads tens
    // of rows, not thousands.
    expect(pairLegWindow(3 * PAGE, PAGE)).toBeLessThan(100)
  })

  it('treats a cursor before the first page as the first page', () => {
    expect(pairPageSlice(-5, PAGE)).toEqual([0, PAIRS_PER_PAGE])
  })
})
