import { describe, it, expect } from 'vitest'
import { tileRequirementFor } from '../tile-requirement'
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

  it('says null for a shape it cannot describe', () => {
    /**
     * The safe direction. A null requirement gives the slot the whole feed,
     * which is what every tile did before geometry existed — spare room rather
     * than a clipped card.
     */
    for (const kind of ['lens', 'attention', 'something-new']) {
      expect(tileRequirementFor({ kind }), kind).toBeNull()
    }
    expect(tileRequirementFor({})).toBeNull()
    expect(tileRequirementFor({ kind: 'scenario' })).toBeNull()
  })
})

describe('the proof cases resolve through the shared path', () => {
  const resolved = (e: Record<string, unknown>) =>
    resolveTile(tileRequirementFor(e)!, FEED).height

  it('gives a sparse thesis card far less than the whole feed', () => {
    /**
     * The live defect: No Core Thesis was taking essentially the entire 590px
     * feed. It is short now because a claim, a metric, a context row, two body
     * lines and three thesis rows cost what they cost — not because anything
     * says `no_research -> 361`.
     */
    const h = resolved(insight('no_case'))
    expect(h).toBeLessThan(FEED.height * 0.75)
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
    expect(narrow.height).toBeGreaterThanOrEqual(wide.height)
    expect(narrow.claimLines).toBeGreaterThanOrEqual(wide.claimLines)
  })

  it('earns room for an active response without enlarging the passive card', () => {
    const passive = tileRequirementFor(insight('long_silence'))!
    const active = tileRequirementFor(insight('long_silence'), { workflow: 'active' })!
    expect(passive.workflow).toBe('passive')
    expect(active.workflow).toBe('active')
    expect(resolveTile(active, FEED).height)
      .toBeGreaterThan(resolveTile(passive, FEED).height)
  })
})
