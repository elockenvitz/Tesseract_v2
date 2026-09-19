/**
 * The first producer on the candidate contract, and proof it changed nothing.
 *
 * Every producer in the product invents its own shape and hand-builds a
 * `DecisionItem` around it. So "what does the system think needs attention,
 * and why" lives in eight evaluators and cannot be asked as one question.
 *
 * `TRADE_REVIEW_OWED` goes first because it derives from a durable
 * `memory_obligations` row, so the contract gets checked against something
 * real rather than a shape invented to fit it.
 *
 * The important half of this suite is the last block: moving a producer onto
 * the contract must be invisible to Today. A refactor that quietly changed
 * eligibility or an id would break dismissals without failing anything else.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  tradeReviewCandidates,
  evaluateTradeReviewOwed,
  TRADE_REVIEW_OWED_KIND,
  type OpenTradeReviewObligation,
} from '../../../engine/decisionEngine/evaluators/tradeReviewOwed'
import { candidateToDecisionItem } from '../to-decision-item'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const NOW = new Date('2026-09-16T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const ob = (over: Partial<OpenTradeReviewObligation> = {}): OpenTradeReviewObligation => ({
  id: 'o1',
  subject_id: 't1',
  organization_id: 'org-1',
  owner_id: 'pm-1',
  raised_at: daysAgo(3),
  due_at: null,
  asset_symbol: 'AAPL',
  portfolio_name: 'Tech & Consumer Growth',
  ...over,
})

describe('an obligation maps deterministically into a candidate', () => {
  it('produces one candidate per open obligation', () => {
    const c = tradeReviewCandidates({ tradeReviewObligations: [ob()], now: NOW })
    expect(c).toHaveLength(1)
    expect(c[0].kind).toBe(TRADE_REVIEW_OWED_KIND)
    expect(c[0].subjectType).toBe('trade')
    expect(c[0].subjectId).toBe('t1')
    expect(c[0].organizationId).toBe('org-1')
  })

  it('is a pure function of the obligation and the clock', () => {
    const args = { tradeReviewObligations: [ob()], now: NOW }
    expect(tradeReviewCandidates(args)).toEqual(tradeReviewCandidates(args))
  })

  /* `occurredAt` is when it started being owed, not when this ran -- it is
     what "how long has this been waiting" is measured from. */
  it('dates the claim from when it was raised', () => {
    const c = tradeReviewCandidates({ tradeReviewObligations: [ob()], now: NOW })
    expect(c[0].occurredAt).toBe(daysAgo(3))
    expect(c[0].facts?.waitingDays).toBe(3)
  })

  it('says nothing when nothing is owed', () => {
    expect(tradeReviewCandidates({ tradeReviewObligations: [], now: NOW })).toEqual([])
    expect(tradeReviewCandidates({ now: NOW })).toEqual([])
  })
})

describe('the claim keeps its identity and its reason', () => {
  /* Load-bearing: a dismissal is recorded against this id. An id that varied
     with time would make the reader answer the same question every morning. */
  it('uses the obligation id, unchanged by age', () => {
    const young = tradeReviewCandidates({ tradeReviewObligations: [ob()], now: NOW })
    const old = tradeReviewCandidates({
      tradeReviewObligations: [ob({ raised_at: daysAgo(90) })], now: NOW,
    })
    expect(young[0].id).toBe('trade-review-o1')
    expect(old[0].id).toBe(young[0].id)
  })

  it.each([
    ['fresh', { raised_at: daysAgo(1) }, 'yellow'],
    ['a week old', { raised_at: daysAgo(8) }, 'orange'],
    ['a fortnight old', { raised_at: daysAgo(15) }, 'red'],
    ['past its own due date', { raised_at: daysAgo(1), due_at: daysAgo(1) }, 'red'],
  ])('severity for %s is %s', (_n, over, expected) => {
    const c = tradeReviewCandidates({ tradeReviewObligations: [ob(over)], now: NOW })
    expect(c[0].severity).toBe(expected)
  })

  it('distinguishes overdue from merely waiting in the reason', () => {
    const waiting = tradeReviewCandidates({ tradeReviewObligations: [ob()], now: NOW })[0]
    const overdue = tradeReviewCandidates({
      tradeReviewObligations: [ob({ due_at: daysAgo(1) })], now: NOW,
    })[0]
    expect(waiting.reason).not.toBe(overdue.reason)
    expect(overdue.reason).toContain('past its expected execution date')
  })
})

describe('provenance points back at real rows', () => {
  const c = tradeReviewCandidates({ tradeReviewObligations: [ob()], now: NOW })[0]

  it('names the producer and the authoritative source', () => {
    expect(c.provenance.producer).toBe('evaluator:tradeReviewOwed')
    expect(c.provenance.sourceType).toBe('accepted_trades')
    expect(c.provenance.sourceId).toBe('t1')
  })

  /* This candidate exists BECAUSE an obligation is open. That is why this
     producer went first. */
  it('references the obligation it came from', () => {
    expect(c.memoryRefs).toEqual([{ kind: 'obligation', id: 'o1' }])
  })

  /* Intent, not presentation. A producer specifying button styling would be
     dictating layout, which the contract exists to prevent. */
  it('carries actions as intent, with no labels or styling', () => {
    expect(c.actions).toEqual([{ actionKey: 'OPEN_TRADE_BOOK', payload: { tradeId: 't1' } }])
  })
})

describe('the contract does not creep into layout or ranking', () => {
  const contract = src('lib/feed/candidate.ts')

  /* Asserted against the DECLARATIONS, not the prose: the file discusses
     several of these by name precisely to say they are excluded. */
  const fields = contract
    .slice(contract.indexOf('export interface FeedCandidate'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it.each(['sortScore', 'rank', 'tier', 'chips', 'className', 'icon', 'color'])(
    'has no %s field', (field) => {
      expect(fields).not.toContain(`${field}`)
    })

  it('scores nothing', () => {
    const c = tradeReviewCandidates({ tradeReviewObligations: [ob()], now: NOW })[0]
    expect('sortScore' in c).toBe(false)
  })
})

describe('Today sees exactly what it saw before', () => {
  const items = evaluateTradeReviewOwed({ tradeReviewObligations: [ob()], now: NOW })

  it('still emits one DecisionItem per obligation, with the same id', () => {
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('trade-review-o1')
    expect(items[0].titleKey).toBe('TRADE_REVIEW_OWED')
    expect(items[0].title).toBe('Trade Needs Review')
  })

  it('keeps eligibility unchanged', () => {
    expect(evaluateTradeReviewOwed({ tradeReviewObligations: [], now: NOW })).toHaveLength(0)
    expect(evaluateTradeReviewOwed({ now: NOW })).toHaveLength(0)
  })

  it('keeps severity, chips and the CTA', () => {
    expect(items[0].severity).toBe('yellow')
    expect(items[0].chips?.map(c => c.label)).toEqual(['Ticker', 'Portfolio', 'Waiting'])
    expect(items[0].ctas?.[0]).toMatchObject({ label: 'Open Trade Book', actionKey: 'OPEN_TRADE_BOOK' })
  })

  /* The adapter must not decorate the id: it IS the suppression key. */
  it('passes the candidate id straight through', () => {
    const item = candidateToDecisionItem(
      tradeReviewCandidates({ tradeReviewObligations: [ob()], now: NOW })[0],
      { title: 't', titleKey: 'k', category: 'risk' },
    )
    expect(item.id).toBe('trade-review-o1')
    expect(item.sortScore).toBe(0)
  })
})
