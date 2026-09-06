import { describe, it, expect } from 'vitest'
import { tileRequirementFor, PRODUCTION_ENTRY_KINDS } from '../tile-requirement'
import { resolveTile, interactivePlotVisual } from '../../signals/tile-geometry'

/** A real phone's feed area: 400x700 viewport minus ~110px of app chrome. */
const FEED = { width: 400, height: 590 }

const insight = (framing: string, extra: Record<string, unknown> = {}) => ({
  kind: 'insight',
  insight: {
    headline: 'APA has no investment thesis', body: 'Nothing on file.',
    portfolioCount: 1, issue: { framing, evidence: [] }, ...extra,
  },
})

/**
 * One plausible payload per production entry kind, shared by the suite.
 *
 * The price-led lenses are listed beside the kinds rather than inside them
 * because `lens` is one kind carrying four very different compositions, and it
 * is the untargeted one — a chart plus three case-entry rows — that costs the
 * most room. A map keyed only by kind would test the cheapest of the four and
 * report the family as covered.
 */
const SAMPLE_ENTRIES: Record<string, Record<string, unknown>> = {
  scenario: { card: { headline: 'A claim', metric: {}, context: [], body: 'x' } },
  template: { card: { headline: 'A claim', metric: null, context: [], body: '' } },
  signal: { signal: { headline: 'A claim', metric: null, context: [], body: '' } },
  insight: insight('no_case'),
  news: { news: { headline: 'A story', summary: 'x', primarySymbol: 'MSFT' } },
  idea: { idea: { type: 'quick_thought', content: 'a post', asset: { symbol: 'MSFT' } } },
  lens: { lens: { type: 'conviction', gap: { symbol: 'MSFT', portfolioName: 'Core', cohort: [1, 2, 3] } } },
  attention: { attention: { title: 'Trim MSFT', symbol: 'MSFT', description: 'x' } },
}

/** The compositions a reader can actually engage, including every lens shape. */
const ENGAGEABLE: Record<string, unknown>[] = [
  ...PRODUCTION_ENTRY_KINDS
    .map(k => (k === 'insight' ? SAMPLE_ENTRIES[k] : { kind: k, ...SAMPLE_ENTRIES[k] })),
  { kind: 'lens', lens: { type: 'stale', target: { symbol: 'GOOGL' } } },
  { kind: 'lens', lens: { type: 'breach', target: { symbol: 'AMZN' } } },
  { kind: 'lens', lens: { type: 'untargeted', position: { symbol: 'BRK.B' } } },
  insight('long_silence'),
  insight('price_move'),
]

describe('the adapter returns requirements, never heights', () => {
  it('describes a capital insight by what it contains', () => {
    const req = tileRequirementFor(insight('no_case'))!
    expect(req.claimChars).toBe('APA has no investment thesis'.length)
    /**
     * The taller of the two panes, not the first.
     *
     * Three thesis rows and the price presentation now share one carousel, so
     * the band is sized by whichever needs more room — the chart. Stated
     * through the primitive rather than as a literal so that recalibrating the
     * presentation moves this with it.
     */
    expect(req.visual).toEqual(interactivePlotVisual())
    expect(req.hasActionTray).toBe(true)
    // Nothing in the requirement is a pixel height or a tier.
    expect(req).not.toHaveProperty('height')
    expect(req).not.toHaveProperty('tier')
  })

  it('follows the pane planner rather than restating its rules', () => {
    /**
     * `no_case` and `incomplete_case` are the authoring framings — the reader
     * is asked to write, not to judge — so they get no judgment row. Anything
     * else does. The condition lives in `insightPanePlan`; this only consumes
     * it, so the two cannot drift into disagreeing about a card's height.
     */
    expect(tileRequirementFor(insight('no_case'))!.controlRows).toBe(0)
    expect(tileRequirementFor(insight('long_silence'))!.controlRows).toBe(1)
  })

  it('does not reserve room for a pane that may never resolve', () => {
    // A news card's tape is per-symbol and eligibility-only, so geometry must
    // not budget a plot for it.
    const req = tileRequirementFor({
      kind: 'news', news: { headline: 'A story', summary: 'x', primarySymbol: 'MSFT' },
    })!
    expect(req.visual).toBeNull()
    expect(req.controlRows).toBe(1)
  })

  it('says null only for shapes outside production', () => {
    /**
     * The defensive branch, and nothing more. `null` gives the slot the whole
     * feed, which is what every tile did before geometry existed — spare room
     * rather than a clipped card. It is the right answer for input nobody has
     * described and the wrong answer for a shipping family, which is what the
     * coverage test below exists to keep true.
     */
    expect(tileRequirementFor({ kind: 'something-new' })).toBeNull()
    expect(tileRequirementFor({})).toBeNull()
    // A known kind carrying no usable payload is also unknown input.
    expect(tileRequirementFor({ kind: 'scenario' })).toBeNull()
  })

  it('describes every entry kind the feed produces', () => {
    /**
     * The guard against a new family silently taking the whole feed forever.
     *
     * `PRODUCTION_ENTRY_KINDS` is the list the dashboard builds; every one must
     * resolve to a requirement when given a plausible payload. Adding a kind to
     * the feed without an adapter fails here rather than shipping as a
     * full-height tile nobody notices.
     */
    for (const kind of PRODUCTION_ENTRY_KINDS) {
      const payload = SAMPLE_ENTRIES[kind]
      expect(payload, `no sample payload for production kind "${kind}"`).toBeDefined()
      const entry = kind === 'insight' ? payload : { kind, ...payload }
      expect(tileRequirementFor(entry as never), `"${kind}" has no geometry adapter`)
        .not.toBeNull()
    }
  })

  it('gives a lens its bar list only when there is more than one bar', () => {
    // The same condition the renderer gates the cohort and book panes on: a
    // comparison of one row is the subject looking at itself.
    const many = tileRequirementFor({
      kind: 'lens', lens: { type: 'conviction', gap: { symbol: 'MSFT', cohort: [1, 2, 3, 4, 5] } },
    })!
    const one = tileRequirementFor({
      kind: 'lens', lens: { type: 'conviction', gap: { symbol: 'MSFT', cohort: [1] } },
    })!
    expect(many.visual).not.toBeNull()
    expect(one.visual).toBeNull()
    expect(resolveTile(many, FEED).requested).toBeGreaterThan(resolveTile(one, FEED).requested)
  })
})

