/**
 * The copy layer, the projection, and the capability decision.
 *
 * Parity is covered next door. This is about the half that is ALLOWED to
 * differ, and about the boundaries that keep it from becoming a template per
 * family again.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { adoptScenarioGap, adoptStaleTarget } from '../mobile'
import { canReviseArtefact } from '../capability'
import { noCoreThesisAuthors, scenarioGapAuthors, staleTargetAuthors } from '../producers'
import { PRIMITIVE_COMPONENTS } from '../../presentation'
import { SITUATION_DEFINITIONS } from '../../situations'
import type { FindingKind } from '../../finding'
import {
  PHONE, dislocationCard, staleTargetCard, staleTargetRow,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
const CAPITAL = { weightPct: 4.8 }

const staleAdoption = () => {
  const r = adoptStaleTarget(staleTargetRow(), staleTargetCard(), READER, PHONE)
  if (!r.ok) throw new Error(`unexpected decline: ${r.reason}`)
  return r.adoption
}

const gapAdoption = () => {
  const r = adoptScenarioGap(dislocationCard(), CAPITAL, READER, PHONE)
  if (!r.ok) throw new Error(`unexpected decline: ${r.reason}`)
  return r.adoption
}

// ── Boundaries ───────────────────────────────────────────────────────────────

const executable = (file: string): string =>
  readFileSync(resolve(__dirname, '..', file), 'utf8')
    .split('\n')
    .filter(l => {
      const t = l.trimStart()
      return t !== '' && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    .join('\n')

describe('the adoption keeps the architecture honest', () => {
  it('the copy layer never branches on a finding kind', () => {
    const body = executable('display-copy.ts')
    for (const kind of Object.keys(SITUATION_DEFINITIONS) as FindingKind[]) {
      expect(body.includes(`'${kind}'`), `display-copy branches on ${kind}`).toBe(false)
    }
  })

  it('the projection never branches on a finding kind', () => {
    const body = executable('project.ts')
    for (const kind of Object.keys(SITUATION_DEFINITIONS) as FindingKind[]) {
      expect(body.includes(`'${kind}'`), `project branches on ${kind}`).toBe(false)
    }
  })

  it('no adopted producer restates a production threshold', () => {
    const body = executable('producers.ts')
    // The numbers that decide whether these families fire or how loud they are.
    for (const literal of ['0.15', 'OVERDUE_MONTHS', 'MATERIAL_DEVIATION_PCT', 'IMPLAUSIBLE']) {
      expect(body.includes(literal), `producers restates ${literal}`).toBe(false)
    }
  })

  it('every primitive the two situations reach has a component', () => {
    for (const a of [staleAdoption(), gapAdoption()]) {
      for (const v of a.plan.visuals) {
        const path: string | null = PRIMITIVE_COMPONENTS[v.primitive]
        expect(path, `${v.primitive} has no component`).not.toBeNull()
        expect(() => readFileSync(resolve(__dirname, '../../../../..', path!), 'utf8')).not.toThrow()
      }
    }
  })
})

// ── Display copy ─────────────────────────────────────────────────────────────

describe('display copy', () => {
  it('states the claim without repeating the metric inside it', () => {
    for (const a of [staleAdoption(), gapAdoption()]) {
      const value = a.copy.metric?.value
      if (!value) continue
      expect(a.copy.headline, `headline repeats ${value}`).not.toContain(value)
    }
  })

  it('reads the direction off the geometry, not off a flag', () => {
    const below = gapAdoption()
    expect(below.copy.headline).toContain('below')
    expect(below.copy.metric?.label).toContain('Below the lowest case')
  })

  it('is deterministic', () => {
    const a = staleAdoption().copy
    const b = staleAdoption().copy
    expect(a).toEqual(b)
  })

  it('formats dates in UTC so a reader in Auckland reads what the analyst wrote', () => {
    // The horizon ran from 15 Jan 2025 to 15 Jan 2026; both are midnight UTC,
    // which is the previous day in half the world if the format is local.
    expect(staleAdoption().copy.body).toContain('15 Jan 2025')
    expect(staleAdoption().copy.body).toContain('15 Jan 2026')
  })

  it('withholds the prompt the plan withheld', () => {
    const a = staleAdoption()
    const asked = a.plan.hierarchy.order.includes('prompt')
    expect(a.copy.prompt === null).toBe(!asked)
    expect(a.card.prompt === undefined).toBe(!asked)
  })
})

// ── Projection ───────────────────────────────────────────────────────────────

describe('projection onto the card contract', () => {
  it('spends no more context rows than the geometry was resolved against', () => {
    for (const a of [staleAdoption(), gapAdoption()]) {
      expect(a.card.context.length)
        .toBeLessThanOrEqual(a.plan.space.requirement.contextRows ?? 0)
    }
  })

  it('keeps the evidence data the producer assembled', () => {
    const original = dislocationCard()
    const a = gapAdoption()
    expect(a.card.evidence?.data).toEqual(original.evidence?.data)
    // The plan chose the shape; the producer still owns the numbers.
    expect(a.card.evidence?.kind).toBe('scenario_ladder')
  })

  it('draws an expired horizon as a clock rather than as a series', () => {
    // An intended presentation difference: the shipping card carries a
    // sparkline, and the resolver says a claim about elapsed time draws on a
    // timeline. Both are non-`none`, so the band gate behaves identically.
    expect(staleTargetCard().evidence?.kind).toBe('sparkline')
    expect(staleAdoption().card.evidence?.kind).toBe('timeline')
  })

  it('never leaves the reader without triage', () => {
    for (const a of [staleAdoption(), gapAdoption()]) {
      const ids = a.card.actions.menu.map(m => m.id)
      expect(ids).toContain('snooze')
      expect(ids).toContain('dismiss')
      expect(ids).toContain('why')
    }
  })

  it('offers at most two quick actions', () => {
    for (const a of [staleAdoption(), gapAdoption()]) {
      expect(a.card.actions.quick.length).toBeLessThanOrEqual(2)
    }
  })

  it('keeps the original navigation target', () => {
    expect(gapAdoption().card.actions.open).toEqual(dislocationCard().actions.open)
  })
})

// ── Capability ───────────────────────────────────────────────────────────────

describe('canCommit comes from an existing source or defaults to false', () => {
  it('reads row authorship where the producer carries it', () => {
    const authors = scenarioGapAuthors(dislocationCard())
    expect(canReviseArtefact(authors, 'u-analyst')).toMatchObject({
      canCommit: true, source: 'row_authorship',
    })
    expect(canReviseArtefact(authors, 'u-someone-else')).toMatchObject({
      canCommit: false, source: 'row_authorship',
    })
  })

  /**
   * The asymmetry adoption B closed.
   *
   * `usePortfolioLenses` now selects `analyst_price_targets.user_id`, so the
   * expired-target family answers from the same column, on the same table,
   * under the same policy the scenario ladder already used.
   */
  it('reads the stale target author the lens now selects', () => {
    const authors = staleTargetAuthors(staleTargetRow())
    expect(canReviseArtefact(authors, 'u-analyst').canCommit).toBe(true)
    expect(canReviseArtefact(authors, 'u-someone-else')).toMatchObject({
      canCommit: false, source: 'row_authorship',
    })
  })

  it('says so plainly when a row predates the column', () => {
    const authors = staleTargetAuthors(staleTargetRow({ authorId: null }))
    expect(canReviseArtefact(authors, 'u-analyst')).toMatchObject({
      canCommit: false, source: 'row_authorship',
    })
  })

  /**
   * A case that was never written has no author, and that is not a data gap.
   *
   * There is no row, so nobody wrote it. `null` is the honest answer and it
   * resolves to a non-commit path rather than a guess.
   */
  it('has no author to check for a thesis that was never written', () => {
    expect(noCoreThesisAuthors()).toBeNull()
    expect(canReviseArtefact(noCoreThesisAuthors(), 'u-analyst')).toMatchObject({
      canCommit: false, source: 'no_author_recorded',
    })
  })

  it('defaults to false for an unresolved reader', () => {
    expect(canReviseArtefact(scenarioGapAuthors(dislocationCard()), null)).toMatchObject({
      canCommit: false, source: 'no_reader',
    })
  })

  /**
   * The capability is computed and recorded, and correctly changes nothing
   * for the adopted situations.
   *
   * None of the three carries a commit-class intent — see `COMMIT_INTENTS`. A
   * reader who cannot commit therefore gets the same primary action as one who
   * can, which is what production does and what parity insists on.
   */
  it('does not move the primary action for any adopted situation', () => {
    const stranger = { readerId: 'u-someone-else', coverage: 'direct' as const }
    const mine = adoptScenarioGap(dislocationCard(), CAPITAL, READER, PHONE)
    const theirs = adoptScenarioGap(dislocationCard(), CAPITAL, stranger, PHONE)
    expect(mine.ok && theirs.ok).toBe(true)
    if (!mine.ok || !theirs.ok) return
    expect(mine.adoption.capability.canCommit).toBe(true)
    expect(theirs.adoption.capability.canCommit).toBe(false)
    expect(theirs.adoption.card.actions.primary.id)
      .toBe(mine.adoption.card.actions.primary.id)
  })
})
