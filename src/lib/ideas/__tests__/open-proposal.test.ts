import { describe, expect, it } from 'vitest'

import {
  MAX_LEGS_PER_PAIR, OPEN_PROPOSAL_STATUSES, PAIRS_PER_PAGE, PROPOSAL_DAYS_BACK,
  pairIsOpen, pairLegWindow, pairPageSlice, proposalWindowDays,
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

describe('a pair trade cannot be recreated across pages', () => {
  /**
   * The regression guard the phase asks for.
   *
   * There is exactly one pair trade in production, and it appeared once per
   * page the reader scrolled — because the pair source regrouped the same slab
   * of legs on every page with no offset. Deduping the symptom is not enough:
   * if the slices ever overlap again, the same pair object is genuinely built
   * twice and every downstream consumer sees two.
   */
  it('never emits the same pair id on two different pages', () => {
    const PAIRS = Array.from({ length: 30 }, (_, i) => `pair-${i}`)
    const emitted: string[] = []
    for (let page = 0; page < 10; page++) {
      const [from, to] = pairPageSlice(page * PAGE, PAGE)
      emitted.push(...PAIRS.slice(from, to))
    }
    expect(new Set(emitted).size).toBe(emitted.length)
  })

  it('advances even when a page yields no OPEN pairs', () => {
    /**
     * Openness is judged after grouping, so a page can legitimately come back
     * empty. The cursor must still move — a slice that stalls would serve the
     * same window forever, which is the original defect wearing a status
     * filter.
     */
    const a = pairPageSlice(0, PAGE)
    const b = pairPageSlice(PAGE, PAGE)
    expect(b[0]).toBeGreaterThanOrEqual(a[1])
  })

  it('keeps a pair whole rather than splitting it across pages', () => {
    // Slicing is over PAIRS, never over legs. A pair split at a read boundary
    // would render as two half-pairs, each missing a side.
    const [from, to] = pairPageSlice(3 * PAGE, PAGE)
    expect(Number.isInteger(from)).toBe(true)
    expect(Number.isInteger(to)).toBe(true)
    expect(to - from).toBe(PAIRS_PER_PAGE)
  })
})

describe('an open proposal does not age out of the feed', () => {
  it('ignores the scroll-widened window', () => {
    /**
     * Measured against production on 2026-08-21: the reporting org had 23 open
     * single proposals and exactly ONE created in the last 90 days. The feed
     * opens at 90 days and widens 30 per page, so the Ideas filter showed one
     * idea and reaching the rest meant scrolling about ten pages.
     *
     * Status already decides whether a proposal belongs. Age should not decide
     * it again — a February idea nobody has executed, rejected or cancelled is
     * arguably more worth surfacing than one raised last week.
     */
    expect(proposalWindowDays(undefined, 90)).toBe(PROPOSAL_DAYS_BACK)
    expect(proposalWindowDays('all', 90)).toBe(PROPOSAL_DAYS_BACK)
    expect(PROPOSAL_DAYS_BACK).toBeGreaterThanOrEqual(365)
  })

  it('covers every open proposal the reporting org actually has', () => {
    // The oldest was 2026-02-02 against a feed measured on 2026-08-21 — about
    // 200 days. A year of headroom covers that without being unbounded.
    const oldestObservedDays = 200
    expect(proposalWindowDays(undefined, 90)).toBeGreaterThan(oldestObservedDays)
  })

  it('still honours a narrower window the reader asked for explicitly', () => {
    // Somebody who asks for the last week means it. Quietly serving a year
    // would be the same mistake in the other direction.
    expect(proposalWindowDays('week', 7)).toBe(7)
    expect(proposalWindowDays('day', 1)).toBe(1)
    expect(proposalWindowDays('month', 30)).toBe(30)
  })

  it('stays bounded', () => {
    // An unbounded feed query is a table scan waiting to happen.
    expect(Number.isFinite(proposalWindowDays(undefined, 90))).toBe(true)
  })
})