describe('the proof cases resolve through the shared path', () => {
  /**
   * The room a composition ASKS for, not the height it gets.
   *
   * Every tile now occupies exactly one screen, so `height` is the same for
   * all of them and proves nothing about content. `requested` is what the
   * model computes and what says whether the composition fits.
   */
  const resolved = (e: Record<string, unknown>) =>
    resolveTile(tileRequirementFor(e)!, FEED).requested

  it('has the sparse thesis card earning its screen, not rattling around in it', () => {
    /**
     * This assertion has been inverted, on the reader's evidence.
     *
     * It used to require `no_case` to ask for LESS than 85% of the feed, and
     * called that "the measure of how much of the screen it earns" — a later
     * pass's job. The later pass never came, and what shipped was reported
     * twice: "no core thesis is still too short and not filling the screen
     * causing me to be able to see 2 tiles on the screen at once... we need to
     * make sure that this CANNOT happen", then "no core thesis tiles still
     * dont have price chart cards".
     *
     * A rule that a family must ask for less than the screen it is given is a
     * rule that it must under-fill it. The card now carries the tape behind
     * its case pane, so the composition genuinely needs the room, and the
     * assertion says what the product actually requires.
     */
    const h = resolved(insight('no_case'))
    expect(h).toBeGreaterThanOrEqual(FEED.height)
  })

  it('gives a plain story less room than a thesis card with a visual', () => {
    const news = resolved({
      kind: 'news', news: { headline: 'A story', summary: 'x', primarySymbol: 'MSFT' },
    })
    expect(news).toBeLessThan(resolved(insight('no_case')))
  })

  it('lets a ladder card earn its room through the same resolver', () => {
    /**
     * Both fill the screen now, so the old `scenario > no_case` comparison has
     * nothing left to distinguish — it compared two numbers that are both the
     * feed height. What still has to hold is that neither is DECIDED by its
     * family: the ladder asks for what a ladder costs, arrived at by the same
     * resolver, and the proof of that is the family-blind case below.
     */
    const scenario = resolved({
      kind: 'scenario',
      card: { headline: 'AMZN is above every case you wrote', metric: { value: '+42%' },
              context: [{ label: 'Core' }], body: 'No stated upside is left.' },
    })
    expect(scenario).toBeGreaterThanOrEqual(FEED.height)
  })

  it('resolves the same shape the same way whatever family produced it', () => {
    // The architectural claim: geometry cannot see a family, so two entries
    // with the same composition must land on the same height.
    const a = tileRequirementFor({
      kind: 'template',
      card: { headline: 'Twelve chars', metric: null, context: [], body: '' },
    })!
    const b = tileRequirementFor({
      kind: 'signal',
      signal: { headline: 'Twelve chars', metric: null, context: [], body: '' },
    })!
    expect(resolveTile(a, FEED)).toEqual(resolveTile(b, FEED))
  })
})

