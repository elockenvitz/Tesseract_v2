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

/**
 * The feed's filters draw in the shell's own bar, not in a second band.
 *
 * ── What this is protecting ──────────────────────────────────────────────
 *
 * The Dashboard drew a mode row -- Dashboard, Ideas, Explore, Portfolio --
 * and the feed drew its own full-width chip band directly beneath it: two
 * bands of controls and two rules for one surface. The chips are in the mode
 * bar now, right-justified.
 *
 * Source assertions for the reason the file already states: the alternative
 * is mounting the desktop feed with a query client, an attention pool and
 * market data to observe which DOM node a chip landed in.
 *
 * Every failure here is SILENT on screen, which is why each is pinned:
 *
 *  - a second rail written for the host's bar drifts from this one;
 *  - a `ref` instead of state leaves the rail in the old band, because a ref
 *    assignment schedules no re-render and the child never learns the node
 *    exists;
 *  - a host node that outlives the feed lens leaves the feed's chips sitting
 *    over the book;
 *  - and the Ideas tab, which passes no host, silently loses its filters.
 */
describe('the feed puts its filters in the host bar', () => {
  const FEED = 'src/components/ideas-app/IdeasExplore.tsx'

  it('has one toolbar, moved rather than copied', () => {
    const src = bare(FEED)
    expect(src).toContain('function RailSlot(')
    expect(src).toContain('return host ? createPortal(children, host)')
    /* One `IDEA_LENSES.map` in the file. A second is the copy this exists to
       prevent, and two chip rows reading the same state is how they start
       differing by a divider. */
    expect(src.match(/IDEA_LENSES\.map\(/g) ?? []).toHaveLength(1)
  })

  it('falls back to its own band when no host is given', () => {
    // The Ideas tab passes nothing and must keep the bar it has.
    expect(bare(FEED)).toContain(': <>{children}</>')
    expect(bare(FEED)).toContain('railHost = null')
  })

  it('hands over a node the child can react to, not a ref', () => {
    const src = bare(SHELL)
    expect(src).toContain('const [railHost, setRailHost] = useState<HTMLElement | null>(null)')
    expect(src).toContain('ref={setRailHost}')
    expect(src).toContain('railHost={railHost}')
  })

  it('removes the host with the lens, so the chips cannot outlive the feed', () => {
    const src = bare(SHELL)
    const i = src.indexOf('ref={setRailHost}')
    expect(i).toBeGreaterThan(-1)
    // The node is inside the feed-lens guard, not a permanent slot.
    expect(src.slice(0, i)).toMatch(/\{lens === 'feed' && \([\s\S]{0,200}$/)
  })

  it('opens Curate into the page from the right-hand end of the bar', () => {
    /* Measured at 1920 with `left-0`: the panel opened at x=1812 and was
       436px wider than the window, with its facets unreachable. `right-0`
       is correct at either end of a band -- at the left it still has the
       whole width to grow into. */
    const src = bare('src/components/ideas-app/CuratePanel.tsx')
    expect(src).toContain('absolute right-0 top-full')
    expect(src).not.toContain('absolute left-0 top-full')
  })
})
