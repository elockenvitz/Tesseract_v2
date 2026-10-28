/**
 * A gallery paints once, at its final geometry.
 *
 * Every lens turns a ranked list into tile sizes by INDEX -- `sizeByRecency(i)`
 * on Decisions, `spanForRank(index)` on Ideas, `sizeByRank(i, total)` on
 * Research. So anything that can reorder the list does not merely move tiles,
 * it resizes them: hero to compact, twelve columns to three. Painting before
 * those inputs land means painting a gallery that is about to rearrange itself.
 *
 * These read the source because the property is structural -- "this lens holds
 * for that input before assigning geometry" -- and a rendering test can only
 * ever demonstrate one arrival order. Each case names the input and why it
 * changes rank, so a future reader can tell a real gate from a copied line.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

/**
 * The same file with its comments removed.
 *
 * Needed by the cases that assert something is ABSENT. This codebase explains
 * removals in prose where they used to live -- "`exposureSettled` is no longer
 * read, because..." -- so a raw text search finds the very string the case is
 * proving gone, and the guard fails on its own documentation. Stripping
 * comments asks the question that was meant: is this still CODE?
 */
const code = (p: string) => src(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('Decisions holds for the outcome facts', () => {
  const page = src('components/decisions-v2/DecisionsWorkspace.tsx')

  /* The facts decide `klass`, `klass` is the first sort key via CLASS_RANK,
     the sort decides the index, and `sizeByRecency(index)` decides the size.
     They also decide MEMBERSHIP -- selectForLens truncates the recent class. */
  it('consumes the loading flag it used to discard', () => {
    expect(page).toContain('isLoading: factsLoading')
    expect(page).toContain('if (isLoading || factsLoading) return <Loading />')
  })

  it('cannot reach its empty states while the facts are in flight', () => {
    const gate = page.indexOf('if (isLoading || factsLoading) return <Loading />')
    expect(gate).toBeGreaterThan(-1)
    // Every empty state, and the gallery itself, is downstream of the gate.
    for (const marker of ['<NothingOwed', '<Empty />', '<DesktopGallery']) {
      expect(page.indexOf(marker)).toBeGreaterThan(gate)
    }
  })
})

describe('Ideas holds for what reorders it', () => {
  const page = src('components/ideas-v2/IdeasWorkspace.tsx')

  /*
   * ── The gate inverted, because what it protected moved ──────────────────
   *
   * This asserted `if (!exposureSettled || gaps.status === 'loading') return
   * <Loading />`. The reasoning was sound for the field it was written for:
   * `exposure` fed `scoreIdea`'s materiality term and prompts appended to the
   * list, so both changed the index that `spanForRank` turned into a column
   * span -- painting early meant painting a gallery about to reorder.
   *
   * Neither is true of the field now. It is the opportunity set, ranked by
   * `diversifyExplore`; `exposure` only orders the deck's rail, and coverage
   * prompts are composed into the set by the field itself. Holding the whole
   * lens on them blanked a field that was ready to draw, which is the defect
   * this case now guards against rather than requires.
   */
  it('does not hold the field for data that no longer reorders it', () => {
    const body = code('components/ideas-v2/IdeasWorkspace.tsx')
    expect(body).not.toContain("gaps.status === 'loading'")
    expect(body).not.toContain('exposureSettled')
  })

  it('never decides emptiness on a list it does not draw', () => {
    /*
     * The regression this locks down.
     *
     * `if (!ranked.length) return <Empty />` gated the entire opportunity
     * field behind the AUTHORED idea list -- so a reader who had written no
     * ideas was told the lens was empty while a full set of opportunities sat
     * underneath, composed, ranked and never rendered. The only list that can
     * answer "is there anything to show" is the one being shown.
     */
    expect(code('components/ideas-v2/IdeasWorkspace.tsx')).not.toContain('!ranked.length')

    /*
     * The field's own empty branch, asserted as a STANDALONE condition.
     *
     * `toContain('opportunities.length === 0')` was the first version of this
     * and it was vacuous: the loading branch above reads
     * `isLoading && opportunities.length === 0`, so the substring matched even
     * with the empty branch deleted. Proven by changing the empty branch to
     * `=== -1` and watching this case still pass.
     *
     * The regex requires the condition to open its own `if`, which the loading
     * branch cannot satisfy.
     */
    const field = code('components/ideas-v2/OpportunityGrid.tsx')
    expect(field).toMatch(/if \(opportunities\.length === 0\)/)
  })

  it('uses the cached graduation hint, so seeded rows do not render then vanish', () => {
    expect(page).toContain('const { hasGraduated, cachedHasGraduated } = usePilotMode()')
    expect(page).toContain('hasGraduated: graduated')
  })

  /* Framework, open price and the detail read fill a tile without moving it,
     so they are deliberately NOT in the gate. Progressive filling is the goal;
     re-layout is the defect. */
  it('does not wait for data that only fills a tile', () => {
    const gate = page.slice(page.indexOf('if (isLoading) return <Loading />'), page.indexOf('if (selected)'))
    expect(gate).not.toContain('framework')
    expect(gate).not.toContain('openPrice')
  })
})

describe('Research holds for what reorders it', () => {
  const page = src('components/research-v2/ResearchWorkspace.tsx')

  it('waits for exposure and the generated subjects', () => {
    expect(page).toContain('if (!exposureSettled || gaps.status === \'loading\') return <Loading />')
  })

  /* The coverage wait used to be conditional on there being nothing on record,
     so an established desk painted its real subjects and then re-sorted and
     re-sized all of them when the generated ones appended. */
  it('no longer waits only when the desk is empty', () => {
    expect(page).not.toContain("(!scanned.length && gaps.status === 'loading')")
  })
})

describe('Today reserves the width its backfill will need', () => {
  const page = src('components/today/TodayPage.tsx')

  /* Real findings still paint immediately -- what changed is that the columns
     they paint into are already the size the appended items will need. */
  it('sizes supporting tiles from a reserved total, not the current one', () => {
    expect(page).toContain('const layoutTotal = gaps.status === \'loading\'')
    expect(page).toContain('supportingSpan(i, layoutTotal)')
    expect(page).not.toContain('supportingSpan(i, supporting.length)')
  })

  /*
   * ── This rule was deliberately superseded, and here is why ──────────────
   *
   * It used to read "no coverage gate in front of the field; only the
   * engine's own loading", so real findings painted the moment the engine
   * answered. Measured, that gave the reader three paints in 1.3s: tiles
   * appeared, then the coverage scan returned and the supporting row changed
   * WIDTH and re-flowed, then enrichment returned and every chart was
   * redrawn and every sentence rewritten. Reserving width inside a tile
   * fixed only the middle one; the other two are the page assembling itself
   * in front of the reader.
   *
   * `0fc92e50` replaced the partial gate with one gate over all three reads.
   * What must stay true is not "coverage never gates" but "no term can hang
   * the surface" -- every term has to resolve on failure as well as success,
   * or an org with no coverage row would stare at a skeleton forever.
   */
  it('gates the field once on every read, and on nothing that can hang', () => {
    expect(page).toContain('const settling = isLoading || gaps.status === \'loading\' || enriching')
    expect(page).toContain('{settling ? (')
    // Enrichment resolves on failure too, and is false when there is
    // nothing to enrich -- that is what makes the third term bounded.
    expect(page).toContain('const enriching = enrichment.pending || coverageEnrichment.pending')
    // And the field itself holds no second gate of its own.
    const field = page.slice(page.indexOf('data-testid="today-field"'))
    expect(field.slice(0, 400)).not.toContain('gaps.status')
  })
})

/*
 * The last jump of a cold load was the skeleton handing over.
 *
 * Every lens had its own placeholder describing a DIFFERENT page from the one
 * that replaced it -- a `md:grid-cols-2 xl:grid-cols-3` grid of equal cards in
 * front of a twelve-column mosaic of four tile sizes. So the handover moved
 * every card on the page, at the moment the reader had just started looking.
 */
describe('the skeleton is the shape of the page it replaces', () => {
  const shell = src('components/desktop/DesktopTile.tsx')

  it('is built from the same span map and grid as the real gallery', () => {
    const fn = shell.slice(shell.indexOf('export function GallerySkeleton'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toContain('SPAN[flow][s]')
    expect(body).toContain("gridAutoRows: 'minmax(88px, auto)'")
    expect(body).toContain('md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12')
  })

  /*
   * The tiles were matched; the band above them was not.
   *
   * Measured at 1536px: the skeleton's grid began at y=72 and the gallery's
   * at y=101, because the skeleton used `pt-6` against `pt-5`, a 21px heading
   * against 19px, and reserved nothing for the note every lens writes. So all
   * ninety tiles dropped 29px at the handover, after the heights had already
   * been matched -- a shift from the one band nobody measured.
   *
   * Asserted as "the same header", part for part, rather than as a number:
   * the number is the consequence, and a case that pins 29 would go quiet the
   * moment somebody changed the heading for an unrelated reason.
   */
  it('opens on the same header as the gallery it replaces', () => {
    const header = (fn: string) => {
      const body = shell.slice(shell.indexOf(fn))
      return body.slice(0, body.indexOf('grid-cols-1'))
    }
    const real = header('export function DesktopGallery')
    const skel = header('export function GallerySkeleton')

    for (const part of [
      'px-6 pb-10 pt-5',
      'flex flex-wrap items-baseline gap-x-2 gap-y-1',
      'min-w-0 truncate text-[19px] font-semibold tracking-tight',
    ]) {
      expect(real).toContain(part)
      expect(skel).toContain(part)
    }
    /* And the note's room, which the skeleton used to leave out entirely.
       The gallery renders a `note` the LENS supplies, so the measure lives
       there rather than here -- `74ch`, which all of them set it at, is what
       the placeholder reserves against. */
    expect(real).toContain('{note}')
    expect(skel).toContain('max-w-[74ch]')
  })

  /* One global height is the same mistake in a different place: a hero and a
     compact do not occupy the same room. */
  it('reserves a height per tile size, not one for all of them', () => {
    const map = shell.slice(shell.indexOf('const SKELETON_HEIGHT'))
    const body = map.slice(0, map.indexOf('}'))
    const heights = [...body.matchAll(/h-\[(\d+)px\]/g)].map(m => m[1])
    expect(heights.length).toBe(4)
    expect(new Set(heights).size).toBeGreaterThan(1)
  })

  /*
    Ideas moved its skeleton into the field, which is where the loading is.

    It used to hold a lens-level `Loading()` built from `spanForRank`, shown
    while the idea scan was in flight -- a skeleton for an authored grid, in
    front of a field that does not read that scan. Both went. The property
    this case protects is unchanged and asserted below on `OpportunityGrid`:
    the placeholders occupy the columns the real cards are about to occupy,
    sized by the same function the loaded field uses.
  */
  it.each([
    ['components/decisions-v2/DecisionsWorkspace.tsx', 'GallerySkeleton'],
    ['components/research-v2/ResearchWorkspace.tsx', 'GallerySkeleton'],
  ])('%s no longer hand-rolls a mismatched grid', (file, marker) => {
    const page = src(file)
    const loading = page.slice(page.indexOf('function Loading()'))
    const body = loading.slice(0, loading.indexOf('\n}'))
    expect(body).toContain(marker)
    expect(body).not.toContain('md:grid-cols-2 xl:grid-cols-3')
  })

  it('Ideas skeletons the field, sized by the field’s own rule', () => {
    /*
     * The same property as the cases above, asserted where Ideas keeps it:
     * the placeholders stand in the columns the real tiles will take, so the
     * handover is a fade rather than a re-layout -- and the lens itself no
     * longer holds a competing skeleton for a grid it does not draw.
     *
     * ── Why this no longer asserts `sizeAt={i => opportunitySize(` ─────────
     *
     * That was the mechanism, and it was the crash. `opportunitySize` sizes
     * by CONTENT, which a skeleton does not have, so the branch fed it a cast
     * stand-in with no `item`; it returned 'hero' for index 0 without looking
     * and threw on index 1, taking the app to its error boundary whenever a
     * History event drilled through to an idea.
     *
     * The property survives, carried by `flow` instead: the skeleton packs
     * exactly as the loaded grid below it packs, which is what makes the two
     * layouts agree. Sizing is by index, GallerySkeleton's own default.
     */
    const field = src('components/ideas-v2/OpportunityGrid.tsx')
    const fieldCode = code('components/ideas-v2/OpportunityGrid.tsx')
    expect(field).toContain('GallerySkeleton')
    /*
     * Asserted as properties, not as one line of JSX.
     *
     * This read `toContain('<GallerySkeleton title="Ideas" flow="packed" />')`,
     * which pinned the element's FORMATTING. Giving the skeleton the lens's
     * measured per-size heights made it multi-line and broke the assertion
     * while every property it names still held — the test was describing the
     * source's shape rather than the page's behaviour.
     */
    expect(fieldCode).toMatch(/<GallerySkeleton[\s\S]{0,600}title="Ideas"/)
    expect(fieldCode).toContain('flow="packed"')
    /* The crash, as a prohibition: a skeleton must never size by content. */
    expect(fieldCode).not.toMatch(/sizeAt=\{[^}]*opportunitySize/)
    expect(code('components/ideas-v2/IdeasWorkspace.tsx')).not.toContain('function Loading()')
  })

  it('Ideas waits for the whole field before it paints one', () => {
    /*
     * The guard was `isLoading && opportunities.length === 0`, and the second
     * clause cancelled the first: `useDesktopCandidates` latches `isLoading`
     * until all four producers have finished, but the post half resolves
     * first, so the skeleton left with 54 of 90 items present and the field
     * then re-sized itself three more times as the rest landed.
     *
     * Measured cold at 1920x889: tile count 54 -> 64 -> 69 -> 90 over 4.9s,
     * CLS 0.4233 against a 0.25 "poor" threshold, worst single shift 0.282
     * moving a tile 509px up the page and from 117px to 524px tall. After:
     * one step 0 -> 90, CLS 0.0589.
     *
     * The length clause must not come back. A partial field is not a field.
     */
    const fieldCode = code('components/ideas-v2/OpportunityGrid.tsx')
    expect(fieldCode).not.toMatch(/isLoading\s*&&\s*opportunities\.length\s*===\s*0/)
    /*
     * The gate now covers BOTH reads, not just the candidates.
     *
     * The closes were fetched per tile -- 56 requests, each resolving on its
     * own schedule, each arrival turning its tile from one panel into two
     * and so changing its HEIGHT. The candidate gate was doing its job and
     * the field still reassembled for seconds afterwards, because the second
     * read had no gate at all.
     *
     * `closes.pending` is bounded the same way Today's terms are: false the
     * moment the query resolves OR fails, and false immediately when there
     * is nothing to fetch, so market data cannot hold the field shut.
     */
    expect(fieldCode).toMatch(/if \(isLoading \|\| closes\.pending\) \{/)
    expect(src('hooks/useTileCloses.ts'))
      .toMatch(/pending: wanted\.length > 0 && status === 'pending'/)
  })

  it('keeps Decisions chronological in its skeleton too', () => {
    const page = src('components/decisions-v2/DecisionsWorkspace.tsx')
    const loading = page.slice(page.indexOf('function Loading()'))
    expect(loading.slice(0, 220)).toContain('flow="chronological"')
    expect(loading.slice(0, 220)).toContain('sizeByRecency')
  })
})

/*
 * A row is as tall as its tallest tile, and by default every other tile in
 * that row is inflated to match. Measured on Ideas at 1920x889: AMZN carries
 * a price chart and is 524px, so AAPL beside it -- three lines of text -- was
 * also 524px, 342px of it (65%) empty. LLY held 338px of void, CEG 228px.
 *
 * TWO things cause that, and removing either alone changes nothing, which is
 * why both are pinned here. `align-items` must release the stretch, AND the
 * tile must not carry an explicit height: `height: 100%` overrides alignment,
 * so `h-full` on the tile silently resolved it back to the full row height.
 */
describe('a tile is as tall as its own contents', () => {
  const shell = code('components/desktop/DesktopTile.tsx')

  it('lets the gallery grid align its tiles to the top', () => {
    const grid = shell.slice(shell.indexOf('export function DesktopGallery'))
    const el = grid.slice(grid.indexOf('className="mt-4 grid'))
    expect(el.slice(0, 160)).toContain('items-start')
  })

  it('gives the tile no height of its own, which would override that', () => {
    const tile = shell.slice(shell.indexOf('export function DesktopTile'))
    const shellClasses = tile.slice(tile.indexOf("'group flex"))
    expect(shellClasses.slice(0, 120)).not.toContain('h-full')
  })
})

/*
 * "The thing this tile is about" was set on two different ladders: the ticker
 * stepped 30/24/20/17 and the hero figure 30/25/19/15, a pixel or two apart at
 * every step below hero. Nobody sees them side by side as a comparison, which
 * is why it survived -- it reads as a gallery slightly out of tune rather than
 * as a defect. The field carried eleven distinct type sizes.
 */
describe('the tile has one display ladder', () => {
  const shell = code('components/desktop/DesktopTile.tsx')

  it('declares it once', () => {
    expect(shell).toMatch(/const TILE_DISPLAY: Record<TileSize, string>/)
    expect(shell).toMatch(/const TILE_BESIDE: Record<TileSize, string>/)
  })

  it.each([
    ['export function TileIdentity', 'the ticker'],
    ['export function TileHeroNumber', 'the hero figure'],
  ])('%s sizes %s from it rather than from its own steps', (fn) => {
    const body = shell.slice(shell.indexOf(fn))
    const scope = body.slice(0, body.indexOf('\n}\n'))
    expect(scope).toContain('TILE_DISPLAY[')
    /* No hand-rolled ladder left behind beside the shared one. A `text-[Npx]`
       above 14 inside these two is a second scale by definition: everything
       smaller is a caption or a label, which is a different role. */
    const own = [...scope.matchAll(/text-\[(\d+)px\]/g)].map(m => Number(m[1]))
    expect(own.filter(n => n > 14)).toEqual([])
  })
})

/*
 * Ideas and Research each need a weight for the names on screen, and a weight
 * needs the whole book as its denominator -- so both read `portfolio_holdings`
 * twice. They had written that same pair of reads out by hand under two
 * lens-namespaced keys, so they could not share a cache entry even when asking
 * the identical question, and the two copies could drift.
 */
describe('the holdings read is asked once', () => {
  const shared = src('hooks/useHoldingsForAssets.ts')

  it('is keyed by the question, not by the lens', () => {
    expect(shared).toContain("queryKey: ['portfolio-holdings', 'for-assets', ids.join('|')]")
    expect(shared).not.toContain('desktop-ideas')
    expect(shared).not.toContain('desktop-research')
  })

  /* Sorted and de-duplicated, or two lenses asking about the same names in a
     different order would still miss each other. */
  it('normalises the ids so equivalent questions share an entry', () => {
    const fn = shared.slice(shared.indexOf('export function assetIdKey'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('new Set')
    expect(body).toContain('.sort()')
  })

  it.each([
    ['hooks/useDesktopIdeas.ts'],
    ['hooks/useDesktopResearch.ts'],
  ])('%s derives from the shared rows rather than reading again', (file) => {
    const page = src(file)
    expect(page).toContain('useHoldingsForAssets(ids)')
    // The hand-rolled two-step read is gone from both.
    expect(page).not.toContain(".select('portfolio_id')\n        .in('asset_id', ids)")
    expect(page).not.toContain(".select('portfolio_id').in('asset_id', ids)")
  })

  it('leaves each lens its own derivation', () => {
    // Ideas wants rank and the book's distribution; Research wants one number.
    expect(src('hooks/useDesktopIdeas.ts')).toContain('weightsByAsset(rows)')
    expect(src('hooks/useDesktopResearch.ts')).toContain('largestWeightByAsset(rows)')
  })
})

describe('a failed scan is never reported as good news', () => {
  /*
   * Ideas left this table, and the rule it was here for did not.
   *
   * A failed coverage scan used to empty the Ideas lens, so it needed a
   * separate full-page state to stop the good news ("No open ideas") being
   * rendered over a broken read. It cannot empty the lens any more: the field
   * is the opportunity set, and coverage only supplies the prompts that top up
   * a thin page. A full-page error would now OVERSTATE the failure -- the
   * opposite error, but still a lie about what happened.
   *
   * So the claim moves rather than disappears, and is asserted below in
   * 'names a failed coverage scan instead of swallowing it'.
   */
  it.each([
    ['components/today/TodayPage.tsx', 'Cleared', "You're current."],
    ['components/research-v2/ResearchWorkspace.tsx', 'Empty', 'No recorded evidence yet'],
  ])('%s routes error and no_org away from its empty state', (file, _empty, reassurance) => {
    const page = src(file)
    expect(page).toContain("gaps.status === 'error' || gaps.status === 'no_org'")
    expect(page).toContain('ScanUnavailable')
    // The reassuring copy still exists -- for the case where it is true.
    expect(page).toContain(reassurance)
    // ...and the failure branch is decided before it.
    expect(page.indexOf("gaps.status === 'error'")).toBeLessThan(page.indexOf(`function ${_empty}`))
  })

  it('Ideas names a failed coverage scan instead of swallowing it', () => {
    /*
     * The same principle, at the scale the failure actually has.
     *
     * Coverage supplies the prompts that top up a thin Ideas field. When that
     * read fails the prompts are missing and everything else is fine, so the
     * lens must neither pretend the desk is quiet nor claim the page is
     * broken. It reports the gap by name.
     */
    const page = src('components/ideas-v2/IdeasWorkspace.tsx')
    expect(page).toContain("gaps.status === 'error' || gaps.status === 'no_org'")
    expect(page).toContain('coverage prompts')
    // Routed to the field's note, not to a full-page error. Checked on the
    // DEFINITION rather than the word, which still appears in the comment
    // explaining where the state went.
    expect(page).toContain('extraMissing')
    const body = code('components/ideas-v2/IdeasWorkspace.tsx')
    expect(body).not.toContain('ScanUnavailable')

    /*
     * And the field prints what it is told, rather than dropping it.
     *
     * Without this the caller could name a gap nobody ever sees, which is the
     * swallowing this whole describe exists to prevent -- one level down.
     */
    const field = src('components/ideas-v2/OpportunityGrid.tsx')
    expect(field).toContain('extraMissing')
    expect(field).toContain('Not yet reaching desktop')
  })
})
