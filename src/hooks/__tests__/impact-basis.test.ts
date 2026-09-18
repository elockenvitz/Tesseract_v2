/**
 * The dollar impact is measured from the EXECUTION price.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `impact_proxy` was `tradeNotional x (moveSinceDecision ?? moveSinceExecution)`,
 * and that fallback order is a units error rather than a preference.
 *
 * `tradeNotional` is the size of the trade AT EXECUTION -- either the
 * market-value delta the execution produced, or |quantity x execution price|.
 * Multiplying it by a return measured from the DECISION price asks what the
 * position is worth now against what the desk was looking at BEFORE it
 * traded, and charges the difference to a position size that did not exist
 * yet.
 *
 * ── The arithmetic ────────────────────────────────────────────────────────
 *
 * With the execution basis it collapses correctly:
 *
 *   notional x moveSinceExec / 100
 *     = qty x execPrice x (now - execPrice) / execPrice
 *     = qty x (now - execPrice)
 *
 * Checked against a clean production row -- Bogey Cap MSFT, 168 shares added
 * at 501.11 on 2026-09-15, market value 2,405,328 -> 2,489,514.48, last close
 * 497.75:
 *
 *   notional            = |2489514.48 - 2405328| = 84,186.48
 *   moveSinceExecution  = (497.75 - 501.11) / 501.11 x 100 = -0.67051%
 *   impact              = 84,186.48 x -0.0067051          = -$564.4
 *   direct              = 168 x (497.75 - 501.11)         = -$564.5
 *
 * The two agree. The decision basis does not, and differs by the drift
 * between the decision and the fill -- which is a real quantity, reported
 * separately as `delay_cost_pct`, because it answers what the WAIT cost
 * rather than what the position has made.
 *
 * ── Why this reads the source ─────────────────────────────────────────────
 *
 * The computation lives inside `useDecisionAccountability`, which is a large
 * hook against Supabase rather than an exported pure function. The invariant
 * worth protecting is one line of it, so this asserts that line and proves
 * the arithmetic it implements independently.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(
  join(__dirname, '..', 'useDecisionAccountability.ts'),
  'utf8',
)

describe('impact is measured from the execution price', () => {
  it('prefers the execution move over the decision move', () => {
    expect(src).toContain('const impactMove = moveSinceExecution ?? moveSinceDecision')
    expect(src).toContain('(tradeNotional * impactMove) / 100')

    /*
     * The order that mixed a size at execution with a return from the
     * decision, scoped to the impact computation.
     *
     * `computeResultDirection` uses that same fallback deliberately and
     * correctly: it classifies whether a decision was validated, where the
     * fuller picture from the decision IS the right lens and no notional is
     * multiplied by it. A blanket ban on the phrase would fail on that
     * function and push the next person to change the wrong one.
     */
    const impactBlock = src.slice(
      src.indexOf('const impactMove'),
      src.indexOf('weighted_delay_cost: weightedDelayCost'),
    )
    expect(impactBlock).not.toContain('moveSinceDecision ?? moveSinceExecution')
  })

  it('keeps the decision-to-execution drift as its own measure', () => {
    // The comparison removed from `impact_proxy` is not lost -- it is what
    // delay cost exists to report, and it answers a different question.
    expect(src).toContain('delay_cost_pct: delayCost')
    expect(src).toContain('computeDelayCost(direction, decisionPrice, executionPrice)')
  })

  it('agrees with shares times the price change, on a real row', () => {
    // Bogey Cap MSFT, the numbers quoted above.
    const qty = 168
    const execPrice = 501.11
    const now = 497.75
    const notional = Math.abs(2489514.48 - 2405328)

    const moveSinceExecution = ((now - execPrice) / execPrice) * 100
    const impact = (notional * moveSinceExecution) / 100
    const direct = qty * (now - execPrice)

    // Within a dollar: the notional carries rounding the share count does not.
    expect(Math.abs(impact - direct)).toBeLessThan(1)
    expect(impact).toBeLessThan(0)
  })

  it('would disagree if measured from the decision price', () => {
    // The same row, had the decision been taken at 480 and filled at 501.11.
    const decisionPrice = 480
    const execPrice = 501.11
    const now = 497.75
    const notional = Math.abs(2489514.48 - 2405328)

    const fromExecution = (notional * (((now - execPrice) / execPrice) * 100)) / 100
    const fromDecision = (notional * (((now - decisionPrice) / decisionPrice) * 100)) / 100

    // Not a rounding difference: one says the trade lost money, the other
    // says it made money, on identical inputs.
    expect(fromExecution).toBeLessThan(0)
    expect(fromDecision).toBeGreaterThan(0)
  })
})
