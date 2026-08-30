import { describe, expect, it } from 'vitest'

import { exploreSparkPlan, sliceSince } from '../explore-spark'
import { EXPLORE_FIXTURE, NOW } from './explore-fixture'
import type { ExploreItem } from '../explore-item'

/**
 * The line was never removed. It was asked for rarely and answered rarely, and
 * the product of two small numbers is zero — see the header of
 * `explore-spark`. These pin the rules that widened the first gate without
 * turning Explore into a chart per card.
 */

const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'x', dedupeKey: 'k', signalType: null,
  category: 'decisions', subtype: 'signal', title: 't',
  symbol: 'NVDA', assetId: 'nvda',
  destination: { kind: 'action', action: 'open_asset' },
  ...over,
})

describe('a line is planned from the card, never from a coin flip', () => {
  it('is deterministic for the same item and clock', () => {
    // The feed must not shimmer between renders. Same input, same plan, every
    // time — asserted over the whole fixture rather than one card.
    for (const f of EXPLORE_FIXTURE) {
      const a = exploreSparkPlan(f, NOW)
      const b = exploreSparkPlan(f, NOW)
      expect(a).toEqual(b)
    }
  })

  it('never asks for a line it cannot draw', () => {
    expect(exploreSparkPlan(item({ symbol: null })).form).toBe('none')
  })
})

describe('the archetype decides first, in both directions', () => {
  it('lets a picture that explains the finding stand alone', () => {
    // A scenario band with a sparkline under it is two charts competing inside
    // 178 pixels. The band explains the breach; the tape does not.
    const scenario = item({
      signalType: 'scenario_gap',
      visual: { currentPrice: 156, cases: [{ label: 'Bear', price: 200 }, { label: 'Bull', price: 310 }] },
    })
    expect(exploreSparkPlan(scenario, NOW).form).toBe('none')

    const target = item({ signalType: 'no_target', visual: { currentPrice: 232, target: null } })
    expect(exploreSparkPlan(target, NOW).form).toBe('none')
  })

  it('renders at feature weight when the archetype chose the path itself', () => {
    expect(exploreSparkPlan(item({ signalType: 'target_hit' }), NOW).form).toBe('primary')
    expect(exploreSparkPlan(item({ signalType: 'unusual_move' }), NOW).form).toBe('primary')
  })

  it('prefers the real path to the schematic last-look rail', () => {
    /**
     * The brief's own example: "NVDA has moved 15% since anyone last looked →
     * show price path from LAST LOOK to TODAY". The rail was built when no
     * windowed path was available to a tile; the path says everything the rail
     * says and adds the shape.
     */
    const stale = item({
      subtype: 'research', category: 'research', signalType: 'research_stale',
      visual: { movePct: 18, lastLookAt: new Date(NOW - 300 * 86_400_000).toISOString() },
    })
    const plan = exploreSparkPlan(stale, NOW)
    expect(plan.form).toBe('edge')
    expect(plan.sinceLabel).toBe('Last look')
    expect(plan.since).toBeTruthy()
  })
})

