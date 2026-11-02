import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ComposedExploreItem, ExploreItem } from '../../../lib/mobile/explore-item'
import type { ExploreOpen } from '../../../lib/desktop-ideas/explore-open'

/**
 * Explore draws the lens tile, and keeps its own grammar.
 *
 * ── What changed, and therefore what is at risk ───────────────────────────
 *
 * Explore used to render a tile of its own: one picture, a title, a figure, a
 * line of context, in a grid of equal cells. It now renders `OpportunityTile`,
 * the same object the Ideas lens draws, over the same candidates.
 *
 * Nothing about the CANDIDATES changed, so none of this tests them. Three
 * things are at risk and all three are things the old tile got right.
 *
 * 1. A tile that cannot answer must not look like a control. `ExploreOpen`
 *    says so in its own type -- "Nothing to open. Said out loud, and the tile
 *    must not look actionable" -- and the shared tile was built for four
 *    lenses whose objects always resolve somewhere, so it had no such mode.
 * 2. The verb must come from the resolver. A story opens a reader and an
 *    aggregate narrows the grid; both saying "Open" is the surface guessing.
 * 3. The candidate SET must stay Explore's. `isIdeaWorthy` keeps news and
 *    aggregates out of the Ideas lens, and borrowing that lens's tile must
 *    not quietly borrow its admission rule -- breadth is the premise here.
 *
 * The region sizing is source-pinned instead: jsdom performs no layout, so a
 * container query is unobservable in a render, and the property ("columns come
 * from the pane, not the window") is a claim about which rule is in force.
 */

const explore = vi.hoisted(() => ({ items: [] as ComposedExploreItem[] }))
vi.mock('../../../hooks/useDesktopExplore', () => ({
  useDesktopExplore: () => ({ items: explore.items, isLoading: false, missing: [] }),
}))
/* The only other mock. Price history is a network read; everything else the
   tile touches is pure. `pending: false` so the field's one gate opens. */
vi.mock('../../../hooks/useTileCloses', () => ({
  useGalleryCloses: () => ({ map: new Map(), pending: false }),
  useYearRanges: () => new Map(),
  useTileCloses: () => ({ data: [] }),
}))

const { IdeasExploreBrowse } = await import('../IdeasExploreBrowse')

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

function composed(over: Partial<ExploreItem> & { id: string }): ComposedExploreItem {
  const item = {
    dedupeKey: over.id, signalType: null,
    category: 'research', subtype: 'note',
    title: `Something about ${over.symbol ?? 'the desk'}`,
    symbol: null, companyName: null, assetId: null,
    destination: {} as never, metric: null, visual: null,
    ...over,
  } as unknown as ExploreItem
  return { item, emphasis: 'standard', score: 5 } as ComposedExploreItem
}

/** Renders the field with one answer for every tile. */
function field(items: ComposedExploreItem[], open: ExploreOpen) {
  explore.items = items
  return render(
    <IdeasExploreBrowse resolve={() => open} onOpen={() => {}} />,
  )
}

const WORK: ExploreOpen = { do: 'work', selection: { key: 'k1' } as never }

describe('the resolver still decides what a tile is', () => {
  it('names the verb after the destination, not after the tile', () => {
    field([composed({ id: 'n1', symbol: 'MSFT', subtype: 'news' })], {
      do: 'article', url: 'https://example.test/x', title: 'A story', source: 'Wire', desk: null,
    })
    /*
     * "Read", because a candidate whose destination is a story is not a name
     * to work on, and the reader is choosing between those two things on one
     * screen. The old tile had one undifferentiated press.
     */
    expect(screen.getByTestId('opportunity-open').textContent).toBe('Read')
  })

  it('says what narrowing does, rather than borrowing Open', () => {
    field([composed({ id: 'a1', subtype: 'aggregate' })], { do: 'filter', category: 'research' })
    expect(screen.getByTestId('opportunity-open').textContent).toBe('Show these')
  })

  it('draws no control at all where there is nothing behind the preview', () => {
    const { container } = field(
      [composed({ id: 'x1', symbol: 'NKE' })],
      { do: 'none', why: 'x1: no candidate and no asset' },
    )
    /*
     * The three affordances, each checked: no verb, no tab stop, no pointer.
     * A surface that offers a press, takes it and does nothing is worse than
     * one that never invited it -- and the preview is still worth reading,
     * which is why the tile stays and only its interactivity goes.
     */
    expect(screen.queryByTestId('opportunity-open')).toBeNull()
    const tile = screen.getByTestId('opportunity-tile')
    expect(tile.dataset.inert).toBe('true')
    expect(tile.getAttribute('tabindex')).toBeNull()
    expect(tile.className).not.toContain('cursor-pointer')
    /* And the body is there: this is a preview, not a hidden row. */
    expect(container.textContent).toContain('NKE')
  })

  it('carries out the one answer Explore owns without leaving the surface', () => {
    field(
      [
        composed({ id: 'a1', subtype: 'aggregate', title: 'Four new research notes' }),
        composed({ id: 'r1', symbol: 'TSLA', category: 'portfolio' as never }),
      ],
      { do: 'filter', category: 'research' },
    )
    expect(screen.getAllByTestId('opportunity-tile')).toHaveLength(2)
    fireEvent.click(screen.getAllByTestId('opportunity-open')[0])
    /*
     * Narrowed in place: the portfolio row is gone and the field did not
     * navigate. The chip that undoes it is the gallery's own action slot.
     */
    expect(screen.getAllByTestId('opportunity-tile')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Research/ })).toBeInTheDocument()
  })
})

