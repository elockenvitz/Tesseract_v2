import { describe, it, expect } from 'vitest'

import {
  deriveScenarioState, groupCases, moveLabel, moveFrom, scenarioLanguage,
} from '../scenario-state'

/**
 * The semantics the Case-vs-Price tile rests on.
 *
 * Every case here corresponds to something the card said wrongly: it named one
 * case on a ladder that was breached end to end, it printed two dots at one
 * coordinate, it called an unweighted mean an expected value, and it labelled a
 * +128% move "Downside".
 */

const c = (name: string, price: number, probability: number | null = null, timeframe: string | null = null) =>
  ({ name, price, probability, timeframe })

/** The production ladder this pass was written against. */
const GOOGL = [c('Bear', 800), c('Base', 800), c('Bull', 1605)]

describe('where the price sits, relative to the whole ladder', () => {
  it('says below ALL cases when the price is under the cheapest', () => {
    // The card only fires in this state, so naming a single case always
    // understated it — and on a ladder with a tie it named whichever sorted
    // first, which is an accident of insertion order.
    const s = deriveScenarioState(350.75, GOOGL)!
    expect(s.position).toBe('below_all')
    expect(scenarioLanguage(350.75, s, 'GOOGL').headline)
      .toBe('GOOGL is trading below every case you modelled')
  })

  it('compares the hero figure to the LOWEST case, not to a case named Base', () => {
    const s = deriveScenarioState(350.75, GOOGL)!
    const lang = scenarioLanguage(350.75, s, 'GOOGL')
    expect(lang.metricLabel).toBe('Below your lowest case of $800')
    // 350.75 → 800 is 56% below 800.
    expect(lang.metricValue).toBe('56%')
  })

  it('uses the inverse language above every case', () => {
    const s = deriveScenarioState(2000, GOOGL)!
    expect(s.position).toBe('above_all')
    const lang = scenarioLanguage(2000, s, 'GOOGL')
    expect(lang.headline).toBe('GOOGL is trading above every case you modelled')
    expect(lang.metricLabel).toBe('Above your highest case of $1605')
    expect(lang.direction).toBe('good')
  })

  it('does not claim the framework is breached from inside it', () => {
    // Below the bull but above the bear. True, ordinary, and NOT a card today —
    // the copy exists so a caller rendering this state is not left with
    // below-all language on an intact ladder.
    const s = deriveScenarioState(900, GOOGL)!
    expect(s.position).toBe('below_middle')
    const lang = scenarioLanguage(900, s, 'GOOGL')
    expect(lang.headline).not.toMatch(/every case/)
    expect(lang.headline).toMatch(/between/)
    expect(lang.summary).toBe('The price is inside the range you modelled.')
  })

  it('needs two cases to be a ladder at all', () => {
    expect(deriveScenarioState(100, [c('Base', 200)])).toBeNull()
  })
})

describe('cases that share a price are one point on the ladder', () => {
  it('groups them under a joint label rather than stacking two dots', () => {
    const s = deriveScenarioState(350.75, GOOGL)!
    expect(s.groups).toHaveLength(2)
    expect(s.groups[0].label).toBe('Bear / Base')
    expect(s.groups[0].price).toBe(800)
    expect(s.groups[1].label).toBe('Bull')
  })

  it('keeps both cases reachable inside the group', () => {
    // The ladder collapses the COORDINATE, never the cases: horizons and
    // reasoning still differ, so the case list shows them separately.
    const s = deriveScenarioState(350.75, GOOGL)!
    expect(s.groups[0].cases.map(x => x.name)).toEqual(['Bear', 'Base'])
    expect(s.sorted).toHaveLength(3)
  })

  it('treats prices within half a cent as the same point', () => {
    const g = groupCases([c('Bear', 800), c('Base', 800.004), c('Bull', 1605)])
    expect(g).toHaveLength(2)
  })

  it('leaves genuinely different prices apart', () => {
    const g = groupCases([c('Bear', 800), c('Base', 810), c('Bull', 1605)])
    expect(g.map(x => x.label)).toEqual(['Bear', 'Base', 'Bull'])
  })
})

