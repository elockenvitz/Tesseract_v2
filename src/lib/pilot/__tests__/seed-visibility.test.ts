/**
 * What the pilot's seeded rows may be after graduation.
 *
 * One rule for the whole Dashboard: a seed still sitting in the state the
 * seeder left it in stops counting as operational work; a seed a person acted
 * on is that person's work and stays. Nothing is ever deleted or rewritten.
 */
import { describe, it, expect } from 'vitest'
import {
  isPilotSeedRow, isOperationalAfterPilot, operationalAfterPilot,
} from '../seed-visibility'

describe('reading the marker', () => {
  it('finds it in either shape the database uses', () => {
    expect(isPilotSeedRow({ origin_metadata: { pilot_seed: true } })).toBe(true)
    expect(isPilotSeedRow({ submission_snapshot: { pilot_seed: true } })).toBe(true)
    expect(isPilotSeedRow({ origin_metadata: { pilot_seed: false } })).toBe(false)
    expect(isPilotSeedRow({ origin_metadata: { source: 'pilot' } })).toBe(false)
    expect(isPilotSeedRow({})).toBe(false)
    expect(isPilotSeedRow(null)).toBe(false)
    // A string "true" is not the flag: only the boolean the seeder writes.
    expect(isPilotSeedRow({ origin_metadata: { pilot_seed: 'true' } })).toBe(false)
  })
})

describe('while the pilot is running', () => {
  it('lets every seeded artifact be the work, because it is', () => {
    for (const row of [{ pilotSeed: true }, { pilotSeed: true, actedOn: false }, { pilotSeed: false }]) {
      expect(isOperationalAfterPilot(row, { hasGraduated: false })).toBe(true)
    }
  })
})

describe('after graduation', () => {
  it('retires a seed nobody acted on', () => {
    expect(isOperationalAfterPilot({ pilotSeed: true }, { hasGraduated: true })).toBe(false)
    expect(isOperationalAfterPilot({ pilotSeed: true, actedOn: false }, { hasGraduated: true })).toBe(false)
  })

  it('keeps a seed the reader decided or executed: that is their work', () => {
    expect(isOperationalAfterPilot({ pilotSeed: true, actedOn: true }, { hasGraduated: true })).toBe(true)
  })

  it('never touches a genuine row', () => {
    expect(isOperationalAfterPilot({ pilotSeed: false }, { hasGraduated: true })).toBe(true)
    expect(isOperationalAfterPilot({}, { hasGraduated: true })).toBe(true)
  })

  it('filters a list in place, keeping order and leaving the rest alone', () => {
    const rows = [
      { id: 'real-1' },
      { id: 'seed-open', pilotSeed: true },
      { id: 'seed-decided', pilotSeed: true, actedOn: true },
      { id: 'real-2', pilotSeed: false },
    ]
    expect(operationalAfterPilot(rows, { hasGraduated: true }).map(r => r.id))
      .toEqual(['real-1', 'seed-decided', 'real-2'])
    expect(operationalAfterPilot(rows, { hasGraduated: false })).toHaveLength(4)
    // The input is untouched: this is a read-side rule.
    expect(rows).toHaveLength(4)
  })
})
