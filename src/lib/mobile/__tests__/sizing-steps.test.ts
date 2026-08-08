import { describe, expect, it } from 'vitest'
import { applyStep, currentDelta, prefixForMode } from '../sizing-steps'
import { parseSizingInput } from '../../trade-lab/sizing-parser'

/**
 * Chip arithmetic on the mobile sizing sheet.
 *
 * The stakes: the string these produce is committed as a variant's
 * sizing_input and resized against a real portfolio. A bug that turns a target
 * into a delta does not error — it sizes the position to a different number
 * than the user asked for, and the readout agrees with itself the whole way.
 */

describe('currentDelta', () => {
  it('reads a signed weight as a delta', () => {
    expect(currentDelta('+0.5', 'weight')).toBe(0.5)
    expect(currentDelta('-0.25', 'weight')).toBe(-0.25)
  })

  it('refuses to treat a bare target as a delta', () => {
    // This is the whole point. "2.5" means take the position to 2.5%; stepping
    // from it would silently reinterpret it as "add 2.5%".
    expect(currentDelta('2.5', 'weight')).toBe(0)
    expect(currentDelta('0', 'weight')).toBe(0)
  })

  it('reads signed shares only behind the # prefix', () => {
    expect(currentDelta('#+100', 'shares')).toBe(100)
    expect(currentDelta('#-50', 'shares')).toBe(-50)
    expect(currentDelta('#500', 'shares')).toBe(0)
  })

  it('reads active-space deltas only behind @d', () => {
    expect(currentDelta('@d+0.25', 'active')).toBe(0.25)
    expect(currentDelta('@t0.5', 'active')).toBe(0)
  })

  it('ignores a value written in another mode syntax', () => {
    // Switching modes leaves the old string briefly in the field; stepping must
    // not reinterpret shares as weight.
    expect(currentDelta('#+100', 'weight')).toBe(0)
    expect(currentDelta('@d+0.5', 'weight')).toBe(0)
    expect(currentDelta('+0.5', 'shares')).toBe(0)
  })

  it('returns zero for empty and unparseable input', () => {
    expect(currentDelta('', 'weight')).toBe(0)
    expect(currentDelta('   ', 'weight')).toBe(0)
    expect(currentDelta('abc', 'weight')).toBe(0)
    expect(currentDelta('+', 'weight')).toBe(0)
  })
})

describe('applyStep', () => {
  it('accumulates repeated taps', () => {
    let v = ''
    v = applyStep(v, 'weight', 0.25)
    v = applyStep(v, 'weight', 0.25)
    v = applyStep(v, 'weight', 0.25)
    expect(v).toBe('+0.75')
  })

  it('clears the field when the deltas cancel out', () => {
    const up = applyStep('', 'weight', 0.5)
    expect(applyStep(up, 'weight', -0.5)).toBe('')
  })

  it('crosses zero into a negative delta', () => {
    expect(applyStep('+0.25', 'weight', -0.5)).toBe('-0.25')
  })

  it('replaces rather than accumulates when the field holds a target', () => {
    // Starting from a target, one +0.5 tap means "+0.5", never "3".
    expect(applyStep('2.5', 'weight', 0.5)).toBe('+0.5')
  })

  it('keeps the mode prefix', () => {
    expect(applyStep('', 'shares', 500)).toBe('#+500')
    expect(applyStep('#+500', 'shares', -100)).toBe('#+400')
    expect(applyStep('', 'active', 0.25)).toBe('@d+0.25')
  })

  it('does not accumulate floating point noise', () => {
    let v = ''
    for (let i = 0; i < 3; i++) v = applyStep(v, 'weight', 0.1)
    expect(v).toBe('+0.3')
  })

  /**
   * The contract that matters most: whatever the chips emit must be something
   * the production parser accepts. If these drift, the sheet produces strings
   * that fail validation only once committed.
   */
  it('emits strings the real sizing parser accepts', () => {
    const cases: [string, 'weight' | 'shares' | 'active', number][] = [
      ['', 'weight', 0.25],
      ['', 'weight', -1],
      ['', 'shares', 500],
      ['', 'shares', -1000],
      ['', 'active', 0.5],
    ]
    for (const [start, mode, step] of cases) {
      const out = applyStep(start, mode, step)
      const parsed = parseSizingInput(out, { has_benchmark: true })
      expect(parsed.is_valid, `${mode} step ${step} produced "${out}"`).toBe(true)
    }
  })
})

describe('prefixForMode', () => {
  it('matches the syntax the parser expects', () => {
    expect(prefixForMode('weight')).toBe('')
    expect(prefixForMode('shares')).toBe('#')
    expect(prefixForMode('active')).toBe('@d')
  })
})
