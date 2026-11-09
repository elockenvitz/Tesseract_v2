/**
 * The twelve-column span model.
 *
 * Every rule here is one that fails silently if broken: a layout that
 * quietly reverts to full width, a class Tailwind never emitted, a saved
 * arrangement that redraws itself the next time it loads. None of them
 * throw, and none are visible in a diff — so they are tested.
 */
import { describe, it, expect } from 'vitest'
import {
  SPAN_CLASS, SPAN_CLASS_FLAT, SNAP_SPANS, spanLabel, stepSpan, snapFraction,
} from '../field-span'
import { asSpan, spanFromWidth, FULL_SPAN, type FieldSpan } from '../layout-resolver'

describe('a span survives the trip from jsonb', () => {
  it('accepts the twelve the grid can draw', () => {
    for (let n = 1; n <= 12; n++) expect(asSpan(n)).toBe(n)
  })

  it('rejects what would produce a class that does not exist', () => {
    /* `field_config` is jsonb written by several versions of this app, so
       what arrives is whatever was stored. A span of 0, 13, -4 or 6.5
       builds `col-span-6.5`, which Tailwind never emitted, and the field
       silently collapses to one column. */
    for (const bad of [0, 13, -4, 6.5, NaN, Infinity]) {
      expect(asSpan(bad)).toBeNull()
    }
  })

  it('rejects a non-number rather than coercing it', () => {
    /* `asSpan('6')` returning 6 would be worse than rejecting: it would
       make a string span work in testing and fail the moment a different
       writer stored a different shape. */
    for (const bad of ['6', null, undefined, {}, [], true]) {
      expect(asSpan(bad)).toBeNull()
    }
  })
})

describe('layouts saved before spans draw exactly as they did', () => {
  it('maps half to six twelfths', () => {
    expect(spanFromWidth('half')).toBe(6)
  })

  it('maps full, and anything unrecognised, to the whole row', () => {
    expect(spanFromWidth('full')).toBe(FULL_SPAN)
    expect(spanFromWidth(null)).toBe(FULL_SPAN)
    expect(spanFromWidth(undefined)).toBe(FULL_SPAN)
  })
})

describe('the class is one Tailwind has emitted', () => {
  it('names every span statically', () => {
    /* A template string is never seen by Tailwind's scanner, so the rule
       is never generated. It fails only in a production build, because
       the dev server often has the class from elsewhere. */
    for (let n = 1 as FieldSpan; n <= 12; n++) {
      expect(SPAN_CLASS[n as FieldSpan]).toBe(`xl:col-span-${n}`)
      expect(SPAN_CLASS_FLAT[n as FieldSpan]).toBe(`col-span-${n}`)
    }
  })

  it('applies the page grid only from xl up', () => {
    /* A half-width thesis on a phone is a column four words across. */
    for (const cls of Object.values(SPAN_CLASS)) expect(cls.startsWith('xl:')).toBe(true)
  })
})

describe('the steps a drag snaps to all tile', () => {
  it('gives every step a complement that completes the row', () => {
    /*
     * ── The rule changed, and this records why ─────────────────────────
     *
     * It used to be COMPLEMENT: every step needed some other step that
     * filled the rest of the row (3+9, 4+8, 6+6, 12), and the note here
     * warned specifically against "divides twelve", because that rule
     * would drop two thirds and three quarters.
     *
     * Those were dropped anyway, deliberately, for a reason geometry
     * could not see: the content is prose, and narrowing prose makes the
     * page taller rather than denser. Investment Thesis measures 176px
     * at a half and 309px at a quarter, and the row beside a quarter is
     * usually empty because nothing else on a research page is that
     * shape. Full, half, third is now the whole vocabulary.
     *
     * So the property is TILING — a row closes with copies of one step,
     * 12 / 6+6 / 4+4+4 — which happens to be divisibility. Asserted with
     * the history attached, so the next person to widen this list knows
     * it was narrowed on measurement rather than on a tidy rule.
     */
    for (const s of SNAP_SPANS) {
      expect(12 % s, `a row must close with copies of ${s}`).toBe(0)
    }
  })

  it('leaves out the spans that strand the rest of a row', () => {
    expect(SNAP_SPANS).not.toContain(5)
    expect(SNAP_SPANS).not.toContain(7)
  })

  it('leaves out the widths that only make prose taller', () => {
    /* Divisibility is necessary, not sufficient: 3 divides twelve and is
       still gone, because a quarter-width thesis is a column four words
       across. 8 and 9 go with it — two thirds existed only to complete a
       third, and three thirds now do. */
    expect(SNAP_SPANS).not.toContain(3)
    expect(SNAP_SPANS).not.toContain(8)
    expect(SNAP_SPANS).not.toContain(9)
  })

  it('offers full, half and third — and nothing else', () => {
    expect([...SNAP_SPANS]).toEqual([4, 6, 12])
  })

  it('still NAMES the widths it no longer steps to', () => {
    /* A field saved at two thirds keeps that width until someone resizes
       it. Its readout has to say "Two thirds", not "8/12". */
    expect(spanLabel(8)).toBe('Two thirds')
    expect(spanLabel(3)).toBe('One quarter')
    expect(spanLabel(9)).toBe('Three quarters')
  })

  it('is ordered, because stepping walks it', () => {
    expect([...SNAP_SPANS]).toEqual([...SNAP_SPANS].sort((a, b) => a - b))
  })
})

