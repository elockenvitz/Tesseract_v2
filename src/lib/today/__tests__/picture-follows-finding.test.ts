/**
 * Which picture a tile draws, and why it is not always the same one.
 *
 * Measured on the live desk at 1920x889, three of Today's four tiles were
 * "THESIS MAY BE STALE" over three identical "PRICE AGAINST THE FRAMEWORK"
 * bands -- two of them captioned "The price sits inside the framework", a
 * chart drawn to report that nothing had broken. The cause was precedence,
 * not data: any name with a valid price ladder drew the band, whatever had
 * happened to it.
 *
 * The rule under test: the band earns the tile when the price has LEFT the
 * range the desk underwrote, because that is the desk's own thinking being
 * overtaken. Inside the framework the band says nothing, and the question a
 * stale thesis raises -- what has the price done since you last wrote? -- is
 * the price path from the anchor.
 */

import { describe, it, expect } from 'vitest'
import type { DecisionItem } from '../../../engine/decisionEngine/types'
import { adaptDecisionItem, applyEnrichment } from '..'
import type { TodayEnrichment } from '..'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const staleThesis = (): DecisionItem => ({
  id: 'thesis-stale-a-amzn', surface: 'action', severity: 'red', category: 'risk',
  title: 'Thesis May Be Stale', titleKey: 'THESIS_STALE', description: 'x',
  chips: [{ label: 'Ticker', value: 'AMZN' }, { label: 'Age', value: '340d' }],
  context: { assetId: 'a-amzn', assetTicker: 'AMZN' },
  ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }],
  sortScore: 0, createdAt: ago(340),
} as DecisionItem)

/** A year of daily closes ending at `end`, so a window always resolves. */
const history = (end: number) => Array.from({ length: 360 }, (_, i) => ({
  date: new Date(Date.now() - (359 - i) * DAY).toISOString().slice(0, 10),
  close: 80 + (end - 80) * (i / 359),
}))

const LADDER = {
  valid: true,
  assetId: 'a-amzn',
  updatedAt: ago(60),
  cases: [
    { name: 'Bear', price: 90 },
    { name: 'Base', price: 120 },
    { name: 'Bull', price: 180 },
  ],
} as unknown as TodayEnrichment['ladder']

const enrich = (spot: number): TodayEnrichment => ({
  spot,
  history: history(spot),
  ladder: LADDER,
})

const drawn = (spot: number) =>
  applyEnrichment(adaptDecisionItem(staleThesis()), enrich(spot)).visual

describe('the picture follows the finding', () => {
  it('draws the framework when the price has run past the bull case', () => {
    // AMZN: 248 against a 90/120/180 ladder. The desk's own range has been
    // overtaken, and that IS the finding.
    const v = drawn(248)
    expect(v.archetype).toBe('scenario')
    expect(v.note).toMatch(/above the bull case/)
  })

  it('draws the framework when the price has fallen through the bear case', () => {
    const v = drawn(70)
    expect(v.archetype).toBe('scenario')
    expect(v.note).toMatch(/below the bear case/)
  })

  it('draws the price path when the price is still inside the framework', () => {
    // TSLA and AAPL. The band here could only report that nothing broke.
    const v = drawn(130)
    expect(v.archetype).toBe('review-window')
    expect(v.caption).toMatch(/Price since/i)
  })

  it('still draws the framework inside the range when no price path exists', () => {
    // A name with a ladder and no usable history has one picture available,
    // and one picture is better than none.
    const v = applyEnrichment(
      adaptDecisionItem(staleThesis()),
      { spot: 130, ladder: LADDER },
    ).visual
    expect(v.archetype).toBe('scenario')
  })

  it('gives a desk of ordinary names more than one picture', () => {
    // The property the reader actually sees: a field of stale theses whose
    // prices differ no longer renders as the same chart three times.
    const kinds = new Set([drawn(248), drawn(130), drawn(70)].map(v => v.archetype))
    expect(kinds.size).toBeGreaterThan(1)
  })
})

/**
 * The alternatives, which used to be built and thrown away.
 *
 * Choosing one picture is right. DISCARDING the rest was not: the data for
 * the other panels was already in hand, so a reader who wanted to ask the
 * card a second question -- "fine, but what has the price done?" -- had to
 * leave the card to do it.
 */
