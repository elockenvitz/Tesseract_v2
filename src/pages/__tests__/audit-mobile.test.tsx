/**
 * Audit on a phone.
 *
 * Audit is not Activity. Activity explains what happened; Audit preserves the
 * record, so the thing to protect here is evidence, not brevity. Two of these
 * findings were evidentiary rather than cosmetic: a before/after value was cut
 * at 120 characters with an ellipsis, and an identifier was `truncate`d with
 * no tooltip and no copy control — a partial UUID identifies nothing.
 *
 * The rest is overflow. The surface has no mobile branch at all, so a 390px
 * reader met a seven-pill filter row with no wrap, a 400px drawer on a 390px
 * screen, and JSON behind a horizontal scrollbar phones do not draw.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const raw = readFileSync(resolve(process.cwd(), 'src/pages/AuditExplorerPage.tsx'), 'utf8')

/**
 * The file with its comments removed.
 *
 * Assertions run against this, not the raw text. A comment explaining a fix
 * names the very classes the fix adds, so matching the raw file lets the
 * prose satisfy the test — which makes it no test at all. This lane has been
 * caught by that once already.
 */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * Every fragment present inside one class string.
 *
 * Classes here are written both as `className="…"` and inside `clsx('…')`,
 * so this matches a quoted string rather than the attribute.
 */
const classesWith = (...fragments: string[]) =>
  new RegExp(`'[^']*${fragments.join("[^']*")}[^']*'|"[^"]*${fragments.join('[^"]*')}[^"]*"`)

describe('evidence is not truncated away', () => {
  it('reports a before/after value in full', () => {
    // It used to `.slice(0, 120)` and append an ellipsis, reporting the value
    // as something it was not.
    expect(src).not.toMatch(/val\.length > 120 \? val\.slice\(0, 120\)/)
    expect(src).not.toMatch(/JSON\.stringify\(val\)\.slice\(0, 120\)/)
  })

  it('keeps the short form for the list summary, which is a preview', () => {
    // `fmtVal` composes a one-line sentence on a row; the drawer beside it
    // holds the record. Shortening there is correct, so it must survive.
    expect(src).toMatch(/val\.length > 28 \? val\.slice\(0, 28\)/)
  })

  it('does not clip an identifier', () => {
    // A 36-character UUID cut to whatever fitted, with no tooltip and no copy
    // affordance, is unrecoverable.
    expect(src).toMatch(/function IdRow[\s\S]{0,600}overflow-wrap:anywhere/)
    expect(src).not.toMatch(/function IdRow[\s\S]{0,600}truncate/)
  })

  it('lets a long action name wrap rather than widen the row', () => {
    // `actionVerb` only replaces underscores, so a dotted action name stays
    // one token no browser will break.
    expect(src).toMatch(classesWith('text-\\[13px\\] leading-5', 'overflow-wrap:anywhere'))
  })
})

describe('the record fits the viewport', () => {
  it('gives the drawer the screen on a phone and 400px on desktop', () => {
    expect(src).toMatch(classesWith('inset-y-0 right-0 left-0', 'sm:w-\\[400px\\]'))
    // The unconditional fixed width is what overflowed a 390px screen.
    expect(src).not.toMatch(/className="absolute inset-y-0 right-0 w-\[400px\] z-20"/)
  })

  it('wraps the raw payload instead of scrolling it sideways', () => {
    // `overflow-x-auto` alone hid long lines behind a scrollbar phones do not
    // draw. The indentation still survives.
    expect(src).toMatch(classesWith('whitespace-pre-wrap', 'overflow-wrap:anywhere'))
  })

  it('makes the segment filters an intentional rail, not an overflowing row', () => {
    // Seven pills ≈ 470px in ≈ 358px, previously with no wrap and no scroller.
    expect(src).toMatch(classesWith('mobile-scroll-x', 'scroll-px-4'))
    expect(src).toMatch(classesWith('shrink-0 whitespace-nowrap', 'rounded-full'))
  })

  it('wraps the secondary filter row', () => {
    expect(src).toMatch(classesWith('flex flex-wrap items-center gap-2', 'border-t'))
  })

  it('stops the fixed meta column starving the event text', () => {
    // 36px + 120px + gutters left the event itself ~190px of a 390px screen.
    expect(src).toMatch(classesWith('grid-cols-\\[28px_1fr_62px\\]', 'sm:grid-cols-\\[36px_1fr_120px\\]'))
  })

  it('wraps the row badges rather than clipping the third one', () => {
    expect(src).not.toMatch(/className="flex items-center gap-1 mt-0\.5 overflow-hidden"/)
    expect(src).toMatch(classesWith('flex flex-wrap items-center gap-1', 'mt-0.5'))
  })
})

describe('desktop is left alone', () => {
  it('keeps every mobile change behind an sm: escape or a phone-only class', () => {
    // The drawer, the meta column and the search all restore their desktop
    // geometry from `sm` up; the rail and the wraps are no-ops at width.
    expect(src).toMatch(/sm:w-\[400px\]/)
    expect(src).toMatch(/sm:grid-cols-\[36px_1fr_120px\]/)
    expect(src).toMatch(/sm:max-w-\[200px\]/)
    expect(src).toMatch(/sm:overflow-visible/)
  })

  it('leaves the deliberately-scrolled diff table as it was', () => {
    // Its 420px floor is a considered trade-off with its own rationale: three
    // equal thirds would break a monospace value every few characters.
    expect(src).toMatch(/min-w-\[420px\] sm:min-w-0/)
    expect(src).toMatch(/mobile-scroll-x show-scrollbar/)
  })
})
