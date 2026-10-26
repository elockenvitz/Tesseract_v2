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
 * The spans a resize handle steps through: full, half, third.
 *
 * ── Why three ──────────────────────────────────────────────────────────
 *
 * This was six — 3, 4, 6, 8, 9, 12 — chosen so that every span had a
 * COMPLEMENT: 3+9, 4+8, 6+6, 12 alone. The reasoning was sound and the
 * result was still wrong, because it answered a geometry question and
 * the content is prose.
 *
 * Narrowing a research field does not make the page denser, it makes it
 * TALLER. Measured on the running page: Investment Thesis is 176px at a
 * half and 309px at a quarter — three quarters taller for half the
 * width, and the row it leaves beside itself is usually empty because
 * nothing else on a research page is quarter-width-shaped. A quarter and
 * three quarters are the two steps that buy the least and cost the most,
 * and two-thirds goes with them because its only use was completing a
 * third, which three thirds now do.
 *
 * What is left reads as a sentence rather than a ratio: a field takes
 * the whole row, half of it, or a third. Rows still close exactly —
 * 6+6, 4+4+4, 12 — so nothing ends ragged.
 *
 * ── Layouts already saved are untouched ────────────────────────────────
 *
 * A span outside this set is still valid, still stored and still drawn:
 * the resolver reads all twelve and `spanLabel` still names 3, 8 and 9.
 * This governs only where a drag STOPS and what the arrow keys reach, so
 * a field sitting at two-thirds keeps its width until someone resizes
 * it, and then lands on one of the three.
 */
export const SNAP_SPANS: readonly FieldSpan[] = [4, 6, 12]

/**
 * Sections the Research page lays out itself, ignoring per-field span.
 *
 * `forecasts` draws its fields as fixed tiles and `supporting_docs` is
 * lifted out to the Key References tab, so neither reads a span. Fields in
 * them are left alone rather than hidden: a reader looking for Price
 * Targets should find it where it lives and see that it does not move,
 * instead of concluding arrange mode lost it.
 *
 * It lives here, beside the spans it governs, rather than in the component
 * that reads it — a second surface that needs to know which sections
 * ignore a span should not have to import a React module to find out.
 */
export const SELF_ARRANGED_SECTIONS = new Set(['forecasts', 'supporting_docs'])

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
    /* `<=`, so an exact midpoint goes to the WIDER step. The steps are
       far apart now (4 → 6 → 12), which puts the 6/12 midpoint at nine
       twelfths: dragging three quarters of the way across clearly means
       "fill the row", and `<` would have answered "half". */
    if (d <= bestDistance) { bestDistance = d; best = s }
  }
  return best
}
