import { describe, it, expect } from 'vitest'

import { exploreVisualFor } from '../../mobile/explore-visual'
import { scoreExplore } from '../../mobile/explore-compose'
import type { ExploreItem, ExploreSubtype } from '../../mobile/explore-item'
import type { ExploreVisualData } from '../../mobile/explore-visual'
import {
  densityForRole,
  intentNeedsWidth,
  resolveTilePresentation,
  type TileRole,
  type TileSubject,
  type TileSurface,
} from '../presentation'
import { intentFromExploreVisual } from '../vocabularies'

/**
 * Can a finding keep its meaning while changing its appearance?
 *
 * The tests below all run on ONE real finding rather than on a fixture built
 * to suit them: a scenario breach on a held name, shaped exactly as the
 * Explore adapters shape it, carrying the modelled ladder and the mark. It is
 * the case the whole "living interface" idea rests on — it has a rich picture,
 * it is material, and it is the finding that currently gets drawn four
 * different ways under four different names.
 *
 * If presentation and semantics are genuinely separable, then everything the
 * app decides ABOUT this finding — what question it answers, which object it
 * is, where it ranks — must be identical whether it is a lead card on a phone
 * or a cell in a desktop grid.
 */

/** A scenario breach on a 6.2% position: the price is above the bull case. */
function breachOnHeldName(): ExploreItem & { visual: ExploreVisualData } {
  return {
    id: 'sig-nvda-breach-2026-09',
    dedupeKey: 'scenario_gap:nvda:2026-W36',
    signalType: 'scenario_gap',
    objectId: 'asset-nvda',
    category: 'decisions',
    subtype: 'signal' as ExploreSubtype,
    title: 'NVDA is above your bull case',
    context: '6.2% of Growth',
    symbol: 'NVDA',
    assetId: 'asset-nvda',
    metric: { value: '+14%', label: 'past bull', direction: 'bad' },
    portfolio: { weightPct: 6.2, name: 'Growth' },
    occurredAt: '2026-09-01T13:30:00.000Z',
    importance: 0.82,
    destination: { kind: 'action', action: 'open_asset', assetId: 'asset-nvda', symbol: 'NVDA' },
    visual: {
      cases: [
        { label: 'Bear', price: 82 },
        { label: 'Base', price: 118 },
        { label: 'Bull', price: 141 },
      ],
      currentPrice: 161,
    },
  }
}

/** The engagement seam's subject shape, for the same object. */
const SUBJECT: TileSubject = { objectType: 'asset', objectId: 'asset-nvda' }

const SURFACES: TileSurface[] = [
  'mobile_feed', 'mobile_grid', 'desktop_today', 'desktop_workspace',
]

describe('A — one finding, several presentation roles', () => {
  it('presents the same breach as lead, standard and compact', () => {
    const item = breachOnHeldName()
    const intent = intentFromExploreVisual(exploreVisualFor(item).kind)

    const roles: TileRole[] = ['lead', 'standard', 'compact']
    const shown = roles.map(role => resolveTilePresentation({
      subject: SUBJECT, intent, role, surface: 'desktop_workspace',
    }))

    // Three genuinely different presentations...
    expect(shown.map(p => p.role)).toEqual(['lead', 'standard', 'compact'])
    expect(shown.map(p => p.density)).toEqual(['spacious', 'standard', 'compact'])
    // ...of one question.
    expect(new Set(shown.map(p => p.intent))).toEqual(new Set(['case_vs_price']))
  })

  it('does not need a second finding to produce a second presentation', () => {
    // The same object literal, presented twice. If role were a property of the
    // finding rather than of the request, one of these would have to change
    // the item to get a different answer.
    const item = breachOnHeldName()
    const intent = intentFromExploreVisual(exploreVisualFor(item).kind)
    const before = JSON.stringify(item)

    resolveTilePresentation({ subject: SUBJECT, intent, role: 'lead', surface: 'mobile_feed' })
    resolveTilePresentation({ subject: SUBJECT, intent, role: 'compact', surface: 'mobile_grid' })

    expect(JSON.stringify(item)).toBe(before)
  })
})

describe('B — role does not change domain identity', () => {
  it('keeps the subject identical across every role and surface', () => {
    const item = breachOnHeldName()
    const intent = intentFromExploreVisual(exploreVisualFor(item).kind)

    const subjects = SURFACES.flatMap(surface =>
      (['lead', 'standard', 'compact'] as TileRole[]).map(role =>
        resolveTilePresentation({ subject: SUBJECT, intent, role, surface }).subject))

    expect(subjects).toHaveLength(12)
    for (const s of subjects) expect(s).toEqual(SUBJECT)
  })

  it('identifies the object by type and id, never by ticker or title', () => {
    // Two findings about NVDA that are not the same object. A presentation
    // keyed on the symbol would collapse them; `explore-match` records that
    // exact failure for posts on one name.
    const asset: TileSubject = { objectType: 'asset', objectId: 'asset-nvda' }
    const idea: TileSubject = { objectType: 'trade_idea', objectId: 'idea-nvda-trim' }

    const a = resolveTilePresentation({
      subject: asset, intent: 'case_vs_price', role: 'lead', surface: 'desktop_today' })
    const b = resolveTilePresentation({
      subject: idea, intent: 'case_vs_price', role: 'lead', surface: 'desktop_today' })

    // Same question, same room, different objects — and they stay different.
    expect(a.intent).toBe(b.intent)
    expect(a.role).toBe(b.role)
    expect(a.subject).not.toEqual(b.subject)
  })

  it('accepts a null subject rather than inventing an id for an aggregate', () => {
    const p = resolveTilePresentation({
      subject: null, intent: 'none', role: 'lead', surface: 'mobile_grid' })
    expect(p.subject).toBeNull()
  })
})

