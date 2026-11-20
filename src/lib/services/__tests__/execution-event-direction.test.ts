/**
 * The execution event's direction must come from the shares, not the thesis.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `emitPaperTradeEvent` derived `action_type` from `trade.action` -- the
 * IDEA's thesis word -- while `quantity_delta` came from the holdings that
 * actually moved. Those disagree whenever a position is already heavier than
 * the target a bullish idea asks for.
 *
 * Measured in production, 2026-11-20. A BUY idea on MSFT sized from 6.14%
 * down to 4.00% cut 1,674 shares, and the event recorded:
 *
 *     action_type    'add'
 *     quantity_delta -1674
 *     4800 -> 3126 shares
 *
 * The row contradicts itself. A consumer trusting the typed action over the
 * delta sign reads a 1,674-share reduction as an increase.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 * The exported `executionActionType` is the extracted decision. Each case
 * pins a direction the old rule got wrong or had to keep getting right, so a
 * fixture built only from `sell` ideas could not reproduce the blind spot.
 */
import { describe, it, expect } from 'vitest'
import { executionActionType } from '../accepted-trade-service'

describe('the execution event takes its direction from the shares', () => {
  // THE DEFECT. A buy-thesis idea that reduces the position.
  it('records a trim when a BUY idea is sized below the current weight', () => {
    expect(
      executionActionType({ sharesBefore: 4800, sharesAfter: 3126 }),
    ).toBe('trim')
  })

  it('records an exit when a BUY idea is sized to zero', () => {
    expect(executionActionType({ sharesBefore: 4800, sharesAfter: 0 })).toBe('exit')
  })

  // The cases the old rule already got right, which must stay right.
  it('records an add when a held position grows', () => {
    expect(executionActionType({ sharesBefore: 4800, sharesAfter: 6000 })).toBe('add')
  })

  it('records an initiate when a position is opened from nothing', () => {
    expect(executionActionType({ sharesBefore: 0, sharesAfter: 1500 })).toBe('initiate')
  })

  it('records a trim when a SELL idea partially reduces', () => {
    expect(executionActionType({ sharesBefore: 1000, sharesAfter: 400 })).toBe('trim')
  })

  it('records an exit when a SELL idea closes the position', () => {
    expect(executionActionType({ sharesBefore: 1000, sharesAfter: 0 })).toBe('exit')
  })

  // A short crossing through zero is still a reduction of the long.
  it('records an exit when the position crosses below zero', () => {
    expect(executionActionType({ sharesBefore: 500, sharesAfter: -200 })).toBe('exit')
  })

  it('records an initiate when a position is reopened from zero', () => {
    expect(executionActionType({ sharesBefore: 0, sharesAfter: 900 })).toBe('initiate')
  })

  it('never disagrees with the sign of the delta it is stored beside', () => {
    const cases = [
      { sharesBefore: 4800, sharesAfter: 3126 },
      { sharesBefore: 4800, sharesAfter: 6000 },
      { sharesBefore: 0, sharesAfter: 1500 },
      { sharesBefore: 1000, sharesAfter: 0 },
      { sharesBefore: 500, sharesAfter: -200 },
    ]
    for (const c of cases) {
      const delta = c.sharesAfter - c.sharesBefore
      const type = executionActionType(c)
      const reducing = type === 'trim' || type === 'exit'
      expect(
        reducing,
        `action_type '${type}' beside delta ${delta}`,
      ).toBe(delta < 0)
    }
  })
})
