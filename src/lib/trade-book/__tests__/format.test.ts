/**
 * How a committed trade's numbers are written.
 *
 * The rule worth pinning hardest is the sign. `notional_value` is stored as an
 * unsigned magnitude and the direction comes from `action`, so a surface that
 * formats the stored number directly shows a sell as a positive amount. That
 * is not a formatting slip — it is the wrong number on a screen where someone
 * decides whether a trade was right.
 *
 * The rest of these exist because the same three expressions were inlined at
 * nine call sites, which is how one trade comes to read $340K on one screen
 * and $340,000 on the next.
 */
import { describe, it, expect } from 'vitest'
import {
  signedNotional,
  fmtSignedNotional,
  fmtSignedNotionalFull,
  fmtTargetWeight,
  fmtDeltaWeight,
  fmtDeltaShares,
  directionalToneClass,
  fmtTotalNotional,
} from '../format'

describe('the notional sign comes from the action, not the stored value', () => {
  it('reads a buy as an increase', () => {
    expect(signedNotional(250_000, 'buy')).toBe(250_000)
    expect(signedNotional(250_000, 'add')).toBe(250_000)
  })

  it('reads a sell or trim as a reduction', () => {
    // Stored unsigned. Formatting it directly would show +$250,000 for a sale.
    expect(signedNotional(250_000, 'sell')).toBe(-250_000)
    expect(signedNotional(250_000, 'trim')).toBe(-250_000)
  })

  it('does not trust a stored sign over the action', () => {
    // A negative magnitude on a buy is still a buy.
    expect(signedNotional(-250_000, 'buy')).toBe(250_000)
    expect(signedNotional(-250_000, 'sell')).toBe(-250_000)
  })

  it('keeps "not recorded" distinct from zero dollars', () => {
    expect(signedNotional(null, 'buy')).toBeNull()
    expect(signedNotional(undefined, 'buy')).toBeNull()
    expect(signedNotional(0, 'buy')).toBe(0)
  })
})

describe('notional formatting', () => {
  it('abbreviates at the thresholds the table has always used', () => {
    expect(fmtSignedNotional(2_400_000_000)).toBe('$2.40B')
    expect(fmtSignedNotional(34_173_518)).toBe('$34.2M')
    expect(fmtSignedNotional(340_000)).toBe('$340K')
  })

  it('prints small figures exactly, where there is room', () => {
    expect(fmtSignedNotional(99_999)).toBe('$99,999')
    expect(fmtSignedNotional(1_250)).toBe('$1,250')
  })

  it('carries the minus through to the reader', () => {
    expect(fmtSignedNotional(-34_173_518)).toBe('-$34.2M')
    expect(fmtSignedNotional(-1_250)).toBe('-$1,250')
  })

  it('renders an unrecorded notional as a dash, not as zero', () => {
    expect(fmtSignedNotional(null)).toBe('—')
  })

  it('keeps the exact figure available alongside the abbreviation', () => {
    // Precision is never lost, only moved to the tooltip / detail line.
    expect(fmtSignedNotionalFull(34_173_518)).toBe('$34,173,518')
    expect(fmtSignedNotionalFull(-34_173_518)).toBe('-$34,173,518')
    expect(fmtSignedNotionalFull(null)).toBe('')
  })

  it('abbreviates the list total by the same rule as a row', () => {
    expect(fmtTotalNotional(13_071_033.449)).toBe('$13.1M')
    expect(fmtTotalNotional(0)).toBe('')
  })
})

describe('weights and shares', () => {
  it('writes a target weight unsigned, because it is a position size', () => {
    expect(fmtTargetWeight(2.5)).toBe('2.50%')
    expect(fmtTargetWeight(0)).toBe('0.00%')
    expect(fmtTargetWeight(null)).toBe('—')
  })

  it('writes a weight change signed, because the direction is the point', () => {
    expect(fmtDeltaWeight(0.45)).toBe('+0.45%')
    expect(fmtDeltaWeight(-1.2)).toBe('-1.20%')
    expect(fmtDeltaWeight(0)).toBe('0.00%')
    expect(fmtDeltaWeight(null)).toBe('—')
  })

  it('groups share counts, which run to six figures', () => {
    expect(fmtDeltaShares(3_200)).toBe('+3,200')
    expect(fmtDeltaShares(-12_500)).toBe('-12,500')
    expect(fmtDeltaShares(null)).toBe('—')
  })
})

describe('directional colour', () => {
  it('colours gains and reductions differently', () => {
    expect(directionalToneClass(1)).toContain('emerald')
    expect(directionalToneClass(-1)).toContain('red')
  })

  it('leaves zero and absent values neutral rather than green', () => {
    expect(directionalToneClass(0)).toContain('gray')
    expect(directionalToneClass(null)).toContain('gray')
    expect(directionalToneClass(undefined)).toContain('gray')
  })
})
