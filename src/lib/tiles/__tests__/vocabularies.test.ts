import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { EvidenceKind } from '../../signals/contract'
import type { ExploreVisual } from '../../mobile/explore-visual'
import type { TodayArchetype } from '../../today/types'
import type { VisualIntent } from '../presentation'
import {
  intentFromEvidenceKind,
  intentFromExploreVisual,
  intentFromIdeaVisualKind,
  intentFromTodayArchetype,
  roleFromDesktopTileSize,
  roleFromExploreCardSize,
  roleFromIdeaDensity,
  visualSizeForDensity,
  type IdeaVisualKindLike,
} from '../vocabularies'

/**
 * The four dialects, and whether they are actually saying the same things.
 *
 * The contract is only worth having if the vocabularies already in the repo
 * collapse onto it without loss that anybody would notice. These tests are the
 * evidence for that claim, and the exhaustive lists below are what makes them
 * fail when a surface adds a member and forgets to say what question it
 * answers.
 */

const EXPLORE_KINDS: ExploreVisual['kind'][] = [
  'scenario_range', 'target_compare', 'timeline', 'exposure', 'comparison',
  'last_look', 'workflow', 'quote', 'price_trend', 'none',
]

const EVIDENCE_KINDS: EvidenceKind[] = [
  'none', 'sparkline', 'peer_bar', 'timeline', 'scenario_ladder',
]

const TODAY_ARCHETYPES: TodayArchetype[] = [
  'exposure', 'aging', 'transition', 'expected-return', 'review-window',
  'scenario', 'metrics',
]

const IDEA_KINDS: IdeaVisualKindLike[] = [
  'range', 'target', 'sizing', 'since', 'exposure', 'cases', 'gap',
]

describe('every dialect maps totally', () => {
  it('answers for every Explore archetype', () => {
    for (const k of EXPLORE_KINDS) expect(intentFromExploreVisual(k)).toBeTruthy()
  })
  it('answers for every evidence kind', () => {
    for (const k of EVIDENCE_KINDS) expect(intentFromEvidenceKind(k)).toBeTruthy()
  })
  it('answers for every Today archetype', () => {
    for (const k of TODAY_ARCHETYPES) expect(intentFromTodayArchetype(k)).toBeTruthy()
  })
  it('answers for every Ideas visual kind', () => {
    for (const k of IDEA_KINDS) expect(intentFromIdeaVisualKind(k)).toBeTruthy()
  })
})

describe('the four names for one question', () => {
  it('reconciles case vs price', () => {
    // The finding this whole stage is about: four surfaces, four spellings.
    expect(intentFromExploreVisual('scenario_range')).toBe('case_vs_price')
    expect(intentFromEvidenceKind('scenario_ladder')).toBe('case_vs_price')
    expect(intentFromTodayArchetype('scenario')).toBe('case_vs_price')
    expect(intentFromIdeaVisualKind('range')).toBe('case_vs_price')
  })

  it('reconciles a weight against another weight', () => {
    expect(intentFromExploreVisual('comparison')).toBe('weight_comparison')
    expect(intentFromEvidenceKind('peer_bar')).toBe('weight_comparison')
    expect(intentFromIdeaVisualKind('sizing')).toBe('weight_comparison')
  })

  it('keeps a single weight against a book separate from a pair of weights', () => {
    expect(intentFromExploreVisual('exposure')).toBe('portfolio_weight')
    expect(intentFromTodayArchetype('exposure')).toBe('portfolio_weight')
    expect(intentFromIdeaVisualKind('exposure')).toBe('portfolio_weight')
    expect(intentFromExploreVisual('exposure'))
      .not.toBe(intentFromExploreVisual('comparison'))
  })

  it('reconciles a price path across its four names', () => {
    expect(intentFromExploreVisual('price_trend')).toBe('price_path')
    expect(intentFromExploreVisual('last_look')).toBe('price_path')
    expect(intentFromEvidenceKind('sparkline')).toBe('price_path')
    expect(intentFromTodayArchetype('review-window')).toBe('price_path')
    expect(intentFromIdeaVisualKind('since')).toBe('price_path')
  })

  it('does not put a price path under a clock', () => {
    // `aging` and `review-window` sit next to each other in Today and answer
    // different questions. Mapping on the word "window" would draw a price
    // line where the claim is that time has passed.
    expect(intentFromTodayArchetype('aging')).toBe('elapsed_time')
    expect(intentFromTodayArchetype('review-window')).toBe('price_path')
  })

  it('treats a quote as typography rather than as a geometry', () => {
    expect(intentFromExploreVisual('quote')).toBe('none')
    expect(intentFromExploreVisual('none')).toBe('none')
    expect(intentFromTodayArchetype('metrics')).toBe('none')
    expect(intentFromEvidenceKind('none')).toBe('none')
  })
})

