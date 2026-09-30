/**
 * A recommendation reads as the instruction that was given.
 *
 * ── The row that prompted this ───────────────────────────────────────────
 *
 * A live AAPL recommendation rendered as `9.225074633705818%`. Two faults in
 * one number.
 *
 * `trade_proposals.weight` is `numeric`, which PostgREST returns as a STRING,
 * so `{proposal.weight}%` printed all sixteen digits verbatim — nothing was
 * ever rounding it.
 *
 * Worse, that figure was never recommended. The stored row is:
 *
 *   proposalType  delta_weight     inputValue  -0.75
 *   currentWeight 9.975074633705818
 *   weight        9.225074633705818
 *
 * The analyst said "trim 75bps". `weight` is `currentWeight + inputValue`
 * resolved once at submission, so it is arithmetic against a position that
 * has since moved. Showing it presents a stale derived target as though it
 * were the recommendation.
 *
 * `recommendationLabel` is exported for this test. The rule it encodes —
 * render a delta as a delta, a target as a target — is the kind that silently
 * regresses when someone reaches for `proposal.weight` because it is the
 * field that is always populated.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { recommendationLabel, pct, signedPct } from '../SimulationPage'

const page = readFileSync(
  path.join(process.cwd(), 'src', 'pages', 'SimulationPage.tsx'),
  'utf8',
)

/** The production row, verbatim. */
const AAPL_DELTA = {
  weight: '9.225074633705818',
  sizing_context: {
    inputValue: -0.75,
    proposalType: 'delta_weight',
    currentWeight: 9.975074633705818,
    idea_direction: 'sell',
  },
}

describe('formatting', () => {
  /** numeric arrives as a string; `.toFixed` on a string throws. */
  it('rounds values that arrive as strings', () => {
    expect(pct('9.225074633705818')).toBe('9.23%')
    expect(pct(9.225074633705818)).toBe('9.23%')
  })

  it('says nothing rather than NaN when there is no number', () => {
    expect(pct(null)).toBe('—')
    expect(pct(undefined)).toBe('—')
    expect(pct('')).toBe('—')
  })

  it('signs a change so a trim reads as one', () => {
    expect(signedPct(-0.75)).toBe('-0.75%')
    expect(signedPct(0.5)).toBe('+0.50%')
  })
})

describe('what the row says', () => {
  /** The regression case. */
  it('shows a delta recommendation as the delta', () => {
    const { text } = recommendationLabel(AAPL_DELTA)
    expect(text).toBe('-0.75%')
    expect(text).not.toContain('9.22')
    expect(text).not.toContain('9.225074633705818')
  })

  /** The stale target is still reachable, as provenance, on hover. */
  it('keeps the weight it was derived against in the tooltip', () => {
    const { title } = recommendationLabel(AAPL_DELTA)
    expect(title).toContain('-0.75%')
    expect(title).toContain('9.98%')
  })

  it('shows an absolute recommendation as a target', () => {
    const { text } = recommendationLabel({
      weight: '2.5',
      sizing_context: { proposalType: 'weight', inputValue: 2.5 },
    })
    expect(text).toBe('2.50%')
  })

  it('marks a benchmark-relative recommendation as relative', () => {
    expect(recommendationLabel({
      weight: '3.1',
      sizing_context: { proposalType: 'active_weight', inputValue: 0.6 },
    }).text).toBe('+0.60% vs bench')
  })

  /**
   * Thirty rows in production carry no sizing_context. `weight` is all there
   * is for those, and it is a target — falling back to it is correct, and
   * dropping the fallback would blank them.
   */
  it('falls back to the stored target for legacy rows', () => {
    expect(recommendationLabel({ weight: '4.25' }).text).toBe('4.25%')
    expect(recommendationLabel({ weight: '4.25', sizing_context: {} }).text).toBe('4.25%')
  })

  /** A mode with no input cannot be rendered as a delta. */
  it('falls back when the mode says delta but the input is missing', () => {
    expect(recommendationLabel({
      weight: '9.22',
      sizing_context: { proposalType: 'delta_weight' },
    }).text).toBe('9.22%')
  })
})

describe('no raw weights left in the recommendation row', () => {
  /**
   * Code only. The comments above `recommendationLabel` quote the very
   * expression they replaced, so a prose match is a false positive on the
   * explanation of the fix.
   */
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('renders every percent through a formatter', () => {
    expect(code).not.toContain('{proposal.weight}%')
    expect(code).not.toContain('{leg.weight}%')
    expect(code).not.toContain('`${variantSizing}%`')
  })
})
