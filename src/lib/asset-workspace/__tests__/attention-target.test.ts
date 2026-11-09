import { describe, it, expect } from 'vitest'
import { attentionTarget } from '../attention-target'

describe('attentionTarget — focus maps to existing navigation, never a silent redirect', () => {
  it('opens Decisions scoped to the request book, at Open Items', () => {
    expect(attentionTarget('decisions', { kind: 'decision', decisionIds: ['d1', 'd2'], portfolioId: 'pf-1' }))
      .toEqual({ subPage: 'decisions', decisionsBook: 'pf-1', openItems: true })
  })
  it('scopes to every book when the request names none', () => {
    expect(attentionTarget('decisions', { kind: 'decision', decisionIds: ['d1'], portfolioId: null }))
      .toEqual({ subPage: 'decisions', decisionsBook: null, openItems: true })
  })

  it('opens the exact research anchor for a section signal', () => {
    expect(attentionTarget('research', { kind: 'research-section', anchor: 'thesis' }))
      .toEqual({ subPage: 'research', researchMode: 'all', anchor: 'thesis' })
    expect(attentionTarget('research', { kind: 'research-section', anchor: 'targets' }))
      .toEqual({ subPage: 'research', researchMode: 'all', anchor: 'targets' })
  })

  it('opens the references/evidence view for new evidence', () => {
    expect(attentionTarget('research', { kind: 'research-evidence' }))
      .toEqual({ subPage: 'research', researchMode: 'references' })
  })

  it('falls back to the nearest truthful context for coverage, and marks it approximate', () => {
    const t = attentionTarget('workflow', { kind: 'coverage' })
    expect(t.subPage).toBe('snapshot')
    expect(t.approximate).toBe(true)
  })

  it('uses the signal’s own page when there is no precise focus (no unrelated redirect)', () => {
    expect(attentionTarget('research', undefined)).toEqual({ subPage: 'research' })
    expect(attentionTarget('decisions', undefined)).toEqual({ subPage: 'decisions' })
  })
})
