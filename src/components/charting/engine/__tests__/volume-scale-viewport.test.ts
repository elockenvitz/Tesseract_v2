/**
 * Volume scales to what is on screen, not to every bar ever loaded.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * A split multiplies historical volume by the split factor. That is
 * arithmetically right and visually ruinous. AAPL's 2013 bar carries
 * 450,356,622 x 28 = 12,609,985,416 against a 2026 bar's 29,756,060 -- a
 * ratio of 424 -- so a pane scaled to the series maximum draws every modern
 * bar at under a quarter of one percent of its height. On the ALL window
 * the volume pane is a flat grey line beneath a price chart that is
 * otherwise entirely correct.
 *
 * Zooming in did not help, because the divisor never changed.
 *
 * This is not a case for changing the adjustment. The factors are right and
 * the stored values are right; the SCALE was asking the wrong question. The
 * price axis has always auto-scaled to the visible window -- see the
 * `autoScalePrice` effect in `ProChart`, which filters bars to
 * `startTime..endTime` before taking a range. Volume simply never asked.
 *
 * ── Why these tests read pixels ───────────────────────────────────────────
 *
 * A renderer defect has no stack trace, no failing request and no thrown
 * error. The chart draws. The only way this fails loudly is to record what
 * was actually painted and measure it, so the fake context below keeps every
 * `fillRect` and the assertions are about heights.
 */
import { describe, it, expect } from 'vitest'
import { ChartRenderer } from '../renderer'
import { ChartTransform } from '../transform'
import type { OHLC, ChartTheme, ChartDimensions, ViewState } from '../types'

interface Rect { x: number; y: number; w: number; h: number }

/** A canvas context that remembers the rectangles it was asked to fill. */
function fakeCtx() {
  const rects: Rect[] = []
  const ctx = {
    rects,
    fillStyle: '',
    save() {}, restore() {}, beginPath() {}, stroke() {}, fill() {},
    /* The renderer clips every data series to the plot rectangle so a
       panned price line cannot be drawn over the study panes. The stub
       has to model that call even though these assertions ignore it. */
    rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h })
    },
  }
  return ctx as unknown as CanvasRenderingContext2D & { rects: Rect[] }
}

const theme = { volumeUp: '#0a0', volumeDown: '#a00' } as unknown as ChartTheme

const dimensions: ChartDimensions = {
  width: 1000, height: 600,
  marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
} as ChartDimensions

/** One bar per day from `t0`, with the volumes given. */
function series(volumes: number[], t0 = 1_700_000_000): OHLC[] {
  return volumes.map((v, i) => ({
    time: t0 + i * 86_400,
    open: 100, high: 101, low: 99, close: 100.5,
    volume: v,
  })) as OHLC[]
}

function drawWith(data: OHLC[], view: Partial<ViewState>) {
  const ctx = fakeCtx()
  const full: ViewState = {
    startTime: data[0].time,
    endTime: data[data.length - 1].time,
    minPrice: 0, maxPrice: 200, autoScalePrice: false,
    ...view,
  } as ViewState
  const transform = new ChartTransform(dimensions, full)
  new ChartRenderer(ctx, theme, transform, 1).drawVolume(data)
  return ctx.rects
}

/**
 * Only the rectangles a reader can actually see.
 *
 * `drawVolume` is handed the whole series and lets the transform place each
 * bar, so an off-screen bar is still painted -- at a negative x, or past the
 * right edge, where the canvas clips it. An assertion over every rect
 * therefore measures bars nobody can see, and the giant pre-split bar is
 * exactly such a bar: it kept this suite green against the unfixed renderer
 * on its first run, because IT was the tallest rect returned.
 */
function onScreen(rects: Rect[]): Rect[] {
  return rects.filter(r => r.x + r.w > 0 && r.x < dimensions.width)
}

/*
 * The real shape of the defect: one enormous pre-split bar, then ordinary
 * modern ones. 12,609,985,416 is AAPL's 2013 volume carried through the 7:1
 * and 4:1 splits; 29,756,060 is a 2026 bar.
 */
const SPLIT_ADJUSTED = series([12_609_985_416, 29_756_060, 31_002_114, 28_400_900])

describe('volume scales to the visible window', () => {
  it('draws modern bars at a usable height once the giant bar is off screen', () => {
    const modernOnly = {
      startTime: SPLIT_ADJUSTED[1].time,
      endTime: SPLIT_ADJUSTED[3].time,
    }
    const rects = onScreen(drawWith(SPLIT_ADJUSTED, modernOnly))
    const pane = dimensions.height * 0.15

    /* The tallest bar a reader can see should fill the pane, not vanish
       into it. Measured over on-screen rects only: the pre-split bar is
       still painted, off the left edge, and it is not what is being
       judged here. */
    expect(rects.length).toBeGreaterThan(0)
    const tallest = Math.max(...rects.map(r => r.h))
    expect(tallest).toBeGreaterThan(pane * 0.9)
  })

  it('is the defect itself when scaled to the whole series', () => {
    /* The same data with the giant bar IN view: the modern bars are the
       sliver this change exists to remove. Pinned so the fix cannot be
       mistaken for the old behaviour. */
    const rects = drawWith(SPLIT_ADJUSTED, {})
    const pane = dimensions.height * 0.15
    const modern = rects.filter(r => r.h < pane * 0.5)
    expect(modern.length).toBeGreaterThan(0)
    for (const r of modern) expect(r.h).toBeLessThan(pane * 0.01)
  })

  it('never draws a bar taller than the pane', () => {
    /* A bar at the edge of the window can exceed the visible maximum. */
    const rects = onScreen(drawWith(SPLIT_ADJUSTED, {
      startTime: SPLIT_ADJUSTED[1].time,
      endTime: SPLIT_ADJUSTED[3].time,
    }))
    const pane = dimensions.height * 0.15
    expect(rects.length).toBeGreaterThan(0)
    for (const r of rects) expect(r.h).toBeLessThanOrEqual(pane + 0.001)
  })

  it('keeps heights proportional to volume within the window', () => {
    const data = series([10, 20, 40])
    const rects = drawWith(data, {})
    const byX = [...rects].sort((a, b) => a.x - b.x)
    expect(byX).toHaveLength(3)
    /* 10:20:40 -> 1:2:4 against the window max. */
    expect(byX[1].h / byX[0].h).toBeCloseTo(2, 5)
    expect(byX[2].h / byX[0].h).toBeCloseTo(4, 5)
  })

  it('still draws when the window holds no volume at all', () => {
    /* Scrolled past the data: fall back to the series max rather than
       collapse the pane to nothing. */
    const data = series([10, 20, 40])
    const far = data[2].time + 10 * 86_400
    const rects = drawWith(data, { startTime: far, endTime: far + 86_400 })
    expect(rects.length).toBeGreaterThan(0)
    expect(Math.max(...rects.map(r => r.h))).toBeGreaterThan(0)
  })

  it('draws nothing when no bar carries a volume', () => {
    const data = series([0, 0, 0])
    expect(drawWith(data, {})).toHaveLength(0)
  })
})
