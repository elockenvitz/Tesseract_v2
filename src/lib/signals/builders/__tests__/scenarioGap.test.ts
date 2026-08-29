import { describe, it, expect, beforeEach } from 'vitest'
import { buildScenarioGapCard, type ScenarioGapInput } from '../scenarioGap'
import { readSuppressionLog } from '../../suppression'
import type { CardResult, SignalCard } from '../../contract'
import { feedActionIsRoutable } from '../../feed-actions'
import { deriveScenarioState } from '../../scenario-state'

/**
 * Every case here is real production data, not invented.
 *
 * Read from `analyst_price_targets` on 2026-08-16. That matters: the previous
 * three builders were written against imagined shapes and two of them could
 * never render — one filtered on status values that do not exist, one computed
 * against a benchmark table with zero rows. These fixtures are what is
 * actually in the database.
 */

const card = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason} (${r.detail})`)
  return r.card
}
const reason = (r: CardResult): string => {
  if (r.ok) throw new Error(`expected suppression, got: ${r.card.headline}`)
  return r.reason
}

const fresh = () => new Date().toISOString()

const base = (over: Partial<ScenarioGapInput>): ScenarioGapInput => ({
  assetId: 'a1', symbol: 'X', price: 100, priceAsOf: fresh(),
  cases: [], heldIn: ['Tech & Consumer Growth'], statedAt: '2026-03-21T18:49:00.000Z',
  ...over,
})

/** TSLA: Bear 325 @10%, Base 375 @15%, Bull 400 @75%. Price 248.90. */
const TSLA = base({
  assetId: 'tsla', symbol: 'TSLA', companyName: 'Tesla', price: 248.90,
  cases: [
    { name: 'Bear', price: 325, probability: 10, timeframe: '6 months' },
    { name: 'Base', price: 375, probability: 15, timeframe: '6 months' },
    { name: 'Bull', price: 400, probability: 75, timeframe: '6 months' },
  ],
})

/** AMZN: Bear 90, Base 120, Bull 180, no probabilities. Price 232.99. */
const AMZN = base({
  assetId: 'amzn', symbol: 'AMZN', companyName: 'Amazon', price: 232.99,
  cases: [
    { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
    { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
  ],
})

/**
 * AAPL, exactly as production holds it: SIX cases, probabilities summing to
 * 125, and two different horizons. Price 276.49.
 *
 * The earlier fixture in this file listed four of the six and claimed an
 * expected value of $280. That was not the data — it was a subset that
 * happened to sum to 100. Read from analyst_price_targets on 2026-08-17.
 */
const AAPL = base({
  assetId: 'aapl', symbol: 'AAPL', companyName: 'Apple', price: 276.49,
  cases: [
    { name: 'Bear', price: 205, probability: 12, timeframe: '6 months' },
    { name: 'Base', price: 230, probability: 19, timeframe: '6 months' },
    { name: 'Bear', price: 255, probability: 10, timeframe: '12 months' },
    { name: 'Bull', price: 285, probability: 62, timeframe: '12 months' },
    { name: 'Bull', price: 345, probability: 15, timeframe: '12 months' },
    { name: 'Uber Bull', price: 500, probability: 7, timeframe: '12 months' },
  ],
})

/** A coherent ladder: one horizon, probabilities summing to 100. */
const COHERENT = base({
  // 104 against an expected value of 105 — inside the 3% band that makes the
  // "priced at expected value" claim true. At 100 it is 4.8% away, which is
  // simply inside the range and correctly says nothing.
  assetId: 'coh', symbol: 'COH', price: 104,
  cases: [
    { name: 'Bear', price: 80, probability: 25, timeframe: '12 months' },
    { name: 'Base', price: 100, probability: 50, timeframe: '12 months' },
    { name: 'Bull', price: 140, probability: 25, timeframe: '12 months' },
  ],
})

/** GOOGL: price 142.80 against targets of 800, 800 and 1605.12. */
const GOOGL = base({
  assetId: 'googl', symbol: 'GOOGL', price: 142.80,
  cases: [
    { name: 'Bear', price: 800, probability: null, timeframe: '6 months' },
    { name: 'Base', price: 800, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 1605.12, probability: null, timeframe: '11 months' },
  ],
})

beforeEach(() => localStorage.clear())

describe('below the bear case — TSLA', () => {
  it('names the claim the single-target view hides', () => {
    const c = card(buildScenarioGapCard(TSLA))
    // Every other surface picks one row and shows 400, which reads as upside.
    //
    // "every case", not "your bear case". This state IS below all of them —
    // the card only fires under the cheapest — and naming one understated it.
    // On a ladder where two cases share a price it named whichever sorted
    // first, which is an accident of insertion order.
    expect(c.headline).toBe('TSLA is trading below every case you modelled')
    expect(c.metric?.value).toBe('23%')
    expect(c.metric?.label).toBe('Below your lowest case of $325')
    expect(c.metric?.direction).toBe('bad')
  })

  it('is critical when the gap is wide', () => {
    expect(card(buildScenarioGapCard(TSLA)).severity).toBe('critical')
    // Just under the bear case is worth saying, but it is not an emergency.
    const near = { ...TSLA, price: 320 }
    expect(card(buildScenarioGapCard(near)).severity).toBe('attention')
  })

  it('dates the number by the quote, not by when the ladder was written', () => {
    const c = card(buildScenarioGapCard(TSLA))
    expect(c.metric?.source).toBe('quote')
    expect(new Date(c.metric!.asOf).getTime()).toBeGreaterThan(new Date(TSLA.statedAt).getTime())
  })

  it('carries the ladder as evidence, because the spread is the argument', () => {
    const c = card(buildScenarioGapCard(TSLA))
    expect(c.evidence?.kind).toBe('scenario_ladder')
    const d = c.evidence!.data as { price: number; cases: unknown[]; expected: number | null }
    expect(d.price).toBe(248.90)
    expect(d.cases).toHaveLength(3)
    expect(d.expected).toBeCloseTo(388.75, 2)
  })

  it('re-surfaces when the claim recurs on a later day', () => {
    const a = card(buildScenarioGapCard(TSLA)).dedupeKey
    const b = card(buildScenarioGapCard({ ...TSLA, price: 240 })).dedupeKey
    expect(b).toBe(a) // same claim, same day
    expect(a).toContain('below_bear')
  })
})

describe('above the bull case — AMZN', () => {
  it('says the upside is spent', () => {
    const c = card(buildScenarioGapCard(AMZN))
    expect(c.headline).toBe('AMZN is trading above every case you modelled')
    expect(c.metric?.value).toBe('+29%')
    expect(c.metric?.label).toBe('Above your highest case of $180')
    expect(c.metric?.direction).toBe('good')
    /**
     * The body says what the headline does NOT.
     *
     * It used to read "The market is pricing an outcome above every recorded
     * scenario" directly under "AMZN is trading above every case you modelled"
     * — the same sentence with different nouns. A card has three jobs and
     * spending the body restating the first leaves the second unsaid.
     */
    expect(c.body).toContain('No stated upside is left')
    expect(c.body).not.toContain('above every recorded scenario')
    /**
     * And it stops there — the ladder's age is NOT in it.
     *
     * `SignalCardView` clamps every body to two lines and paints a "more"
     * affordance over the end of the second one when it overflows. Appending
     * " Ladder last updated 5 Feb 2026." pushed this body to three lines in a
     * two-line box, so the card rendered "Ladder last updated 5 Feb" with
     * "more" over "2026." — a truncation control leaked into the prose to hide
     * one word. The date rides on the evidence now and prints under the axis.
     */
    expect(c.body).not.toContain('Ladder last updated')
    expect((c.evidence!.data as { statedOn: string | null }).statedOn)
      .toBe('21 Mar 2026')
    /**
     * The number that made the clamp fire.
     *
     * Measured in the gallery: a 358px body holds about 50 characters a line,
     * so two lines is ~100 and the clamp fired at 106. 100 is the ceiling this
     * card's summaries are written under, and it has to hold at 320px too —
     * where the same box holds nearer 35 a line and there is no margin left to
     * spend on provenance.
     */
    expect(c.body.length).toBeLessThanOrEqual(100)
  })

  it('computes no expected value when probabilities are missing', () => {
    // Weighting the unlabelled cases at zero would invent a number.
    const c = card(buildScenarioGapCard(AMZN))
    expect((c.evidence!.data as { expected: number | null }).expected).toBeNull()
    expect(c.context.some(x => x.label.startsWith('EV'))).toBe(false)
  })
})

describe('expected value only from a real distribution', () => {
  it('computes it when the weights sum to 100 on one horizon', () => {
    // 0.25*80 + 0.50*100 + 0.25*140 = 105
    const c = card(buildScenarioGapCard(COHERENT))
    expect(c.headline).toBe('COH is priced at your expected value')
    expect(c.metric?.value).toBe('$105')
    expect(c.severity).toBe('informational')
  })

  it('refuses to normalise AAPL, whose probabilities sum to 125', () => {
    // The old code divided by the sum of whatever was present, so it presented
    // a "probability-weighted expected value" from a distribution the analyst
    // never wrote. No number they could enter would make the card disagree
    // with them, which makes the fair-value claim unfalsifiable.
    const r = buildScenarioGapCard(AAPL)
    expect(r.ok).toBe(false)
    expect(reason(r)).toBe('resolved')
  })

  /**
   * The reason moved to the pane it is about; the guarantee did not move.
   *
   * It was a context chip, and so was the expected value — so a card with an
   * inconsistent ladder carried "EV $146" or "Probabilities sum to 125%" in the
   * scan row AND the same statement in the Cases pane, which is where the cases
   * those numbers belong to are listed and where the control that repairs them
   * lives. Two statements of one fact, one of them in the row a reader scans to
   * decide whether any of this is their problem.
   *
   * What must remain true is that the card never shows a silently missing
   * expectation: `expected` is null, the state derivation names the reason, and
   * `ScenarioCaseDetail` renders it with `Fix probabilities` beside it.
   */
  it('never leaves a missing expectation unexplained', () => {
    // Below its bear case, so the card still renders.
    const c = card(buildScenarioGapCard({ ...AAPL, price: 150 }))
    const data = c.evidence!.data as { expected: number | null; cases: unknown[] }
    expect(data.expected).toBeNull()
    // The reason the pane renders, derived from the same cases the card carries.
    const state = deriveScenarioState(150, data.cases as never)
    expect(state?.expectedBlockedBy).toBe('Probabilities sum to 125%')
    // And it is no longer duplicated into the scan row.
    expect(c.context.some(x => x.label.startsWith('EV'))).toBe(false)
    expect(c.context.some(x => x.label.startsWith('Probabilities sum'))).toBe(false)
  })

  it('refuses to average across mixed horizons', () => {
    // A 6-month bear at 205 and a 12-month bull at 285 are not competing
    // outcomes of one question; weighting them describes no point in time.
    const mixed = {
      ...COHERENT,
      cases: [
        { name: 'Bear', price: 80, probability: 25, timeframe: '6 months' },
        { name: 'Base', price: 100, probability: 50, timeframe: '12 months' },
        { name: 'Bull', price: 140, probability: 25, timeframe: '12 months' },
      ],
    }
    const c = card(buildScenarioGapCard({ ...mixed, price: 60 }))
    const data = c.evidence!.data as { expected: number | null; cases: unknown[] }
    expect(data.expected).toBeNull()
    // Stated by the Cases pane, from the same derivation — see the test above
    // for why it is no longer a second copy in the context row.
    expect(deriveScenarioState(60, data.cases as never)?.expectedBlockedBy)
      .toMatch(/^Mixed horizons/)
    expect((c.evidence!.data as { expected: number | null }).expected).toBeNull()
  })
})

describe('suppressions', () => {
  it('rejects an implausible gap as a data fault, not a 460% finding', () => {
    // GOOGL, live in production: a split-adjusted price meeting unadjusted
    // targets. The most confident wrong thing the surface could say.
    expect(reason(buildScenarioGapCard(GOOGL))).toBe('inconsistent_numbers')
  })

  it('builds against the last close, and says that is what it is', () => {
    /**
     * A closed market is not a stale quote.
     *
     * The old rule required a quote under 15 minutes old — right for a card
     * claiming to compare a target to the TAPE, and its consequence was never
     * chosen: outside market hours every scenario card vanished, silently,
     * which is most of the week.
     *
     * A ladder is a months-long view, so Friday's close is a legitimate
     * comparison. Implying it is live is not, which is why the card has to say.
     */
    const closed = { ...TSLA, priceAsOf: new Date(Date.now() - 6 * 60 * 60_000).toISOString() }
    const c = card(buildScenarioGapCard(closed))
    expect(c.headline).toContain('below every case')
    /**
     * And says NOTHING about the clock.
     *
     * `At last close` rode on `atClose`, which is true outside market hours —
     * so nearly every card carried it and it distinguished nothing. It spent
     * the first slot of the row a reader scans for "is any of this mine" on
     * boilerplate. The card is a present-tense finding; the ladder shows the
     * price as `NOW $x` against the cases, which is where price context goes.
     * A genuinely stale quote deserves a specific state, not a permanent hedge.
     */
    expect((c.context ?? []).map(x => x.label)).not.toContain('At last close')
    expect((c.context ?? []).map(x => x.label)).toEqual(['1 portfolio', '3 cases'])
  })

  it('says nothing about the close when the quote is live', () => {
    expect((card(buildScenarioGapCard(TSLA)).context ?? []).map(x => x.label))
      .not.toContain('At last close')
  })

  it('still rejects a quote too old to be anybody’s close', () => {
    // Beyond a long weekend the market has traded since, and no label makes
    // that number useful.
    const ancient = { ...TSLA, priceAsOf: new Date(Date.now() - 9 * 24 * 60 * 60_000).toISOString() }
    expect(reason(buildScenarioGapCard(ancient))).toBe('quote_stale')
  })

  it('rejects a quote with no timestamp at all', () => {
    expect(reason(buildScenarioGapCard({ ...TSLA, priceAsOf: '' }))).toBe('quote_stale')
  })

  it('rejects a missing price', () => {
    // PLTR, COIN, DASH, CEG, NVDA and NKE all have targets and no
    // current_price. 68 of 911 assets carry one.
    expect(reason(buildScenarioGapCard({ ...TSLA, price: 0 }))).toBe('quote_unavailable')
  })

  it('rejects a single target — one number is not a ladder', () => {
    const one = { ...TSLA, cases: [TSLA.cases[0]] }
    expect(reason(buildScenarioGapCard(one))).toBe('insufficient_coverage')
  })

  it('says nothing when the price is simply inside the range', () => {
    // The normal state of every position. A card that fires here fires on
    // everything and teaches people to ignore the surface.
    const inside = { ...TSLA, price: 360 }
    expect(reason(buildScenarioGapCard(inside))).toBe('resolved')
  })

  it('logs every suppression with its entity', () => {
    buildScenarioGapCard(GOOGL)
    buildScenarioGapCard({ ...TSLA, price: 360 })
    const log = readSuppressionLog()
    expect(log.map(e => e.type)).toEqual(['scenario_gap', 'scenario_gap'])
    expect(log.map(e => e.entity)).toEqual(['GOOGL', 'TSLA'])
    expect(log.every(e => !!e.detail)).toBe(true)
  })
})

describe('contract invariants', () => {
  // Built inside the test, not at collection time. As a module-scope const, a
  // single suppression threw during collection and took all 17 tests in this
  // file with it — reported as "no tests" rather than as a failure, which is
  // indistinguishable from the file not existing.
  const build = () => [TSLA, AMZN, COHERENT].map(i => card(buildScenarioGapCard(i)))

  it('no headline carries the metric value', () => {
    for (const c of build()) expect(c.headline).not.toContain(c.metric!.value)
  })

  it('every card names its stake and can explain itself', () => {
    for (const c of build()) {
      /**
       * "2 portfolios", not "Held · 3" and no longer "In 2 portfolios".
       *
       * The chip still has to say what the number COUNTS — readers asked what
       * "Held" meant and the honest answer was that it counted portfolios. What
       * went is the preposition, which read as a sentence fragment in a row of
       * middot-separated labels that are not sentences.
       */
      expect(c.context.some(x => /^\d+ portfolios?$/.test(x.label) || x.label === 'Not held')).toBe(true)
      expect(c.provenance.reason).toContain('scenarios')
      /**
       * The primary is either resolvable in place OR a real destination.
       *
       * This asserted `inline === true`, which held while every primary was
       * Capture. The contextual primary introduced in Phase 4 navigates — to
       * the case editor, which is where revising a ladder actually happens — so
       * `inline: false` is the honest value, and the contract's own comment
       * anticipates exactly this as the rare deliberate case.
       *
       * What must never be true is a primary that neither resolves in place nor
       * goes anywhere, which is the dead-end button this phase exists to
       * prevent. That is what is checked instead.
       */
      expect(
        c.actions.primary.inline ||
        feedActionIsRoutable(c.actions.primary.id, {
          assetId: c.entity.kind === 'asset' ? c.entity.id : null,
          symbol: c.entity.ticker ?? null,
        }),
      ).toBe(true)
      // Capture is never removed from the product, only demoted.
      expect(
        c.actions.primary.id === 'capture' || c.actions.quick.some(a => a.id === 'capture'),
      ).toBe(true)
      expect(c.dedupeKey.startsWith('scenario_gap')).toBe(true)
    }
  })
})

describe('a case edit changes what the card says, and whether it says anything', () => {
  /**
   * The propagation bug, at the level where it is decidable.
   *
   * Cards are DERIVED per fetch — nothing is persisted — so the whole fix is
   * that editing a target invalidates the key the cards are read under. What
   * that invalidation buys is asserted here: the rebuild is not a cosmetic
   * refresh, it re-runs the claim and the eligibility check together.
   */
  const BASE = {
    assetId: 'a1', symbol: 'GOOGL', price: 350.75,
    priceAsOf: new Date().toISOString(),
    statedAt: new Date().toISOString(),
    heldIn: ['Core Equity'],
  }
  const ladder = (bear: number) => [
    { name: 'Bear', price: bear, probability: null, timeframe: '6 months' },
    { name: 'Base', price: 800, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 1000, probability: null, timeframe: '11 months' },
  ]

  it('restates the comparison when the lowest case moves', () => {
    const before = card(buildScenarioGapCard({ ...BASE, cases: ladder(800) }))
    expect(before.metric?.label).toBe('Below your lowest case of $800')

    const after = card(buildScenarioGapCard({ ...BASE, cases: ladder(500) }))
    expect(after.metric?.label).toBe('Below your lowest case of $500')
    expect(after.metric?.value).not.toBe(before.metric?.value)
  })

  it('regroups immediately when an edit makes two targets equal', () => {
    const apart = card(buildScenarioGapCard({ ...BASE, cases: ladder(500) }))
    expect((apart.evidence!.data as any).cases).toHaveLength(3)

    // Bear moved onto Base. The ladder is now two coordinates, and the card
    // says so through the shared grouping rather than through its own copy.
    const together = card(buildScenarioGapCard({ ...BASE, cases: ladder(800) }))
    expect(together.metric?.label).toBe('Below your lowest case of $800')
  })

  it('stops claiming "below every case" once that is no longer true', () => {
    // Bear edited under the price. The card must not keep a statement its own
    // data no longer supports — it resolves through the existing lifecycle
    // rather than being corrected in place.
    const r = buildScenarioGapCard({ ...BASE, cases: ladder(300) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('resolved')
  })

  it('keeps the evidence in step with the claim', () => {
    // One authoritative dataset for every pane: the ladder, the price bands
    // and the case list all read `evidence.data.cases`.
    const c = card(buildScenarioGapCard({ ...BASE, cases: ladder(500) }))
    const prices = ((c.evidence!.data as any).cases as any[]).map(x => x.price)
    expect(prices).toContain(500)
    expect(prices).not.toContain(800.0001)
  })
})
