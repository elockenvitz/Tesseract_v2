import { describe, it, expect } from 'vitest'
import { insightPanePlan } from '../pane-plan'

describe('insightPanePlan', () => {
  it('always gives an insight entry a case pane', () => {
    /**
     * The invariant the gallery got wrong. Its capital fixtures mounted a
     * plain card with no panes at all, which the feed cannot produce — so
     * those fixtures measured 19-35% ink and sent a density stage chasing a
     * hole that does not ship.
     */
    for (const framing of ['no_case', 'incomplete_case', 'long_silence', 'new_evidence'] as const) {
      const plan = insightPanePlan({ framing, hasCapital: false, evidenceCount: 0 })
      expect(plan.order, framing).toContain('case')
      expect(plan.guaranteed, framing).toContain('case')
    }
  })

  it('leads with the case when capital is the finding', () => {
    // On an unwritten position nothing happened to the price, so opening onto
    // a chart answers a question the reader did not ask.
    const withCapital = insightPanePlan({ framing: 'no_case', hasCapital: true, evidenceCount: 0 })
    expect(withCapital.caseLeads).toBe(true)
    expect(withCapital.order[0]).toBe('case')

    const without = insightPanePlan({ framing: 'long_silence', hasCapital: false, evidenceCount: 0 })
    expect(without.caseLeads).toBe(false)
    expect(without.order.indexOf('case')).toBeGreaterThan(without.order.indexOf('price'))
  })

  it('gives a judgment region only to a framing that wants one', () => {
    // The two authoring framings ask the reader to write, not to judge.
    for (const framing of ['no_case', 'incomplete_case'] as const) {
      expect(insightPanePlan({ framing, hasCapital: false, evidenceCount: 0 }).order, framing)
        .not.toContain('judgment')
    }
    for (const framing of ['long_silence', 'new_evidence'] as const) {
      expect(insightPanePlan({ framing, hasCapital: false, evidenceCount: 1 }).order, framing)
        .toContain('judgment')
    }
  })

  it('gives an evidence pane only when there is evidence to review', () => {
    expect(insightPanePlan({ framing: 'new_evidence', hasCapital: false, evidenceCount: 2 }).order[0])
      .toBe('evidence')
    expect(insightPanePlan({ framing: 'new_evidence', hasCapital: false, evidenceCount: 0 }).order)
      .not.toContain('evidence')
    // Evidence belongs to its own framing; another framing carrying arrivals
    // does not grow the pane.
    expect(insightPanePlan({ framing: 'long_silence', hasCapital: false, evidenceCount: 3 }).order)
      .not.toContain('evidence')
  })

  it('never promises the price pane', () => {
    /**
     * The honest exception, and the reason `guaranteed` is separate from
     * `order`. The framing can want a tape and the pane can still be absent:
     * `pricePane` returns null for a symbol that does not resolve, and the
     * series loads after mount. Anything reserving SPACE must read
     * `guaranteed`; anything COMPOSING reads `order`.
     */
    const plan = insightPanePlan({ framing: 'long_silence', hasCapital: false, evidenceCount: 0 })
    expect(plan.order).toContain('price')
    expect(plan.guaranteed).not.toContain('price')
    // Every guaranteed pane is one the feed will actually mount.
    expect(plan.guaranteed.length).toBe(plan.order.length - 1)
  })
})
