/**
 * Focused tests for the Decisions domain layer.
 *
 * Scope: portfolio-scoped identity, outcome families, the provenance rule that
 * separates a written reason from a system string, what the record can and
 * cannot prove, ordering, the since-decision window, and target construction.
 * Pure — no React, no network.
 */

import { describe, it, expect } from 'vitest'
import {
  outcomeOf, OUTCOME_LABEL, statusDetail, provenanceOf, reasonLabel, provable,
  headline, summaryOf, compareDecisions, daysSince, targetFor, seedPromptFor,
  RESOLVED, NOT_RECORDED_AT_DECISION,
  type DecisionRecord, type DecisionStatus,
} from './index'
import { windowSinceDecision } from '../../components/decisions-v2/DecisionVisual'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const decision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: 'dr-1', ideaId: 'tq-1',
  portfolioId: 'p1', portfolioName: 'Vision Fund 10K',
  assetId: 'a-orcl', symbol: 'ORCL', companyName: 'Oracle',
  status: 'accepted', action: 'buy',
  decidedBy: 'u1', decidedByName: 'Eric Lockenvitz', decidedAt: daysAgo(160),
  requestedByName: 'Seb Barbero', requestedAt: daysAgo(170),
  decisionNote: null, contextNote: null,
  sizingWeight: 2, sizingShares: null, baselineWeight: null,
  deferredUntil: null, execution: null,
  ...over,
})

/* -------------------------------------------------------------- identity */

describe('a decision is (idea, portfolio, outcome)', () => {
  it('keeps the same idea in two books as two decisions', () => {
    const core = decision({ id: 'dr-a', portfolioId: 'p1', portfolioName: 'Large Cap Core', status: 'accepted' })
    const growth = decision({ id: 'dr-b', portfolioId: 'p2', portfolioName: 'Large Cap Growth', status: 'withdrawn' })
    // Same idea, same asset, two books, two different outcomes.
    expect(core.ideaId).toBe(growth.ideaId)
    expect(core.id).not.toBe(growth.id)
    expect(outcomeOf(core.status)).not.toBe(outcomeOf(growth.status))
  })

  it('binds the engagement target to one book, not to the asset in general', () => {
    const t = targetFor(decision({ portfolioId: 'p2', portfolioName: 'Large Cap Growth' }))!
    expect(t.portfolioId).toBe('p2')
    expect(t.portfolioName).toBe('Large Cap Growth')
    // The origin distinguishes this decision from the same idea's other one.
    expect(t.origin?.itemId).toBe('dr-1')
    expect(t.origin?.surface).toBe('decisions')
  })
})

/* -------------------------------------------------------------- outcomes */

describe('outcome families', () => {
  it('never folds withdrawn into declined', () => {
    // 29 rows in this org are withdrawn. Reading them as rejections would
    // invent 29 refusals nobody made.
    expect(outcomeOf('withdrawn')).toBe('withdrawn')
    expect(outcomeOf('rejected')).toBe('declined')
    expect(OUTCOME_LABEL.withdrawn).toBe('Withdrawn')
    expect(OUTCOME_LABEL.declined).toBe('Declined')
  })

  it('says a withdrawal happened before anyone decided', () => {
    const text = summaryOf(decision({ status: 'withdrawn', decidedByName: null, decidedAt: null }))
    expect(text).toContain('withdrawn before a decision was recorded')
    expect(text).not.toMatch(/reject|declin/i)
  })

  it('handles statuses production has never yet produced', () => {
    // rejected and deferred have zero rows today and are real workflow states.
    for (const s of ['rejected', 'deferred', 'accepted_with_modification',
                     'under_review', 'needs_discussion'] as DecisionStatus[]) {
      expect(OUTCOME_LABEL[outcomeOf(s)]).toBeTruthy()
      expect(summaryOf(decision({ status: s })).length).toBeGreaterThan(20)
    }
    expect(statusDetail(decision({ status: 'accepted_with_modification' })))
      .toBe('Accepted with modification')
  })

  it('treats every resolved status as resolved and pending as not', () => {
    expect(RESOLVED.has('accepted')).toBe(true)
    expect(RESOLVED.has('withdrawn')).toBe(true)
    expect(RESOLVED.has('deferred')).toBe(true)
    expect(RESOLVED.has('pending')).toBe(false)
    expect(outcomeOf('pending')).toBe('open')
  })

  it('never labels an outcome good, bad, right or wrong', () => {
    const words = /good|bad|winner|loser|correct|wrong|success|fail|mistake/i
    for (const s of ['accepted', 'rejected', 'withdrawn', 'deferred', 'pending'] as DecisionStatus[]) {
      expect(OUTCOME_LABEL[outcomeOf(s)]).not.toMatch(words)
      expect(summaryOf(decision({ status: s }))).not.toMatch(words)
      expect(headline(decision({ status: s }))).not.toMatch(words)
    }
  })
})

