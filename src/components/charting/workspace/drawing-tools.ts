/**
 * The drawing tools, as data.
 *
 * ── Why this table exists at all ──────────────────────────────────────────
 *
 * Every one of these tools already worked. The geometry is anchored in price
 * and time, `completeDraw` already builds a one-point mark from a click and a
 * two-point mark from a drag, marks can be picked up, moved, reshaped and
 * deleted, and there is undo. None of it was reachable: the only door was a
 * RIGHT-CLICK on empty canvas, with nothing anywhere on the page saying so.
 * Opening Charting showed a line on a white field and no indication that it
 * could be drawn on at all.
 *
 * So this is not a new capability. It is the capability being admitted to.
 *
 * ── Why a table rather than JSX ───────────────────────────────────────────
 *
 * The palette, the keyboard shortcuts, the armed-tool caption and the
 * inspector's title for a selected mark all need the same four facts about a
 * tool. Spelled separately they drift: a shortcut that moves, a label that
 * says "Trend Line" in one place and "Trendline" in another. They read this.
 *
 * It is also the only form in which the set can be ASSERTED -- that every
 * annotation type the engine can build is offered, that no two tools claim
 * the same key, that a one-point tool's hint does not tell the reader to
 * drag. Those tests cannot be written against a wall of markup.
 */
import type { AnnotationType } from '../engine/annotations'
import { isTwoPointTool } from '../../../lib/charting/annotation-geometry'

/** Which band of the rail a tool sits in. */
export type ToolGroup = 'select' | 'lines' | 'shapes' | 'measure' | 'markup'

export interface DrawingTool {
  /** `null` is the pointer: no tool in hand. */
  type: AnnotationType | null
  label: string
  /** The single key that arms it. Compared case-insensitively. */
  shortcut: string
  group: ToolGroup
  /** What the reader has to do once it is armed. */
  hint: string
}

/**
 * ── On the shortcut letters ───────────────────────────────────────────────
 *
 * First letter wherever it is free: Trend, Ray, Horizontal, Vertical,
 * Ellipse, Fibonacci, Arrow. `S` selects, because `P` for pointer collides
 * with nothing useful but reads as "price". `B` is the rectangle, from box,
 * since `R` is the ray. `X` is text, since `T` is the trend line -- the one
 * genuinely arbitrary key, and the reason every button shows its own key
 * rather than expecting them to be learned.
 *
 * Bare letters, not `Alt+`. The chart canvas is not a text field, and the
 * handler that reads these refuses to act while an input, a textarea or a
 * contenteditable has focus -- the same guard the undo shortcut already uses,
 * for the same reason: the page carries a symbol search.
 */
export const DRAWING_TOOLS: readonly DrawingTool[] = [
  { type: null, label: 'Select', shortcut: 'S', group: 'select', hint: 'Click a mark to pick it up' },

  { type: 'trend-line', label: 'Trend line', shortcut: 'T', group: 'lines', hint: 'Drag from one point to another' },
  { type: 'ray', label: 'Ray', shortcut: 'R', group: 'lines', hint: 'Drag to set the origin and direction' },
  { type: 'horizontal-line', label: 'Horizontal line', shortcut: 'H', group: 'lines', hint: 'Click at the price level' },
  { type: 'vertical-line', label: 'Vertical line', shortcut: 'V', group: 'lines', hint: 'Click at the date' },

  { type: 'rectangle', label: 'Rectangle', shortcut: 'B', group: 'shapes', hint: 'Drag to set the price and date range' },
  { type: 'ellipse', label: 'Ellipse', shortcut: 'E', group: 'shapes', hint: 'Drag to set the price and date range' },

  { type: 'fibonacci', label: 'Fibonacci retracement', shortcut: 'F', group: 'measure', hint: 'Drag from the low to the high' },

  { type: 'text', label: 'Text note', shortcut: 'X', group: 'markup', hint: 'Click where the note belongs' },
  { type: 'arrow', label: 'Arrow', shortcut: 'A', group: 'markup', hint: 'Drag from the tail to the head' },
]

/** The groups in rail order, so the renderer does not re-state it. */
export const TOOL_GROUPS: readonly ToolGroup[] = ['select', 'lines', 'shapes', 'measure', 'markup']

/** The tool a key arms, or undefined. Case-insensitive, as typing is. */
export function toolForKey(key: string): DrawingTool | undefined {
  const k = key.toUpperCase()
  return DRAWING_TOOLS.find(t => t.shortcut === k)
}

/** The table entry for an armed type, or the pointer when nothing is armed. */
export function toolFor(type: AnnotationType | null): DrawingTool | undefined {
  return DRAWING_TOOLS.find(t => t.type === type)
}

/**
 * The caption the chart shows while a tool is in hand.
 *
 * Says what to DO, and the two kinds of tool need different sentences: a
 * horizontal line is placed by a click and telling its reader to drag is
 * telling them to do something that will not work.
 */
export function armedCaption(type: AnnotationType): string {
  const tool = toolFor(type)
  if (!tool) return 'Drawing'
  return `${tool.label}: ${tool.hint.charAt(0).toLowerCase()}${tool.hint.slice(1)}`
}

/** Whether a tool needs a drag rather than a click. Re-exported so the
    palette and its tests do not reach past this module into geometry. */
export function needsDrag(type: AnnotationType): boolean {
  return isTwoPointTool(type)
}
