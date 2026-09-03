import { describe, it, expect } from 'vitest'
import {
  resolveTile, claimLinesAt, rowsVisual, plotVisual, TILE_COST,
  type TileRequirement, type TileContainer,
} from '../tile-geometry'

/**
 * These assert INVARIANTS, never "this family is 448px".
 *
 * A test that pinned a family to a pixel height would re-encode the system
 * this replaces — the whole defect was that a type decided a height. What must
 * hold is relational: sparser resolves shorter, narrower resolves taller, the
 * feed is the ceiling, and an active workflow can ask for more than the
 * passive card reserves.
 */

/** A short phone, feed area only — the viewport minus app chrome. */
const SHORT: TileContainer = { width: 400, height: 590 }
/** The canonical tall phone, feed area only. */
const TALL: TileContainer = { width: 390, height: 734 }

/** A sparse workflow card: a claim, some context, a prompt, actions. */
const SPARSE: TileRequirement = {
  claimChars: 34, contextRows: 1, bodyLines: 2, hasActionTray: true,
}

describe('the feed is the ceiling, not the viewport', () => {
  it('never resolves taller than the container it was given', () => {
    /**
     * The defect this system exists to prevent. On a real 400x700 device the
     * feed is 590px, and the old ceiling was `min(46rem, 100dvh)` = 700 — a
     * card 110px taller than the box it lives in, with its action tray below
     * the visible area.
     */
    const rich: TileRequirement = {
      claimChars: 90, hasMetric: true, contextRows: 2, bodyLines: 3,
      controlRows: 2, visual: plotVisual(), hasActionTray: true,
    }
    for (const c of [SHORT, TALL, { width: 360, height: 520 }]) {
      expect(resolveTile(rich, c).height, `${c.width}x${c.height}`)
        .toBeLessThanOrEqual(c.height)
    }
  })

  it('reports when the ceiling bit, rather than silently overflowing', () => {
    const rich: TileRequirement = {
      claimChars: 120, hasMetric: true, contextRows: 2, bodyLines: 4,
      controlRows: 3, visual: plotVisual(),
    }
    const tiny = resolveTile(rich, { width: 360, height: 300 })
    expect(tiny.capped).toBe(true)
    expect(tiny.requested).toBeGreaterThan(tiny.height)
  })
})

describe('width is an input to height', () => {
  it('wraps a claim to more lines on a narrower phone', () => {
    expect(claimLinesAt(64, 360)).toBeGreaterThan(claimLinesAt(64, 430))
  })

  it('resolves the same content taller when it is narrower', () => {
    /**
     * Not a rounding artifact: the claim genuinely occupies another line, and
     * a line is real vertical room. The old system gave both widths the same
     * fixed rem.
     */
    const narrow = resolveTile({ ...SPARSE, claimChars: 64 }, { width: 360, height: 800 })
    const wide = resolveTile({ ...SPARSE, claimChars: 64 }, { width: 430, height: 800 })
    expect(narrow.height).toBeGreaterThan(wide.height)
    expect(narrow.claimLines).toBeGreaterThan(wide.claimLines)
  })
})

describe('content is an input to height', () => {
  it('gives a sparser tile less room, with no reference to its family', () => {
    const sparse = resolveTile(SPARSE, TALL)
    const dense = resolveTile(
      { ...SPARSE, hasMetric: true, controlRows: 3, visual: rowsVisual(5) }, TALL)
    expect(sparse.height).toBeLessThan(dense.height)
  })

  it('lets a visual declare its own requirement', () => {
    const withRows = resolveTile({ ...SPARSE, visual: rowsVisual(5) }, TALL)
    const withFewerRows = resolveTile({ ...SPARSE, visual: rowsVisual(2) }, TALL)
    expect(withRows.height).toBeGreaterThan(withFewerRows.height)
  })

  it('lets a plot use room a row list would not', () => {
    /**
     * The difference is declared by the primitive. A chart is better bigger; a
     * five-row bar list is finished at five rows and should not take a screen
     * because it happens to sit on a card with space.
     */
    const plot = resolveTile({ ...SPARSE, visual: plotVisual() }, TALL)
    const rows = resolveTile({ ...SPARSE, visual: rowsVisual(5) }, TALL)
    expect(plot.height).toBeGreaterThan(rows.height)
  })

  it('does not let a row visual expand just because the container is tall', () => {
    const short = resolveTile({ ...SPARSE, visual: rowsVisual(5) }, { width: 390, height: 600 })
    const tall = resolveTile({ ...SPARSE, visual: rowsVisual(5) }, { width: 390, height: 900 })
    expect(tall.height).toBe(short.height)
  })
})

describe('workflow state is an input to height', () => {
  it('lets an active response ask for more than its passive card', () => {
    const passive = resolveTile(SPARSE, TALL)
    const active = resolveTile({ ...SPARSE, workflow: 'active', controlRows: 2 }, TALL)
    expect(active.height).toBeGreaterThan(passive.height)
  })

  it('does not reserve the note in the passive card', () => {
    /**
     * The other half, and the one that matters for density: a passive card
     * that permanently reserved response room is exactly the unearned
     * whitespace this pass exists to remove.
     */
    const passive = resolveTile(SPARSE, TALL)
    const active = resolveTile({ ...SPARSE, workflow: 'active' }, TALL)
    expect(active.height - passive.height).toBe(TILE_COST.noteField)
  })
})

describe('the action tray is inside the tile', () => {
  it('always budgets for the tray when there is one', () => {
    const withTray = resolveTile({ ...SPARSE, hasActionTray: true }, TALL)
    const without = resolveTile({ ...SPARSE, hasActionTray: false }, TALL)
    expect(withTray.height - without.height).toBe(TILE_COST.actionTray)
  })
})

describe('the resolver is family-blind', () => {
  it('gives identical geometry to identical shapes', () => {
    /**
     * The architectural acceptance test. Two families with the same
     * composition must resolve the same, because the resolver cannot see a
     * family at all — which is what makes a new tile family need no new height
     * rule.
     */
    const shape: TileRequirement = {
      claimChars: 48, hasMetric: true, contextRows: 1,
      visual: rowsVisual(5), hasActionTray: true,
    }
    expect(resolveTile({ ...shape }, SHORT)).toEqual(resolveTile({ ...shape }, SHORT))
  })

  it('is deterministic, so a collapsed slot matches a mounted one', () => {
    const r = { claimChars: 55, hasMetric: true, visual: plotVisual(), hasActionTray: true }
    const a = resolveTile(r, SHORT)
    const b = resolveTile(r, SHORT)
    expect(a).toEqual(b)
  })
})
