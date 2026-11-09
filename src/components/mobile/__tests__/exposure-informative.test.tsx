/**
 * An exposure bar is a measurement, and a crowding card is about the spread.
 *
 * ── The two defects ───────────────────────────────────────────────────────
 *
 * MEASURED live at 1920x889 on META's "held across N portfolios" tile:
 *
 *   headline        "4.8% OF VISION FUND 10K"
 *   the picture     one indigo bar filling ~24% of its track
 *   the ruler       absent -- the quarter ticks rendered only when `grow`
 *   the ceiling     unnamed, so the 24% fill meant nothing on the page
 *   the other books four of the five, discarded at the adapter
 *
 * 1. NO RULER AT TILE SIZE. The ticks were gated behind `grow`, which is hero
 *    and large tiles only. On every other tile -- the majority of the field --
 *    4.8% and 9.6% were two indistinguishable rectangles. A fill with no scale
 *    is not a quantity, and the scale is the part that cannot be the thing
 *    dropped when the tile is small.
 *
 * 2. THE SPREAD WAS THROWN AWAY. `usePortfolioLenses` returns
 *    `weightsByPortfolio` on every crowding row, weight-ordered, and the phone
 *    has rendered the full spread from it for two releases. The Explore adapter
 *    read `[0].name` for a caption and dropped the rest, so a card whose whole
 *    claim is "five books carry this name" drew one book.
 *
 * ── What is asserted, and what cannot be ──────────────────────────────────
 *
 * GEOMETRY is not: jsdom performs no layout, so every rect reads 0 and the
 * pixel figures above were measured in the running app. What is asserted is
 * the source of each number and the presence of each mark -- both things an
 * edit could silently undo, and neither of which needs layout.
 *
 * PROVENANCE is the point of the spread cases. Every row must trace to a
 * `weightsByPortfolio` entry; a row the component invented, re-sorted or
 * re-scaled to its own set would be a figure with no source, which this
 * codebase forbids.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ExploreVisualBlock } from '../ExploreVisual'
import type { ExploreVisual } from '../../../lib/mobile/explore-visual'
import { exploreVisualFor } from '../../../lib/mobile/explore-visual'
import type { ExploreItem } from '../../../lib/mobile/explore-item'

const NOW = Date.UTC(2026, 0, 1)

const draw = (visual: ExploreVisual, fill?: boolean) => {
  const { container } = render(
    <ExploreVisualBlock visual={visual} now={NOW} density="tile" fill={fill} />,
  )
  const root = container.querySelector('[data-explore-visual="exposure"]')
  if (!root) throw new Error('exposure drew nothing')
  return root
}

const BOOKS = [
  { name: 'Vision Fund 10K', weightPct: 4.8 },
  { name: 'Core Equity', weightPct: 3.1 },
  { name: 'Concentrated Growth', weightPct: 2.2 },
  { name: 'Income', weightPct: 1.4 },
  { name: 'Legacy Sleeve', weightPct: 0.6 },
]

describe('the bar carries its ruler at every size', () => {
  const one: ExploreVisual = { kind: 'exposure', weightPct: 4.8, portfolioName: 'Vision Fund 10K' }

  /**
   * THE anti-vacuity case for defect 1. A small tile is the common tile, and
   * it is the one that had no scale.
   */
  it('shows all three ticks on a tile that was never grown', () => {
    const root = draw(one, false)
    for (const t of [25, 50, 75]) {
      expect(root.querySelector(`[data-exposure-tick="${t}"]`)).toBeTruthy()
    }
  })

  it('shows them on a grown tile too, so nothing was traded away', () => {
    const root = draw(one, true)
    expect(root.querySelectorAll('[data-exposure-tick]')).toHaveLength(3)
  })

  /** A fraction whose denominator is invisible is not a fraction. */
  it('names the ceiling the fill is read against', () => {
    const root = draw(one, false)
    expect(root.querySelector('[data-exposure-ceiling]')?.textContent).toBe('20%')
  })

  /**
   * Two tiles on the same rung share a scale, so a longer bar means a bigger
   * position. The rung is NOT the tile's own maximum: that would end every
   * bar near the right edge and destroy magnitude altogether.
   */
  it('scales a weight against the rung, never against itself', () => {
    const half = draw({ kind: 'exposure', weightPct: 10 }, false)
    const quarter = draw({ kind: 'exposure', weightPct: 5 }, false)
    expect((half.querySelector('[data-exposure-fill]') as HTMLElement).style.width).toBe('50%')
    expect((quarter.querySelector('[data-exposure-fill]') as HTMLElement).style.width).toBe('25%')
    for (const r of [half, quarter]) {
      expect(r.querySelector('[data-exposure-ceiling]')?.textContent).toBe('20%')
    }
  })

  /**
   * THE case for the ladder, and the defect that produced it.
   *
   * MEASURED on the live field: 3 of 15 headline weights were over 20% and 5
   * of 11 spread rows pegged at 100%, so 28.2%, 25.3% and 29.6% were three
   * identical full bars. A weight above the rung steps the rung up instead of
   * saturating, and the tile says which rung it is on.
   */
  it('steps the rung up rather than pegging a weight above it', () => {
    for (const [weight, rung] of [[28.2, 35], [29.6, 35], [44, 50], [96, 100]] as const) {
      const root = draw({ kind: 'exposure', weightPct: weight }, false)
      const fill = (root.querySelector('[data-exposure-fill]') as HTMLElement).style.width
      expect(fill, `${weight}% pegged`).not.toBe('100%')
      expect(fill).toBe(`${(weight / rung) * 100}%`)
      expect(root.querySelector('[data-exposure-ceiling]')?.textContent).toBe(`${rung}%`)
    }
  })

  /** Past the top rung there is nowhere to step, so it clamps and says 100%. */
  it('clamps only at the top of the ladder', () => {
    const root = draw({ kind: 'exposure', weightPct: 140 }, false)
    expect((root.querySelector('[data-exposure-fill]') as HTMLElement).style.width).toBe('100%')
    expect(root.querySelector('[data-exposure-ceiling]')?.textContent).toBe('100%')
  })
})

