/**
 * Tapping Move from an open idea did nothing until the idea was closed.
 *
 * ── Root cause ───────────────────────────────────────────────────────────
 *
 * `IdeaDetail` portals to `document.body` at `z-[90]`, opaque and full screen.
 * `BottomSheet`, which the stage chooser is, portals to `document.body` at
 * `z-[60]`. Two siblings on the body, so which one the reader sees comes down
 * to two z-indexes chosen independently — and the chooser loses. It was mounted
 * and interactive the whole time, underneath an opaque pane. Closing the detail
 * revealed it, which is exactly what was reported.
 *
 * ── The fix, and why not a bigger number ─────────────────────────────────
 *
 * Raising `z-[60]` fixes this collision and stores up the next one, because the
 * loser was never the layer — it was that nothing owned the relationship. The
 * chooser is a mode of the detail, so the detail renders it, into its own node.
 * `z-[90]` is a positioned element with a z-index, so it establishes a stacking
 * context, and a descendant at 60 resolves inside it: above the detail by
 * construction, and unchanged against everything else on the page.
 *
 * These read source. The claim is about which DOM node a portal targets and
 * which component owns a piece of state, and a render cannot see either.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const pipeline = src('components/mobile/MobilePipeline.tsx')
const sheet = src('components/mobile/BottomSheet.tsx')

describe('the stage chooser is owned by the pane that opens it', () => {
  it('is rendered by the detail, not beside it', () => {
    // The only <MoveSheet> in the file sits inside IdeaDetail's portal.
    const detailStart = pipeline.indexOf('function IdeaDetail(')
    expect(detailStart).toBeGreaterThan(-1)
    const usages = [...pipeline.matchAll(/<MoveSheet/g)].map(m => m.index!)
    expect(usages).toHaveLength(1)
    expect(usages[0]).toBeGreaterThan(detailStart)
  })

  /** A second row-shaped state was what let the two drift apart. */
  it('tracks it as a mode of the open detail', () => {
    expect(pipeline).toContain('const [moving, setMoving] = useState(false)')
    expect(pipeline).not.toContain('setMoveTarget')
  })

  it('draws into the detail s own node rather than the body', () => {
    expect(pipeline).toContain('const [host, setHost] = useState<HTMLDivElement | null>(null)')
    expect(pipeline).toContain('<div ref={setHost}')
    expect(pipeline).toContain('container={host}')
  })

  /**
   * A ref would be null on the render that opens the chooser, and the sheet
   * falls back to the body when it has no container — which is the exact
   * layering this removes.
   */
  it('re-renders when that node attaches', () => {
    expect(pipeline).not.toContain('useRef<HTMLDivElement')
  })
})

describe('the sheet primitive', () => {
  it('accepts an owner and still defaults to the body', () => {
    expect(sheet).toContain('container?: HTMLElement | null')
    expect(sheet).toContain('container ?? document.body')
  })

  /** No global layer was renumbered to make any of this work. */
  it('keeps its own layer', () => {
    expect(sheet).toContain('z-[60]')
    expect(pipeline).toContain('z-[90]')
  })
})

/**
 * Three full-bleed strips before the first card — view tabs, banner, stage
 * pager — read as three pieces of chrome of equal standing, and guidance about
 * a board should not outrank the board.
 */
describe('the banner is subordinate to the board controls', () => {
  it('is drawn as a card, not a strip', () => {
    expect(pipeline).toMatch(/<PilotStepsBanner[^>]*variant="inset"/)
  })

  it('sits below the stage selector and the search field', () => {
    const banner = pipeline.indexOf('<PilotStepsBanner')
    expect(banner).toBeGreaterThan(pipeline.indexOf('aria-label="Next stage"'))
    expect(banner).toBeGreaterThan(pipeline.indexOf('placeholder="Search symbol'))
  })
})

describe('the move itself is unchanged', () => {
  /** One canonical path, still the shared service, still on confirm. */
  it('still commits through the shared service once', () => {
    expect([...pipeline.matchAll(/movePairTrade\(\{/g)]).toHaveLength(1)
    expect([...pipeline.matchAll(/moveTrade\(\{/g)]).toHaveLength(1)
    expect(pipeline).toContain("commit(detail, target, 'mobile_sheet')")
  })

  it('still closes both the chooser and the detail on success', () => {
    const commit = pipeline.slice(pipeline.indexOf('const commit ='))
    expect(commit.slice(0, commit.indexOf('\n  }'))).toContain('setMoving(false)')
  })
})