describe('the field is still Explore\'s field', () => {
  it('admits the candidates the Ideas lens excludes', () => {
    /*
     * `isIdeaWorthy` drops `news` and `aggregate` and anything with no
     * instrument, because the Ideas lens is a field of names to act on.
     * Explore's premise is breadth, so borrowing that lens's TILE must not
     * borrow its admission rule: this fails if the field is ever routed
     * through `opportunitiesFrom`.
     */
    field([
      composed({ id: 'n1', symbol: 'MSFT', subtype: 'news' }),
      composed({ id: 'a1', subtype: 'aggregate' }),
      /* `signal` is the subtype `isIdeaWorthy` admits: a card-shaped finding
         about a position. The contrast is the point -- this one would survive
         that filter and the two above it would not. */
      composed({ id: 'p1', symbol: 'LLY', subtype: 'signal' }),
    ], WORK)
    expect(screen.getAllByTestId('opportunity-tile')).toHaveLength(3)
  })

  it('labels a tile with the facet its own filter narrows on', () => {
    field([composed({ id: 'r1', symbol: 'AMZN', category: 'portfolio' as never })], WORK)
    /*
     * The CATEGORY, not what raised the candidate. The Ideas lens chips
     * `OPPORTUNITY_LABEL`, which is the right word there and the wrong one
     * here: the category is what this field narrows on, so a chip naming
     * anything else labels a facet the reader cannot then ask for.
     */
    expect(screen.getByTestId('opportunity-tile').textContent).toContain('Portfolio')
  })

  it('rings the tile whose object is in the pane beside it', () => {
    /*
     * The shared tile dropped its persistent ring because nothing sits
     * beneath the four workspace galleries. Something sits beside this one:
     * the Dashboard keeps the field in the left column with the asset
     * workspace open, so which tile the pane belongs to is a real question.
     */
    explore.items = [composed({ id: 'r1', symbol: 'AMZN' })]
    render(
      <IdeasExploreBrowse resolve={() => WORK} onOpen={() => {}} selectedKey="k1" />,
    )
    expect(screen.getByTestId('opportunity-tile').dataset.selected).toBe('true')
  })
})

describe('one tile, and columns from the pane', () => {
  it('renders the Ideas lens tile rather than one of its own', () => {
    /*
     * The whole point of the change. A second tile for one candidate shape is
     * a second answer to how a candidate looks, which is what had Explore and
     * Ideas reading as two products over the same rows.
     */
    const explore = src('components/ideas-app/IdeasExploreBrowse.tsx')
    expect(explore).toContain('<OpportunityTile')
    /* No second anatomy: the shared tile owns the identity, the reason line,
       the figure and the shelf. */
    expect(explore).not.toContain('TileIdentity')
    expect(explore).not.toContain('ExploreVisualBlock')
  })

  it('sizes its columns off the region, in the field and in the skeleton', () => {
    /*
     * The same 1920px window shows this field at full width and at ~40rem
     * beside an open workspace, and a media query cannot tell those apart --
     * it would pack twelve tracks into a pane where a tile is 3rem wide.
     *
     * Both halves, because they must agree: a skeleton laid out on a
     * different span table than the grid replacing it is a re-layout on load,
     * which is the one thing the skeleton exists to avoid.
     */
    const code = src('components/ideas-app/IdeasExploreBrowse.tsx')
    expect(code).toMatch(/<DesktopGallery[\s\S]{0,120}\sregion\b/)
    expect(code).toMatch(/<GallerySkeleton[^>]*\sregion\b/)
    /* The container itself, on the one element that is never remounted -- so
       the grid re-flows in place and the reader's scroll does not move. */
    expect(code).toContain('explore-host')
    /* And the rule that reads it. A `region` grid that fell through to the
       window breakpoints would pass every assertion above. */
    expect(src('index.css')).toContain('.gallery-region')
  })
})
