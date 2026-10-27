/**
 * The Ideas skeleton sizes by index, and `opportunitySize` keeps its contract.
 *
 * ── The defect these pin ──────────────────────────────────────────────────
 *
 * `OpportunityGrid`'s loading branch sized its placeholders by calling the
 * CONTENT sizing function with a hand-built stand-in:
 *
 *     opportunitySize({ composed: { emphasis: 'standard' } } as Opportunity, i)
 *
 * `Opportunity` requires `item`; that literal has none, and the `as` cast is
 * what let it compile. `opportunitySize` returns 'hero' at index 0 without
 * looking at the item, then reads `o.item` for every index after — so the
 * first placeholder rendered and the second threw
 *
 *     TypeError: Cannot read properties of undefined (reading 'subtype')
 *
 * which reached the app's ErrorBoundary and blanked the page. It was reachable
 * from the Asset Page: a History event drilling through to its idea mounts this
 * grid cold, so the skeleton always ran.
 *
 * ── What is asserted, and why in this shape ───────────────────────────────
 *
 * Three input states, separately, as the brief requires:
 *
 *   valid       a real opportunity still gets its intended size — the fix must
 *               not flatten the loaded grid.
 *   unresolved  the loading state renders placeholders and throws nothing.
 *   malformed   an opportunity that reached `opportunitySize` WITHOUT an item
 *               still throws. That is deliberate. A null guard here would let
 *               a malformed LOADED record render at some default size and look
 *               fine, which is the "silently conceal" failure the brief rules
 *               out. The contract stays strict; the loading path simply stopped
 *               violating it.
 *
 * `GallerySkeleton` is rendered for real rather than asserted from source: it
 * is a pure presentational component with no hooks, so the render costs
 * nothing and proves the placeholders actually survive a mount.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GallerySkeleton } from '../../desktop/DesktopTile'
import { opportunitySize } from '../../../lib/desktop-ideas/opportunity'
import { exploreCardSize } from '../../../lib/mobile/explore-layout'
import type { Opportunity } from '../../../lib/desktop-ideas/opportunity'
import type { ComposedExploreItem, ExploreItem } from '../../../lib/mobile/explore-item'

const GRID_SRC = readFileSync(
  join(process.cwd(), 'src/components/ideas-v2/OpportunityGrid.tsx'), 'utf8',
)

/*
 * Comments stripped before asserting. The fix's own note quotes the broken
 * expression verbatim so the next reader knows what not to reintroduce, and a
 * bare source match would therefore read that explanation as the defect.
 */
const GRID_CODE = GRID_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'x1', dedupeKey: 'k1', signalType: null,
  category: 'research' as never, subtype: 'signal',
  title: 'Something happened', symbol: 'AAA', assetId: 'a-1',
  destination: {} as never,
  ...over,
})

const opportunity = (over: Partial<ExploreItem> = {}): Opportunity => ({
  composed: { item: item(over), emphasis: 'standard', score: 1 } as ComposedExploreItem,
  item: item(over),
  kind: 'price_move',
})

/* The literal the broken branch built, kept verbatim so the case below proves
   the real thing rather than a paraphrase of it. */
const THE_STAND_IN = { composed: { emphasis: 'standard' } } as unknown as Opportunity

describe('valid opportunities keep their intended size', () => {
  it('leads with a hero', () => {
    expect(opportunitySize(opportunity(), 0)).toBe('hero')
  })

  it('sizes a later card from its own content, not its position', () => {
    const size = opportunitySize(opportunity(), 3)
    expect(['large', 'medium', 'compact']).toContain(size)
  })

  it('still reads the item for every index after the lead', () => {
    /* If this ever stops being true the malformed case below goes quiet for
       the wrong reason, so it is pinned rather than assumed. */
    const aggregate = opportunitySize(opportunity({ subtype: 'aggregate' }), 2)
    const signal = opportunitySize(opportunity({ subtype: 'signal' }), 2)
    expect(aggregate).not.toBe(signal)
  })
})

describe('malformed input is not silently concealed', () => {
  it('throws when an opportunity reaches the sizer without an item', () => {
    expect(() => opportunitySize(THE_STAND_IN, 1)).toThrow(/subtype/)
  })

  it('throws for an item that is missing entirely', () => {
    expect(() => exploreCardSize(undefined as never)).toThrow(/subtype/)
  })

  it('does not throw at index 0, which is why only the SECOND tile crashed', () => {
    expect(opportunitySize(THE_STAND_IN, 0)).toBe('hero')
  })
})

describe('the unresolved loading state renders placeholders safely', () => {
  it('renders every placeholder without throwing', () => {
    const { container } = render(<GallerySkeleton title="Ideas" flow="packed" count={6} />)
    const grid = container.querySelector('.grid')
    expect(grid).not.toBeNull()
    expect(grid!.children.length).toBe(6)
  })

  it('survives a count large enough to pass the index the old branch died on', () => {
    expect(() => render(
      <GallerySkeleton title="Ideas" flow="packed" count={12} />,
    )).not.toThrow()
  })
})

describe('the Ideas loading branch no longer fabricates an Opportunity', () => {
  it('casts nothing to Opportunity', () => {
    expect(GRID_CODE).not.toMatch(/\bas Opportunity\b/)
  })

  it('does not route the skeleton size through the content sizer', () => {
    expect(GRID_CODE).not.toMatch(/sizeAt=\{[^}]*opportunitySize/)
  })

  it('packs the skeleton like the grid that replaces it, so load is not a re-layout', () => {
    // The property, not the formatting — this pinned the whole element as one
    // self-closing line, so adding the lens's measured heights broke it while
    // the packing it protects was untouched.
    expect(GRID_CODE).toMatch(/<GallerySkeleton[\s\S]{0,600}flow="packed"/)
  })

  it('reserves the room this lens\'s tiles actually take', () => {
    /*
     * `SKELETON_HEIGHT` is shared by five lenses whose tiles are genuinely
     * different heights. Measured at 1920x889: the widest tile is 461px on
     * Ideas, 452px on Research, 233px on Decisions, and the shared default
     * claims 232. So the first skeleton row was ~230px short here and every
     * row below it started in the wrong place — worth 0.03 of CLS on its own.
     *
     * Medians rather than maxima: the aim is least total movement, and
     * reserving the 524px maximum for every wide tile would overshoot most of
     * them by as much as 232 undershot.
     */
    expect(GRID_CODE).toMatch(/heights=\{\{/)
    expect(GRID_CODE).toMatch(/hero: 'h-\[460px\]'/)
    expect(GRID_CODE).toMatch(/compact: 'h-\[202px\]'/)
  })
})