describe('a crowding card draws the spread, from the producer rows', () => {
  const spread: ExploreVisual = {
    kind: 'exposure', weightPct: 4.8, portfolioName: 'Vision Fund 10K', books: BOOKS,
  }

  /**
   * THE anti-vacuity case for defect 2: every row's width traces to its own
   * `weightsByPortfolio` entry against the shared ceiling. A component that
   * auto-scaled to its own set would make Legacy Sleeve's 0.6% a full bar.
   */
  it('gives each book a row whose length is that book’s weight on the shared scale', () => {
    const root = draw(spread, true)
    for (const b of BOOKS) {
      const bar = root.querySelector(`[data-exposure-book="${b.name}"]`) as HTMLElement | null
      expect(bar, `${b.name} has no row`).toBeTruthy()
      expect(bar!.style.width).toBe(`${(b.weightPct / 20) * 100}%`)
    }
    expect(root.querySelector('[data-exposure-ceiling]')?.textContent).toBe('bars to 20%')
  })

  /**
   * The rung comes from EVERY book, not from the rows on show, so revealing a
   * withheld row on a taller tile cannot change what the visible rows mean.
   */
  /**
   * The rung comes from EVERY book, not from the rows on show.
   *
   * Exercised with the heavy book in the WITHHELD tail, which is the only
   * arrangement that can tell the two rules apart: a renderer scaling to the
   * visible rows would put the tight tile on a different rung from the grown
   * one, and the same book would mean two different lengths on two tiles of
   * the same field. `weightsByPortfolio` arrives heaviest-first today, so this
   * is a guard on the renderer not depending on that.
   */
  it('picks one rung for the whole set and keeps it when rows are withheld', () => {
    const tailHeavy: ExploreVisual = {
      ...spread,
      weightPct: 28.2,
      books: [...BOOKS.slice(0, 4), { name: 'Large Cap Core', weightPct: 28.2 }],
    }
    const tight = draw(tailHeavy, false)
    const grown = draw(tailHeavy, true)
    for (const r of [tight, grown]) {
      expect(r.querySelector('[data-exposure-ceiling]')?.textContent).toBe('bars to 35%')
      expect((r.querySelector('[data-exposure-book="Core Equity"]') as HTMLElement).style.width)
        .toBe(`${(3.1 / 35) * 100}%`)
    }
    // And the heavy row, once revealed, is on that same rung rather than full.
    expect((grown.querySelector('[data-exposure-book="Large Cap Core"]') as HTMLElement).style.width)
      .toBe(`${(28.2 / 35) * 100}%`)
  })

  /**
   * The spread's own version of the pegging defect: five of eleven live rows
   * read as full bars because the heaviest book was over the single ceiling.
   */
  it('pegs no row when the heaviest book is above the first rung', () => {
    const root = draw({
      ...spread,
      weightPct: 29.6,
      books: [{ name: 'Large Cap Growth', weightPct: 29.6 }, { name: 'Large Cap Core', weightPct: 24.1 }],
    } as ExploreVisual, true)
    const widths = [...root.querySelectorAll('[data-exposure-book]')]
      .map(b => (b as HTMLElement).style.width)
    expect(widths.filter(w => w === '100%')).toHaveLength(0)
    expect(new Set(widths).size).toBe(2)
  })

  it('keeps the producer’s heaviest-first order rather than sorting again', () => {
    const root = draw(spread, true)
    const order = [...root.querySelectorAll('[data-exposure-book]')]
      .map(el => el.getAttribute('data-exposure-book'))
    expect(order).toEqual(BOOKS.map(b => b.name))
  })

  /** The headline number is the largest, and it now says so. */
  it('says the headline weight is the largest of the set', () => {
    const root = draw(spread, true)
    expect(root.textContent).toContain('4.8%')
    expect(root.textContent?.toLowerCase()).toContain('largest of 5 books')
  })

  /** A tight tile shows fewer rows and SAYS how many it withheld. */
  it('withholds rows on a tight tile and counts what it withheld', () => {
    const root = draw(spread, false)
    expect(root.querySelectorAll('[data-exposure-book]')).toHaveLength(3)
    expect(root.querySelector('[data-exposure-withheld]')?.textContent).toContain('2 more books')
  })

  it('says nothing about withheld rows when every book fits', () => {
    const root = draw({ ...spread, books: BOOKS.slice(0, 2) } as ExploreVisual, true)
    expect(root.querySelector('[data-exposure-withheld]')).toBeNull()
  })

  /**
   * One book is not a spread. Drawing a single-row chart of the number already
   * in the headline is the "picture of the headline" defect, in a new place.
   */
  it('falls back to the single bar when the producer had only one book', () => {
    const root = draw({ ...spread, books: BOOKS.slice(0, 1) } as ExploreVisual, true)
    expect(root.querySelector('[data-exposure-spread]')).toBeNull()
    expect(root.querySelector('[data-exposure-fill]')).toBeTruthy()
  })
})

