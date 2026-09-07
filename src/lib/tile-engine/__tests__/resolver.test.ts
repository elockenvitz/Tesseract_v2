/**
 * What the resolver actually decides, on the six canonical situations.
 *
 * The tests are written as product statements rather than as field assertions
 * wherever possible, because the thing worth protecting is the behaviour: a
 * briefing leads with the claim, discovery leads with the picture, a workbench
 * shows the corroboration, and nobody is asked to judge a name they do not
 * cover.
 */

import { describe, expect, it } from 'vitest'

import { composeSituations } from '../situation'
import { resolvePresentation, type PresentationRequest } from '../resolver'
import {
  ALL_CANONICAL, PANE, PHONE, SLIVER,
  coverageGap, decisionFollowup, dislocation, noCoreThesis,
  targetExpired, unreviewedMove,
} from './fixtures'
import type { SemanticFinding } from '../finding'

const PM = { canCommit: true, coverage: 'direct' as const }
const ANALYST = { canCommit: false, coverage: 'assigned' as const }

const situationOf = (f: SemanticFinding) => composeSituations([f])[0]

const plan = (
  f: SemanticFinding,
  over: Partial<Omit<PresentationRequest, 'situation'>> = {},
) => resolvePresentation({
  situation: situationOf(f),
  surface: 'mobile_brief',
  viewer: PM,
  container: PHONE,
  state: 'passive',
  ...over,
})

describe('predicate chooses the picture, not the kind', () => {
  it('an expired horizon draws a clock', () => {
    expect(plan(targetExpired()).visuals[0]?.primitive).toBe('timeline')
  })

  it('a price outside its band draws the band', () => {
    expect(plan(dislocation()).visuals[0]?.primitive).toBe('scenario_range')
  })

  it('an unreviewed move draws the move against the review', () => {
    expect(plan(unreviewedMove()).visuals[0]?.primitive).toBe('last_look')
  })

  it('an open loop draws the stages it is between', () => {
    expect(plan(decisionFollowup()).visuals[0]?.primitive).toBe('workflow')
  })

  /**
   * Two unrelated domains, one shape of claim, one treatment — and neither
   * builder ever named the primitive. This is the architecture working.
   */
  it('a missing thesis and an unassigned position share no code and no kind', () => {
    const thesis = plan(noCoreThesis())
    const coverage = plan(coverageGap())
    expect(thesis.visuals[0]?.primitive).toBe('target_compare')
    expect(coverage.visuals[0]?.primitive).toBe('exposure')
    // Same structural family: both are absences, neither plots a series.
    expect(thesis.space.requirement.visual?.min)
      .toBeLessThan(300)
    expect(coverage.space.requirement.visual?.min)
      .toBeLessThan(300)
  })

  it('a band claim with no band falls back rather than drawing an empty axis', () => {
    const f = dislocation()
    const stripped: SemanticFinding = { ...f, claim: { ...f.claim, band: null } }
    expect(plan(stripped).visuals[0]?.primitive).toBe('target_compare')
  })
})

describe('surface changes the plan, not the finding', () => {
  const f = dislocation()

  it('the briefing leads with the claim', () => {
    const p = plan(f, { surface: 'mobile_brief' })
    expect(p.hierarchy.lead).toBe('claim')
    expect(p.space.density).toBe('standard')
  })

  it('discovery leads with the picture and asks nothing', () => {
    const p = plan(f, { surface: 'explore' })
    expect(p.hierarchy.lead).toBe('evidence')
    expect(p.hierarchy.order).not.toContain('prompt')
    expect(p.actions.primary.intent).toBe('inspect_subject')
    expect(p.space.density).toBe('compact')
  })

  it('the workbench shows the corroboration a briefing hides', () => {
    // Two findings on the same name asking the same question: one situation
    // with real corroboration behind it.
    const many = composeSituations([
      targetExpired(),
      { ...targetExpired(), id: 'target_expired:a-msft:2', severity: 'informational' as const },
    ]).find(s => s.supporting.length > 0)
    expect(many).toBeDefined()

    const bench = resolvePresentation({
      situation: many!, surface: 'desktop_workbench', viewer: PM,
      container: PANE, state: 'passive',
    })
    const brief = resolvePresentation({
      situation: many!, surface: 'mobile_brief', viewer: PM,
      container: PHONE, state: 'passive',
    })

    expect(bench.hierarchy.order).toContain('corroboration')
    expect(brief.hierarchy.order).not.toContain('corroboration')
    expect(bench.space.density).toBe('expanded')
  })

  it('one finding produces three different plans and stays one finding', () => {
    const surfaces = ['mobile_brief', 'explore', 'desktop_workbench'] as const
    const plans = surfaces.map(surface => plan(f, {
      surface, container: surface === 'desktop_workbench' ? PANE : PHONE,
    }))
    const leads = new Set(plans.map(p => p.hierarchy.lead))
    const densities = new Set(plans.map(p => p.space.density))
    expect(densities.size).toBe(3)
    expect(leads.size).toBeGreaterThan(1)
    for (const p of plans) expect(p.situationId).toBe(plans[0].situationId)
  })
})

