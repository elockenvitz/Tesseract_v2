/**
 * What a press on the chart canvas means.
 *
 * These are the decisions that used to be unreachable: they lived inside
 * `ProChart.handleMouseDown`, whose canvas cannot be rendered in jsdom, so
 * nothing about the interaction model could be asserted without a browser.
 */
import { describe, expect, it } from 'vitest'
import { beginGesture, completeDraw, type Projector } from '../drawing-gesture'
import { DEFAULT_ANNOTATION_STYLE, type AnnotationType } from '../../../components/charting/engine/annotations'
import { MIN_DRAG_PIXELS } from '../annotation-geometry'

/* A plot inset from a 1000x600 canvas: 60px price gutter right, 40px time
   gutter bottom. The same shape ProChart's `chartArea` describes. */
const AREA = { x: 50, y: 10, width: 890, height: 550 }
const DIMS = { width: 1000, height: 600 }

/**
 * A linear projector whose arithmetic is checkable by eye: x 50..940 maps to
 * 1000..1890 seconds, y 10..560 maps to 200 down to 145 (price falls as y
 * rises, as it does on a real chart).
 */
const project: Projector = {
  xToTime: x => 1000 + (x - AREA.x),
  yToPrice: y => 200 - (y - AREA.y) * 0.1,
}

const at = (x: number, y: number) => ({ x, y })
const begin = (p: { x: number; y: number }, activeTool: AnnotationType | null = null) =>
  beginGesture({ at: p, chartArea: AREA, dimensions: DIMS, activeTool })

describe('with no tool selected, the chart behaves as it always did', () => {
  it('pans from inside the plot', () => {
    expect(begin(at(400, 300))).toEqual({ kind: 'pan', axis: 'both' })
  })

  it('zooms the price axis from the right gutter', () => {
    expect(begin(at(960, 300))).toEqual({ kind: 'zoom-price' })
  })

  it('zooms the time axis from the bottom gutter', () => {
    expect(begin(at(400, 580))).toEqual({ kind: 'zoom-time' })
  })

  it('ignores a press beyond the canvas', () => {
    expect(begin(at(1200, 300))).toEqual({ kind: 'none' })
    expect(begin(at(400, 900))).toEqual({ kind: 'none' })
  })

  it('treats the plot edges as inside', () => {
    expect(begin(at(AREA.x, AREA.y)).kind).toBe('pan')
    expect(begin(at(AREA.x + AREA.width, AREA.y + AREA.height)).kind).toBe('pan')
  })
})

describe('with a tool selected', () => {
  it('begins a drawing inside the plot instead of a pan', () => {
    expect(begin(at(400, 300), 'trend-line')).toEqual({
      kind: 'draw',
      tool: 'trend-line',
      from: { x: 400, y: 300 },
    })
  })

  it('still lets the axes zoom', () => {
    /*
     * The axes are the only way to change the view. A tool that captured
     * them would strand a reader who needed to zoom out before placing the
     * next mark and had no way to.
     */
    expect(begin(at(960, 300), 'trend-line')).toEqual({ kind: 'zoom-price' })
    expect(begin(at(400, 580), 'rectangle')).toEqual({ kind: 'zoom-time' })
  })

  it('does not begin a drawing outside the canvas', () => {
    expect(begin(at(1200, 300), 'trend-line')).toEqual({ kind: 'none' })
  })
})

describe('completing a two-point drawing', () => {
  const complete = (tool: AnnotationType, from: { x: number; y: number }, to: { x: number; y: number }) =>
    completeDraw({ tool, from, to, project, style: DEFAULT_ANNOTATION_STYLE, id: 'a1' })

  it('puts the mark between the two projected points', () => {
    const a = complete('trend-line', at(100, 100), at(500, 300)) as unknown as Record<string, number>
    expect(a.startTime).toBe(project.xToTime(100))
    expect(a.startPrice).toBeCloseTo(project.yToPrice(100), 10)
    expect(a.endTime).toBe(project.xToTime(500))
    expect(a.endPrice).toBeCloseTo(project.yToPrice(300), 10)
  })

  it('draws a downward drag as a falling line', () => {
    /* Dragging DOWN the canvas is dragging DOWN in price. The old code could
       only ever produce a rising line, whatever the gesture. */
    const a = complete('trend-line', at(100, 100), at(500, 300)) as unknown as Record<string, number>
    expect(a.endPrice).toBeLessThan(a.startPrice)
  })

  it('draws an upward drag as a rising line', () => {
    const a = complete('trend-line', at(100, 300), at(500, 100)) as unknown as Record<string, number>
    expect(a.endPrice).toBeGreaterThan(a.startPrice)
  })

  it('refuses a click that never moved', () => {
    /*
     * Otherwise every stray click with a tool still selected deposits an
     * invisible zero-length mark, selectable only by accident.
     */
    expect(complete('trend-line', at(300, 300), at(300, 300))).toBeNull()
    expect(complete('rectangle', at(300, 300), at(301, 301))).toBeNull()
  })

  it('accepts a drag at the pixel floor', () => {
    expect(complete('trend-line', at(300, 300), at(300 + MIN_DRAG_PIXELS, 300))).not.toBeNull()
  })

  it('refuses a tool it does not recognise', () => {
    /* The old code's default branch turned an unknown type into a horizontal
       line, putting an unrequested price level on the chart. */
    expect(complete('freehand' as AnnotationType, at(100, 100), at(500, 300))).toBeNull()
  })
})

