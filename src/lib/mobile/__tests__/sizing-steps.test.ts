import { describe, expect, it } from 'vitest'
import { applyStep, currentDelta, readSizing, prefixForMode } from '../sizing-steps'
import { parseSizingInput } from '../../trade-lab/sizing-parser'

/**
 * Chip arithmetic on the mobile sizing sheet.
 *
 * The stakes are not abstract: the string these produce is committed as a
 * variant's sizing_input and resized against a real portfolio. A live AAPL
 * trade went out at -0.25% when the sheet read +0.25%, because a chip replaced
 * a +0.50% recommendation with the raw chip value instead of nudging it.
 *
 * The rule: a chip adjusts what is already there, IN KIND. A target stays a
 * target, a delta stays a delta.
 */

describe('readSizing tells a target from a delta', () => {
  it('reads an explicit sign as a delta', () => {
    expect(readSizing('+0.5', 'weight')).toEqual({ kind: 'delta', value: 0.5 })
    expect(readSizing('-0.25', 'weight')).toEqual({ kind: 'delta', value: -0.25 })
  })

  it('reads a bare number as a target', () => {
    // The old code collapsed this to "no delta", which is what discarded the
    // recommendation.
    expect(readSizing('7.64', 'weight')).toEqual({ kind: 'target', value: 7.64 })
    expect(readSizing('0', 'weight')).toEqual({ kind: 'target', value: 0 })
  })

  it('separates share targets from share deltas behind #', () => {
    expect(readSizing('#+100', 'shares')).toEqual({ kind: 'delta', value: 100 })
    expect(readSizing('#500', 'shares')).toEqual({ kind: 'target', value: 500 })
  })

  it('separates active target from active delta', () => {
    expect(readSizing('@d+0.25', 'active')).toEqual({ kind: 'delta', value: 0.25 })
    expect(readSizing('@t0.5', 'active')).toEqual({ kind: 'target', value: 0.5 })
  })

  it('calls another mode syntax foreign rather than guessing', () => {
    // Switching modes leaves the old string in the field for a moment.
    expect(readSizing('#+100', 'weight').kind).toBe('foreign')
    expect(readSizing('+0.5', 'shares').kind).toBe('foreign')
    expect(readSizing('abc', 'weight').kind).toBe('foreign')
  })
})

describe('THE REPRODUCED BUG: a chip nudges the recommendation', () => {
  /**
   * Production, 2026-09-28. Current AAPL 7.135%, recommendation +0.50% (target
   * 7.64%), user taps -0.25. The sheet showed +0.25% and the executed trade was
   * -0.2496% — 248 shares SOLD.
   */
  it('adjusts a target recommendation instead of replacing it', () => {
    expect(applyStep('7.64', 'weight', -0.25)).toBe('7.39')
  })

  it('never emits the raw chip value when a recommendation is present', () => {
    // The exact string that went to production.
    expect(applyStep('7.64', 'weight', -0.25)).not.toBe('-0.25')
  })

  it('keeps the trade an ADD, because 7.39 is still above the 7.135 holding', () => {
    const out = applyStep('7.64', 'weight', -0.25)
    const parsed = parseSizingInput(out, { has_benchmark: true })
    expect(parsed.is_valid).toBe(true)
    expect(parsed.framework).toBe('weight_target')
    // A target above the current holding is an increase. The old code produced
    // a weight_delta of -0.25, which is a decrease — the direction inversion.
    expect(parsed.value! - 7.135).toBeCloseTo(0.255, 3)
    expect(parsed.value! - 7.135).toBeGreaterThan(0)
  })

  it('does not produce the executed-in-error target of ~6.886%', () => {
    const out = applyStep('7.64', 'weight', -0.25)
    const parsed = parseSizingInput(out, { has_benchmark: true })
    // 7.135 - 0.25 = 6.885, the number that actually traded.
    expect(parsed.value).not.toBeCloseTo(6.885, 2)
  })
})