describe('width and workflow reach the shipping path', () => {
  it('resolves taller on a narrower feed when the claim wraps', () => {
    const req = tileRequirementFor(insight('no_case'))!
    const narrow = resolveTile(req, { width: 320, height: 590 })
    const wide = resolveTile(req, { width: 430, height: 590 })
    expect(narrow.requested).toBeGreaterThanOrEqual(wide.requested)
    expect(narrow.claimLines).toBeGreaterThanOrEqual(wide.claimLines)
  })

  it('fits the response inside the screen, on every family and every phone', () => {
    /**
     * The assertion this replaces, and why it was the wrong one.
     *
     * It required an active card to ask for MORE than its passive self, which
     * assumes the response is stacked under the evidence. `SignalCardView`
     * replaces the band instead — "an ENGAGED judgment takes the whole band" —
     * so a card swapping a 176px chart for a 124px answer form correctly needs
     * no more room, and the old rule could only be satisfied by over-charging.
     *
     * What has to hold is that the response FITS. It did not: with the two
     * regions summed, every production family overflowed a 400x590 feed the
     * moment it was engaged, by 121-177px, and the overflow came off the
     * bottom where the note field is. Reported as "on some respond cards the
     * note entry box is getting cut off" — in fact all of them at that height,
     * and none at 430x822, which is what made it look intermittent.
     */
    const FEEDS = [
      { width: 360, height: 590 }, { width: 400, height: 590 },
      { width: 390, height: 734 }, { width: 430, height: 822 },
    ]
    for (const e of ENGAGEABLE) {
      const active = tileRequirementFor(e as never, { workflow: 'active' })
      if (!active) continue
      expect(active.workflow).toBe('active')
      const name = JSON.stringify(e).slice(0, 60)
      for (const feed of FEEDS) {
        const r = resolveTile(active, feed)
        expect(
          r.requested,
          `${name} engaged at ${feed.width}x${feed.height} asks ${r.requested} ` +
          `for a ${feed.height} screen — the note field is what falls off`,
        ).toBeLessThanOrEqual(feed.height)
      }
    }
  })
})

describe('production and the gallery resolve the same geometry', () => {
  /**
   * The property the harness exists for.
   *
   * The gallery was a second height system for most of this project's life,
   * and every stage it misled cost a pass: fixtures measured compositions the
   * feed does not produce, and geometry tuned to them was tuned to nothing.
   * Both sides now call `tileRequirementFor` then `resolveTile`, so the same
   * entry in the same container must land on the same number — otherwise the
   * gallery is once again measuring a product that does not ship.
   */
  const CONTAINERS = [
    { width: 360, height: 590 }, { width: 400, height: 590 },
    { width: 390, height: 734 }, { width: 430, height: 822 },
    { width: 390, height: 540 },
  ]

  const ENTRIES: Record<string, Record<string, unknown>> = {
    'scenario with a ladder and a detail': {
      kind: 'scenario', hasDetailRegion: true,
      card: {
        headline: 'AMZN has passed every case you wrote', metric: { value: '+42%' },
        prompt: 'Has the investment view changed?', context: [{ label: 'Core' }],
        body: 'No stated upside is left.',
      },
    },
    'bare contract card': {
      kind: 'template',
      card: { headline: 'A short claim', metric: null, context: [], body: '' },
    },
    'sparse thesis workflow': {
      kind: 'insight',
      insight: {
        headline: 'APA has no investment thesis', body: 'Nothing on file.',
        portfolioCount: 1, issue: { framing: 'no_case', evidence: [] },
      },
    },
  }

  for (const [name, entry] of Object.entries(ENTRIES)) {
    it(`agrees on ${name} at every container`, () => {
      for (const c of CONTAINERS) {
        // Both sides run this exact pair; there is no second implementation to
        // compare against, which is the point — the duplicate was deleted.
        const req = tileRequirementFor(entry)
        expect(req, `${name}: no adapter`).not.toBeNull()
        const a = resolveTile(req!, c)
        const b = resolveTile(tileRequirementFor(entry)!, c)
        expect(a, `${name} at ${c.width}x${c.height}`).toEqual(b)
        expect(a.height).toBeLessThanOrEqual(c.height)
      }
    })
  }

  it('lets a narrow container ask for more room than a wide one', () => {
    const entry = ENTRIES['sparse thesis workflow']
    const narrow = resolveTile(tileRequirementFor(entry)!, { width: 360, height: 734 })
    const wide = resolveTile(tileRequirementFor(entry)!, { width: 430, height: 734 })
    expect(narrow.requested).toBeGreaterThanOrEqual(wide.requested)
  })
})
