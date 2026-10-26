/**
 * Turning a span into a class Tailwind has actually emitted.
 *
 * ── Why a lookup and not a template string ──────────────────────────────
 *
 * `` `xl:col-span-${span}` `` is the obvious way to write this and it does
 * not work. Tailwind generates CSS by scanning source files for complete
 * class names; a name assembled at runtime is never seen, so the rule is
 * never emitted and the element falls back to one column. It fails
 * silently and only in a production build, because the dev server's JIT
 * often has the class from somewhere else in the codebase.
 *
 * Writing all twelve out is what makes them real. The same reason the
 * config carries a `safelist` — this is that mechanism, kept next to the
 * thing it serves instead of in a file nobody reads when adding a width.
 */
import type { FieldSpan } from './layout-resolver'

/**
 * Below `xl` every field is full width.
 *
 * A research field holds prose. Three columns of it on a laptop is a
 * newspaper, not a document, and on a phone a half-width thesis is a
 * column four words across. So the grid only takes effect at the width
 * where it reads — which is also why the editor says so rather than
 * letting someone arrange a layout they will never see.
 */
export const SPAN_CLASS: Record<FieldSpan, string> = {
  1: 'xl:col-span-1',
  2: 'xl:col-span-2',
  3: 'xl:col-span-3',
  4: 'xl:col-span-4',
  5: 'xl:col-span-5',
  6: 'xl:col-span-6',
  7: 'xl:col-span-7',
  8: 'xl:col-span-8',
  9: 'xl:col-span-9',
  10: 'xl:col-span-10',
  11: 'xl:col-span-11',
  12: 'xl:col-span-12',
}

/** The same spans inside the arrange overlay, which is always gridded. */
export const SPAN_CLASS_FLAT: Record<FieldSpan, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
  5: 'col-span-5',
  6: 'col-span-6',
  7: 'col-span-7',
  8: 'col-span-8',
  9: 'col-span-9',
  10: 'col-span-10',
  11: 'col-span-11',
  12: 'col-span-12',
}

/**
 * The spans a resize handle steps through.
 *
 * Not all twelve. The test is not that a span divides twelve — 8 and 9 do
 * not, and both are wanted — but that every span has a COMPLEMENT in this
 * set, so whatever you pick, some other choice completes the row: 3+9,
 * 4+8, 6+6, and 12 alone. 5 and 7 have none, so a row containing one
 * always ends ragged, and they also make finding the half you wanted a
 * game of pointer precision. A span outside this set is still valid and
 * still drawn — it just is not somewhere a drag will stop.
 */
export const SNAP_SPANS: readonly FieldSpan[] = [3, 4, 6, 8, 9, 12]

/** Human wording for a span, for titles and the live readout. */
export function spanLabel(span: FieldSpan): string {
  switch (span) {
    case 12: return 'Full width'
    case 6: return 'Half'
    case 4: return 'One third'
    case 8: return 'Two thirds'
    case 3: return 'One quarter'
    case 9: return 'Three quarters'
    default: return `${span}/12`
  }
}

/**
 * The nearest snap step in a direction, or the span itself at the end.
 *
 * Used by the keyboard path, so a field can be resized without a mouse —
 * a drag handle alone would put the whole feature out of reach of anyone
 * using the keyboard.
 */
export function stepSpan(span: FieldSpan, direction: 1 | -1): FieldSpan {
  const steps = SNAP_SPANS
  if (direction === 1) return steps.find(s => s > span) ?? span
  return [...steps].reverse().find(s => s < span) ?? span
}

/**
 * The snap step closest to a width the pointer is at, as a fraction of the
 * row. Fractions outside the row are clamped rather than wrapped: dragging
 * past the right edge means "as wide as possible", not "back to narrow".
 */
export function snapFraction(fraction: number): FieldSpan {
  const raw = Math.min(12, Math.max(1, fraction * 12))
  let best: FieldSpan = SNAP_SPANS[0]
  let bestDistance = Infinity
  for (const s of SNAP_SPANS) {
    const d = Math.abs(s - raw)
    if (d < bestDistance) { bestDistance = d; best = s }
  }
  return best
}
