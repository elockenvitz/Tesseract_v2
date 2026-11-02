import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Going back from the workspace stops re-rendering the whole field.
 *
 * ── What was measured ─────────────────────────────────────────────────────
 *
 * In the running app, with a `longtask` PerformanceObserver across the click
 * and for 2.5s after, on the live desktop Explore field of 145 tiles:
 *
 *   opening a tile   234ms in 2 long tasks (106ms, 128ms)
 *   going back       258ms in 2 long tasks (129ms, 129ms)
 *
 * A frame is 16ms, so each of those is roughly eight dropped frames, and the
 * cost is symmetric -- it is not something special about "back". Nothing was
 * refetching: the tile count never left 145 and no skeleton ever appeared. The
 * whole of it was rendering all 145 tiles, twice, to change the appearance of
 * two of them.
 *
 * ── The four things that were defeating a memo ────────────────────────────
 *
 * 1. `ExploreTile` was not memoised at all.
 * 2. It took `selectedKey`, which changes on every selection, so every tile
 *    had a changed prop by construction.
 * 3. `open` came from `resolve(o.item)` called inside the render loop -- a
 *    fresh object per tile per render.
 * 4. `closes` fell back to a literal `[]`, a fresh array per render.
 *
 * And above all of it, `DashboardNext` passed `resolve` and `onOpen` as inline
 * arrows, so the field itself received new function identities every render.
 * Memoising the tile without fixing that would have been decoration, which is
 * why this file pins the call site too.
 *
 * ── Why source assertions ─────────────────────────────────────────────────
 *
 * A render-count test would need the whole desktop field mounted with market
 * data, a query client and an attention pool, and it would still be asserting
 * React's scheduling rather than this code. What actually has to hold is a set
 * of prop-shape invariants, and those are visible in the source. The timing
 * above is the behavioural evidence; these cases stop it silently regressing.
 */

const ROOT = resolve(__dirname, '../../../../')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const BROWSE = 'src/components/ideas-app/IdeasExploreBrowse.tsx'
const SHELL = 'src/components/dashboard-next/DashboardNext.tsx'

/* Comments quote the old lines to explain why they are gone, so every absence
   assertion reads the code and not the prose about it. */
const bare = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

describe('the tile can be skipped when nothing about it changed', () => {
  it('is memoised', () => {
    const src = bare(BROWSE)
    expect(src).toMatch(/const ExploreTile = memo\(/)
    expect(src).toMatch(/import \{[^}]*\bmemo\b[^}]*\} from 'react'/)
  })

  it('takes a boolean, not the selected key', () => {
    const src = bare(BROWSE)
    const start = src.indexOf('const ExploreTile = memo(')
    const props = src.slice(start, src.indexOf('}) {', start))
    expect(props).toContain('selected: boolean')
    // The key reaching the tile is the whole defect: it changes for all 145.
    expect(props).not.toContain('selectedKey')
  })

  it('decides `selected` in the parent, where the key already is', () => {
    expect(bare(BROWSE)).toContain('selected={isSelected(opens[i], selectedKey)}')
  })
})

describe('every prop handed to a tile is stable across an unrelated render', () => {
  it('resolves the field once, in a memo, instead of per render', () => {
    const src = bare(BROWSE)
    expect(src).toMatch(/const opens = useMemo\(\(\) => shown\.map\(o => resolve\(o\.item\)\), \[shown, resolve\]\)/)
  })

  it('does not call resolve inside the render loop any more', () => {
    const src = bare(BROWSE)
    const start = src.indexOf(': shown.map(')
    expect(start).toBeGreaterThan(-1)
    const loop = src.slice(start, src.indexOf('</DesktopGallery>', start))
    expect(loop).not.toContain('resolve(o.item)')
    expect(loop).toContain('open={opens[i]}')
  })

  it('uses one frozen empty array for a tile with no prices', () => {
    const src = bare(BROWSE)
    expect(src).toMatch(/const NO_CLOSES: TileClose\[\] = \[\]/)
    const start = src.indexOf(': shown.map(')
    const loop = src.slice(start, src.indexOf('</DesktopGallery>', start))
    // `?? []` allocates per render, which is a changed prop under memo.
    expect(loop).not.toMatch(/closes=\{[^}]*\?\?\s*\[\]/)
    expect(loop).toContain('NO_CLOSES')
  })
})

describe('the shell holds the two callbacks stable', () => {
  it('passes named callbacks, not inline arrows, to the field', () => {
    const src = bare(SHELL)
    const start = src.indexOf('<IdeasExploreBrowse')
    expect(start).toBeGreaterThan(-1)
    const el = src.slice(start, src.indexOf('/>', start))
    expect(el).toContain('resolve={resolveExplore}')
    expect(el).toContain('onOpen={onExploreOpen}')
    // An arrow here is the thing that made memoising the tile pointless.
    expect(el).not.toContain('=>')
  })

  it('memoises resolve on the candidate pool, which is what it reads', () => {
    const src = bare(SHELL)
    expect(src).toMatch(/const resolveExplore = useCallback\(/)
    // Keyed on `resolver.entries` and nothing else: narrower would go stale,
    // wider would change identity for no reason.
    const start = src.indexOf('const resolveExplore = useCallback(')
    expect(src.slice(start, start + 220)).toContain('[resolver.entries]')
  })

  it('memoises the open handler too, and the route it calls', () => {
    const src = bare(SHELL)
    expect(src).toMatch(/const onExploreOpen = useCallback\(/)
    // `openWorkspace` is called by it, so an unstable one would propagate.
    expect(src).toMatch(/const openWorkspace = useCallback\(/)
  })

  it('still routes all four answers, which is what must not have changed', () => {
    // The hoist moved this body out of JSX verbatim. If an arm were dropped,
    // a tile would silently stop opening -- the fault the previous commit
    // spent its whole diff removing.
    const src = bare(SHELL)
    const start = src.indexOf('const onExploreOpen = useCallback(')
    const body = src.slice(start, src.indexOf('}, [openWorkspace])', start))
    expect(body).toContain("open.do === 'work'")
    expect(body).toContain("open.do === 'article'")
    expect(body).toContain("open.do === 'navigate'")
    expect(body).toContain('nothing to open')
  })
})
