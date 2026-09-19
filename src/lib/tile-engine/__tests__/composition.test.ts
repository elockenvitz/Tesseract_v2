/**
 * Composition and importance.
 *
 * The second half of the sovereignty rule: the engine composes, and then hands
 * the result to the scorer the product already has. These tests assert both —
 * that composition is deterministic and does the grouping it claims, and that
 * ranking is `feed-priority` doing exactly what it would have done anyway.
 */

import { describe, expect, it } from 'vitest'

import { composeSituations, corroborationCount } from '../situation'
import { rankSituations, situationPriorityInput } from '../importance'
import { priorityFor, rankFeed } from '../../signals/feed-priority'
import {
  ALL_CANONICAL, MSFT, NOW,
  dislocation, noCoreThesis, targetExpired, unreviewedMove,
} from './fixtures'

describe('composition groups by subject AND question', () => {
  it('two findings that ask the same question about one name are one situation', () => {
    // Both are the price-objective question on MSFT.
    const situations = composeSituations([targetExpired(), dislocation()])
    const msft = situations.filter(s => s.subject.id === MSFT.id)
    // Different questions: `target` and `framework`.
    expect(msft).toHaveLength(2)
    expect(new Set(msft.map(s => s.question))).toEqual(new Set(['target', 'framework']))
  })

  it('two findings of the same question on one name compose into one', () => {
    const a = targetExpired()
    const b = { ...targetExpired(), id: 'target_expired:a-msft:2', severity: 'informational' as const }
    const [s] = composeSituations([a, b])
    expect(s.supporting).toHaveLength(1)
    expect(corroborationCount(s)).toBe(2)
    // The louder claim leads. `a` is 68 days past its horizon: `attention`.
    expect(s.lead.id).toBe(a.id)
    expect(s.lead.severity).toBe('attention')
  })

  it('different subjects never merge', () => {
    const situations = composeSituations([noCoreThesis(), unreviewedMove()])
    expect(situations).toHaveLength(2)
  })

  it('the situation takes the loudest severity and the most recent instant', () => {
    const older = { ...targetExpired(), id: 'x1', severity: 'informational' as const, occurredAt: '2026-01-01T00:00:00.000Z' }
    const newer = { ...targetExpired(), id: 'x2', severity: 'critical' as const, occurredAt: '2026-08-01T00:00:00.000Z' }
    const [s] = composeSituations([older, newer])
    expect(s.severity).toBe('critical')
    expect(s.occurredAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('intents are unioned, lead first, without duplicates', () => {
    const [s] = composeSituations([targetExpired(), { ...targetExpired(), id: 'x3' }])
    expect(new Set(s.intents).size).toBe(s.intents.length)
    expect(s.intents[0]).toBe(s.lead.intents[0])
  })

  it('is deterministic regardless of input order', () => {
    const findings = ALL_CANONICAL()
    const forward = composeSituations(findings)
    const reverse = composeSituations([...findings].reverse())
    expect(forward.map(s => s.id)).toEqual(reverse.map(s => s.id))
  })
})

describe('rankFeed stays sovereign', () => {
  it('ranking a situation is exactly rankFeed on its priority input', () => {
    const situations = composeSituations(ALL_CANONICAL())
    const viaEngine = rankSituations(situations, NOW)
    const viaScorer = rankFeed(situations, situationPriorityInput, NOW)
    expect(viaEngine.map(r => r.item.id)).toEqual(viaScorer.map(r => r.item.id))
    expect(viaEngine.map(r => r.priority.total)).toEqual(viaScorer.map(r => r.priority.total))
  })

  it('the engine never supplies a base override', () => {
    for (const s of composeSituations(ALL_CANONICAL())) {
      expect(situationPriorityInput(s).base).toBeUndefined()
    }
  })

  it('corroboration adds no score', () => {
    const one = composeSituations([targetExpired()])[0]
    const two = composeSituations([
      targetExpired(),
      { ...targetExpired(), id: 'target_expired:a-msft:2' },
    ])[0]
    expect(priorityFor(situationPriorityInput(two), NOW).total)
      .toBe(priorityFor(situationPriorityInput(one), NOW).total)
  })

  it('corroboration fills a missing input rather than inflating a present one', () => {
    const lead = { ...targetExpired(), stakes: { held: true, coverage: 'direct' as const } }
    const support = { ...targetExpired(), id: 'te2', stakes: { weightPct: 9.5, held: true } }
    const [s] = composeSituations([lead, support])
    const input = situationPriorityInput(s)
    // The lead had no weight; the group genuinely does.
    expect(input.weightPct).toBe(9.5)
  })

  it('the strongest coverage answer in the group wins over an unknown one', () => {
    const unknownLead = { ...targetExpired(), stakes: { ...targetExpired().stakes, coverage: 'unknown' as const } }
    const knownSupport = { ...targetExpired(), id: 'te3', stakes: { coverage: 'direct' as const } }
    const [s] = composeSituations([unknownLead, knownSupport])
    expect(situationPriorityInput(s).coverage).toBe('direct')
  })

  it('the ranked order is stable across calls', () => {
    const situations = composeSituations(ALL_CANONICAL())
    const a = rankSituations(situations, NOW).map(r => r.item.id)
    const b = rankSituations([...situations].reverse(), NOW).map(r => r.item.id)
    expect(a).toEqual(b)
  })
})
