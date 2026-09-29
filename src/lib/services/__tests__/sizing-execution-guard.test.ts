/**
 * The last line between a sizing disagreement and a real position change.
 *
 * `sizing_input` is what the user typed or nudged, and what the sheet's
 * readout derives from. `computed` is what actually sizes the trade. They are
 * produced at different moments by different code — optimistic cache patches
 * null `computed`, the server recomputes it, `SimulationPage` rebuilds it from
 * cache when missing — and nothing downstream compares them.
 *
 * `createAcceptedTrade` is a pure pass-through insert, so a disagreement
 * becomes a real trade with no error raised anywhere. One did: a sheet
 * reading +0.25% committed "-0.25" and sold 248 AAPL shares.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase', () => ({ supabase: { from: () => ({}) } }))

import { assertSizingAgreesWithInput } from '../execute-sim-variants-service'

const variant = (sizing_input: string, computed: Record<string, number | null> | null) =>
  ({ id: 'v1', sizing_input, computed } as any)

describe('agreement between the sizing string and the sized trade', () => {
  it('passes when a delta input matches the computed delta', () => {
    expect(() => assertSizingAgreesWithInput(
      variant('-0.25', { delta_weight: -0.25, target_weight: 6.885 }),
    )).not.toThrow()
  })

  it('passes when a target input matches the computed target', () => {
    expect(() => assertSizingAgreesWithInput(
      variant('7.39', { target_weight: 7.39, delta_weight: 0.255 }),
    )).not.toThrow()
  })

  it('REFUSES when the sign is inverted', () => {
    // The exact failure shape: the field says take 25bps off, the trade adds
    // 25bps. Either direction of this disagreement is a wrong-way trade.
    expect(() => assertSizingAgreesWithInput(
      variant('-0.25', { delta_weight: 0.25, target_weight: 7.385 }),
    )).toThrow(/does not match/i)

    expect(() => assertSizingAgreesWithInput(
      variant('+0.25', { delta_weight: -0.25, target_weight: 6.885 }),
    )).toThrow(/does not match/i)
  })

  it('REFUSES when a target was computed from a stale, different input', () => {
    expect(() => assertSizingAgreesWithInput(
      variant('7.39', { target_weight: 7.64, delta_weight: 0.5 }),
    )).toThrow(/does not match/i)
  })

  it('names both numbers so the refusal is actionable', () => {
    try {
      assertSizingAgreesWithInput(variant('-0.25', { delta_weight: 0.25 }))
      throw new Error('should have refused')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('-0.25')
      expect(msg).toContain('0.2500')
      expect(msg).toMatch(/re-enter/i)
    }
  })

  it('tolerates rounding, which the normalizer legitimately applies', () => {
    // The real AAPL row: input "-0.25", computed delta -0.24958…, because the
    // normalizer resolves through whole shares. Rejecting that would make the
    // guard fire on every correct trade.
    expect(() => assertSizingAgreesWithInput(
      variant('-0.25', { delta_weight: -0.24958196116878048, target_weight: 6.88562642380935 }),
    )).not.toThrow()

    expect(() => assertSizingAgreesWithInput(
      variant('7.75', { target_weight: 7.749760388440257, delta_weight: 0.5014476966214664 }),
    )).not.toThrow()
  })

  it('stays silent where it cannot judge, rather than guessing', () => {
    // Missing sizing is the caller's own guard. Share and active frameworks
    // resolve through price and benchmark weight, which are not in scope here —
    // re-deriving them badly is the bug class this guard exists to stop.
    expect(() => assertSizingAgreesWithInput(variant('', null))).not.toThrow()
    expect(() => assertSizingAgreesWithInput(variant('-0.25', null))).not.toThrow()
    expect(() => assertSizingAgreesWithInput(variant('#-250', { delta_weight: 99 }))).not.toThrow()
    expect(() => assertSizingAgreesWithInput(variant('@d+0.5', { delta_weight: 99 }))).not.toThrow()
    expect(() => assertSizingAgreesWithInput(variant('nonsense', { delta_weight: 99 }))).not.toThrow()
  })

  it('stays silent when the relevant computed field is absent', () => {
    // A null delta_weight is not a disagreement; it is an absence, and the
    // insert will carry null. Refusing here would block correct trades.
    expect(() => assertSizingAgreesWithInput(
      variant('-0.25', { delta_weight: null, target_weight: 6.885 }),
    )).not.toThrow()
  })
})
