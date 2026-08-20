import { describe, expect, it } from 'vitest'

import { judgmentTouches, staleContextFor, staleCopy } from '../../../hooks/mobile/useDerivedInsights'
import { claimedSubjects, suppressCoveredInsights } from '../feed-dedupe'
import { buildInsightCard } from '../builders/legacy-kinds'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'

/**
 * Phase 7: the unreviewed-change signal has to earn its screen.
 *
 * The old rule was `days >= 30` and nothing else — a fact about the product,
 * not about the investment. Most of what follows asserts that the signal now
 * STAYS QUIET, because "no card" is the correct output for the majority of a
 * book at any moment and was the defect being fixed.
 *
 * The lettered cases are the manual test matrix, made automatic where the logic
 * is reachable without a Supabase-backed render.
 */

const insight = (over: Partial<DerivedInsight> = {}): DerivedInsight => ({
  id: 'i1',
  kind: 'stale_research',
  headline: 'AAPL has moved 18% since anyone last looked',
  body: 'The price is up 18% since the last recorded view, and it is 6.2% of Core. No thesis, judgment or decision has been recorded since.',
  assetId: 'a-1',
  symbol: 'AAPL',
  companyName: 'Apple',
  portfolioName: 'Core',
  weightPct: 6.2,
  daysSinceActivity: 48,
  lastTouchedAt: new Date(Date.now() - 48 * 86_400_000).toISOString(),
  context: { kind: 'price_move', movePct: 18.4, days: 48, weightPct: 6.2 },
  score: 0.9,
  ...over,
})

describe('trigger quality', () => {
  it('case A: silence alone produces nothing', () => {
    // The entire point of the phase. A small position nobody has written about
    // for two months, where nothing has happened to it, is not news.
    expect(staleContextFor({ days: 62, movePct: 2.1, weightPct: 1.4 })).toBeNull()
    // And silence with no price information at all is still nothing.
    expect(staleContextFor({ days: 62, movePct: null, weightPct: 1.4 })).toBeNull()
    // Even a very long silence, on its own, is not a reason.
    expect(staleContextFor({ days: 400, movePct: 0, weightPct: 1.4 })).toBeNull()
  })

  it('case B: a material move since the last look does produce a card', () => {
    const c = staleContextFor({ days: 48, movePct: 18.4, weightPct: 6.2 })
    expect(c?.kind).toBe('price_move')
    // The facts are carried through, not recomputed downstream.
    expect(c?.movePct).toBe(18.4)
    expect(c?.days).toBe(48)
  })

  it('reads a fall as an unreviewed change too, not just a rally', () => {
    // Sign is irrelevant to whether the view needs revisiting; magnitude is not.
    expect(staleContextFor({ days: 48, movePct: -21, weightPct: 1 })?.kind).toBe('price_move')
  })

  it('case F: a material position eventually earns a look on size alone', () => {
    const c = staleContextFor({ days: 120, movePct: 3, weightPct: 8 })
    expect(c?.kind).toBe('material_position')
    expect(c?.weightPct).toBe(8)
  })

  it('makes size-alone wait three times as long as a real change', () => {
    // A big position is not an EVENT — nothing happened, it is simply large and
    // old — so it must not compete with a card about something that changed.
    expect(staleContextFor({ days: 45, movePct: 3, weightPct: 8 })).toBeNull()
    expect(staleContextFor({ days: 95, movePct: 3, weightPct: 8 })?.kind).toBe('material_position')
    // A move at 45 days does fire, which is the asymmetry being asserted.
    expect(staleContextFor({ days: 45, movePct: 19, weightPct: 8 })?.kind).toBe('price_move')
  })

  it('prefers the change over the size when both are true', () => {
    // Both paths qualify here. The card should say what happened, not that the
    // position is big — the reader can see the weight either way.
    expect(staleContextFor({ days: 200, movePct: 30, weightPct: 9 })?.kind).toBe('price_move')
  })

  it('never treats a missing price as a flat one', () => {
    /**
     * The failure mode this guards is specific: if an absent baseline were
     * coerced to 0% the size path would still be reachable, but a card would
     * later be able to claim "moved 0%" as a finding. `null` has to stay null
     * all the way through — an absent close must never become an invented move.
     */
    const c = staleContextFor({ days: 200, movePct: null, weightPct: 9 })
    expect(c?.kind).toBe('material_position')
    expect(c?.movePct).toBeUndefined()
  })

  it('stays quiet below the staleness floor whatever else is true', () => {
    // A name written up last week does not need a nudge, however much it moved.
    expect(staleContextFor({ days: 5, movePct: 40, weightPct: 20 })).toBeNull()
  })

  it('holds the line exactly at each threshold', () => {
    // Boundaries stated once, so a later tweak to a constant fails loudly here
    // rather than quietly changing how much the feed talks.
    expect(staleContextFor({ days: 30, movePct: 15, weightPct: 0 })?.kind).toBe('price_move')
    expect(staleContextFor({ days: 29, movePct: 15, weightPct: 0 })).toBeNull()
    expect(staleContextFor({ days: 30, movePct: 14.9, weightPct: 0 })).toBeNull()
    expect(staleContextFor({ days: 90, movePct: null, weightPct: 5 })?.kind).toBe('material_position')
    expect(staleContextFor({ days: 90, movePct: null, weightPct: 4.9 })).toBeNull()
  })

  it('does not fire on an unheld name it has no weight for', () => {
    // Weight null and no move: nothing to say, and nothing to say it about.
    expect(staleContextFor({ days: 300, movePct: null, weightPct: null })).toBeNull()
  })
})

