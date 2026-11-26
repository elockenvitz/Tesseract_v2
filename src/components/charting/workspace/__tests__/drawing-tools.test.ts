/**
 * The palette must offer every tool the engine can build, and say the truth
 * about how to use each one.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * Nothing in the engine. Every tool asserted here already worked: the
 * geometry is anchored in price and time, `completeDraw` builds a one-point
 * mark from a click and a two-point mark from a drag, marks can be picked up
 * and reshaped, and there is undo. The only way to reach any of it was a
 * RIGHT-CLICK on empty canvas, which no part of the interface mentioned.
 *
 * So these cases guard the two ways a palette stops matching the engine
 * behind it:
 *
 *  1. A tool quietly goes missing. The old context menu listed nine types; a
 *     tenth added to `AnnotationType` would simply not appear, and nobody
 *     would notice because there is no place the two lists are compared.
 *     Here they are compared.
 *
 *  2. A hint tells the reader to do the wrong thing. The strip over the
 *     canvas used to read "Drag to draw horizontal line" for EVERY armed
 *     tool. A horizontal line is placed by a click, and dragging to make one
 *     produces nothing: `completeDraw` discards a two-point gesture shorter
 *     than the drag floor, and a one-point tool ignores the drag entirely.
 *     The instruction has to differ by tool, so it is asserted by tool.
 */
import { describe, it, expect } from 'vitest'
import {
  DRAWING_TOOLS, TOOL_GROUPS, toolForKey, toolFor, armedCaption, needsDrag,
} from '../drawing-tools'
import { isTwoPointTool } from '../../../../lib/charting/annotation-geometry'
import type { AnnotationType } from '../../engine/annotations'

/**
 * Every type the engine can actually build a mark for.
 *
 * Taken from `annotationFromPoints`' own behaviour rather than copied from a
 * list, so a type that stops being buildable, or starts being buildable, is
 * caught here instead of agreeing with a stale constant.
 */
const ENGINE_TYPES: AnnotationType[] = [
  'horizontal-line', 'vertical-line', 'trend-line', 'ray',
  'rectangle', 'ellipse', 'fibonacci', 'text', 'arrow',
]

describe('the palette offers what the engine can draw', () => {
  it('has a tool for every annotation type', () => {
    const offered = DRAWING_TOOLS.map(t => t.type).filter(Boolean)
    const missing = ENGINE_TYPES.filter(t => !offered.includes(t))
    expect(missing, `these tools exist in the engine and are unreachable: ${missing.join(', ')}`).toEqual([])
  })

  it('offers nothing the engine cannot build', () => {
    const extra = DRAWING_TOOLS.map(t => t.type).filter(t => t !== null && !ENGINE_TYPES.includes(t))
    expect(extra, `these buttons would draw nothing: ${extra.join(', ')}`).toEqual([])
  })

  it('includes the pointer, so putting a tool down is a button and not only a key', () => {
    expect(DRAWING_TOOLS.some(t => t.type === null)).toBe(true)
  })

  it('puts every tool in a group the rail renders', () => {
    for (const tool of DRAWING_TOOLS) {
      expect(TOOL_GROUPS, `${tool.label} is in group "${tool.group}", which the rail does not draw`)
        .toContain(tool.group)
    }
  })
})

describe('the shortcuts are unambiguous', () => {
  it('no two tools claim the same key', () => {
    const keys = DRAWING_TOOLS.map(t => t.shortcut)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes, `these keys are claimed twice: ${dupes.join(', ')}`).toEqual([])
  })

  it('every key is a single letter, because the handler only reads single keys', () => {
    for (const tool of DRAWING_TOOLS) {
      expect(tool.shortcut, `${tool.label}`).toMatch(/^[A-Z]$/)
    }
  })

  it('resolves a key whichever case it was typed in', () => {
    expect(toolForKey('t')?.type).toBe('trend-line')
    expect(toolForKey('T')?.type).toBe('trend-line')
  })

  it('claims no key it has no tool for', () => {
    expect(toolForKey('Q')).toBeUndefined()
    expect(toolForKey('z')).toBeUndefined()
  })
})

describe('the hint tells the reader the right gesture', () => {
  it('tells a one-point tool to click, never to drag', () => {
    for (const tool of DRAWING_TOOLS) {
      if (!tool.type || isTwoPointTool(tool.type)) continue
      expect(tool.hint.toLowerCase(), `${tool.label} is placed by a click`).toContain('click')
      expect(tool.hint.toLowerCase(), `${tool.label} cannot be dragged into existence`).not.toContain('drag')
    }
  })

  it('tells a two-point tool to drag', () => {
    for (const tool of DRAWING_TOOLS) {
      if (!tool.type || !isTwoPointTool(tool.type)) continue
      expect(tool.hint.toLowerCase(), `${tool.label} needs two points`).toContain('drag')
    }
  })

  it('agrees with the geometry module about which tools need a drag', () => {
    for (const type of ENGINE_TYPES) {
      expect(needsDrag(type), type).toBe(isTwoPointTool(type))
    }
  })

  it('names the tool in the armed caption', () => {
    expect(armedCaption('horizontal-line')).toContain('Horizontal line')
    expect(armedCaption('horizontal-line').toLowerCase()).toContain('click')
    expect(armedCaption('trend-line').toLowerCase()).toContain('drag')
  })
})

describe('tool lookup', () => {
  it('finds the pointer for a null tool, so the rail can light it', () => {
    expect(toolFor(null)?.label).toBe('Select')
  })

  it('finds a tool by its type', () => {
    expect(toolFor('fibonacci')?.label).toBe('Fibonacci retracement')
  })
})