describe('C — intent is independent of geometry and density', () => {
  it('answers the same question at every density', () => {
    const intents = (['lead', 'standard', 'compact'] as TileRole[]).map(role =>
      resolveTilePresentation({
        subject: SUBJECT, intent: 'case_vs_price', role, surface: 'desktop_workspace',
      }).intent)

    expect(intents).toEqual(['case_vs_price', 'case_vs_price', 'case_vs_price'])
  })

  it('lets density come apart from role, which is the aggregate-banner case', () => {
    // `exploreCardHeight` gives an aggregate the full width and the shortest
    // body: "the two are independent decisions and this is the one case where
    // they come apart". Expressible only if density is not derived from role.
    const banner = resolveTilePresentation({
      subject: null, intent: 'none', role: 'lead', surface: 'mobile_grid', density: 'compact',
    })

    expect(banner.role).toBe('lead')
    expect(banner.density).toBe('compact')
    expect(banner.density).not.toBe(densityForRole(banner.role))
  })

  it('makes width a property of the question, not of the surface or the role', () => {
    // The three `visualNeedsWidth` names. A range bar is illegible narrow
    // wherever it is drawn, and a single exposure bar is fine narrow anywhere.
    for (const surface of SURFACES) {
      for (const role of ['lead', 'standard', 'compact'] as TileRole[]) {
        expect(resolveTilePresentation({
          subject: SUBJECT, intent: 'case_vs_price', role, surface }).needsWidth).toBe(true)
        expect(resolveTilePresentation({
          subject: SUBJECT, intent: 'portfolio_weight', role, surface }).needsWidth).toBe(false)
      }
    }

    expect(intentNeedsWidth('elapsed_time')).toBe(true)
    expect(intentNeedsWidth('weight_comparison')).toBe(true)
    expect(intentNeedsWidth('price_path')).toBe(false)
  })
})

describe('D — presentation varies by surface, ranking does not', () => {
  it('gives the same finding a different density on each surface', () => {
    const compactEverywhere = SURFACES.map(surface => resolveTilePresentation({
      subject: SUBJECT, intent: 'case_vs_price', role: 'compact', surface,
    }))

    // The Curate feed has no compact tier — every card is `h-full`. The other
    // three do, so the identical request lands differently.
    expect(compactEverywhere.map(p => `${p.surface}:${p.density}`)).toEqual([
      'mobile_feed:standard',
      'mobile_grid:compact',
      'desktop_today:compact',
      'desktop_workspace:compact',
    ])
  })

  it('raises an explicit density to the surface floor too', () => {
    const p = resolveTilePresentation({
      subject: SUBJECT, intent: 'case_vs_price', role: 'lead',
      surface: 'mobile_feed', density: 'compact',
    })
    expect(p.density).toBe('standard')
  })

  it('never lets a presentation change move the finding up or down the page', () => {
    // `scoreExplore` is the real Explore ranker. Presenting the finding four
    // ways must not perturb the score, because the score reads only domain
    // fields and presentation writes none of them.
    const item = breachOnHeldName()
    const now = Date.parse('2026-09-02T09:00:00.000Z')
    const before = scoreExplore(item, now)

    for (const surface of SURFACES) {
      for (const role of ['lead', 'standard', 'compact'] as TileRole[]) {
        resolveTilePresentation({
          subject: SUBJECT,
          intent: intentFromExploreVisual(exploreVisualFor(item).kind),
          role,
          surface,
        })
      }
    }

    expect(scoreExplore(item, now)).toBe(before)
    expect(before).toBeGreaterThan(0)
  })

  it('reads the same intent off the finding whatever surface asks', () => {
    // The resolver is handed an intent; the intent itself comes from the
    // finding. Nothing in that path consults the surface.
    const item = breachOnHeldName()
    const kinds = SURFACES.map(() => exploreVisualFor(item).kind)
    expect(new Set(kinds)).toEqual(new Set(['scenario_range']))
    expect(intentFromExploreVisual('scenario_range')).toBe('case_vs_price')
  })
})

describe('the resolver itself', () => {
  it('is pure and total — same request, same answer', () => {
    const req = {
      subject: SUBJECT, intent: 'target_distance' as const,
      role: 'standard' as const, surface: 'desktop_today' as const,
    }
    expect(resolveTilePresentation(req)).toEqual(resolveTilePresentation(req))
  })

  it('carries no geometry — no pixels, no class names', () => {
    const p = resolveTilePresentation({
      subject: SUBJECT, intent: 'case_vs_price', role: 'lead', surface: 'desktop_workspace' })
    const serialised = JSON.stringify(p)

    // A presentation that named a height or a Tailwind span would have put the
    // coupling back one layer down.
    expect(serialised).not.toMatch(/px|col-span|h-\[|text-\[/)
    expect(Object.keys(p).sort()).toEqual(
      ['density', 'intent', 'needsWidth', 'role', 'subject', 'surface'])
  })
})
