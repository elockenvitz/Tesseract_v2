/**
 * What this file used to pin, and why it no longer can.
 *
 * ── The original defect ──────────────────────────────────────────────────
 *
 * Tapping Move from an open idea did nothing until the idea was closed.
 * `MobilePipeline` owned a local `IdeaDetail` that portalled to
 * `document.body` at `z-[90]`, opaque and full screen, and a `MoveSheet` that
 * portalled to `document.body` at `z-[60]`. Two siblings on the body, so which
 * one the reader saw came down to two z-indexes chosen independently — and the
 * chooser lost. It was mounted and interactive the whole time, underneath an
 * opaque pane.
 *
 * The lesson was not "pick a bigger number". It was that nothing owned the
 * relationship between the two panes, so the fix made the chooser a mode of
 * the detail, rendered into the detail's own node.
 *
 * ── Why the assertions changed ───────────────────────────────────────────
 *
 * Both panes are gone. A phone could walk an idea to Ready to Recommend
 * through that local detail and then had no way to write a thesis, satisfy a
 * blocked gate, or submit the recommendation the stage is named after —
 * because a stage change was the only write the pane had. Tapping a card now
 * opens `TradeIdeaDetailModal`, the same component the desktop board, Trade
 * Lab and the simulation page open, which already adapts itself to a phone.
 *
 * The lesson survives as a stronger claim than the one it replaces: the
 * pipeline owns no second detail pane and no second stage chooser at all, so
 * there is no pair of independently chosen layers left to collide. These read
 * source, because the claim is about which component owns a piece of state
 * and which module a surface delegates to, and a render cannot see either.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const pipeline = src('components/mobile/MobilePipeline.tsx')
const sheet = src('components/mobile/BottomSheet.tsx')
const modal = src('components/trading/TradeIdeaDetailModal.tsx')

/**
 * Code only. The comments in this file name the very calls it no longer makes
 * — "no `useTradeIdeaService()` here any more" — so a prose match would be a
 * false positive on the explanation of the fix.
 */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const body = codeOnly(pipeline.slice(pipeline.indexOf('export function MobilePipeline')))

describe('the pipeline opens the shared detail, not one of its own', () => {
  it('mounts TradeIdeaDetailModal, exactly once, from the open row', () => {
    expect([...pipeline.matchAll(/<TradeIdeaDetailModal/g)]).toHaveLength(1)
    expect(pipeline).toContain("import { TradeIdeaDetailModal } from '../trading/TradeIdeaDetailModal'")
    expect(pipeline).toMatch(/tradeId=\{detail\.id\}/)
  })

  /**
   * The same module the desktop surfaces import. If a mobile-only copy is
   * ever forked off, this is where it shows up.
   */
  it('reaches the same component the desktop surfaces mount', () => {
    for (const p of ['pages/TradeQueuePage.tsx', 'pages/SimulationPage.tsx']) {
      expect(src(p)).toContain('components/trading/TradeIdeaDetailModal')
    }
  })

  it('is the mobile-adapted modal, not the desktop one squeezed', () => {
    expect(modal).toContain('useIsMobile')
  })

  /** The two panes whose layers collided. Neither exists here any more. */
  it('owns no local detail pane and no local stage chooser', () => {
    expect(pipeline).not.toContain('function IdeaDetail(')
    expect(pipeline).not.toContain('function MoveSheet(')
    expect(pipeline).not.toContain('<MoveSheet')
    expect(pipeline).not.toContain('const [moving, setMoving]')
  })

  /**
   * A body portal at a hand-picked z-index is the shape of the original bug.
   * The one sheet left — the stage pager's "Go to stage" — has nothing opaque
   * above it, because the pane that was above it is gone.
   */
  it('portals nothing to the body itself', () => {
    expect(pipeline).not.toContain('createPortal')
    expect(pipeline).not.toContain('z-[90]')
  })
})

describe('the pipeline performs no idea mutations of its own', () => {
  /**
   * Not a style rule. Two implementations of "advance a stage" drift, and the
   * mobile one drifted into being unable to do anything else.
   */
  it('does not call the idea service directly', () => {
    expect(body).not.toContain('useTradeIdeaService(')
    expect(body).not.toContain('moveTrade({')
    expect(body).not.toContain('movePairTrade({')
  })

  /** Gating a move is the modal's job, in one place, for both shells. */
  it('does not re-derive the move gate', () => {
    expect(body).not.toContain('missingForStage')
    expect(body).not.toContain('isForwardMove')
  })

  /**
   * And the modal carries all three pieces the pane used to: the ladder read
   * from the canonical stage model, a permission check, and a confirmation
   * step before the write. The move is never a single tap there either.
   */
  it('and the modal is where the ladder, the permission and the confirm live', () => {
    expect(modal).toContain("from '../../lib/ideas/stage-model'")
    expect(modal).toContain('useTradeIdeaService')
    expect(modal).toContain('canMoveStages')
    expect(modal).toContain('setPendingStageMove')
  })
})

describe('the sheet primitive', () => {
  /** Kept as an escape hatch: a future owner-rendered sheet needs it. */
  it('accepts an owner and still defaults to the body', () => {
    expect(sheet).toContain('container?: HTMLElement | null')
    expect(sheet).toContain('container ?? document.body')
  })

  /** No global layer was renumbered by any of this. */
  it('keeps its own layer', () => {
    expect(sheet).toContain('z-[60]')
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
