import { describe, it, expect } from 'vitest'
import {
  ideaShapeFor,
  maturityOf,
  stanceOf,
  IDEA_MIN_AGE_DAYS,
} from '../idea-shape'

const NOW = new Date('2026-08-30T12:00:00Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

describe('stanceOf', () => {
  it('keeps all four real directions distinct', () => {
    expect(stanceOf('buy')).toMatchObject({ label: 'BUY', direction: 'increase', kind: 'entry' })
    expect(stanceOf('sell')).toMatchObject({ label: 'SELL', direction: 'decrease', kind: 'entry' })
    expect(stanceOf('add')).toMatchObject({ label: 'ADD', direction: 'increase', kind: 'adjust' })
    expect(stanceOf('trim')).toMatchObject({ label: 'TRIM', direction: 'decrease', kind: 'adjust' })
  })

  /**
   * The regression this module exists for. `hooks/ideas/types.ts` declared
   * `TradeAction = 'buy' | 'sell'` against a four-value enum, so add and trim
   * were read through a type that said they could not exist.
   */
  it('does not coerce add/trim into buy/sell', () => {
    expect(stanceOf('add')!.label).not.toBe('BUY')
    expect(stanceOf('trim')!.label).not.toBe('SELL')
  })

  it('returns null rather than defaulting a direction nobody stated', () => {
    expect(stanceOf(null)).toBeNull()
    expect(stanceOf('')).toBeNull()
    expect(stanceOf('hold')).toBeNull()
  })
})

describe('maturityOf', () => {
  it('normalises the three early stages to one pill', () => {
    for (const s of ['aware', 'investigate', 'deep_research']) {
      expect(maturityOf(s)).toMatchObject({ maturity: 'researching', label: 'RESEARCHING' })
    }
  })

  it('keeps the later stages distinct, because each asks something different', () => {
    expect(maturityOf('thesis_forming').label).toBe('THESIS FORMING')
    expect(maturityOf('ready_for_decision').label).toBe('DECISION READY')
    expect(maturityOf('deciding').label).toBe('DECIDING')
  })

  it('marks only the stages that are actually asking the desk for something', () => {
    expect(maturityOf('deep_research').awaitingDesk).toBe(false)
    expect(maturityOf('thesis_forming').awaitingDesk).toBe(false)
    expect(maturityOf('ready_for_decision').awaitingDesk).toBe(true)
    expect(maturityOf('deciding').awaitingDesk).toBe(true)
  })

  it('reads the legacy stage vocabulary still present on old rows', () => {
    expect(maturityOf('idea').maturity).toBe('researching')
    expect(maturityOf('working_on').maturity).toBe('researching')
    expect(maturityOf('modeling').maturity).toBe('thesis_forming')
  })

  it('shows no pill at all for a stage it cannot read', () => {
    expect(maturityOf(null).label).toBeNull()
    expect(maturityOf('nonsense').label).toBeNull()
  })
})

describe('ideaShapeFor — stance and maturity are independent', () => {
  it('keeps the direction on an early-stage idea instead of calling it a watch', () => {
    const s = ideaShapeFor({ action: 'buy', stage: 'investigate', createdAt: daysAgo(2) }, NOW)
    expect(s.stance!.label).toBe('BUY')
    expect(s.maturity.label).toBe('RESEARCHING')
  })

  it('produces the same stance across every maturity', () => {
    const stages = ['aware', 'thesis_forming', 'ready_for_decision', 'deciding']
    const labels = stages.map(st => ideaShapeFor({ action: 'sell', stage: st }, NOW).stance!.label)
    expect(new Set(labels)).toEqual(new Set(['SELL']))
  })
})

describe('ideaShapeFor — family selection', () => {
  const base = { action: 'buy', stage: 'deep_research', createdAt: daysAgo(60) }

  it('prefers the scenario ladder over everything else', () => {
    const s = ideaShapeFor({ ...base, ladderCaseCount: 3, targetPrice: 100, referencePrice: 80, hasPriceHistory: true }, NOW)
    expect(s.family).toBe('scenario')
  })

  it('will not call one rung a ladder', () => {
    const s = ideaShapeFor({ ...base, ladderCaseCount: 1, targetPrice: 100, referencePrice: 80 }, NOW)
    expect(s.family).toBe('target')
  })

  /**
   * A target idea stays a target idea on a name with no cached price. The pane
   * degrades to "target, no gap"; the card does not change what it is about.
   */
  it('claims the target family on the target alone', () => {
    expect(ideaShapeFor({ ...base, targetPrice: 100, referencePrice: null, hasPriceHistory: false }, NOW).family)
      .toBe('target')
  })

  it('does not claim a target family without a target', () => {
    expect(ideaShapeFor({ ...base, targetPrice: null, referencePrice: 80, hasPriceHistory: true }, NOW).family)
      .toBe('performance')
  })

  it('gives a framework-less but well-aged idea its path', () => {
    const s = ideaShapeFor({ ...base, hasPriceHistory: true }, NOW)
    expect(s.family).toBe('performance')
  })

  it('does not draw a path for an idea younger than the minimum age', () => {
    const s = ideaShapeFor({ ...base, createdAt: daysAgo(IDEA_MIN_AGE_DAYS - 1), hasPriceHistory: true }, NOW)
    expect(s.family).toBe('narrative')
    expect(s.reason).toMatch(/too new/)
  })

  it('does not draw a path when nothing is cached', () => {
    expect(ideaShapeFor({ ...base, hasPriceHistory: false }, NOW).family).toBe('narrative')
  })

  /** A thesis-led idea is a real answer, not a rendering failure. */
  it('lands a thesis-only idea on narrative rather than inventing a chart', () => {
    const s = ideaShapeFor({ action: 'buy', stage: 'thesis_forming', createdAt: daysAgo(90) }, NOW)
    expect(s.family).toBe('narrative')
  })

  it('rejects a zero or negative target rather than charting it', () => {
    expect(ideaShapeFor({ ...base, targetPrice: 0 }, NOW).family).not.toBe('target')
    expect(ideaShapeFor({ ...base, targetPrice: -5 }, NOW).family).not.toBe('target')
  })
})
