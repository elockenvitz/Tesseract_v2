/**
 * The band's four labelled measurements come from four named fields.
 *
 * ── Why this is worth a test of its own ───────────────────────────────────
 *
 * The orientation band distinguishes a stated target, the book's own mark,
 * the overshoot between them and the last close, and it PRINTS the source
 * under each one. That care is only worth anything if the slots are filled
 * from the fields the labels name. A reshape that put the mark where the
 * close goes would make the band lie with its own provenance line attached,
 * and the band could not detect it.
 *
 * It also runs on two surfaces -- the Dashboard pane and the canonical Asset
 * page -- so this is the thing that stops the two drifting.
 */
import { describe, it, expect } from 'vitest'
import { orientationFactsFrom } from '../orientation-facts'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'

const position = (over: Partial<AssetWorkspaceData['positions'][number]>) => ({
  portfolioId: 'p1', portfolioName: 'Core', shares: 100, price: 266,
  marketValue: 26_600, weightPct: 2.4, avgCost: 180, unrealisedGain: null,
  unrealisedPct: null, asOf: '2026-11-10',
  ...over,
})

const data = (over: Partial<AssetWorkspaceData> = {}): AssetWorkspaceData => ({
  sections: [], evidence: [], caseWrittenAt: '2026-03-02T00:00:00Z', coreSections: [],
  history: [
    { date: '2026-11-09', close: 261 },
    { date: '2026-11-10', close: 264.5 },
  ],
  spot: 264.5,
  ladder: {
    assetId: 'a1', symbol: 'AAPL', companyName: 'Apple Inc.',
    cases: [
      { id: 'c-bear', name: 'Bear', price: 180 },
      { id: 'c-base', name: 'Base', price: 240 },
    ],
    updatedAt: '2026-03-02T00:00:00Z', valid: true, reason: '',
  },
  target: 240,
  positions: [position({}), position({ portfolioId: 'p2', portfolioName: 'Opportunities', weightPct: 1.1 })],
  liveIdeas: [],
  decisions: [],
  ...over,
} as AssetWorkspaceData)

describe('nothing to reshape', () => {
  it('is null rather than a facts object full of nulls', () => {
    /* The caller renders no band at all. An empty band would be a heading
       with no reading under it. */
    expect(orientationFactsFrom(null)).toBeNull()
    expect(orientationFactsFrom(undefined)).toBeNull()
  })
})

describe('the four measurements', () => {
  it('takes the official target from the target field', () => {
    expect(orientationFactsFrom(data())!.officialTarget).toBe(240)
  })

  it('takes the last close from the end of the price series, with its date', () => {
    const facts = orientationFactsFrom(data())!
    expect(facts.spot).toBe(264.5)
    /* The series is oldest first. Reading the FIRST element here would print
       a two-day-old close under a label that says it is the latest. */
    expect(facts.spotAsOf).toBe('2026-11-10')
  })

  it('says it does not know the date rather than guessing one', () => {
    const facts = orientationFactsFrom(data({ history: [] }))!
    expect(facts.spotAsOf).toBeNull()
  })

  it('carries the ladder in the order the producer gave it', () => {
    expect(orientationFactsFrom(data())!.ladder).toEqual([
      { id: 'c-bear', name: 'Bear', price: 180 },
      { id: 'c-base', name: 'Base', price: 240 },
    ])
  })

  it('has an empty ladder, not a null one, when no scenarios are on record', () => {
    /* The band distinguishes "no ladder" from "a ladder that does not contain
       the event's target", which is how it discloses a renamed case. An
       undefined here would collapse the two. */
    expect(orientationFactsFrom(data({ ladder: null }))!.ladder).toEqual([])
  })
})

describe('the position', () => {
  it('reports the book the reader arrived from', () => {
    const facts = orientationFactsFrom(data(), 'p2')!
    expect(facts.position).toEqual({ portfolioName: 'Opportunities', weightPct: 1.1, valueUsd: 26_600 })
    expect(facts.alsoHeldIn).toEqual(['Core'])
  })

  it('falls back to the first book when the reader arrived from none', () => {
    const facts = orientationFactsFrom(data(), null)!
    expect(facts.position!.portfolioName).toBe('Core')
    expect(facts.alsoHeldIn).toEqual(['Opportunities'])
  })

  it('is null on a name the firm does not hold, and holds nobody else either', () => {
    const facts = orientationFactsFrom(data({ positions: [] }))!
    expect(facts.position).toBeNull()
    expect(facts.alsoHeldIn).toEqual([])
  })
})

describe('the waiting request', () => {
  it('reports one that is pending', () => {
    const facts = orientationFactsFrom(data({
      decisions: [{
        id: 'd1', status: 'pending', action: 'Trim', decidedAt: null,
        portfolioId: 'p1', portfolioName: 'Core', decisionNote: 'Above the base case.',
      }],
    }))!
    expect(facts.pending).toEqual({ label: 'Trim', note: 'Above the base case.', portfolioName: 'Core' })
  })

  it('ignores a request already answered', () => {
    /* Status, not stage. A request that was executed is not waiting on
       anyone, and an action offered to "go to the request" would land the
       reader on a closed one. */
    const facts = orientationFactsFrom(data({
      decisions: [{
        id: 'd1', status: 'executed', action: 'Trim', decidedAt: '2026-11-01T00:00:00Z',
        portfolioId: 'p1', portfolioName: 'Core', decisionNote: null,
      }],
    }))!
    expect(facts.pending).toBeNull()
  })

  it('names an unlabelled request rather than printing nothing', () => {
    const facts = orientationFactsFrom(data({
      decisions: [{
        id: 'd1', status: 'PENDING', action: null, decidedAt: null,
        portfolioId: null, portfolioName: null, decisionNote: null,
      }],
    }))!
    expect(facts.pending!.label).toBe('Decision request')
  })
})
