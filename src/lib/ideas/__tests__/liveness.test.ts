import { describe, it, expect } from 'vitest'
import { isTerminalIdea, isLiveIdea, TERMINAL_STATUSES } from '../../trade-status-semantics'
import { isOpenProposal, pairIsOpenFromRows, OPEN_PROPOSAL_STATUSES } from '../open-proposal'

/**
 * Three axes, and these tests exist because two of them keep getting confused:
 *
 *   MATURITY       how far the work got            -> stage
 *   LIVENESS       is it still open                -> outcome, then status
 *   DECISION STATE is a portfolio decision pending -> trade_idea_portfolios
 *
 * `stage` reads like progress and therefore like liveness. It is not: an idea
 * that reached `deciding` and was executed still says `deciding` forever,
 * because nothing moves the column back when the work ends.
 */

describe('isTerminalIdea — outcome is authoritative', () => {
  it('treats every real outcome as an end state', () => {
    for (const outcome of ['executed', 'accepted', 'rejected', 'deferred']) {
      expect(isTerminalIdea({ outcome, status: 'deciding' })).toBe(true)
    }
  })

  it('is live when there is no outcome and the status is a working one', () => {
    expect(isTerminalIdea({ outcome: null, status: 'idea' })).toBe(false)
    expect(isTerminalIdea({ outcome: null, status: 'discussing' })).toBe(false)
    expect(isTerminalIdea({ outcome: null, status: 'simulating' })).toBe(false)
  })

  it('falls back to the legacy status when no outcome was written', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminalIdea({ outcome: null, status })).toBe(true)
    }
  })

  /** What the legacy approval path writes: a terminal status and no outcome. */
  it('catches an approved row carrying no outcome at all', () => {
    expect(isTerminalIdea({ status: 'approved' })).toBe(true)
  })

  it('treats an empty-string outcome as absent, not as terminal', () => {
    expect(isTerminalIdea({ outcome: '', status: 'idea' })).toBe(false)
    expect(isTerminalIdea({ outcome: '   ', status: 'idea' })).toBe(false)
  })

  it('is case-insensitive about the legacy status', () => {
    expect(isTerminalIdea({ status: 'EXECUTED' })).toBe(true)
  })

  it('says nothing about a row it was not given', () => {
    expect(isTerminalIdea(null)).toBe(false)
    expect(isTerminalIdea(undefined)).toBe(false)
  })

  it('is the exact inverse of isLiveIdea', () => {
    const rows = [
      { outcome: 'executed', status: 'approved' },
      { outcome: null, status: 'idea' },
      { status: 'rejected' },
    ]
    for (const r of rows) expect(isLiveIdea(r)).toBe(!isTerminalIdea(r))
  })
})

describe('stage is never consulted for liveness', () => {
  /** The production shape D4.2 found: 11 approved rows, all outcome=executed. */
  it('calls an executed idea terminal even though its stage says deciding', () => {
    expect(isTerminalIdea({ outcome: 'executed', status: 'approved' })).toBe(true)
    expect(isOpenProposal({ outcome: 'executed', status: 'approved' })).toBe(false)
  })

  it('leaves a deciding idea live when nothing terminal was written', () => {
    expect(isOpenProposal({ outcome: null, status: 'deciding' })).toBe(true)
  })

  /**
   * The helper does not accept a stage at all, which is the strongest form of
   * "stage must never decide this". Passing one changes nothing.
   */
  it('ignores a stage handed to it by a careless caller', () => {
    const live = { outcome: null, status: 'idea', stage: 'deciding' } as any
    const dead = { outcome: 'rejected', status: 'idea', stage: 'aware' } as any
    expect(isTerminalIdea(live)).toBe(false)
    expect(isTerminalIdea(dead)).toBe(true)
  })

  /** `visibility_tier` is which drawer a row sits in, not whether it is open. */
  it('does not let an active visibility tier override a terminal outcome', () => {
    const row = { outcome: 'executed', status: 'approved', visibility_tier: 'active' } as any
    expect(isOpenProposal(row)).toBe(false)
  })
})

describe('isOpenProposal — the list narrows, the predicate decides', () => {
  it('accepts the working statuses when nothing terminal is set', () => {
    for (const status of ['idea', 'discussing', 'simulating', 'deciding']) {
      expect(isOpenProposal({ outcome: null, status })).toBe(true)
    }
  })

  it('rejects a status outside the coarse list even when live', () => {
    expect(isOpenProposal({ outcome: null, status: 'somethingelse' })).toBe(false)
  })

  /**
   * The regression that motivated the fix. Removing 'approved' from the list
   * would also pass this — which is why the next test exists.
   */
  it('rejects executed work that still carries an open-looking status', () => {
    expect(isOpenProposal({ outcome: 'executed', status: 'approved' })).toBe(false)
  })

  /**
   * Status and outcome are written by different paths and nothing reconciles
   * them. A status-list-only fix is correct exactly until they drift.
   */
  it('rejects terminal work whose status still says a live one', () => {
    expect(isOpenProposal({ outcome: 'rejected', status: 'discussing' })).toBe(false)
    expect(isOpenProposal({ outcome: 'deferred', status: 'idea' })).toBe(false)
  })

  it('keeps the coarse list as a server-side narrowing, unchanged', () => {
    expect(OPEN_PROPOSAL_STATUSES).toContain('idea')
    expect(OPEN_PROPOSAL_STATUSES).toContain('deciding')
  })

  it('says nothing about a row it was not given', () => {
    expect(isOpenProposal(null)).toBe(false)
  })
})

describe('pairIsOpenFromRows — a pair is open when any leg is', () => {
  it('is open while one leg is still being worked', () => {
    expect(pairIsOpenFromRows([
      { outcome: 'executed', status: 'approved' },
      { outcome: null, status: 'simulating' },
    ])).toBe(true)
  })

  it('is closed once every leg is finished', () => {
    expect(pairIsOpenFromRows([
      { outcome: 'executed', status: 'approved' },
      { outcome: 'executed', status: 'approved' },
    ])).toBe(false)
  })

  it('is closed for a pair with no legs at all', () => {
    expect(pairIsOpenFromRows([])).toBe(false)
  })
})
