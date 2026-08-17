import { describe, it, expect } from 'vitest'
import { timeframeMonths } from '../timeframe'

/**
 * The long-form cases are the exact strings in production. The previous parser
 * matched none of them, so "outdated case" signals never rendered.
 */
describe('timeframeMonths', () => {
  it('parses every form that exists in production', () => {
    // 30 of 30 rows in analyst_price_targets use this shape.
    expect(timeframeMonths('12 months')).toBe(12)
    expect(timeframeMonths('6 months')).toBe(6)
    expect(timeframeMonths('3 months')).toBe(3)
    expect(timeframeMonths('11 months')).toBe(11)
  })

  it('still parses the short form the old parser expected', () => {
    // Rejecting half a corpus is how the original defect happened; accepting
    // both costs nothing.
    expect(timeframeMonths('12M')).toBe(12)
    expect(timeframeMonths('3Y')).toBe(36)
    expect(timeframeMonths('18 mos')).toBe(18)
    expect(timeframeMonths('2 years')).toBe(24)
  })

  it('is case and whitespace insensitive', () => {
    expect(timeframeMonths('  12 MONTHS ')).toBe(12)
    expect(timeframeMonths('1Y')).toBe(12)
  })

  it('rejects anything it cannot read rather than guessing', () => {
    // Anchored at both ends: a permissive parser that reads "12 monthly
    // reviews" as 12 months would put a fabricated horizon on a card.
    expect(timeframeMonths('12 monthly reviews')).toBeNull()
    expect(timeframeMonths('next quarter')).toBeNull()
    expect(timeframeMonths('')).toBeNull()
    expect(timeframeMonths(null)).toBeNull()
    expect(timeframeMonths('0 months')).toBeNull()
    expect(timeframeMonths('-6 months')).toBeNull()
  })
})
