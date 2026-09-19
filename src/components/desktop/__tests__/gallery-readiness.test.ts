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

  it('still renders real findings without waiting for coverage', () => {
    // No coverage gate in front of the field; only the engine's own loading.
    expect(page).toContain('{isLoading ? (')
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
     * The same property as the cases above, asserted where Ideas keeps it.
     * `GallerySkeleton` sized by `opportunitySize` means the placeholders
     * stand in the columns the real tiles will take, so the handover is a
     * fade rather than a re-layout -- and the lens itself no longer holds a
     * competing skeleton for a grid it does not draw.
     */
    const field = src('components/ideas-v2/OpportunityGrid.tsx')
    expect(field).toContain('GallerySkeleton')
    expect(field).toContain('sizeAt={i => opportunitySize(')
    expect(code('components/ideas-v2/IdeasWorkspace.tsx')).not.toContain('function Loading()')
  })

  it('keeps Decisions chronological in its skeleton too', () => {
    const page = src('components/decisions-v2/DecisionsWorkspace.tsx')
    const loading = page.slice(page.indexOf('function Loading()'))
    expect(loading.slice(0, 220)).toContain('flow="chronological"')
    expect(loading.slice(0, 220)).toContain('sizeByRecency')
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