describe('eligibility differs by type, as the brief specifies', () => {
  it('SIGNAL — the highest chart rate, and it comes from the archetype', () => {
    /**
     * A signal carrying a symbol and no richer archetype resolves to
     * `price_trend` in `exploreVisualFor` via the tape fallback, so it arrives
     * here already answered. This pins that there is no gap between the two
     * rules: every symbol-bearing signal charts, and none of them needs a
     * second rule here to say so.
     */
    expect(exploreSparkPlan(item({ signalType: 'active_risk' }), NOW).form).toBe('primary')
    expect(exploreSparkPlan(item({ signalType: 'anything_unmapped' }), NOW).form).toBe('primary')
    // And a signal with no name to chart still asks for nothing.
    expect(exploreSparkPlan(item({ signalType: 'active_risk', symbol: null }), NOW).form).toBe('none')
  })

  it('RESEARCH — only with a review date to anchor the window', () => {
    const anchored = item({ subtype: 'research', category: 'research', visual: { lastLookAt: new Date(NOW - 200 * 86_400_000).toISOString() } })
    expect(exploreSparkPlan(anchored, NOW).form).toBe('edge')
    // No review date is no window, and a year of closes would be the generic
    // tape this module exists to refuse.
    expect(exploreSparkPlan(item({ subtype: 'research', category: 'research' }), NOW).form).toBe('none')
  })

  it('IDEA — a stance with road behind it charts; a narrative post does not', () => {
    const old = new Date(NOW - 140 * 86_400_000).toISOString()
    const proposal = item({
      subtype: 'idea', category: 'ideas', occurredAt: old, visual: { direction: 'buy' },
    })
    const plan = exploreSparkPlan(proposal, NOW)
    expect(plan.form).toBe('edge')
    expect(plan.sinceLabel).toBe('Idea')

    // A thought's content IS its content; a price line under it implies the
    // market is the argument.
    const narrative = item({ subtype: 'idea', category: 'ideas', occurredAt: old, visual: { quote: 'Margins are doing the work.' } })
    expect(exploreSparkPlan(narrative, NOW).form).toBe('none')
  })

  it('IDEA — too new for a path to mean anything', () => {
    const fresh = item({
      subtype: 'idea', category: 'ideas',
      occurredAt: new Date(NOW - 2 * 86_400_000).toISOString(),
      visual: { direction: 'buy' },
    })
    expect(exploreSparkPlan(fresh, NOW).form).toBe('none')
  })

  it('NEWS — rare, and only where the card already states a reaction', () => {
    const reacting = item({
      subtype: 'news', category: 'news',
      metric: { value: '+11.4%', label: 'since published' },
      occurredAt: new Date(NOW - 86_400_000).toISOString(),
    })
    expect(exploreSparkPlan(reacting, NOW).form).toBe('inline')
    // Without a stated reaction there is nothing to corroborate, and Explore
    // becomes a financial-news app with a chart on every headline.
    expect(exploreSparkPlan(item({ subtype: 'news', category: 'news' }), NOW).form).toBe('none')
  })

  it('WORKFLOW — a deadline is not a price', () => {
    expect(exploreSparkPlan(item({ subtype: 'workflow', category: 'workflow' }), NOW).form).toBe('none')
  })

  it('AGGREGATE — stands for many names, so charts none of them', () => {
    expect(exploreSparkPlan(item({ subtype: 'aggregate' }), NOW).form).toBe('none')
  })
})

describe('the page stays selective', () => {
  it('charts a minority of the fixture, spread across forms', () => {
    /**
     * The failure this pins is the opposite of the reported one: a rule that
     * put a line on everything would satisfy "I see no sparklines" and ruin
     * the surface. A discovery page is mostly typography.
     */
    const forms = EXPLORE_FIXTURE.map(f => exploreSparkPlan(f, NOW).form)
    const charted = forms.filter(f => f !== 'none')
    expect(charted.length).toBeGreaterThan(2)
    expect(charted.length).toBeLessThan(EXPLORE_FIXTURE.length / 2)
    // And not all of one placement — the brief asks for several integrations,
    // not one repetitive chart slot.
    expect(new Set(charted).size).toBeGreaterThan(1)
  })
})

describe('the window is trimmed to what the card is about', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({
    date: new Date(NOW - (10 - i) * 86_400_000).toISOString().slice(0, 10),
    close: 100 + i,
  }))

  it('cuts to the anchor', () => {
    const since = new Date(NOW - 4 * 86_400_000).toISOString()
    const cut = sliceSince(pts, since)
    expect(cut.length).toBeLessThan(pts.length)
    expect(cut.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the full series when there is no anchor', () => {
    expect(sliceSince(pts, null)).toHaveLength(pts.length)
  })

  it('keeps the full series rather than a stub the cache cannot support', () => {
    // A window the cache does not reach back far enough to fill would leave one
    // point, and one point is not a line. The recent path says more.
    const since = new Date(NOW - 0.2 * 86_400_000).toISOString()
    expect(sliceSince(pts, since)).toHaveLength(pts.length)
  })
})