/* ------------------------------------------------------------ provenance */

describe('a system string is not a reason', () => {
  it('classifies the machine notes production actually contains', () => {
    // 37 of 43 notes in this org are this one string.
    expect(provenanceOf('Self-proposed via Trade Lab Execute')).toBe('system')
    expect(provenanceOf('Withdrawn during cleanup — no active recommendation')).toBe('system')
    expect(provenanceOf('Backfilled: resolved by Trade Lab Execute (executed 2026-04-13)')).toBe('system')
  })

  it('classifies the one real human note as human', () => {
    expect(provenanceOf('i like this idea, makes sense')).toBe('human')
  })

  it('returns null for nothing, rather than guessing', () => {
    expect(provenanceOf(null)).toBeNull()
    expect(provenanceOf('')).toBeNull()
    expect(provenanceOf('   ')).toBeNull()
  })

  it('only ever calls human text a reason', () => {
    expect(reasonLabel('human')).toBe('Why we decided')
    expect(reasonLabel('system')).toBe('System record')
    expect(reasonLabel('system')).not.toMatch(/why|reason|rationale/i)
  })

  it('does not misread a human note that happens to mention the machinery', () => {
    // Matching is on literal prefixes, so this stays human.
    expect(provenanceOf('Trimmed here rather than in Trade Lab, per the PM')).toBe('human')
  })
})

/* --------------------------------------------------------- what we know */

describe('what the record can prove', () => {
  it('needs both an actor and a date before claiming a decision was made', () => {
    expect(provable(decision()).actorAndDate).toBe(true)
    expect(provable(decision({ decidedAt: null })).actorAndDate).toBe(false)
    expect(provable(decision({ decidedBy: null })).actorAndDate).toBe(false)
  })

  it('counts only a human note as a recorded reason', () => {
    expect(provable(decision({ decisionNote: 'i like this idea, makes sense' })).humanReason).toBe(true)
    expect(provable(decision({ decisionNote: 'Self-proposed via Trade Lab Execute' })).humanReason).toBe(false)
    expect(provable(decision({ decisionNote: null })).humanReason).toBe(false)
  })

  it('separates the submission rationale from the decision reason', () => {
    const p = provable(decision({ decisionNote: null, contextNote: 'get long pal' }))
    expect(p.submissionReason).toBe(true)
    expect(p.humanReason).toBe(false)
  })

  it('only claims a decision-time weight where the snapshot recorded one', () => {
    expect(provable(decision({ baselineWeight: 3.9 })).weightAtDecision).toBe(true)
    // Today's holdings cannot answer what the book weighed that day.
    expect(provable(decision({ baselineWeight: null })).weightAtDecision).toBe(false)
  })

  it('only claims a decision-time price where one was captured', () => {
    expect(provable(decision(), 120.5).priceAtDecision).toBe(true)
    expect(provable(decision(), null).priceAtDecision).toBe(false)
    expect(provable(decision(), 0).priceAtDecision).toBe(false)
  })

  it('names the framework facts nobody records, so absence is legible', () => {
    const said = NOT_RECORDED_AT_DECISION.join(' ')
    expect(said).toMatch(/thesis/)
    expect(said).toMatch(/target/)
    expect(said).toMatch(/scenario/)
    expect(said).toMatch(/research/)
  })
})

/* --------------------------------------------------- decision vs execution */

describe('decision and execution are separate facts', () => {
  it('says so when an accepted decision has no execution', () => {
    const text = summaryOf(decision({ status: 'accepted', execution: null }))
    expect(text).toContain('No execution is recorded')
  })

  it('states execution only where a completion date exists', () => {
    const started = decision({
      execution: { id: 'at1', status: 'not_started', completedAt: null, executedByName: null },
    })
    expect(provable(started).execution).toBe(true)
    // Raised but incomplete is its own state — not "executed", and not
    // "nothing recorded" either.
    expect(summaryOf(started)).toContain('raised but has not completed')
    expect(summaryOf(started)).not.toContain('No execution is recorded')

    expect(summaryOf(decision({ execution: null }))).toContain('No execution is recorded')

    const done = decision({
      execution: { id: 'at1', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' },
    })
    expect(summaryOf(done)).toContain('it was executed')
  })

  it('never presents accepted and executed as the same word', () => {
    const accepted = summaryOf(decision({ status: 'accepted', execution: null }))
    expect(accepted).toContain('accepted')
    expect(accepted).not.toMatch(/\bwas executed\b/)
  })
})

/* ---------------------------------------------------------------- window */

describe('the since-decision window tells the truth about its own span', () => {
  const series = (n: number, from: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.now() - (from - i) * DAY).toISOString().slice(0, 10),
      close: 100 + i,
    }))

  it('slices at the decision when history reaches it', () => {
    const w = windowSinceDecision(series(300, 300), daysAgo(160))!
    expect(w.reachesDecision).toBe(true)
    expect(w.series.length).toBeLessThan(180)
    expect(w.days).toBeLessThanOrEqual(161)
  })

  it('refuses to claim a since-decision move when history starts later', () => {
    const w = windowSinceDecision(series(60, 60), daysAgo(400))!
    expect(w.reachesDecision).toBe(false)
    expect(w.series.length).toBe(60)
  })

  it('refuses when the decision has no date at all', () => {
    expect(windowSinceDecision(series(60, 60), null)!.reachesDecision).toBe(false)
  })

  it('returns nothing rather than a line from one point', () => {
    expect(windowSinceDecision([{ date: '2026-01-01', close: 100 }], daysAgo(30))).toBeNull()
    expect(windowSinceDecision(undefined, daysAgo(30))).toBeNull()
  })

  it('measures the move over the slice, not the whole series', () => {
    const sliced = windowSinceDecision(series(300, 300), daysAgo(160))!
    const full = windowSinceDecision(series(300, 300), null)!
    expect(Math.abs(sliced.changePct - full.changePct)).toBeGreaterThan(1)
  })
})

