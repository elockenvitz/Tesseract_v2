/**
 * The gate that held the Coverage tab on a loader forever.
 *
 * It asked whether the active tab was hidden in PILOT_ACCESS_DEFAULTS, which
 * was safe only while every default-hidden surface stayed hidden for the whole
 * pilot: the route guard moved them off it and the hold ended with the tab.
 * Coverage now opens once a pilot has declared some, so a pilot on the
 * Coverage tab waited on a guard that was never going to fire.
 */

import { describe, it, expect } from 'vitest'
import { shouldHoldForPilotDecision, type PilotTabGateInput } from '../tab-gate'

const on = (over: Partial<PilotTabGateInput> = {}): PilotTabGateInput => ({
  orgKnown: true,
  pilotLoading: false,
  isPilot: true,
  hiddenByDefaults: false,
  hiddenForThisPilot: false,
  ...over,
})

describe('before the pilot decision resolves', () => {
  it('holds a tab that would be hidden if this turns out to be a pilot', () => {
    expect(shouldHoldForPilotDecision(on({ pilotLoading: true, hiddenByDefaults: true }))).toBe(true)
  })

  /** The org is briefly null after a reload, which disables the flags query. */
  it('holds when the org is not known yet', () => {
    expect(shouldHoldForPilotDecision(on({ orgKnown: false, hiddenByDefaults: true }))).toBe(true)
  })

  it('paints a tab no pilot would be bounced off', () => {
    expect(shouldHoldForPilotDecision(on({ pilotLoading: true }))).toBe(false)
  })
})

describe('once it has resolved', () => {
  /**
   * The regression. Coverage is hidden by default and open to this pilot; the
   * old rule read only the default and held on a guard that never fired.
   */
  it('paints an unlocked surface that the defaults call hidden', () => {
    expect(shouldHoldForPilotDecision(on({
      hiddenByDefaults: true,
      hiddenForThisPilot: false,
    }))).toBe(false)
  })

  /** Still closed to them: the guard is mid-swap, and this hold terminates. */
  it('holds a surface that really is closed to this pilot', () => {
    expect(shouldHoldForPilotDecision(on({
      hiddenByDefaults: true,
      hiddenForThisPilot: true,
    }))).toBe(true)
  })

  it('holds nothing for a reader who is not a pilot', () => {
    expect(shouldHoldForPilotDecision(on({
      isPilot: false,
      hiddenByDefaults: true,
      hiddenForThisPilot: true,
    }))).toBe(false)
  })
})