describe('an average is not an expectation', () => {
  it('computes no expected value without probabilities', () => {
    const s = deriveScenarioState(350.75, GOOGL)!
    expect(s.expectedValue).toBeNull()
    expect(s.hasUsableProbabilities).toBe(false)
  })

  it('still offers the plain mean, named for what it is', () => {
    // Worth showing — it is the ladder's midpoint — and never under the words
    // "expected value", which is a claim about likelihood nobody has made.
    const s = deriveScenarioState(350.75, GOOGL)!
    expect(s.caseAverage).toBeCloseTo((800 + 800 + 1605) / 3, 4)
  })

  it('weights it properly when the probabilities are a distribution', () => {
    const s = deriveScenarioState(350.75, [
      c('Bear', 800, 25, '12 months'),
      c('Bull', 1600, 75, '12 months'),
    ])!
    expect(s.hasUsableProbabilities).toBe(true)
    expect(s.expectedValue).toBeCloseTo(800 * 0.25 + 1600 * 0.75, 4)
    // And it is NOT the unweighted mean, which is the whole point.
    expect(s.expectedValue).not.toBeCloseTo(s.caseAverage, 1)
  })

  it('refuses to normalise weights that are not a distribution', () => {
    // Summing to 125 is the analyst's own numbers being inconsistent. Scaling
    // them would make the fair-value claim unfalsifiable.
    const s = deriveScenarioState(350.75, [
      c('Bear', 800, 50, '12 months'),
      c('Bull', 1600, 75, '12 months'),
    ])!
    expect(s.expectedValue).toBeNull()
    expect(s.expectedBlockedBy).toBe('Probabilities sum to 125%')
  })

  it('refuses to average across horizons', () => {
    // A 6-month bear and a 12-month bull are not competing outcomes of one
    // question, so weighting them produces a number describing no point in time.
    const s = deriveScenarioState(350.75, [
      c('Bear', 800, 40, '6 months'),
      c('Bull', 1600, 60, '12 months'),
    ])!
    expect(s.expectedValue).toBeNull()
    expect(s.expectedBlockedBy).toMatch(/Mixed horizons/)
  })
})

describe('upside and downside follow the geometry, not the case name', () => {
  it('calls a bear case above the price upside', () => {
    // GOOGL at $350.75 against a bear at $800: every modelled outcome is a
    // gain, and the tile read "Downside −128%" — the wrong word and the wrong
    // sign on the same figure.
    expect(moveLabel(350.75, 800)).toBe('Upside')
    expect(moveFrom(350.75, 800)).toBeCloseTo(128.1, 0)
  })

  it('still calls a case below the price downside', () => {
    expect(moveLabel(900, 800)).toBe('Downside')
    expect(moveFrom(900, 800)).toBeLessThan(0)
  })

  it('knows when every case is on one side', () => {
    expect(deriveScenarioState(350.75, GOOGL)!.oneSided).toBe(true)
    expect(deriveScenarioState(900, GOOGL)!.oneSided).toBe(false)
  })
})

describe('the price pane anchors to the breach, not to the furthest case', () => {
  /**
   * The bands the card hands the chart, in the order the card builds them:
   * grouped by coordinate, nearest to the signal price first.
   */
  const bandsFor = (price: number, cases: Parameters<typeof deriveScenarioState>[1]) =>
    deriveScenarioState(price, cases)!.groups
      .map(g => ({ label: g.label, price: g.price }))
      .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price))

  it('puts the lowest breached group first when the price is below everything', () => {
    // The pane read "↑ BULL 1605" on a card that exists because the price fell
    // under 800 — it highlighted the most distant scenario rather than the one
    // that fired the signal.
    const b = bandsFor(350.75, GOOGL)
    expect(b[0].label).toBe('Bear / Base')
    expect(b[0].price).toBe(800)
    expect(b[b.length - 1].label).toBe('Bull')
  })

  it('puts the highest group first when the price is above everything', () => {
    const b = bandsFor(2000, GOOGL)
    expect(b[0].label).toBe('Bull')
  })

  it('uses the grouped label, so one coordinate draws one band', () => {
    // Two cases at $800 drew two labels at the same y.
    const b = bandsFor(350.75, GOOGL)
    expect(b).toHaveLength(2)
    expect(b.filter(x => x.price === 800)).toHaveLength(1)
  })
})

describe('the feed and the editor address the same cards', () => {
  it('reads and invalidates under one shared key', async () => {
    // Editing a Bear case through Review cases saved correctly and left the
    // feed card showing the old number: `useScenarioCards` read
    // `['scenario-cards', orgId]` and nothing in the editor's mutation
    // invalidated it, while the in-card control did. Two write paths, one
    // wired — and a literal in each file is a wiring that drifts silently.
    const { SCENARIO_CARDS_KEY } = await import('../scenario-cards-key')
    const reader = await import('fs').then(m =>
      m.readFileSync('src/hooks/mobile/useScenarioCards.ts', 'utf8'))
    const writer = await import('fs').then(m =>
      m.readFileSync('src/hooks/useAnalystPriceTargets.ts', 'utf8'))

    expect(SCENARIO_CARDS_KEY).toEqual(['scenario-cards'])
    // Neither side may reintroduce a literal of its own.
    for (const src of [reader, writer]) {
      expect(src).toContain('SCENARIO_CARDS_KEY')
      expect(src).not.toMatch(/queryKey: \['scenario-cards'/)
    }
  })
})