/* -------------------------------------------------------------- ordering */

describe('history is chronological, not ranked', () => {
  it('puts the most recent decision first', () => {
    const older = decision({ id: 'a', decidedAt: daysAgo(200) })
    const newer = decision({ id: 'b', decidedAt: daysAgo(10) })
    expect([older, newer].sort(compareDecisions)[0].id).toBe('b')
  })

  it('falls back to the request date for anything undecided', () => {
    const pending = decision({ id: 'p', status: 'pending', decidedAt: null, requestedAt: daysAgo(1) })
    const decided = decision({ id: 'd', decidedAt: daysAgo(100) })
    expect([decided, pending].sort(compareDecisions)[0].id).toBe('p')
  })

  it('is a total order', () => {
    const a = decision({ id: 'a-1' }), b = decision({ id: 'b-1' })
    expect(compareDecisions(a, b)).toBeLessThan(0)
    expect(compareDecisions(b, a)).toBeGreaterThan(0)
    expect(compareDecisions(a, a)).toBe(0)
  })

  it('exposes no priority, tier or score to rank history by', async () => {
    const mod = await import('./model')
    const names = Object.keys(mod).join(' ').toLowerCase()
    for (const forbidden of ['tierof', 'scoreof', 'priority', 'urgency', 'quality', 'grade', 'hitrate']) {
      expect(names).not.toContain(forbidden)
    }
  })
})

/* ------------------------------------------------------------ engagement */

describe('the AI target carries the decision, not just the name', () => {
  it('targets the asset, which Discuss already supports', () => {
    const t = targetFor(decision())!
    expect(t.objectType).toBe('asset')
    expect(t.objectId).toBe('a-orcl')
    expect(t.issue?.reason).toBe('decision:accepted')
  })

  it('only builds chips from values that exist', () => {
    const bare = targetFor(decision({
      decidedByName: null, decidedAt: null, sizingWeight: null,
      baselineWeight: null, decisionNote: null, execution: null,
    }))!
    const labels = (bare.contextChips ?? []).map(c => c.label)
    expect(labels).toContain('Decision')
    expect(labels).not.toContain('Weight then')
    expect(labels).not.toContain('Executed')
    expect(labels).not.toContain('Reason')
    expect(labels).not.toContain('Since decision')
  })

  it('marks a reason as recorded only when a human wrote it', () => {
    const machine = targetFor(decision({ decisionNote: 'Self-proposed via Trade Lab Execute' }))!
    expect((machine.contextChips ?? []).map(c => c.label)).not.toContain('Reason')
    const human = targetFor(decision({ decisionNote: 'i like this idea, makes sense' }))!
    expect((human.contextChips ?? []).map(c => c.label)).toContain('Reason')
  })

  it('includes the subsequent move only when one was measured', () => {
    const withMove = targetFor(decision(), -39)!
    expect((withMove.contextChips ?? []).find(c => c.label === 'Since decision')?.value).toBe('-39.0%')
    expect((targetFor(decision(), null)!.contextChips ?? []).map(c => c.label))
      .not.toContain('Since decision')
  })

  it('asks the reader to judge, and never asserts a verdict', () => {
    for (const s of ['accepted', 'rejected', 'withdrawn', 'deferred', 'pending'] as DecisionStatus[]) {
      const prompt = seedPromptFor(decision({ status: s }), -12)
      expect(prompt.length).toBeGreaterThan(40)
      expect(prompt).not.toMatch(/was (a )?(good|bad|correct|wrong)/i)
    }
  })
})

describe('daysSince', () => {
  it('is null rather than zero for a missing date', () => {
    expect(daysSince(null)).toBeNull()
    expect(daysSince('not a date')).toBeNull()
    expect(daysSince(daysAgo(5))).toBe(5)
  })
})
