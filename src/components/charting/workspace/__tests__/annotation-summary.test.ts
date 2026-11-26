/**
 * What the inspector may say about a mark, and what it may never say.
 *
 * ── The rule these exist to hold ─────────────────────────────────────────
 *
 * The chart surface does not carry the instrument's quoting currency. So
 * every price the inspector prints is a BARE NUMBER, and the one thing it
 * must never do is attach a currency nobody supplied.
 *
 * That mistake has already been made on this surface once: every horizontal
 * line used to be labelled with `$${price}`, which put a dollar sign on a
 * pence-quoted London holding -- wrong about the country and wrong by a
 * factor of a hundred at the same time. The fix was to stop asserting a
 * currency, and these cases are what stops it coming back.
 *
 * The second rule is about manufactured figures. A mark anchored off the
 * series can have a zero or non-finite price, and dividing by it yields
 * `Infinity%` or `NaN%`. A percentage on a chart gets copied into a note, so
 * an uncomputable one is omitted rather than printed.
 */
import { describe, it, expect } from 'vitest'
import { describeAnnotation, priceMove, spanInDays } from '../annotation-summary'
import { DEFAULT_ANNOTATION_STYLE, type Annotation } from '../../engine/annotations'

const STYLE = DEFAULT_ANNOTATION_STYLE
/** 2026-10-21T00:00:00Z and 22 days later, in the seconds the engine uses. */
const T0 = Math.floor(Date.UTC(2026, 9, 21) / 1000)
const T1 = T0 + 22 * 86_400

function trend(startPrice: number, endPrice: number): Annotation {
  return {
    id: 'a1', type: 'trend-line', style: STYLE,
    startTime: T0, startPrice, endTime: T1, endPrice,
  } as Annotation
}

const value = (rows: { label: string; value: string }[], label: string) =>
  rows.find(r => r.label === label)?.value ?? ''

describe('a price is printed without a currency nobody supplied', () => {
  it('shows no currency symbol on a two-point mark', () => {
    const rows = describeAnnotation(trend(340.68, 355.33))
    const all = rows.map(r => r.value).join(' ')
    expect(all).not.toMatch(/[$£€¥]/)
    expect(value(rows, 'From')).toContain('340.68')
    expect(value(rows, 'To')).toContain('355.33')
  })

  it('shows no currency symbol on a horizontal line', () => {
    const line = { id: 'h', type: 'horizontal-line', style: STYLE, price: 2847.5 } as Annotation
    const rows = describeAnnotation(line)
    expect(value(rows, 'Price')).not.toMatch(/[$£€¥]/)
    expect(value(rows, 'Price')).toContain('2,847.50')
  })
})

describe('a change is reported only when it can be computed', () => {
  it('states the move and the percentage', () => {
    const rows = describeAnnotation(trend(340.68, 355.33))
    expect(value(rows, 'Change')).toBe('+14.65 (+4.30%)')
  })

  it('signs a fall as a fall', () => {
    const rows = describeAnnotation(trend(355.33, 340.68))
    expect(value(rows, 'Change')).toMatch(/^-14\.65 \(-4\.12%\)$/)
  })

  it('omits the change rather than printing Infinity, when the start is zero', () => {
    const rows = describeAnnotation(trend(0, 355.33))
    expect(rows.some(r => r.label === 'Change')).toBe(false)
    expect(rows.map(r => r.value).join(' ')).not.toContain('Infinity')
  })

  it('omits the change rather than printing NaN', () => {
    const rows = describeAnnotation(trend(Number.NaN, 355.33))
    expect(rows.some(r => r.label === 'Change')).toBe(false)
    expect(rows.map(r => r.value).join(' ')).not.toContain('NaN')
  })

  it('priceMove refuses the cases that would fabricate a number', () => {
    expect(priceMove(0, 10)).toBeNull()
    expect(priceMove(Number.NaN, 10)).toBeNull()
    expect(priceMove(10, Number.POSITIVE_INFINITY)).toBeNull()
    expect(priceMove(100, 110)).toEqual({ absolute: 10, percent: 10 })
  })
})

describe('the span is the number of days the mark covers', () => {
  it('counts 22 days', () => {
    expect(value(describeAnnotation(trend(1, 2)), 'Span')).toBe('22 days')
  })

  it('is never negative, whichever way the mark was drawn', () => {
    expect(spanInDays(T1, T0)).toBe(22)
    expect(spanInDays(T0, T1)).toBe(22)
  })

  it('says day, not days, for one', () => {
    const a = { id: 'a', type: 'trend-line', style: STYLE, startTime: T0, startPrice: 1, endTime: T0 + 86_400, endPrice: 2 } as Annotation
    expect(value(describeAnnotation(a), 'Span')).toBe('1 day')
  })
})

describe('each kind of mark reports its own anchors', () => {
  it('a vertical line reports a date and no price', () => {
    const a = { id: 'v', type: 'vertical-line', style: STYLE, time: T0 } as Annotation
    const rows = describeAnnotation(a)
    expect(rows.map(r => r.label)).toEqual(['Date'])
  })

  it('a text note reports where it sits and what it says', () => {
    const a = { id: 't', type: 'text', style: STYLE, time: T0, price: 100, text: 'gap fill', anchor: 'left' } as Annotation
    const rows = describeAnnotation(a)
    expect(rows.map(r => r.label)).toEqual(['Date', 'Price', 'Note'])
    expect(value(rows, 'Note')).toBe('gap fill')
  })

  it('a fibonacci lists its levels as percentages', () => {
    const a = {
      id: 'f', type: 'fibonacci', style: STYLE,
      startTime: T0, startPrice: 100, endTime: T1, endPrice: 200,
      levels: [0, 0.382, 0.618, 1],
    } as Annotation
    expect(value(describeAnnotation(a), 'Levels')).toBe('0.0%  38.2%  61.8%  100.0%')
  })

  it('an unhandled type says nothing rather than borrowing another type fields', () => {
    const a = { id: 'x', type: 'not-a-real-type', style: STYLE } as unknown as Annotation
    expect(describeAnnotation(a)).toEqual([])
  })
})
