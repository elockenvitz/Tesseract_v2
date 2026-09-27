import type { CompositeFieldConfig, CompositeWidget } from './field-types'

/**
 * The composite-container layout generator, extracted.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 *
 * `recomputeAutoLayout` and `getDefaultWidgetSize` were closures inside
 * `ResearchFieldsManager` — 6,300 lines of desktop editor that a phone never
 * mounts. The mobile editor needs the SAME generator, and the only two ways
 * to get it are to export it or to copy it. A copy is how two devices start
 * writing subtly different `layout` arrays for the same widgets, which is the
 * one failure this whole lane exists to avoid.
 *
 * So the functions move here unchanged and both editors import them. Desktop
 * behaviour is identical by construction, not by inspection.
 *
 * ── What the output has to satisfy ─────────────────────────────────────────
 *
 * `compositeConfigSchema` in ./field-types: every layout item is
 * `{i, x, y, w, h}` with integer x/y ≥ 0 and w/h ≥ 1, every `i` references a
 * real widget id, ids are unique, and `cols` is 12. The single-column output
 * below is always `x: 0, w: 12`, which satisfies that trivially — and is
 * exactly why a phone can author a twelve-column layout without ever
 * expressing a twelve-column grid.
 */

/**
 * The default footprint for a widget type.
 *
 * Verbatim from ResearchFieldsManager. The widths are twelfths, so a
 * `numeric` at `w: 3` is a quarter-row on a desktop — and is widened to a
 * full row by the single-column generator, which is the correct reading of
 * "one column" rather than a phone-specific size.
 */
export function getDefaultWidgetSize(widgetType: string): { w: number; h: number } {
  switch (widgetType) {
    case 'rich_text': case 'checklist': case 'chart':
      return { w: 6, h: 3 }
    case 'table': case 'scenario':
      return { w: 12, h: 4 }
    case 'numeric': case 'percentage': case 'currency': case 'boolean': case 'rating':
      return { w: 3, h: 2 }
    default:
      return { w: 6, h: 2 }
  }
}

/**
 * Lay widgets out in one or two columns, in their current order.
 *
 * Verbatim from ResearchFieldsManager, including the two-column carry of
 * `prevH` — the row advances by the taller of the pair, so a short widget
 * beside a tall one does not overlap the row beneath.
 *
 * This is what makes a phone editor possible: ORDER is the only thing the
 * user chooses, and position is derived. Reordering a list is a touch
 * interaction; dragging on a twelve-column grid is not.
 */
export function recomputeAutoLayout(
  widgets: CompositeWidget[],
  cols: 1 | 2,
): CompositeFieldConfig['layout'] {
  const newLayout: CompositeFieldConfig['layout'] = []
  let y = 0
  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i]
    const defaultH = getDefaultWidgetSize(w.type).h
    if (cols === 1) {
      newLayout.push({ i: w.id, x: 0, y, w: 12, h: defaultH })
      y += defaultH
    } else {
      const col = i % 2
      if (col === 0) {
        newLayout.push({ i: w.id, x: 0, y, w: 6, h: defaultH })
      } else {
        const prevH = newLayout[newLayout.length - 1]?.h ?? defaultH
        newLayout.push({ i: w.id, x: 6, y, w: 6, h: defaultH })
        y += Math.max(prevH, defaultH)
      }
    }
  }
  return newLayout
}

/**
 * Move one widget within the ordered list.
 *
 * The mobile reorder primitive. It returns a NEW array rather than mutating,
 * and an out-of-range move is a no-op rather than an error — a Move Up on the
 * first row should do nothing, not throw.
 *
 * Callers pair this with `recomputeAutoLayout` to regenerate positions: the
 * order is the edit, the layout is derived from it.
 */
export function moveWidget(
  widgets: CompositeWidget[],
  fromIndex: number,
  toIndex: number,
): CompositeWidget[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 || fromIndex >= widgets.length ||
    toIndex < 0 || toIndex >= widgets.length
  ) {
    return widgets
  }
  const next = [...widgets]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}
