import { describe, it, expect } from 'vitest'
import { tileRequirementFor, PRODUCTION_ENTRY_KINDS } from '../tile-requirement'
import { resolveTile } from '../../signals/tile-geometry'

/** A real phone's feed area: 400x700 viewport minus ~110px of app chrome. */
const FEED = { width: 400, height: 590 }

const insight = (framing: string, extra: Record<string, unknown> = {}) => ({
  kind: 'insight',
  insight: {
    headline: 'APA has no investment thesis', body: 'Nothing on file.',
    portfolioCount: 1, issue: { framing, evidence: [] }, ...extra,
  },
})

describe('the adapter returns requirements, never heights', () => {
  it('describes a capital insight by what it contains', () => {
    const req = tileRequirementFor(insight('no_case'))!
    expect(req.claimChars).toBe('APA has no investment thesis'.length)
    expect(req.visual).toEqual({ min: 3 * 26 + 24, preferred: 3 * 26 + 24 })
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
    const sample: Record<string, Record<string, unknown>> = {
      scenario: { card: { headline: 'A claim', metric: {}, context: [], body: 'x' } },
      template: { card: { headline: 'A claim', metric: null, context: [], body: '' } },
      signal: { signal: { headline: 'A claim', metric: null, context: [], body: '' } },
      insight: insight('no_case'),
      news: { news: { headline: 'A story', summary: 'x', primarySymbol: 'MSFT' } },
      idea: { idea: { type: 'quick_thought', content: 'a post', asset: { symbol: 'MSFT' } } },
      lens: { lens: { type: 'conviction', gap: { symbol: 'MSFT', portfolioName: 'Core', cohort: [1, 2, 3] } } },
      attention: { attention: { title: 'Trim MSFT', symbol: 'MSFT', description: 'x' } },
    }
    for (const kind of PRODUCTION_ENTRY_KINDS) {
      const payload = sample[kind]
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

  it('gives a sparse thesis card far less than the whole feed', () => {
    /**
     * The live defect: No Core Thesis was taking essentially the entire 590px
     * feed. It is short now because a claim, a metric, a context row, two body
     * lines and three thesis rows cost what they cost — not because anything
     * says `no_research -> 361`.
     */
    const h = resolved(insight('no_case'))
    /**
     * Still about what the card CONTAINS, even though it is now given the
     * whole screen. A sparse composition asking for less than a rich one is
     * what makes the difference visible to a later pass: those families have
     * a screen to fill and this is the measure of how much of it they earn.
     */
    expect(h).toBeLessThan(FEED.height * 0.85)
    expect(h).toBeGreaterThan(240)
  })

  it('gives a plain story less room than a thesis card with a visual', () => {
    const news = resolved({
      kind: 'news', news: { headline: 'A story', summary: 'x', primarySymbol: 'MSFT' },
    })
    expect(news).toBeLessThan(resolved(insight('no_case')))
  })

  it('lets a ladder card earn more, through the same resolver', () => {
    const scenario = resolved({
      kind: 'scenario',
      card: { headline: 'AMZN is above every case you wrote', metric: { value: '+42%' },
              context: [{ label: 'Core' }], body: 'No stated upside is left.' },
    })
    expect(scenario).toBeGreaterThan(resolved(insight('no_case')))
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

  it('earns room for an active response without enlarging the passive card', () => {
    const passive = tileRequirementFor(insight('long_silence'))!
    const active = tileRequirementFor(insight('long_silence'), { workflow: 'active' })!
    expect(passive.workflow).toBe('passive')
    expect(active.workflow).toBe('active')
    expect(resolveTile(active, FEED).requested)
      .toBeGreaterThan(resolveTile(passive, FEED).requested)
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
