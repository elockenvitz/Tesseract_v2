/**
 * What a press on the chart canvas means.
 *
 * ── Why this is not inside ProChart ───────────────────────────────────────
 *
 * `ProChart.handleMouseDown` already decides between three things by pixel
 * position -- pan the chart, zoom the price axis, zoom the time axis -- and
 * adding "or begin drawing" to it would put the whole interaction model
 * inside a 1,400-line component whose canvas cannot be rendered in jsdom.
 * Logic in there is logic that cannot be tested without a browser.
 *
 * So the decisions live here, pure, and ProChart becomes a thin adapter that
 * reports pixels and applies the answer. Every rule below is asserted in
 * `__tests__/drawing-gesture.test.ts`.
 *
 * ── Pixels in, chart space out ───────────────────────────────────────────
 *
 * The caller passes a `Projector`, which is the two methods it already has
 * on `ChartTransform` (`xToTime`, `yToPrice`). This module therefore needs
 * no canvas, no transform instance and no view state, and a test can supply
 * a two-line linear projector whose arithmetic is obvious by inspection.
 */
import {
  annotationFromPoints,
  isDrag,
  isTwoPointTool,
  type ChartPoint,
} from './annotation-geometry'
import type {
  Annotation,
  AnnotationStyle,
  AnnotationType,
} from '../../components/charting/engine/annotations'

/** The part of `ChartTransform` this module uses. */
export interface Projector {
  xToTime(x: number): number
  yToPrice(y: number): number
}

/** Pixel coordinates relative to the canvas. */
export interface Pixel {
  x: number
  y: number
}

/** The plot rectangle, excluding the axis gutters. */
export interface ChartArea {
  x: number
  y: number
  width: number
  height: number
}

export interface Dimensions {
  width: number
  height: number
}

/**
 * What the press started.
 *
 * `pan`, `zoom-price` and `zoom-time` are the modes ProChart already had and
 * are named identically, so the adapter can pass the value straight through
 * rather than translating it -- a translation table is a place for the two
 * to disagree.
 */
export type Gesture =
  | { kind: 'pan' }
  | { kind: 'zoom-price' }
  | { kind: 'zoom-time' }
  | { kind: 'draw'; tool: AnnotationType; from: Pixel }
  /** Outside the canvas entirely: the press belongs to nothing. */
  | { kind: 'none' }

export interface BeginGestureInput {
  at: Pixel
  chartArea: ChartArea
  dimensions: Dimensions
  /** The selected drawing tool, or null when the pointer is a pointer. */
  activeTool: AnnotationType | null
}

/**
 * Decide what a press begins.
 *
 * Order matters. The axis gutters are checked FIRST, before the drawing
 * tool, because a press on the price axis with a tool selected should still
 * zoom the axis: the axes are the only way to change the view, and a tool
 * that captured them would strand a reader who had to zoom out before
 * drawing the next mark and had no way to.
 */
export function beginGesture(input: BeginGestureInput): Gesture {
  const { at, chartArea: area, dimensions: dims, activeTool } = input

  const onPriceAxis = at.x > area.x + area.width && at.x <= dims.width
  if (onPriceAxis) return { kind: 'zoom-price' }

  const onTimeAxis = at.y > area.y + area.height && at.y <= dims.height
  if (onTimeAxis) return { kind: 'zoom-time' }

  const insidePlot =
    at.x >= area.x &&
    at.x <= area.x + area.width &&
    at.y >= area.y &&
    at.y <= area.y + area.height

  if (!insidePlot) return { kind: 'none' }
  if (activeTool) return { kind: 'draw', tool: activeTool, from: at }
  return { kind: 'pan' }
}

export interface CompleteDrawInput {
  tool: AnnotationType
  from: Pixel
  to: Pixel
  project: Projector
  style: AnnotationStyle
  /** Supplied by the caller so nothing here depends on a clock or randomness. */
  id: string
}

/**
 * Turn a finished gesture into a mark, or into nothing.
 *
 * Returns null when the gesture does not describe a mark, which is a normal
 * outcome rather than a failure:
 *
 *   - a two-point tool that never moved. A trend line of no length is
 *     invisible, selectable only by accident, and would accumulate silently
 *     every time someone clicked the chart with a tool still selected. The
 *     floor is in pixels because that is where the tremor is: two pixels is
 *     a different number of seconds at every zoom level.
 *   - an unrecognised tool, rather than the old code's fallback, which
 *     turned anything it did not know into a horizontal price level.
 *
 * A ONE-point tool ignores the drag entirely and lands on `from`, so a
 * horizontal line goes exactly where it was clicked even if the hand moved
 * while releasing.
 */
export function completeDraw(input: CompleteDrawInput): Annotation | null {
  const { tool, from, to, project, style, id } = input

  if (isTwoPointTool(tool) && !isDrag(from, to)) return null

  const start: ChartPoint = { time: project.xToTime(from.x), price: project.yToPrice(from.y) }
  const end: ChartPoint = isTwoPointTool(tool)
    ? { time: project.xToTime(to.x), price: project.yToPrice(to.y) }
    : start

  return annotationFromPoints(tool, start, end, style, id)
}