describe('resizing without a mouse', () => {
  it('walks up and down the snap steps', () => {
    expect(stepSpan(6, 1)).toBe(12)
    expect(stepSpan(6, -1)).toBe(4)
    expect(stepSpan(4, 1)).toBe(6)
  })

  it('stops at the ends instead of wrapping', () => {
    /* Wrapping would turn one key press too many into a full-width field
       becoming a third — a change the reader did not ask for and may
       not notice. */
    expect(stepSpan(12, 1)).toBe(12)
    expect(stepSpan(4, -1)).toBe(4)
  })

  it('lifts a legacy width onto the nearest step rather than refusing it', () => {
    /* A field stored at a quarter, two thirds or three quarters is not a
       step any more, but it must still be resizable — `find(s => s > span)`
       walks to the next step in the direction asked, so the first key
       press lands it on one of the three and it behaves normally after. */
    expect(stepSpan(8, -1)).toBe(6)
    expect(stepSpan(8, 1)).toBe(12)
    expect(stepSpan(9, -1)).toBe(6)
    expect(stepSpan(3, 1)).toBe(4)
    /* Already narrower than the narrowest step, so there is nowhere down
       to go — it holds rather than silently widening. */
    expect(stepSpan(3, -1)).toBe(3)
  })
})

describe('a drag lands on the nearest step', () => {
  it('snaps to the closest, not the one it passed', () => {
    expect(snapFraction(0.5)).toBe(6)
    expect(snapFraction(0.34)).toBe(4)
    expect(snapFraction(0.99)).toBe(12)
    /* A quarter is no longer a step, so a drag that lands there takes
       the nearest one that is — a third, not nothing. */
    expect(snapFraction(0.26)).toBe(4)
  })

  it('sends an exact midpoint to the wider step', () => {
    /* The steps are far apart now, which puts the half/full midpoint at
       nine twelfths. Dragging three quarters of the way across a row
       plainly means "fill it"; rounding down would answer "half" and
       undo most of the gesture. */
    expect(snapFraction(0.75)).toBe(12)
    expect(snapFraction(0.74)).toBe(6)
  })

  it('clamps past either edge rather than wrapping', () => {
    /* Dragging past the right edge means "as wide as possible". If it
       wrapped, overshooting would snap the field to its narrowest. */
    expect(snapFraction(5)).toBe(12)
    expect(snapFraction(-3)).toBe(SNAP_SPANS[0])
    expect(snapFraction(0)).toBe(SNAP_SPANS[0])
  })
})

describe('the readout says a width in words', () => {
  it('names the common fractions', () => {
    expect(spanLabel(12)).toBe('Full width')
    expect(spanLabel(6)).toBe('Half')
    expect(spanLabel(4)).toBe('One third')
    expect(spanLabel(8)).toBe('Two thirds')
    expect(spanLabel(3)).toBe('One quarter')
    expect(spanLabel(9)).toBe('Three quarters')
  })

  it('falls back to twelfths for a span with no name', () => {
    /* Reachable from a layout saved by a future version, or by keyboard
       on a span that is not a snap step. "5/12" beats blank. */
    expect(spanLabel(5)).toBe('5/12')
    expect(spanLabel(7)).toBe('7/12')
  })
})
