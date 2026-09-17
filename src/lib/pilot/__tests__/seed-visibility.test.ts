/**
 * What the pilot's seeded rows may be after graduation.
 *
 * One rule for the whole Dashboard: a seed still sitting in the state the
 * seeder left it in stops counting as operational work; a seed a person acted
 * on is that person's work and stays. Nothing is ever deleted or rewritten.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  isPilotSeedRow, isOperationalAfterPilot, operationalAfterPilot, judgeIdeaRow,
} from '../seed-visibility'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

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

/**
 * Judging a `trade_queue_items` row.
 *
 * One definition, here, because the surfaces that already applied the rule
 * judged their own shapes and an engine inventing a sixth answer is how the
 * lenses start disagreeing about what the reader's book contains.
 */
describe('judging an idea row', () => {
  const seedMeta = { pilot_seed: true, pilot_scenario_id: 's1' }

  it('reads the seed marker off origin_metadata', () => {
    expect(judgeIdeaRow({ origin_metadata: seedMeta }).pilotSeed).toBe(true)
    expect(judgeIdeaRow({ origin_metadata: {} }).pilotSeed).toBe(false)
  })

  it.each([
    ['a decision was recorded', { decided_at: '2026-09-17T00:00:00Z' }],
    ['a decision outcome was set', { decision_outcome: 'approved' }],
    ['the idea reached an outcome', { outcome: 'accepted' }],
  ])('counts as acted on when %s', (_n, over) => {
    expect(judgeIdeaRow({ origin_metadata: seedMeta, ...over }).actedOn).toBe(true)
  })

  /* The seeder plants ideas at five different stages, so stage movement alone
     would make every seed look acted-on the moment it existed. */
  it('does not treat the seeded stage as evidence of work', () => {
    const untouched = judgeIdeaRow({ origin_metadata: seedMeta })
    expect(untouched.actedOn).toBe(false)
    expect(untouched.pilotSeed).toBe(true)
  })
})

describe('the sandbox case, end to end', () => {
  /* Exactly the rows in ZZ Acceptance Sandbox: five untouched seeds planted
     across the pipeline, plus the one idea the reader captured themselves. */
  const rows = [
    { id: 'AAPL-rec', origin_metadata: { pilot_seed: true, role: 'recommendation' } },
    { id: 'MSFT-idea', origin_metadata: { pilot_seed: true, role: 'idea' } },
    { id: 'NVDA-demo', origin_metadata: { pilot_seed: true, role: 'demo_idea' } },
    { id: 'AMZN-demo', origin_metadata: { pilot_seed: true, role: 'demo_idea' } },
    { id: 'META-demo', origin_metadata: { pilot_seed: true, role: 'demo_idea' } },
    { id: 'LLY-real', origin_metadata: {} },
  ].map(r => ({ ...r, ...judgeIdeaRow(r) }))

  it('teaches with every seed while the pilot is running', () => {
    expect(operationalAfterPilot(rows, { hasGraduated: false }).map(r => r.id))
      .toHaveLength(6)
  })

  it('leaves only the reader’s own work after graduation', () => {
    expect(operationalAfterPilot(rows, { hasGraduated: true }).map(r => r.id))
      .toEqual(['LLY-real'])
  })

  it('keeps a seed the reader actually decided', () => {
    const acted = rows.map(r =>
      r.id === 'MSFT-idea'
        ? { ...r, ...judgeIdeaRow({ ...r, decided_at: '2026-09-17T00:00:00Z' }) }
        : r)
    expect(operationalAfterPilot(acted, { hasGraduated: true }).map(r => r.id))
      .toEqual(['MSFT-idea', 'LLY-real'])
  })

  /* Nothing is deleted or rewritten: provenance survives suppression. */
  it('leaves provenance intact on the rows it hides', () => {
    const hidden = rows.filter(r => !operationalAfterPilot(rows, { hasGraduated: true }).includes(r))
    expect(hidden).toHaveLength(5)
    for (const r of hidden) expect(isPilotSeedRow(r)).toBe(true)
  })
})

describe('the engine reads the marker it filters on', () => {
  const hook = src('hooks/useGlobalDecisionEngine.ts')

  /* The root cause: `origin_metadata` was never selected, so the rule could
     not be applied at this boundary even in principle. */
  it('selects origin_metadata', () => {
    expect(hook).toContain('origin_metadata,')
  })

  it('filters the idea list through the shared helper', () => {
    expect(hook).toContain('operationalAfterPilot(')
    expect(hook).toContain('judgeIdeaRow(d)')
  })

  /* Graduating must refetch the list, or the tour stays in the feed until
     something unrelated invalidates it. */
  it('keys the query on graduation', () => {
    expect(hook).toContain("'decision-engine-ideas', userId, coverage?.portfolioIds, hasGraduated")
  })
})
