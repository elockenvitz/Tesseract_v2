/**
 * Composition on real producer output. The main proof of adoption B.
 *
 * Every finding here comes through an adapter from a card a shipping builder
 * produced. The question is what the reader meets when one name carries
 * several of them at once.
 */

import { describe, expect, it } from 'vitest'

import { composeForSubject, wouldCompose } from '../composition'
import { adoptNoCoreThesis, adoptScenarioGap, adoptStaleTarget } from '../mobile'
import { composeSituations, corroborationCount } from '../../situation'
import { situationPriorityInput } from '../../importance'
import { priorityFor } from '../../../signals/feed-priority'
import { readerQuestionFor } from '../../../signals/reader-question'
import {
  NOW, PHONE, dislocationCard, staleTargetCard, staleTargetRow,
  thesisCard, thesisInsight,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
const CAPITAL = { weightPct: 4.8 }

/**
 * One name, so composition has something to compose.
 *
 * All three fixtures are re-pointed at a single asset. Production can genuinely
 * produce all three for one name: the lens reads `analyst_price_targets`, the
 * scenario hook reads the ladder in the same table, and the research scan reads
 * `investment_case` contributions — three objects, one security. Somebody who
 * priced a name without writing the argument for it is the ordinary case, not a
 * contrived one.
 */
const ASSET = 'a-amzn'

const expiredFor = () => {
  const row = staleTargetRow({ assetId: ASSET, symbol: 'AMZN', companyName: 'Amazon' })
  return adoptStaleTarget(row, staleTargetCard({
    assetId: ASSET, symbol: 'AMZN', companyName: 'Amazon',
  }), READER, PHONE)
}

const dislocatedFor = () => adoptScenarioGap(dislocationCard(), CAPITAL, READER, PHONE)

const noThesisFor = () => adoptNoCoreThesis(thesisInsight(), thesisCard(), READER, PHONE)

const findingOf = (r: ReturnType<typeof adoptStaleTarget>) => {
  if (!r.ok) throw new Error(`unexpected decline: ${r.reason} — ${r.detail}`)
  return r.adoption.situation.lead
}

// ─────────────────────────────────────────────────────────────────────────────
// The three required examples
// ─────────────────────────────────────────────────────────────────────────────

describe('A. expired target + no core thesis', () => {
  const composed = () => composeForSubject([expiredFor(), noThesisFor()])

  it('produces two situations and two tiles', () => {
    const c = composed()
    expect(c.tileCount).toBe(2)
    expect(c.absorbed).toBe(0)
  })

  it('stays distinct because they are two different questions', () => {
    expect(composed().questions.sort()).toEqual(['target', 'thesis'])
    const w = wouldCompose(findingOf(expiredFor()), findingOf(noThesisFor()))
    expect(w.compose).toBe(false)
    expect(w.because).toContain('different questions')
  })

  /**
   * The product had already decided this, and said so in the dedupe rule.
   *
   * `suppressCoveredInsights` deliberately exempts `no_thesis`: "a name with a
   * stale price target and a name with no written research at all are two
   * genuinely different gaps, and the second is not implied by the first."
   * The composer reaching the same answer from the question map rather than
   * from a hard-coded exemption is the point.
   */
  it('agrees with the shipping dedupe rule', () => {
    expect(readerQuestionFor('target_expired')).not.toBe(readerQuestionFor('no_research'))
  })
})

describe('B. case/price dislocation + no core thesis', () => {
  const composed = () => composeForSubject([dislocatedFor(), noThesisFor()])

  it('produces two situations and two tiles', () => {
    const c = composed()
    expect(c.tileCount).toBe(2)
    expect(c.absorbed).toBe(0)
  })

  it('stays distinct: the framework question is not the thesis question', () => {
    expect(composed().questions.sort()).toEqual(['framework', 'thesis'])
  })

  /**
   * These two are the most tempting merge and the most wrong one.
   *
   * A price outside a modelled band presupposes a written band. A name with no
   * core thesis has no band at all. Merging them would produce a tile claiming
   * the price has left a framework that was never written.
   */
  it('never claims a price left a framework that does not exist', () => {
    const gap = findingOf(dislocatedFor())
    const thesis = findingOf(noThesisFor())
    expect(gap.claim.band).toBeTruthy()
    expect(thesis.claim.band ?? null).toBeNull()
    expect(wouldCompose(gap, thesis).compose).toBe(false)
  })
})

describe('C. expired target + dislocation + no core thesis', () => {
  const composed = () => composeForSubject([expiredFor(), dislocatedFor(), noThesisFor()])

  it('produces three situations and three tiles', () => {
    const c = composed()
    expect(c.tileCount).toBe(3)
    expect(c.absorbed).toBe(0)
    expect(c.declined).toEqual([])
  })

  it('asks three genuinely different questions', () => {
    expect(composed().questions.sort()).toEqual(['framework', 'target', 'thesis'])
  })

  /**
   * Three different jobs, three different afternoons.
   *
   * Revising a horizon, reconsidering a broken case and writing an argument
   * that was never written are not one decision, and a single tile offering one
   * button would make two of them invisible.
   */
  it('keeps a distinct primary action for each', () => {
    const [a, b, c] = [expiredFor(), dislocatedFor(), noThesisFor()].map(r => {
      if (!r.ok) throw new Error('unexpected decline')
      return r.adoption.card.actions.primary.id
    })
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The positive branch: findings that DO share a question
// ─────────────────────────────────────────────────────────────────────────────

describe('corroboration becomes context, not another tile', () => {
  /**
   * Two findings, one name, one question.
   *
   * `researchIssueFor` gives one case at most one framing, so production cannot
   * emit both of these today — the precedence rule prevents it upstream, and
   * that is the correct place for it. What this proves is the composer's
   * behaviour when two findings for one question DO arrive, which is the shape
   * the next adopted family will bring: `target_hit` and `target_expired` both
   * ask the target question and `usePortfolioLenses` pushes both for one asset
   * in the same loop.
   */
  const twoOnOneQuestion = () => {
    const a = findingOf(noThesisFor())
    const b = { ...findingOf(noThesisFor()), id: 'research-incomplete_case-a-amzn' }
    return composeSituations([a, b])
  }

  it('merges into one situation', () => {
    const s = twoOnOneQuestion()
    expect(s).toHaveLength(1)
    expect(corroborationCount(s[0])).toBe(2)
    expect(s[0].supporting).toHaveLength(1)
  })

  it('the second becomes supporting evidence rather than a second tile', () => {
    const [s] = twoOnOneQuestion()
    expect(s.lead.id).not.toBe(s.supporting[0].id)
    expect(s.supporting[0].question).toBe(s.question)
  })

  it('adds no score, so corroboration cannot inflate the feed', () => {
    const [one] = composeSituations([findingOf(noThesisFor())])
    const [two] = twoOnOneQuestion()
    expect(priorityFor(situationPriorityInput(two), NOW).total)
      .toBe(priorityFor(situationPriorityInput(one), NOW).total)
  })

  it('the composer agrees with wouldCompose', () => {
    const a = findingOf(noThesisFor())
    const b = { ...a, id: 'other' }
    expect(wouldCompose(a, b).compose).toBe(true)
    expect(composeSituations([a, b])).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Accounting
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing disappears', () => {
  it('a decline is counted, not dropped', () => {
    const notAdopted = adoptNoCoreThesis(
      { ...thesisInsight(), kind: 'stale_research' },
      thesisCard(),
      READER,
      PHONE,
    )
    const c = composeForSubject([expiredFor(), notAdopted])
    expect(c.tileCount).toBe(1)
    expect(c.declined).toHaveLength(1)
    expect(c.declined[0].detail).toContain('stale_research')
  })

  it('two different names never merge, whatever they ask', () => {
    const msft = adoptStaleTarget(staleTargetRow(), staleTargetCard(), READER, PHONE)
    const amzn = expiredFor()
    if (!msft.ok || !amzn.ok) throw new Error('unexpected decline')
    expect(composeSituations([msft.adoption.situation.lead, amzn.adoption.situation.lead]))
      .toHaveLength(2)
  })
})
