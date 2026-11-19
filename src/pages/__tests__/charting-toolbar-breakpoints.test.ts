/**
 * The toolbar's collapse thresholds, pinned to the widths they were measured
 * against.
 *
 * ── Why these numbers and not round ones ─────────────────────────────────
 *
 * Measured in the running app at a 1920px viewport, the right-hand control
 * group is 1063px intrinsic:
 *
 *   timeframe pill   492   (8 buttons + Freq + Custom)  46% of the group
 *   chart type       132
 *   metric  "Price"   90
 *   indicators       105
 *   compare          100
 *   view mode         68
 *   add panel         28
 *   gaps              48
 *
 * plus ~192px for the symbol search on the other side. The bar therefore
 * needs about 1255px to lay out flat, and below that it overflowed -- 85px
 * of controls hanging off the side at phone width.
 *
 * `TOOLBAR_COMPACT_PX` has to sit ABOVE that 1255, so the secondary controls
 * move into the Analysis panel just BEFORE the overflow rather than during
 * it. `TOOLBAR_TIGHT_PX` has to sit above what remains once they have gone
 * -- 192 + 492 + 132 + 110 is about 926 -- so the timeframe pill becomes a
 * select before THAT overflows in turn.
 *
 * A test that merely asserted `1280 === 1280` would pass if someone changed
 * the constant and the comment together while breaking the relationship to
 * the measurements. These assert the ORDERING and the headroom, which is
 * what actually has to hold.
 */
import { describe, it, expect } from 'vitest'
import { TOOLBAR_COMPACT_PX, TOOLBAR_TIGHT_PX } from '../ChartingPage'

/** The measurements above, as the figures the thresholds must clear. */
const MEASURED = {
  symbolSearch: 192,
  timeframePill: 492,
  chartType: 132,
  metric: 90,
  indicators: 105,
  compare: 100,
  viewMode: 68,
  addPanel: 28,
  gaps: 48,
  analysisButton: 110,
}

const rightGroupIntrinsic =
  MEASURED.timeframePill + MEASURED.chartType + MEASURED.metric +
  MEASURED.indicators + MEASURED.compare + MEASURED.viewMode +
  MEASURED.addPanel + MEASURED.gaps

const flatBarRequires = rightGroupIntrinsic + MEASURED.symbolSearch

const collapsedBarRequires =
  MEASURED.symbolSearch + MEASURED.timeframePill + MEASURED.chartType +
  MEASURED.analysisButton

describe('the measurements the thresholds answer to', () => {
  it('reproduces the 1063px right-hand group', () => {
    /* If someone adds a control, this figure moves and the thresholds below
       must be re-derived rather than left as they were. */
    expect(rightGroupIntrinsic).toBe(1063)
  })

  it('needs about 1255px for a flat bar', () => {
    expect(flatBarRequires).toBe(1255)
  })
})

describe('the compact threshold', () => {
  it('fires BEFORE the bar overflows, not after', () => {
    expect(TOOLBAR_COMPACT_PX).toBeGreaterThan(flatBarRequires)
  })

  it('does not fire so early that a bar with room to spare is collapsed', () => {
    /* 200px of slack above the requirement would mean hiding controls on a
       toolbar that could still show them. */
    expect(TOOLBAR_COMPACT_PX - flatBarRequires).toBeLessThan(200)
  })
})

describe('the tight threshold', () => {
  it('is below the compact one, so the two stages happen in order', () => {
    /* Reversed, the timeframe pill would collapse while the secondary
       controls were still taking up 430px beside it. */
    expect(TOOLBAR_TIGHT_PX).toBeLessThan(TOOLBAR_COMPACT_PX)
  })

  it('fires before the already-collapsed bar overflows in turn', () => {
    expect(TOOLBAR_TIGHT_PX).toBeGreaterThan(collapsedBarRequires)
  })

  it('leaves the timeframe pill visible at ordinary laptop widths', () => {
    /* A 1280px laptop must still get the eight buttons: swapping them for a
       select there would be a regression dressed as responsiveness. */
    expect(TOOLBAR_TIGHT_PX).toBeLessThan(1280)
  })
})
