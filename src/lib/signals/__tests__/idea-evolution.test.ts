import { describe, it, expect } from 'vitest'
import { summariseEvolution, shortAge, unchangedThesisLine, NO_EVOLUTION } from '../idea-evolution'

const NOW = new Date('2026-08-30T12:00:00Z').getTime()
const at = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const ev = (fields: string[], days: number, actionType = 'update') =>
  ({ actionType, changedFields: fields, occurredAt: at(days) })

describe('summariseEvolution', () => {
  it('names what changed and when, never a before/after pair', () => {
    const e = summariseEvolution([ev(['target_price'], 6)])
    expect(e.lines).toHaveLength(1)
    expect(e.lines[0].label).toBe('Target revised')
    // The thing the record cannot prove must not appear anywhere in the output.
    expect(JSON.stringify(e)).not.toMatch(/→|->/)
  })

  it('leads with the thesis when several things moved at once', () => {
    const e = summariseEvolution([ev(['proposed_weight', 'target_price', 'rationale'], 2)])
    expect(e.lines.map(l => l.label)).toEqual([
      'Thesis updated', 'Target revised', 'Sizing revised',
    ])
  })

  it('keeps the most recent occurrence of a repeated change', () => {
    const e = summariseEvolution([ev(['target_price'], 3), ev(['target_price'], 40)])
    expect(e.lines).toHaveLength(1)
    expect(e.lines[0].at).toBe(at(3))
  })

  it('collapses the two thesis fields and the four sizing fields to one line each', () => {
    const e = summariseEvolution([ev(['rationale', 'thesis_text', 'proposed_weight', 'proposed_shares'], 1)])
    expect(e.lines.filter(l => l.label === 'Thesis updated')).toHaveLength(1)
    expect(e.lines.filter(l => l.label === 'Sizing revised')).toHaveLength(1)
  })

  it('ignores creation, which every idea has', () => {
    expect(summariseEvolution([ev(['stage', 'action'], 90, 'create')]).lines).toHaveLength(0)
  })

  it('ignores edits that are not investment changes', () => {
    expect(summariseEvolution([ev(['context_tags', 'sharing_visibility'], 1)]).lines).toHaveLength(0)
  })

  it('caps the strip at three lines', () => {
    const e = summariseEvolution([
      ev(['rationale', 'target_price', 'stage', 'proposed_weight', 'urgency'], 1),
    ])
    expect(e.lines.length).toBeLessThanOrEqual(3)
  })

  it('reports whether the written case moved, as its own fact', () => {
    expect(summariseEvolution([ev(['target_price'], 1)]).thesisChanged).toBe(false)
    expect(summariseEvolution([ev(['rationale'], 1)]).thesisChanged).toBe(true)
  })

  it('returns an empty summary for an idea nobody has revised', () => {
    expect(summariseEvolution([])).toEqual(NO_EVOLUTION)
  })
})

describe('unchangedThesisLine — both halves must be provable', () => {
  it('states the divergence when the view held and the price moved', () => {
    const e = summariseEvolution([ev(['target_price'], 5)])
    expect(unchangedThesisLine(e, 15.4)).toBe('Thesis unchanged · price +15%')
  })

  it('uses a real minus sign for a fall', () => {
    expect(unchangedThesisLine(NO_EVOLUTION, -22)).toBe('Thesis unchanged · price −22%')
  })

  it('says nothing when the thesis did move', () => {
    const e = summariseEvolution([ev(['rationale'], 3)])
    expect(unchangedThesisLine(e, 20)).toBeNull()
  })

  /** No anchored return means no claim — see idea-performance. */
  it('says nothing when there is no anchored return to quote', () => {
    expect(unchangedThesisLine(NO_EVOLUTION, null)).toBeNull()
  })

  it('says nothing about a move that is only noise', () => {
    expect(unchangedThesisLine(NO_EVOLUTION, 3)).toBeNull()
  })
})

describe('shortAge', () => {
  it('reads compactly at every scale a card shows', () => {
    expect(shortAge(at(0), NOW)).toBe('today')
    expect(shortAge(at(1), NOW)).toBe('yesterday')
    expect(shortAge(at(6), NOW)).toBe('6d ago')
    expect(shortAge(at(20), NOW)).toBe('2w ago')
    expect(shortAge(at(90), NOW)).toBe('3mo ago')
    expect(shortAge(at(400), NOW)).toBe('1y ago')
  })

  it('returns null rather than a placeholder for a missing or bad date', () => {
    expect(shortAge(null, NOW)).toBeNull()
    expect(shortAge('not-a-date', NOW)).toBeNull()
  })
})