describe('every intent earns its place', () => {
  it('has at least two independent implementations behind it', () => {
    // One vocabulary counts once, however many of its members land here.
    // `evidence_gap` is the exception the contract documents: two distinct
    // primitives in one surface, `CasesUnpriced` and `ModelGap`.
    const sources = new Map<VisualIntent, Set<string>>()
    const add = (i: VisualIntent, dialect: string) => {
      const s = sources.get(i) ?? new Set<string>()
      s.add(dialect)
      sources.set(i, s)
    }

    for (const k of EXPLORE_KINDS) add(intentFromExploreVisual(k), 'explore')
    for (const k of EVIDENCE_KINDS) add(intentFromEvidenceKind(k), 'evidence')
    for (const k of TODAY_ARCHETYPES) add(intentFromTodayArchetype(k), 'today')
    for (const k of IDEA_KINDS) add(intentFromIdeaVisualKind(k), 'ideas')

    // Every intent the contract declares is reachable from real code.
    const declared: VisualIntent[] = [
      'case_vs_price', 'target_distance', 'elapsed_time', 'portfolio_weight',
      'weight_comparison', 'price_path', 'workflow_state', 'evidence_gap', 'none',
    ]
    expect([...sources.keys()].sort()).toEqual([...declared].sort())

    for (const intent of declared) {
      const dialects = sources.get(intent)!
      if (intent === 'evidence_gap') {
        // Two primitives, one surface. The weakest member, kept deliberately.
        expect([...dialects]).toEqual(['ideas'])
        expect(IDEA_KINDS.filter(k => intentFromIdeaVisualKind(k) === 'evidence_gap'))
          .toEqual(['cases', 'gap'])
      } else {
        expect(dialects.size, `${intent} needs two surfaces`).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

describe('the role dialects', () => {
  it('collapses all three size vocabularies onto the same three bands', () => {
    expect(roleFromIdeaDensity('featured')).toBe('lead')
    expect(roleFromDesktopTileSize('hero')).toBe('lead')
    expect(roleFromExploreCardSize('feature')).toBe('lead')

    expect(roleFromIdeaDensity('compact')).toBe('compact')
    expect(roleFromDesktopTileSize('compact')).toBe('compact')
    expect(roleFromExploreCardSize('compact')).toBe('compact')
  })

  it('reads DesktopTile large as second place, not as the lead', () => {
    // Its own comment: "large gives second place visible second place".
    expect(roleFromDesktopTileSize('large')).toBe('standard')
    expect(roleFromDesktopTileSize('medium')).toBe('standard')
  })

  it('drives the one primitive scale that already accepts a size', () => {
    // `RangeChart`, `TargetBar`, `SizingBar`, `SinceOpen`, `ExposureRank`,
    // `CasesUnpriced` and `ModelGap` all take `size?: VisualSize` today.
    expect(visualSizeForDensity('spacious')).toBe('lg')
    expect(visualSizeForDensity('standard')).toBe('md')
    expect(visualSizeForDensity('compact')).toBe('sm')
  })
})

describe('the restated Ideas union stays in step with the real one', () => {
  it('matches the declaration in IdeaCard.tsx', () => {
    // `IdeaVisualKind` cannot be imported here: its module reaches React, and
    // `gallery-purity.mjs` walks that graph. Pinned against the source instead,
    // the way IdeasWorkspace.test.tsx already pins `PLOT`.
    // Newlines normalised: the working tree checks out CRLF on Windows, and a
    // blank-line terminator written as `\n\n` silently never matches there —
    // the slice then runs on to the end of the file and the test fails with a
    // diff about `thesis_forming` rather than about the union.
    const card = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
      .replace(/\r\n/g, '\n')

    const decl = card.slice(card.indexOf('export type IdeaVisualKind'))
    const members = decl
      .slice(0, decl.indexOf('\n\n'))
      .match(/'([a-z_]+)'/g)!
      .map(m => m.replace(/'/g, ''))

    expect([...members].sort()).toEqual([...IDEA_KINDS].sort())
  })
})
