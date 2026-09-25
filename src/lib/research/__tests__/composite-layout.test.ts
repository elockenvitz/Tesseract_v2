/**
 * The shared composite-layout generators.
 *
 * These moved out of a 6,300-line desktop component so a phone could use the
 * SAME functions rather than a copy. That is the whole point, so what is
 * pinned here is the output contract: every layout these produce must
 * satisfy `compositeConfigSchema`, because that schema is what the desktop
 * editor validates against before writing `research_fields.config`.
 *
 * If a phone ever emits a layout that fails this schema, a mobile save either
 * errors or — worse — writes a shape the desktop cannot reopen.
 */
import { describe, it, expect } from 'vitest'
import { getDefaultWidgetSize, recomputeAutoLayout, moveWidget } from '../composite-layout'
import { compositeConfigSchema, type CompositeWidget } from '../field-types'

const widget = (id: string, type: string): CompositeWidget => ({
  id, type, label: id, config: {},
})

const WIDGETS = [
  widget('a', 'rich_text'),   // 6x3
  widget('b', 'numeric'),     // 3x2
  widget('c', 'table'),       // 12x4
  widget('d', 'chart'),       // 6x3
]

/** The config a save would actually write. */
const asConfig = (widgets: CompositeWidget[], cols: 1 | 2) => ({
  widgets,
  layout: recomputeAutoLayout(widgets, cols),
  cols: 12,
})

describe('getDefaultWidgetSize', () => {
  it('keeps the desktop footprints exactly', () => {
    // Lifted verbatim; a change here silently resizes every existing widget
    // the next time a layout is regenerated.
    expect(getDefaultWidgetSize('rich_text')).toEqual({ w: 6, h: 3 })
    expect(getDefaultWidgetSize('checklist')).toEqual({ w: 6, h: 3 })
    expect(getDefaultWidgetSize('chart')).toEqual({ w: 6, h: 3 })
    expect(getDefaultWidgetSize('table')).toEqual({ w: 12, h: 4 })
    expect(getDefaultWidgetSize('scenario')).toEqual({ w: 12, h: 4 })
    for (const t of ['numeric', 'percentage', 'currency', 'boolean', 'rating']) {
      expect(getDefaultWidgetSize(t)).toEqual({ w: 3, h: 2 })
    }
    expect(getDefaultWidgetSize('anything-else')).toEqual({ w: 6, h: 2 })
  })
})

describe('recomputeAutoLayout', () => {
  it('stacks one per row at full width in single-column mode', () => {
    // This is what makes a phone editor possible: x is always 0 and w is
    // always 12, so ORDER is the only thing the user chooses.
    const layout = recomputeAutoLayout(WIDGETS, 1)
    expect(layout.map(l => l.i)).toEqual(['a', 'b', 'c', 'd'])
    expect(layout.every(l => l.x === 0 && l.w === 12)).toBe(true)
    expect(layout.map(l => l.y)).toEqual([0, 3, 5, 9])
  })

  it('pairs widgets and advances by the taller of each pair in two-column mode', () => {
    const layout = recomputeAutoLayout(WIDGETS, 2)
    expect(layout.map(l => l.x)).toEqual([0, 6, 0, 6])
    expect(layout.every(l => l.w === 6)).toBe(true)
    // a(h3) beside b(h2) -> row advances 3, not 2, so c does not overlap a.
    expect(layout.map(l => l.y)).toEqual([0, 0, 3, 3])
  })

  it('produces a schema-valid config in both modes', () => {
    for (const cols of [1, 2] as const) {
      const parsed = compositeConfigSchema.safeParse(asConfig(WIDGETS, cols))
      expect(parsed.success).toBe(true)
    }
  })

  it('converts between 1 and 2 columns without breaking the schema', () => {
    // The mobile editor's only sizing control. Round-tripping it must stay
    // valid, and must keep every widget referenced.
    const one = asConfig(WIDGETS, 1)
    const two = { ...one, layout: recomputeAutoLayout(one.widgets, 2) }
    const backToOne = { ...two, layout: recomputeAutoLayout(two.widgets, 1) }

    expect(compositeConfigSchema.safeParse(two).success).toBe(true)
    expect(compositeConfigSchema.safeParse(backToOne).success).toBe(true)
    expect(backToOne.layout).toEqual(one.layout)
  })

  it('never emits a layout item for a widget that is not present', () => {
    // compositeConfigSchema refuses a dangling `i`; this is the generator
    // side of that guarantee.
    const layout = recomputeAutoLayout(WIDGETS, 1)
    const ids = new Set(WIDGETS.map(w => w.id))
    expect(layout.every(l => ids.has(l.i))).toBe(true)
    expect(layout).toHaveLength(WIDGETS.length)
  })

  it('returns an empty layout for no widgets', () => {
    expect(recomputeAutoLayout([], 1)).toEqual([])
  })
})

describe('moveWidget', () => {
  it('moves a widget and leaves the rest in order', () => {
    const moved = moveWidget(WIDGETS, 2, 0)
    expect(moved.map(w => w.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves down as well as up', () => {
    expect(moveWidget(WIDGETS, 0, 3).map(w => w.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('is a no-op at the ends rather than an error', () => {
    // Move Up on the first row must do nothing, not throw.
    expect(moveWidget(WIDGETS, 0, -1)).toBe(WIDGETS)
    expect(moveWidget(WIDGETS, 3, 4)).toBe(WIDGETS)
    expect(moveWidget(WIDGETS, 1, 1)).toBe(WIDGETS)
  })

  it('does not mutate the array it was given', () => {
    const before = WIDGETS.map(w => w.id)
    moveWidget(WIDGETS, 0, 2)
    expect(WIDGETS.map(w => w.id)).toEqual(before)
  })

  it('still yields a schema-valid layout after reordering', () => {
    // The mobile save path in one line: reorder, regenerate, validate.
    const reordered = moveWidget(WIDGETS, 3, 0)
    const parsed = compositeConfigSchema.safeParse(asConfig(reordered, 1))
    expect(parsed.success).toBe(true)
    expect(recomputeAutoLayout(reordered, 1).map(l => l.i)).toEqual(['d', 'a', 'b', 'c'])
  })
})
