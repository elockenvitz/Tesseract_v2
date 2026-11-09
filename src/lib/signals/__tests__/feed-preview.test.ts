/**
 * The preview descriptor picks an object from data the pool ALREADY holds.
 *
 * These pin the two claims that matter: richer structured truth produces a
 * richer object, and absence produces nothing rather than a decorative
 * substitute.
 */

import { describe, it, expect } from 'vitest'
import { previewFor, previewsFor, previewSymbol } from '../feed-preview'
import type { SignalCard } from '../contract'

const card = (over: Record<string, unknown> = {}) => ({
  id: 'c1', type: 'crowding', headline: 'h', surface: 'risk',
  entity: { kind: 'asset', id: 'a1', name: 'A', ticker: 'AAA' },
  ...over,
} as unknown as SignalCard)

describe('previewFor', () => {
  it('turns a crowding count into the distribution behind it', () => {
    const p = previewFor('crowding', card(), {
      weightsByPortfolio: [
        { id: '1', name: 'Core', weightPct: 6.2, valueUsd: 1 },
        { id: '2', name: 'Growth', weightPct: 2.1, valueUsd: 1 },
        { id: '3', name: 'Income', weightPct: 0.9, valueUsd: 1 },
      ],
    }, undefined)
    expect(p?.kind).toBe('exposure')
    // Sorted heaviest first — "where is concentration greatest" is the question.
    expect(p && p.kind === 'exposure' && p.rows.map(r => r.label)).toEqual(['Core', 'Growth', 'Income'])
  })

  /** One book is not a distribution; the metric already says the count. */
  it('draws nothing for a single-book crowding row', () => {
    expect(previewFor('crowding', card(), {
      weightsByPortfolio: [{ id: '1', name: 'Core', weightPct: 6.2, valueUsd: 1 }],
    }, undefined)).toBeNull()
  })

  it('puts conviction against its benchmark so the divergence is visible', () => {
    const p = previewFor('conviction', card({ type: 'conviction_oversized' }), {
      weightPct: 5.4, benchmarkPct: 1.2, portfolioName: 'Core', conviction: 'low',
    }, undefined)
    expect(p?.kind).toBe('exposure')
    expect(p && p.kind === 'exposure' && p.rows.length).toBe(2)
  })

  /** A missing benchmark is not zero. Asserting an underweight nobody measured. */
  it('draws nothing for conviction with no benchmark', () => {
    expect(previewFor('conviction', card(), {
      weightPct: 5.4, benchmarkPct: null, portfolioName: 'Core',
    }, undefined)).toBeNull()
  })

  /** Dated closes, because the desktop chart reads out the date under the cursor. */
  const series = (...closes: number[]) =>
    closes.map((close, i) => ({ date: `2026-01-0${i + 1}`, close }))

  it('carries a declared target onto the price path', () => {
    const c = card({ type: 'target_hit', evidence: { kind: 'sparkline', data: { target: 310 } } })
    const p = previewFor('target_hit', c, null, series(100, 120, 140))
    expect(p).toEqual({ kind: 'price', series: series(100, 120, 140), reference: 310 })
  })

  it('draws no line from a single close', () => {
    const c = card({ type: 'trade_idea', evidence: { kind: 'sparkline', data: { symbol: 'AAA' } } })
    expect(previewFor('post', c, null, series(100))).toBeNull()
    expect(previewFor('post', c, null, undefined)).toBeNull()
  })

  it('leaves prose families alone', () => {
    for (const f of ['post', 'stale_target']) {
      expect(previewFor(f, card({ evidence: undefined }), null, undefined)).toBeNull()
    }
  })

  /*
   * ── The gate widened, and it had to ──────────────────────────────────────
   *
   * This asserted that a card with no sparkline evidence names no symbol,
   * because the batched price read had exactly one consumer: the sparkline
   * branch. That made the rule circular as soon as a scenario or exposure
   * card gained a Price pane -- the pane needs the series, the series is only
   * fetched for cards that name a symbol, and only price cards named one. A
   * ladder card could never reach its own price.
   *
   * The question the batch is really asking is "is this card about a name",
   * so that is what it asks now. The claim the old case protected -- the
   * batch never grows by a symbol with nothing to draw -- still holds and is
   * pinned below, on the shape that actually has no ticker rather than on the
   * shape that merely had no sparkline.
   */
  it('names the symbol for any card about a name, so its price can be reached', () => {
    expect(previewSymbol(card({ evidence: { kind: 'sparkline', data: { symbol: 'msft' } } }))).toBe('MSFT')
    // A sparkline's own symbol still wins: its line was computed for that one,
    // which is not always the card's entity.
    expect(previewSymbol(card({ evidence: { kind: 'sparkline', data: {} } }))).toBe('AAA')
    // The case that changed. A ladder card is about AAA and can now show it.
    expect(previewSymbol(card({ evidence: { kind: 'scenario_ladder', data: {} } }))).toBe('AAA')
    expect(previewSymbol(card({ evidence: undefined }))).toBe('AAA')
  })

  it('names nothing for a card that is about no name', () => {
    // A prompt, a thought, a card about a book. Nothing to fetch, so the
    // batch does not grow for it.
    expect(previewSymbol(card({ entity: { kind: 'prompt', id: 'p1', name: 'P' } }))).toBeNull()
    expect(previewSymbol(card({ entity: undefined }))).toBeNull()
    expect(previewSymbol(card({ entity: { kind: 'asset', id: 'a1', name: 'A', ticker: null } }))).toBeNull()
  })
})