describe('completing a one-point drawing', () => {
  const complete = (tool: AnnotationType, from: { x: number; y: number }, to: { x: number; y: number }) =>
    completeDraw({ tool, from, to, project, style: DEFAULT_ANNOTATION_STYLE, id: 'a1' })

  it('lands a horizontal line at the press, ignoring any drag', () => {
    /* The hand often moves while releasing. A price level must sit where it
       was aimed, not where the mouse happened to come to rest. */
    const a = complete('horizontal-line', at(200, 250), at(700, 480)) as unknown as Record<string, number>
    expect(a.price).toBeCloseTo(project.yToPrice(250), 10)
  })

  it('lands a vertical line at the press time', () => {
    const a = complete('vertical-line', at(200, 250), at(700, 480)) as unknown as Record<string, number>
    expect(a.time).toBe(project.xToTime(200))
  })

  it('commits on a click, with no drag floor to clear', () => {
    /* A one-point tool must not be subject to the drag floor, or a click --
       which is its entire gesture -- would produce nothing at all. */
    expect(complete('horizontal-line', at(300, 300), at(300, 300))).not.toBeNull()
    expect(complete('text', at(300, 300), at(300, 300))).not.toBeNull()
  })
})

describe('the gesture kinds match the modes ProChart already had', () => {
  it('names them identically, so the adapter needs no translation', () => {
    /* A translation table between this module's names and the component's
       is a place for the two to disagree. */
    const kinds = new Set([
      begin(at(400, 300)).kind,
      begin(at(960, 300)).kind,
      begin(at(400, 580)).kind,
    ])
    expect(kinds).toEqual(new Set(['pan', 'zoom-price', 'zoom-time']))
  })
})

/**
 * The study panes under the main chart.
 *
 * `dimensions` describes the MAIN chart only, because ProChart builds the
 * transform from `mainChartDimensions`. Once plots existed, the main chart
 * shrank to `mainChartHeightRatio` of the canvas -- as little as 0.3 -- and
 * every press in the remaining 70% fell outside all three regions and
 * returned `none`. Dragging an RSI or MACD pane did nothing at all.
 */
describe('a press in a study pane', () => {
  /* Main chart 600 tall inside an 1100-tall canvas: 500px of panes. */
  const STACK = 1100
  const inPanes = (p: { x: number; y: number }, activeTool: AnnotationType | null = null) =>
    beginGesture({ at: p, chartArea: AREA, dimensions: DIMS, activeTool, stackBottom: STACK })

  it('pans, rather than belonging to nothing', () => {
    expect(inPanes(at(400, 800)).kind).toBe('pan')
  })

  it('pans time only, so it cannot move the price plot it is not touching', () => {
    expect(inPanes(at(400, 800))).toEqual({ kind: 'pan', axis: 'time' })
  })

  it('reaches the very bottom of the stack', () => {
    expect(inPanes(at(400, STACK))).toEqual({ kind: 'pan', axis: 'time' })
  })

  it('still belongs to nothing below the stack', () => {
    expect(inPanes(at(400, STACK + 1))).toEqual({ kind: 'none' })
  })

  it('pans instead of drawing, because a pane has no price scale to place a mark on', () => {
    expect(inPanes(at(400, 800), 'trend-line')).toEqual({ kind: 'pan', axis: 'time' })
  })

  it('leaves the price plot drawing, and panning both axes, exactly as it was', () => {
    expect(inPanes(at(400, 300), 'trend-line').kind).toBe('draw')
    expect(inPanes(at(400, 300))).toEqual({ kind: 'pan', axis: 'both' })
  })

  it('does not capture the gutters, which still zoom their own axis', () => {
    expect(inPanes(at(960, 300)).kind).toBe('zoom-price')
    expect(inPanes(at(400, 580)).kind).toBe('zoom-time')
  })

  it('ignores a press left or right of the plotted column', () => {
    expect(inPanes(at(AREA.x - 1, 800))).toEqual({ kind: 'none' })
  })

  /* Without `stackBottom` there are no panes: the no-plots chart, whose
     behaviour must not have changed at all. */
  it('is absent when the caller reports no panes', () => {
    expect(begin(at(400, 800))).toEqual({ kind: 'none' })
  })
})
