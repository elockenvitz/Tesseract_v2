/**
 * A tile shows one picture at a time, and you can page to the other.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * A wide tile drew its archetype AND a price chart, stacked. On AMZN that was
 * a scenario bar, a horizon ladder, a 150px plot and a caption -- 524px of
 * tile in a grid of ninety. Measured live at 1920x889: 4 of 90 tiles stacked
 * two pictures, all of them `scenario_range`.
 *
 * Neither picture was droppable -- the archetype is why the candidate was
 * raised and the price is the evidence under it -- so they page instead.
 *
 * ── What is asserted here, and what is not ────────────────────────────────
 *
 * MOUNTING is asserted here: exactly one picture in the DOM, the dots page
 * between them, and the eyebrow figure comes back when the bar that was
 * carrying it pages away. That last one is the trap this pass created for
 * itself -- the metric suppression was written when the picture was always on
 * screen, and under a carousel it would have taken "+38%" off AMZN's eyebrow
 * and then hidden the bar that justified taking it off.
 *
 * GEOMETRY is not, and cannot be: jsdom performs no layout, so every
 * `getBoundingClientRect` here would read 0. The invariant that paging does
 * not change the tile's height was measured in the running app instead, on
 * all four carousels -- see the commit that introduced this file.
 *
 * `useTileCloses` is the only mock. Everything else the tile uses is pure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ExploreItem } from '../../../lib/mobile/explore-item'
import type { ComposedExploreItem } from '../../../lib/mobile/explore-item'
import type { Opportunity } from '../../../lib/desktop-ideas/opportunity'

const closes = vi.fn()
vi.mock('../../../hooks/useTileCloses', () => ({
  useTileCloses: (symbol?: string | null) => closes(symbol),
  // The field batches, but this suite renders ONE tile directly, which is
  // the solo path: the tile falls back to its own hook when the field hands
  // it nothing. Present so the module's shape matches.
  useGalleryCloses: () => ({ map: new Map(), pending: false }),
  useYearRanges: () => new Map(),
}))

const { OpportunityTile } = await import('../OpportunityGrid')

/* AMZN as it stood: a bull case at $180, last trade $249, so the band prints
   "+38% above your range" and the metric line carried "+38%" beside it. */
const AMZN = (): Opportunity => {
  const item = {
    id: 'amzn-1', dedupeKey: 'amzn', signalType: null,
    category: 'framework' as never, subtype: 'scenario',
    title: 'AMZN is trading above every case you modelled',
    symbol: 'AMZN', companyName: 'Amazon.com, Inc.', assetId: 'a-amzn',
    destination: {} as never,
    metric: { value: '+38%', direction: 'good' },
    visual: {
      currentPrice: 249,
      cases: [{ label: 'Bear', price: 120 }, { label: 'Bull', price: 180 }],
    },
  } as unknown as ExploreItem
  return { composed: { item, emphasis: 'feature', score: 9 } as ComposedExploreItem, item, kind: 'framework' }
}

const SERIES = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(2026, 8, i + 1), value: 200 + i,
}))

beforeEach(() => {
  closes.mockReset()
  closes.mockReturnValue({ data: SERIES })
})

const dots = () => screen.queryAllByRole('button', { name: /^Show / })