describe('judgment as engagement', () => {
  const at = new Date('2026-08-01T12:00:00.000Z').toISOString()

  it('case C: a recorded judgment counts as having looked', () => {
    // Without this, tapping "View holds" on Tuesday earns the same card again
    // on Wednesday — the feed punishing the exact behaviour it asks for.
    expect(judgmentTouches({ 'research_stale:a-1': { at } }))
      .toEqual([{ entityId: 'a-1', at }])
  })

  it('keeps the whole entity id when the type prefix is not the only colon', () => {
    // Splitting on every colon would truncate the id, nothing would ever match,
    // and case C would fail silently with no test naming it.
    expect(judgmentTouches({ 'target_expired:a:b:c': { at } })[0].entityId).toBe('a:b:c')
  })

  it('drops entries it cannot date rather than dating them now', () => {
    // A malformed row treated as `Date.now()` would mark an asset freshly
    // reviewed and suppress a card that should have appeared.
    expect(judgmentTouches({
      'x:a-1': { at: 'not a date' },
      'x:a-2': { at: null },
      'a-3': { at },
      'x:': { at },
    })).toEqual([])
  })

  it('survives an empty or absent store', () => {
    expect(judgmentTouches({})).toEqual([])
    expect(judgmentTouches(undefined as any)).toEqual([])
  })
})

describe('deduplication against stronger signals', () => {
  const entry = (symbol: string, kind = 'stale_research') => ({ insight: insight({ symbol, kind: kind as any }) })

  it('case D/E: a name a sharper card already owns loses the general one', () => {
    // A reached target or an unbacked scenario names the event and offers the
    // matching action. "Something moved" alongside it is a second tile about
    // the same holding that adds nothing.
    const claimed = claimedSubjects(['NVDA', 'msft'])
    const kept = suppressCoveredInsights([entry('NVDA'), entry('MSFT'), entry('AAPL')], claimed)
    expect(kept.map(e => e.insight.symbol)).toEqual(['AAPL'])
  })

  it('does not suppress a missing-research card', () => {
    // A stale target and no written research at all are different gaps, and the
    // second is not implied by the first.
    const kept = suppressCoveredInsights([entry('NVDA', 'no_thesis')], claimedSubjects(['NVDA']))
    expect(kept).toHaveLength(1)
  })

  it('ignores blank subjects rather than matching everything with them', () => {
    // An empty claim used to become a `""` key. Any insight without a symbol
    // would then have matched it and vanished.
    const claimed = claimedSubjects([null, undefined, '', '  '])
    expect(claimed.size).toBe(0)
    expect(suppressCoveredInsights([{ insight: insight({ symbol: undefined as unknown as string }) }], claimed)).toHaveLength(1)
  })
})

describe('card copy', () => {
  const built = (i: DerivedInsight) => {
    const r = buildInsightCard(i as any)
    if (!r.ok) throw new Error(`expected a card, got: ${r.reason}`)
    return r.card
  }

  it('names the change rather than the silence', () => {
    // "AAPL is going stale" describes the app. This has to describe the asset.
    const copy = staleCopy({
      symbol: 'AAPL', portfolioName: 'Core',
      context: { kind: 'price_move', movePct: 18.4, days: 48, weightPct: 6.2 },
    })
    expect(copy.headline).not.toMatch(/stale|quiet|going/i)
    expect(copy.headline).toContain('18%')
    expect(copy.body).toContain('up 18%')
  })

  it('says which way it moved, because the direction changes the question', () => {
    const copy = staleCopy({
      symbol: 'AAPL', context: { kind: 'price_move', movePct: -22, days: 48 },
    })
    expect(copy.body).toContain('down 22%')
    // No weight was supplied, so none is claimed.
    expect(copy.body).not.toMatch(/% of/)
  })

  it('does not dress a size-driven card up as an event', () => {
    // Nothing happened here. Saying "moved" would be the fabrication this phase
    // exists to stop, and the reader would go looking for news that is not there.
    const copy = staleCopy({
      symbol: 'MSFT', portfolioName: 'Core',
      context: { kind: 'material_position', weightPct: 7.5, days: 140 },
    })
    expect(copy.headline).not.toMatch(/moved/)
    expect(copy.body).toContain('Nothing has happened to it')
    expect(copy.body).toContain('140 days')
  })

  it('states the ingredients in "why this surfaced", because the rule is composite', () => {
    // A reader looking at a card they did not expect needs the facts that
    // caused it, not a characterisation of them.
    const reason = built(insight()).provenance.reason
    expect(reason).toContain('18% price move')
    expect(reason).toContain('48 days')
    expect(reason).toContain('6.2%')
  })

  it('explains a size-driven card by its size, not by an event', () => {
    const reason = built(insight({
      headline: 'MSFT is a 7.5% position nobody has revisited',
      body: 'It is 7.5% of Core and nothing has been recorded against it for 140 days. Nothing has happened to it either; it is simply large and unexamined.',
      context: { kind: 'material_position', weightPct: 7.5, days: 140 },
      daysSinceActivity: 140,
    })).provenance.reason
    expect(reason).toContain('7.5% position')
    expect(reason).toContain('140 days')
    // There was no move; claiming one would be the fabrication this forbids.
    expect(reason).not.toMatch(/price move/)
  })

  it('falls back to a claim it can support when there is no context', () => {
    // Legacy rows and `large_unreviewed` reach the builder without one. The
    // reason must not then invent ingredients it was never given.
    const reason = built(insight({ context: undefined })).provenance.reason
    expect(reason).not.toMatch(/price move|·/)
  })

  it('asks about the change rather than about the silence', () => {
    expect(built(insight()).prompt).toBe('Does this change need a look?')
  })
})