describe('a tile keeps every picture it can draw', () => {
  const panels = (spot: number) =>
    applyEnrichment(adaptDecisionItem(staleThesis()), enrich(spot)).visuals ?? []

  it('leads with the finding\'s own choice', () => {
    // The contract every existing reader of `visual` depends on.
    for (const spot of [248, 130, 70]) {
      expect(panels(spot)[0]).toEqual(drawn(spot))
    }
  })

  it('offers the framework behind a tile that leads with the price path', () => {
    // Inside the range the band does not earn the tile -- but the ladder
    // exists, so the reader can still ask to see it.
    const p = panels(130)
    expect(p[0].archetype).toBe('review-window')
    expect(p.map(v => v.archetype)).toContain('scenario')
  })

  it('offers the price path behind a tile that leads with the framework', () => {
    const p = panels(248)
    expect(p[0].archetype).toBe('scenario')
    expect(p.map(v => v.archetype)).toContain('review-window')
  })

  it('never repeats an archetype', () => {
    const kinds = panels(130).map(v => v.archetype)
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('invents nothing: no ladder means no framework panel', () => {
    // The guard against a pager that pads itself to look richer.
    const p = applyEnrichment(
      adaptDecisionItem(staleThesis()),
      { spot: 130, history: history(130) },
    ).visuals ?? []
    expect(p.map(v => v.archetype)).not.toContain('scenario')
    expect(p[0].archetype).toBe('review-window')
  })

  it('invents nothing: no history means no price panel', () => {
    const p = applyEnrichment(
      adaptDecisionItem(staleThesis()),
      { spot: 130, ladder: LADDER },
    ).visuals ?? []
    expect(p.map(v => v.archetype)).not.toContain('review-window')
    expect(p[0].archetype).toBe('scenario')
  })

  it('never offers the archetype that draws nothing', () => {
    expect(panels(130).map(v => v.archetype)).not.toContain('metrics')
  })
})

/**
 * A bar of elapsed time never beats a price path.
 *
 * Measured on the live desk: the two "idea being worked on" tiles drew
 * "OPEN FOR / 228 days" over a track with a dot on it, directly beneath a
 * metric reading "228d OPEN" -- the picture restated the figure. NKE's price
 * had moved -19% since the idea was opened, the strip said so, and the
 * history to draw it was already in hand.
 */
describe('the age bar is the last resort, not the default', () => {
  /** An idea nobody has sized. Its key is deliberately NOT in DRAWS_WINDOW. */
  const openIdea = (): DecisionItem => ({
    id: 'idea-nosim-a-nke', surface: 'action', severity: 'yellow', category: 'alpha',
    title: 'Idea Being Worked On', titleKey: 'IDEA_NOT_SIMULATED', description: 'x',
    chips: [{ label: 'Ticker', value: 'NKE' }, { label: 'Open', value: '228d' }],
    context: { assetId: 'a-nke', assetTicker: 'NKE' },
    ctas: [{ label: 'Simulate idea', actionKey: 'OPEN_TRADE_LAB', kind: 'primary' }],
    sortScore: 0, createdAt: ago(228),
  } as DecisionItem)

  it('draws the price path for a finding that is not on the window list', () => {
    const v = applyEnrichment(
      adaptDecisionItem(openIdea()),
      { spot: 70, history: history(70) },
    ).visual
    expect(v.archetype).toBe('review-window')
  })

  it('still draws the bar when there is no price to draw', () => {
    // TGT: an open idea on a name with no history. The bar is then the only
    // honest answer, and one picture beats none.
    const v = applyEnrichment(adaptDecisionItem(openIdea()), { spot: 70 }).visual
    expect(v.archetype).toBe('aging')
  })

  it('keeps the age reachable behind the price path', () => {
    const p = applyEnrichment(
      adaptDecisionItem(openIdea()),
      { spot: 70, history: history(70) },
    ).visuals ?? []
    expect(p.map(v => v.archetype)).toEqual(['review-window', 'aging'])
  })
})