describe('a wide tile with two pictures pages between them', () => {
  it('mounts exactly one of them, and offers a dot for each', () => {
    render(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)

    expect(screen.getAllByTestId('opportunity-visual')).toHaveLength(1)
    expect(dots().map(d => d.getAttribute('aria-label')))
      .toEqual(['Show the finding', 'Show the price'])
  })

  it('leads with the finding, which is why the candidate was raised', () => {
    render(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)

    expect(screen.getByTestId('opportunity-visual').dataset.panel).toBe('scenario_range')
    /* The horizon ladder belongs to the price panel and is not mounted yet. */
    expect(screen.queryByRole('button', { name: '1M' })).toBeNull()
  })

  it('swaps the picture when the second dot is pressed', () => {
    render(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the price' }))

    expect(screen.getAllByTestId('opportunity-visual')).toHaveLength(1)
    expect(screen.getByTestId('opportunity-visual').dataset.panel).toBe('price')
    /* And the ladder arrives with it -- the horizons are the fast way to
       judge whether a move is news, which is why the chart kept them. */
    expect(screen.getByRole('button', { name: '1M' })).toBeTruthy()
  })

  /*
   * ── The figure moved; the rule it is under did not ────────────────────
   *
   * This case was written against `tile-figure`, an 11px pill in the eyebrow
   * beside the lens name. The figure now renders in `tile-stats`, below the
   * claim, at a size that reads across the field and with the `metric.label`
   * the pill discarded -- the prototype's shape, and the reason is in
   * `TileStats`.
   *
   * The RULE is untouched and is what these two cases exist for: a quantity
   * is not printed twice on one tile. While the bar states it the row is
   * suppressed; page the bar away and the row comes back. Only the testid and
   * the place changed, so the cases are rewritten rather than dropped.
   *
   * Note what the old assertion would have become. `queryByTestId('tile-
   * figure')` returns null now whatever the tile does, so the second case
   * below would have gone on PASSING while checking nothing at all -- it did,
   * in the run that caught the first one. A suppression test that cannot
   * observe the thing it suppresses is the defect class this repo keeps
   * finding, so both are moved together.
   */
  it('gives the figure row back when the bar that stated it pages away', () => {
    render(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)
    /* Scoped to the row, because "+38%" IS on the tile while the bar is
       showing -- the bar prints it, captioned "above your range". The rule is
       that it is not said twice, not that it is absent. */
    expect(screen.queryByTestId('tile-stats')).toBeNull()
    expect(screen.getByText('above your range')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show the price' }))
    expect(screen.getByTestId('tile-stats').textContent).toContain('+38%')
  })

  it('pages back', () => {
    render(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the price' }))
    /* The row is up at this point, which is what makes the next assertion
       mean something: it has to GO, not merely be absent throughout. */
    expect(screen.getByTestId('tile-stats')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show the finding' }))
    expect(screen.getByTestId('opportunity-visual').dataset.panel).toBe('scenario_range')
    expect(screen.queryByTestId('tile-stats')).toBeNull()
  })
})

/*
 * The card whose finding IS the trajectory. `exploreVisualFor` returns
 * `price_trend` for `target_hit`, `unusual_move` and `earnings_result`, and
 * `ExploreVisualBlock` draws that kind by handing back the sparkline the
 * CALLER injects -- which this caller does not, because the price has its own
 * panel here. So the archetype resolved to null and `drawsPrice` excluded
 * `price_trend` by name, and the tile drew nothing at all.
 *
 * Measured live at 1920x889 before the fix: 2 of 90 tiles, both "passed its
 * target", with an empty 0px box where their only picture belonged.
 */
const TARGET_HIT = (): Opportunity => {
  const item = {
    id: 'aapl-1', dedupeKey: 'aapl', signalType: 'target_hit',
    category: 'framework' as never, subtype: 'signal',
    title: 'AAPL passed its target',
    symbol: 'AAPL', companyName: 'Apple Inc.', assetId: 'a-aapl',
    destination: {} as never,
    metric: { value: '+20%', direction: 'good' },
  } as unknown as ExploreItem
  return { composed: { item, emphasis: 'standard', score: 5 } as ComposedExploreItem, item, kind: 'framework' }
}

describe('a card about the price draws the price', () => {
  it.each(['compact', 'hero'] as const)('on a %s tile, where the archetype has none of its own', (size) => {
    render(<OpportunityTile o={TARGET_HIT()} size={size} onOpen={() => {}} />)

    const box = screen.getByTestId('opportunity-visual')
    expect(box.dataset.panel).toBe('price')
    /* Not merely present -- FILLED. The defect was a box that mounted and
       held nothing, which `getByTestId` alone would have passed. The horizon
       ladder is the chart's own and is the cheapest proof it is really
       there. */
    expect(screen.getByRole('button', { name: '1M' })).toBeTruthy()
    expect(box.innerHTML.length).toBeGreaterThan(0)
  })

  it('is one picture, not a carousel of a chart and a blank', () => {
    render(<OpportunityTile o={TARGET_HIT()} size="hero" onOpen={() => {}} />)
    expect(dots()).toHaveLength(0)
  })

  it('still draws nothing rather than an empty box when there is no series', () => {
    closes.mockReturnValue({ data: undefined })
    render(<OpportunityTile o={TARGET_HIT()} size="hero" onOpen={() => {}} />)

    expect(screen.queryByTestId('opportunity-visual')).toBeNull()
  })
})

describe('a tile with one picture is not a carousel', () => {
  it('draws no dots when the price never arrives', () => {
    closes.mockReturnValue({ data: undefined })
    render(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)

    expect(screen.getAllByTestId('opportunity-visual')).toHaveLength(1)
    expect(dots()).toHaveLength(0)
  })

  /*
   * REVERSED, and the reason kept.
   *
   * This asserted that a narrow tile has no carousel, because the price
   * panel was gated on tile WIDTH (`drawsPrice = hasCloses && (… || big)`).
   * Measured on the live field at 1920x889: of 56 tiles, FOUR had a second
   * panel. On the other 52 the carousel did not exist and the price was
   * unreachable without opening the card.
   *
   * Width is a layout fact standing in for "is there anything else worth
   * seeing", which is a data fact -- and the data was already fetched. A
   * narrow tile now gets a shorter plot, not no plot, and the picture it
   * LEADS with is still its finding.
   */
  it('pages a narrow tile too, leading with its finding', () => {
    render(<OpportunityTile o={AMZN()} size="compact" onOpen={() => {}} />)

    expect(dots()).toHaveLength(2)
    expect(screen.getByTestId('opportunity-visual').dataset.panel).toBe('scenario_range')
  })

  /*
   * The clamp. `useTileCloses` resolves AFTER the tile has painted, so a
   * reader who paged to the price and then saw the query fail would be left
   * on an index past the end -- `panels[1]` of a one-panel list, and the
   * picture blanks. Derived from the length rather than reset by an effect,
   * so there is no ordering to get wrong.
   */
  it('falls back to the remaining picture when the price goes away', () => {
    const { rerender } = render(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the price' }))
    expect(screen.getByTestId('opportunity-visual').dataset.panel).toBe('price')

    closes.mockReturnValue({ data: undefined })
    rerender(<OpportunityTile o={AMZN()} size="hero" onOpen={() => {}} />)

    expect(screen.getAllByTestId('opportunity-visual')).toHaveLength(1)
    expect(screen.getByTestId('opportunity-visual').dataset.panel).toBe('scenario_range')
  })
})