describe('the reader changes the plan', () => {
  it('a reader who does not cover the name is shown it, never asked', () => {
    const p = plan(dislocation(), {
      viewer: { canCommit: true, coverage: 'none' },
    })
    expect(p.hierarchy.order).not.toContain('prompt')
    expect(p.rationale.join(' ')).toContain('does not cover')
  })

  it('a reader who cannot commit keeps the action, in the menu', () => {
    const p = plan(targetExpired(), { viewer: ANALYST })
    const revise = [p.actions.primary, ...p.actions.secondary]
      .find(a => a.intent === 'revise_price_objective')
    expect(revise, 'the action is still offered').toBeDefined()
    expect(revise!.placement).toBe('menu')
    // Nothing disappears and nothing redirects: the primary is simply the
    // first thing this reader can actually finish.
    expect(p.actions.primary.intent).not.toBe('revise_price_objective')
  })

  it('a PM gets the committing action inline', () => {
    const p = plan(targetExpired(), { viewer: PM })
    expect(p.actions.primary.intent).toBe('revise_price_objective')
    expect(p.actions.primary.placement).toBe('inline')
  })
})

describe('active and passive', () => {
  const f = targetExpired()

  it('a passive card reserves no control band and stays viewport-composed', () => {
    const p = plan(f, { state: 'passive' })
    expect(p.space.requirement.controlRows).toBe(0)
    expect(p.space.requirement.hasDetailRegion).toBe(false)
    expect(p.space.requirement.workflow).toBe('passive')
    expect(p.space.resolved!.height).toBeLessThanOrEqual(PHONE.height)
  })

  /**
   * An engaged card is not a feed slot.
   *
   * The reader has opened it, so it gets the room the shell actually gives an
   * open card. Resolving an active plan against the 590px resting slot is what
   * produced a plan that budgeted a detail region and then shed its own
   * question to pay for it — honest arithmetic against the wrong canvas.
   */
  const OPENED = { width: 390, height: 820 }

  it('an active card earns the controls and asks its question', () => {
    const p = plan(f, { state: 'active', container: OPENED })
    expect(p.space.requirement.controlRows).toBe(1)
    expect(p.space.requirement.hasDetailRegion).toBe(true)
    expect(p.hierarchy.order).toContain('prompt')
  })

  it('an active plan resolved against a resting slot sheds rather than clips', () => {
    const p = plan(f, { state: 'active', container: PHONE })
    expect(p.space.degraded.length).toBeGreaterThan(0)
    expect(p.space.resolved!.height).toBeLessThanOrEqual(PHONE.height)
  })
})

describe('space is a real input', () => {
  it('a plan sheds regions in the declared order rather than clipping', () => {
    const p = plan(dislocation(), { container: SLIVER })
    expect(p.space.degraded.length).toBeGreaterThan(0)
    // Corroboration and context go before the picture does.
    const evidenceIdx = p.space.degraded.indexOf('evidence')
    const contextIdx = p.space.degraded.indexOf('context')
    if (evidenceIdx >= 0 && contextIdx >= 0) {
      expect(contextIdx).toBeLessThan(evidenceIdx)
    }
  })

  it('the claim and the actions are never shed', () => {
    const p = plan(dislocation(), { container: SLIVER })
    expect(p.hierarchy.order).toContain('claim')
    expect(p.hierarchy.order).toContain('actions')
    expect(p.space.degraded).not.toContain('claim')
    expect(p.space.degraded).not.toContain('actions')
  })

  it('a plan with no container claims no height', () => {
    const p = plan(dislocation(), { container: null })
    expect(p.space.resolved).toBeNull()
    expect(p.space.degraded).toEqual([])
  })

  it('the same content is taller on a narrower phone', () => {
    const narrow = plan(dislocation(), { container: { width: 320, height: 900 } })
    const wide = plan(dislocation(), { container: { width: 430, height: 900 } })
    expect(narrow.space.resolved!.claimLines)
      .toBeGreaterThanOrEqual(wide.space.resolved!.claimLines)
  })
})

describe('determinism', () => {
  it('identical requests produce deeply equal plans', () => {
    for (const f of ALL_CANONICAL()) {
      const a = plan(f)
      const b = plan(f)
      expect(a).toEqual(b)
    }
  })

  it('every canonical situation resolves to a usable plan', () => {
    for (const f of ALL_CANONICAL()) {
      const p = plan(f)
      expect(p.hierarchy.order[0]).toBe('claim')
      expect(p.hierarchy.order).toContain('actions')
      expect(p.actions.primary.intent).toBeTruthy()
      expect(p.question.prompt.endsWith('?')).toBe(true)
      expect(p.rationale.length).toBeGreaterThan(0)
    }
  })
})