/**
 * The carousel's list, which is the whole point of the change above.
 *
 * `previewFor` answers with at most one object by a chain of early returns.
 * These pin that `previewsFor` composes the same branches without them
 * cutting each other off, and that it adds nothing the card did not already
 * have.
 */
describe('previewsFor', () => {
  const series = (...closes: number[]) =>
    closes.map((close, i) => ({ date: `2026-01-0${i + 1}`, close }))

  const ladderCard = () => card({
    type: 'scenario_gap',
    evidence: { kind: 'scenario_ladder', data: { price: 100, cases: [{ a: 1 }] } },
  })

  it('leads with the finding and trails it with the price', () => {
    const panes = previewsFor('scenario_gap', ladderCard(), null, series(100, 120, 140))
    expect(panes.map(p => p.label)).toEqual(['Cases', 'Price'])
    /* The finding first, because the headline is about it and a reader who
       pages nowhere must still be looking at the right thing. */
    expect(panes[0].preview.kind).toBe('scenario_ladder')
    expect(panes[1].preview.kind).toBe('price')
  })

  it('gives an exposure card its price too', () => {
    const panes = previewsFor('crowding', card(), {
      weightsByPortfolio: [
        { id: '1', name: 'Core', weightPct: 6.2, valueUsd: 1 },
        { id: '2', name: 'Growth', weightPct: 2.1, valueUsd: 1 },
      ],
    }, series(100, 120))
    expect(panes.map(p => p.label)).toEqual(['Exposure', 'Price'])
  })

  it('does not show the price twice when the price IS the finding', () => {
    const c = card({ type: 'target_hit', evidence: { kind: 'sparkline', data: { target: 310 } } })
    const panes = previewsFor('target_hit', c, null, series(100, 120, 140))
    expect(panes.map(p => p.label)).toEqual(['Price'])
    /* And it keeps the reference the sparkline branch read off its evidence,
       rather than being replaced by the bare second pane. */
    expect(panes[0].preview.kind === 'price' && panes[0].preview.reference).toBe(310)
  })

  it('adds no price pane without a line to draw', () => {
    /* One close is not a path. Same floor the sparkline branch uses: a flat
       stroke through a single point is a claim nobody made. */
    expect(previewsFor('scenario_gap', ladderCard(), null, series(100)).map(p => p.label))
      .toEqual(['Cases'])
    expect(previewsFor('scenario_gap', ladderCard(), null, undefined).map(p => p.label))
      .toEqual(['Cases'])
  })

  it('draws no reference line on the trailing price pane', () => {
    /* The cases are on the pane before it. A `reference` here would have to
       be invented, since a scenario card declares no target. */
    const panes = previewsFor('scenario_gap', ladderCard(), null, series(100, 120, 140))
    expect(panes[1].preview.kind === 'price' && panes[1].preview.reference).toBeNull()
  })

  it('stays empty for a card with no object at all', () => {
    expect(previewsFor('post', card({ evidence: undefined }), null, undefined)).toEqual([])
  })
})