describe('the adjustment matrix', () => {
  it('increases an existing add: +0.50 then +0.25 -> +0.75', () => {
    expect(applyStep('+0.5', 'weight', 0.25)).toBe('+0.75')
  })

  it('reduces an existing add: +0.50 then -0.25 -> +0.25', () => {
    expect(applyStep('+0.5', 'weight', -0.25)).toBe('+0.25')
  })

  it('reduces an existing trim: -0.50 then +0.25 -> -0.25, still a trim', () => {
    expect(applyStep('-0.5', 'weight', 0.25)).toBe('-0.25')
  })

  it('allows a legitimate sign crossing: +0.25 then -0.50 -> -0.25', () => {
    // Direction flips because the CUMULATIVE recommendation crossed zero, not
    // because the button was negative. That distinction is the bug.
    expect(applyStep('+0.25', 'weight', -0.5)).toBe('-0.25')
  })

  it('clears a delta that lands back on zero', () => {
    // '' reads as "no instruction", which is what +0.25 then -0.25 means.
    expect(applyStep('+0.25', 'weight', -0.25)).toBe('')
  })

  it('keeps a TARGET of zero, which is an instruction to exit', () => {
    // Not the same as an empty field: "take this to 0%" is a real trade.
    expect(applyStep('0.25', 'weight', -0.25)).toBe('0')
  })

  it('floors a target at zero rather than going negative', () => {
    // A negative target weight is not a position anyone can hold.
    expect(applyStep('0.25', 'weight', -0.5)).toBe('0')
  })

  it('accumulates repeated nudges without rebasing', () => {
    // +0.50 -> -0.25 -> -0.25 should land on the original holding, i.e. the
    // recommendation nudged all the way back to flat.
    let v = '7.64'
    v = applyStep(v, 'weight', -0.25)
    expect(v).toBe('7.39')
    v = applyStep(v, 'weight', -0.25)
    expect(v).toBe('7.14')
  })

  it('accumulates repeated taps from an empty field', () => {
    let v = ''
    for (let i = 0; i < 3; i++) v = applyStep(v, 'weight', 0.25)
    expect(v).toBe('+0.75')
  })

  it('does not accumulate floating point noise', () => {
    let v = ''
    for (let i = 0; i < 3; i++) v = applyStep(v, 'weight', 0.1)
    expect(v).toBe('+0.3')
  })
})

describe('modes keep their own syntax', () => {
  it('steps share deltas and share targets in kind', () => {
    expect(applyStep('', 'shares', 500)).toBe('#+500')
    expect(applyStep('#+500', 'shares', -100)).toBe('#+400')
    expect(applyStep('#500', 'shares', -100)).toBe('#400')
  })

  it('steps active deltas and active targets in kind', () => {
    expect(applyStep('', 'active', 0.25)).toBe('@d+0.25')
    expect(applyStep('@d+0.25', 'active', 0.25)).toBe('@d+0.5')
    expect(applyStep('@t0.5', 'active', -0.25)).toBe('@t0.25')
  })

  it('starts a fresh delta when the field belongs to another mode', () => {
    expect(applyStep('#+100', 'weight', 0.25)).toBe('+0.25')
  })

  /**
   * The contract that matters most: whatever the chips emit must be something
   * the production parser accepts, and must mean what the chip intended.
   */
  it('emits strings the real sizing parser accepts, in the intended framework', () => {
    const cases: Array<[string, 'weight' | 'shares' | 'active', number, string]> = [
      ['', 'weight', 0.25, 'weight_delta'],
      ['', 'weight', -1, 'weight_delta'],
      ['7.64', 'weight', -0.25, 'weight_target'],
      ['2.5', 'weight', 0.5, 'weight_target'],
      ['', 'shares', 500, 'shares_delta'],
      ['#500', 'shares', -100, 'shares_target'],
      ['', 'active', 0.5, 'active_delta'],
      ['@t0.5', 'active', -0.25, 'active_target'],
    ]
    for (const [start, mode, step, framework] of cases) {
      const out = applyStep(start, mode, step)
      const parsed = parseSizingInput(out, { has_benchmark: true })
      expect(parsed.is_valid, `${mode} "${start}" step ${step} produced "${out}"`).toBe(true)
      expect(parsed.framework, `"${start}" + ${step} -> "${out}"`).toBe(framework)
    }
  })
})

describe('currentDelta (deprecated)', () => {
  it('still reports zero for a target, for its remaining callers', () => {
    expect(currentDelta('+0.5', 'weight')).toBe(0.5)
    expect(currentDelta('7.64', 'weight')).toBe(0)
  })
})

describe('prefixForMode', () => {
  it('matches the syntax the parser expects', () => {
    expect(prefixForMode('weight')).toBe('')
    expect(prefixForMode('shares')).toBe('#')
    expect(prefixForMode('active')).toBe('@d')
  })
})
