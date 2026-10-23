/**
 * What the Work surface is allowed to say beside a requirement.
 *
 * The risk this guards is not a crash — it is a sentence. Guidance printed
 * under a heading on the requirement surface reads as the firm's own, and a
 * reader has no way to tell generated prose from a quoted Process
 * definition. So the assertions here are mostly about RESTRAINT:
 *
 *  - the objective is the stage description verbatim, or nothing;
 *  - a requirement whose wording matches no topic gets NO questions;
 *  - no question mentions the asset, a number, or a direction.
 *
 * The last one is the non-vacuous half. A table of questions is easy to
 * extend with one that reads "AMZN has run 14% — is that justified?", which
 * would be a claim about an asset this module has never seen. The test
 * walks every question in the table and refuses that shape, so the guard
 * fails when the table grows a wrong row rather than when someone
 * remembers to check.
 */
import { describe, it, expect } from 'vitest'
import { guidanceFor } from '../requirement-guidance'

describe('the objective is quoted, never composed', () => {
  it('uses the stage description exactly as the Process defines it', () => {
    const stageDescription = 'Determine whether recent performance supports the thesis.'
    expect(guidanceFor({ text: 'Check YTD performance', stageDescription }).objective)
      .toBe(stageDescription)
  })

  it('returns null rather than inventing one when the stage has no description', () => {
    expect(guidanceFor({ text: 'Check YTD performance' }).objective).toBeNull()
    expect(guidanceFor({ text: 'Check YTD performance', stageDescription: '   ' }).objective).toBeNull()
  })

  it('trims, so a description of whitespace is absence and not an empty quote', () => {
    expect(guidanceFor({ text: 'x', stageDescription: '  Weigh the position.  ' }).objective)
      .toBe('Weigh the position.')
  })
})

describe('questions come from the wording, or not at all', () => {
  it('matches a performance requirement and leads with price', () => {
    const g = guidanceFor({ text: 'Check YTD performance' })
    expect(g.topic).toBe('Performance')
    expect(g.questions.length).toBeGreaterThan(0)
    expect(g.facets[0]).toBe('price')
  })

  it('matches a sizing requirement and leads with the position', () => {
    const g = guidanceFor({ text: 'Is the position still the right size?' })
    expect(g.topic).toBe('Position and sizing')
    expect(g.facets[0]).toBe('position')
  })

  it('reads a 13F requirement as a catalyst rather than as nothing', () => {
    expect(guidanceFor({ text: 'Check 13F' }).topic).toBe('Catalysts and events')
  })

  /** THE restraint assertion. */
  it('offers no questions when the wording matches no topic', () => {
    const g = guidanceFor({ text: 'Ping the specialist' })
    expect(g.topic).toBeNull()
    expect(g.questions).toEqual([])
    /* But evidence is still offered — those are facts, not guidance. */
    expect(g.facets.length).toBeGreaterThan(0)
  })

  it('says nothing about an empty or missing requirement', () => {
    for (const text of ['', '   ', null, undefined]) {
      const g = guidanceFor({ text })
      expect(g.questions).toEqual([])
      expect(g.topic).toBeNull()
    }
  })

  it('is case-insensitive, because requirement text is typed by people', () => {
    expect(guidanceFor({ text: 'REVIEW THE VALUATION' }).topic).toBe('Valuation and target')
  })
})

describe('no question may carry a claim about the asset', () => {
  /*
   * Every topic's questions, walked through the public entry point rather
   * than reaching into the table, so a new topic is covered the moment it
   * is added.
   */
  const PROBES = [
    'Check YTD performance',
    'Is the position still the right size?',
    'Review the valuation',
    'Does the thesis still hold?',
    'Check 13F',
    'Read and summarize the news',
  ]

  const questions = PROBES.flatMap(text => guidanceFor({ text }).questions)

  it('covers every topic in the table', () => {
    const topics = new Set(PROBES.map(text => guidanceFor({ text }).topic))
    expect(topics.has(null)).toBe(false)
    expect(topics.size).toBe(6)
    expect(questions.length).toBeGreaterThanOrEqual(12)
  })

  it('names no ticker and no company', () => {
    for (const q of questions) expect(q).not.toMatch(/\b[A-Z]{2,5}\b/)
  })

  it('states no figure, so nothing here can be read as data', () => {
    for (const q of questions) expect(q).not.toMatch(/\d/)
  })

  it('asserts no direction — these are questions, not a reading', () => {
    for (const q of questions) {
      expect(q).not.toMatch(/\b(bullish|bearish|overvalued|undervalued|should buy|should sell|expensive|cheap)\b/i)
      expect(q.trim().endsWith('?')).toBe(true)
    }
  })
})

describe('the horizon comes from the requirement, not from the cache', () => {
  /*
   * The defect: "Check YTD performance" opened on the whole 400-day cache
   * window, honestly stamped and not the period asked for.
   */
  it('opens a YTD requirement on YTD', () => {
    expect(guidanceFor({ text: 'Check YTD performance' }).defaultPeriod).toBe('YTD')
    expect(guidanceFor({ text: 'Review year-to-date return' }).defaultPeriod).toBe('YTD')
  })

  it('opens on the period the requirement actually names', () => {
    expect(guidanceFor({ text: 'Three-month price action' }).defaultPeriod).toBe('3M')
    expect(guidanceFor({ text: 'Performance over the past month' }).defaultPeriod).toBe('1M')
    expect(guidanceFor({ text: 'Quarterly performance check' }).defaultPeriod).toBe('3M')
  })

  it('falls back to YTD only for a performance requirement naming no period', () => {
    expect(guidanceFor({ text: 'Check performance' }).defaultPeriod).toBe('YTD')
  })

  it('offers no period at all where performance is not the subject', () => {
    for (const text of ['Does the thesis still hold?', 'Check 13F', 'Ping the specialist']) {
      expect(guidanceFor({ text }).defaultPeriod).toBeNull()
    }
  })
})

describe('every requirement is offered the same facts', () => {
  /*
   * The ordering differs by topic and the SET does not. This is the
   * property that broke in the browser when the panel varied its price
   * window by topic: one requirement showed a last close and the next
   * said none was held, for the same asset on the same screen.
   */
  const PROBES = [
    'Check YTD performance',
    'Revisit position sizing',
    'Does the thesis still hold?',
    'Ping the specialist',
  ]

  it('offers at least four facets whatever the wording', () => {
    for (const text of PROBES) {
      expect(guidanceFor({ text }).facets.length).toBeGreaterThanOrEqual(4)
    }
  })

  /*
   * Which facts LEAD is the topic's business; which are present is not.
   * The position and the last close are the context for any requirement on
   * an asset, so every topic carries both. The case and the target move in
   * the order instead of in and out of it.
   */
  it('always offers the position and the price', () => {
    for (const text of PROBES) {
      const facets = guidanceFor({ text }).facets
      for (const required of ['position', 'price'] as const) {
        expect(facets).toContain(required)
      }
    }
  })

  it('names no facet twice, so no cell can render twice', () => {
    for (const text of PROBES) {
      const facets = guidanceFor({ text }).facets
      expect(new Set(facets).size).toBe(facets.length)
    }
  })
})
