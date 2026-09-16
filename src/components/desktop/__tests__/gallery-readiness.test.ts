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

  /* `exposure` feeds scoreIdea's materiality term; prompts append to the list.
     Both change the index that spanForRank turns into a column span. */
  it('waits for exposure and the coverage scan before the field', () => {
    expect(page).toContain('if (!exposureSettled || gaps.status === \'loading\') return <Loading />')
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

  it.each([
    ['components/decisions-v2/DecisionsWorkspace.tsx', 'GallerySkeleton'],
    ['components/research-v2/ResearchWorkspace.tsx', 'GallerySkeleton'],
    // Ideas draws its own twelve-column field, so its skeleton uses that
    // field's own `spanForRank` -- the property is the same one.
    ['components/ideas-v2/IdeasWorkspace.tsx', 'spanForRank(i)'],
  ])('%s no longer hand-rolls a mismatched grid', (file, marker) => {
    const page = src(file)
    const loading = page.slice(page.indexOf('function Loading()'))
    const body = loading.slice(0, loading.indexOf('\n}'))
    expect(body).toContain(marker)
    expect(body).not.toContain('md:grid-cols-2 xl:grid-cols-3')
  })

  it('keeps Decisions chronological in its skeleton too', () => {
    const page = src('components/decisions-v2/DecisionsWorkspace.tsx')
    const loading = page.slice(page.indexOf('function Loading()'))
    expect(loading.slice(0, 220)).toContain('flow="chronological"')
    expect(loading.slice(0, 220)).toContain('sizeByRecency')
  })
})

describe('a failed scan is never reported as good news', () => {
  it.each([
    ['components/today/TodayPage.tsx', 'Cleared', "You're current."],
    ['components/ideas-v2/IdeasWorkspace.tsx', 'Empty', 'No open ideas'],
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
})