describe('the resolver carries the spread, and only a real one', () => {
  const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
    id: 'lens-crowded-meta',
    dedupeKey: 'crowding:meta',
    signalType: 'crowding',
    category: 'decisions',
    subtype: 'signal',
    title: 'META is held across 5 portfolios',
    symbol: 'META',
    assetId: 'asset-meta',
    occurredAt: '2025-12-01T00:00:00Z',
    destination: { kind: 'action', action: 'open_asset', assetId: 'asset-meta', symbol: 'META' },
    importance: 0.4,
    positive: false,
    portfolio: { weightPct: 4.8, heldInCount: 5, name: 'Vision Fund 10K' },
    ...over,
  } as ExploreItem)

  it('passes the producer rows through to the visual', () => {
    const v = exploreVisualFor(item({ visual: { books: BOOKS } }))
    expect(v.kind).toBe('exposure')
    expect(v.kind === 'exposure' && v.books).toEqual(BOOKS)
  })

  it('drops a one-entry spread, so the renderer never has to', () => {
    const v = exploreVisualFor(item({ visual: { books: BOOKS.slice(0, 1) } }))
    expect(v.kind === 'exposure' && v.books).toBeUndefined()
  })

  /** A non-finite weight is a row with no number, not a row worth drawing. */
  it('drops rows whose weight is not a number', () => {
    const v = exploreVisualFor(item({
      visual: { books: [...BOOKS.slice(0, 2), { name: 'Broken', weightPct: NaN }] },
    }))
    expect(v.kind === 'exposure' && v.books?.map(b => b.name)).toEqual(['Vision Fund 10K', 'Core Equity'])
  })

  it('still resolves exposure for a producer that never had a spread', () => {
    const v = exploreVisualFor(item())
    expect(v.kind).toBe('exposure')
    expect(v.kind === 'exposure' && v.books).toBeUndefined()
  })
})
