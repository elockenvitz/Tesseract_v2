/**
 * A suggested question exists only because a record does.
 *
 * ── What is being protected ──────────────────────────────────────────────
 *
 * Two failure modes, and they pull in opposite directions.
 *
 * The first is invented activity: a panel that says "3 recommendations need
 * your attention" when none do, or calls something overdue because it looks
 * old. Every assertion below that checks a `reason` is checking that the
 * sentence is a statement about rows that were actually returned.
 *
 * The second is instability. The panel renders these in order, so a
 * comparator that can return 0 for two different candidates lets them swap
 * places between renders, and a reader reaching for the third button gets a
 * different question than the one they read. The ordering tests are about
 * that, and they are the reason `key` is part of the comparator.
 */
import { describe, it, expect } from 'vitest'
import {
  candidatePrompts,
  compareCandidates,
  mergePrompts,
  FALLBACKS,
  STALLED_IDEA_DAYS,
  type CandidateInput,
  type GroundedPrompt,
} from '../prompt-candidates'

/** Nothing open, nothing bound. The state a new account is in. */
const empty: CandidateInput = { limit: 4 }

const busy: CandidateInput = {
  limit: 6,
  subject: { label: 'AAPL', kind: 'asset' },
  pendingDecisions: { count: 4, longestWaitingDays: 9, yoursToAnswer: 2 },
  pipeline: {
    readyToRecommend: 3,
    stalled: { symbol: 'MSFT', daysInStage: 21 },
    liveTotal: 16,
  },
  work: { overdueRequirements: 2, openRequirements: 11, busiestSymbol: 'NVDA' },
  lists: { flaggedCount: 5, flaggedListName: 'Semis watch' },
  coverage: { assetCount: 60 },
  recentDecisions: { count: 7, windowDays: 14 },
}

describe('nothing invented when nothing is open', () => {
  it('falls back to questions about the firm, with no reason attached', () => {
    const got = candidatePrompts(empty)
    expect(got).toHaveLength(4)
    for (const c of got) {
      expect(c.kind).toBe('generic')
      /* The important half: a fallback has no record behind it, so a
         justification here would be fabricated. Null, not a vague phrase. */
      expect(c.reason).toBeNull()
    }
    expect(got.map(c => c.text)).toEqual([...FALLBACKS].slice(0, 4))
  })

  it('offers no count-based question when every count is zero', () => {
    const got = candidatePrompts({
      limit: 6,
      pendingDecisions: { count: 0, longestWaitingDays: null, yoursToAnswer: 0 },
      pipeline: { readyToRecommend: 0, stalled: null, liveTotal: 0 },
      work: { overdueRequirements: 0, openRequirements: 0, busiestSymbol: null },
      lists: { flaggedCount: 0, flaggedListName: null },
      coverage: { assetCount: 0 },
      recentDecisions: { count: 0, windowDays: 14 },
    })
    expect(got.every(c => c.kind === 'generic')).toBe(true)
  })

  it('never names a subject it was not given', () => {
    /* The live defect this replaces offered "Analyze asset's thesis for
       blind spots" on first paint, because the label had not resolved and the
       code fell back to the tag TYPE. */
    const got = candidatePrompts({ limit: 4, subject: { label: null, kind: 'asset' } })
    for (const c of got) {
      expect(c.text).not.toMatch(/\basset('s)?\b/i)
      expect(c.text).not.toMatch(/\bundefined\b|\bnull\b/)
    }
  })
})

describe('every reason is a statement about records', () => {
  it('quotes the count and the wait it was given', () => {
    const got = candidatePrompts(busy)
    const yours = got.find(c => c.key === 'pending_decision:yours')
    expect(yours?.reason).toBe('2 recommendations are awaiting your ruling')
    const all = got.find(c => c.key === 'pending_decision:all')
    expect(all?.reason).toBe('4 in your decision inbox, the longest for 9 days')
  })

  it('never states a visible count as if it were the firm total', () => {
    /*
     * The rule these counts live under.
     *
     * Every fact behind a suggestion comes from a permission-scoped read, so
     * the number is what the CALLER can see. Measured against the live
     * database on 2026-11-11: 84 open decision requests exist and this reader
     * can see a fraction of them. A reason reading "18 are waiting" would be
     * a visible count presented as a total, which is the same partial truth
     * the retrieval tools declare a `visibility.scope` to avoid.
     *
     * So every reason has to say whose records it counted. Asserted as a
     * property rather than per string, because the next reason someone adds
     * is the one that will forget.
     */
    const got = candidatePrompts({ ...busy, limit: 50 })
    /* Addresses the reader, so the count is about their records. A heuristic,
       and deliberately one: it cannot tell "7 visible to you" from "84 are
       waiting for you". The exact strings above are the real check, and this
       is the net that catches a new reason nobody wrote an assertion for. */
    const addressesTheReader = (s: string) => /\byou\b|\byour\b/i.test(s)
    /* A reason that names one record is scoped by that record: it is a claim
       about a row, not a count of a population. */
    const namesARecord = (s: string) => /^[A-Z]{1,6}\b|^An idea\b/.test(s)
    for (const c of got) {
      if (!c.reason) continue
      expect(
        addressesTheReader(c.reason) || namesARecord(c.reason),
        `unscoped reason on ${c.key}: "${c.reason}"`,
      ).toBe(true)
    }
  })

  it('agrees with itself at one', () => {
    /* "1 days" and "1 requirements are" are the tell that a count was
       interpolated without being read. */
    const got = candidatePrompts({
      limit: 6,
      pendingDecisions: { count: 1, longestWaitingDays: 1, yoursToAnswer: 1 },
      work: { overdueRequirements: 1, openRequirements: 1, busiestSymbol: null },
      lists: { flaggedCount: 1, flaggedListName: null },
      coverage: { assetCount: 1 },
      recentDecisions: { count: 1, windowDays: 1 },
    })
    for (const c of got) {
      if (!c.reason) continue
      expect(c.reason, c.reason).not.toMatch(/\b1 (days|recommendations|requirements|entries|rulings|names)\b/)
      expect(c.reason, c.reason).not.toMatch(/\b1 are\b/)
    }
  })

  it('drops the wait from the sentence when it is unknown', () => {
    const got = candidatePrompts({
      limit: 4,
      pendingDecisions: { count: 3, longestWaitingDays: null, yoursToAnswer: 0 },
    })
    const all = got.find(c => c.key === 'pending_decision:all')
    expect(all?.reason).toBe('3 in your decision inbox')
    expect(all?.reason).not.toMatch(/longest/)
  })

  it('calls nothing overdue without a date that has passed', () => {
    const got = candidatePrompts({
      limit: 6,
      work: { overdueRequirements: 0, openRequirements: 11, busiestSymbol: 'NVDA' },
    })
    expect(got.some(c => c.kind === 'overdue_requirement')).toBe(false)
    for (const c of got) expect(c.text + (c.reason ?? '')).not.toMatch(/overdue|past (its|their) due/i)
    /* And the open-work question still appears, named. */
    const open = got.find(c => c.kind === 'open_requirement')
    expect(open?.text).toBe('What is left to finish on NVDA?')
    expect(open?.reason).toBe('11 of your requirements are still open')
  })

  it('calls nothing stalled until it has actually sat', () => {
    const justUnder = candidatePrompts({
      limit: 6,
      pipeline: { readyToRecommend: 0, stalled: { symbol: 'MSFT', daysInStage: STALLED_IDEA_DAYS - 1 }, liveTotal: 1 },
    })
    expect(justUnder.some(c => c.kind === 'stalled_idea')).toBe(false)

    const atThreshold = candidatePrompts({
      limit: 6,
      pipeline: { readyToRecommend: 0, stalled: { symbol: 'MSFT', daysInStage: STALLED_IDEA_DAYS }, liveTotal: 1 },
    })
    const s = atThreshold.find(c => c.kind === 'stalled_idea')
    expect(s?.text).toBe('What is holding up MSFT, and what would move it forward?')
    expect(s?.reason).toBe(`MSFT has not moved stage in ${STALLED_IDEA_DAYS} days`)
  })

  it('asks a working question about a stalled idea it cannot name', () => {
    const got = candidatePrompts({
      limit: 6,
      pipeline: { readyToRecommend: 0, stalled: { symbol: null, daysInStage: 30 }, liveTotal: 1 },
    })
    const s = got.find(c => c.kind === 'stalled_idea')
    expect(s?.text).toBe('Which of my ideas have stopped moving, and what is holding them up?')
    expect(s?.reason).toBe('An idea has not moved stage in 30 days')
  })

  it('does not read a ready-to-recommend idea as a recommendation', () => {
    /* The maturity axis ends at ready-to-recommend. A question that told the
       reader to submit it would be the merge the decision chain forbids, one
       step earlier. */
    const got = candidatePrompts({
      limit: 6,
      pipeline: { readyToRecommend: 3, stalled: null, liveTotal: 3 },
    })
    const r = got.find(c => c.kind === 'ready_to_recommend')
    expect(r?.text).toMatch(/ready to recommend/)
    expect(r?.text).not.toMatch(/submit|recommend it|send it|approve/i)
    expect(r?.reason).toBe('3 of your ideas are at ready to recommend')
  })
})

describe('ordering is total and stable', () => {
  it('puts what is waiting on a person above everything else', () => {
    const got = candidatePrompts(busy)
    expect(got[0].kind).toBe('pending_decision')
    const kinds = got.map(c => c.kind)
    expect(kinds.indexOf('pending_decision')).toBeLessThan(kinds.indexOf('overdue_requirement'))
    expect(kinds).not.toContain('generic')
  })

  it('returns the identical sequence for the identical input', () => {
    const a = candidatePrompts(busy).map(c => c.key)
    const b = candidatePrompts(busy).map(c => c.key)
    expect(a).toEqual(b)
  })

  it('breaks a weight tie rather than leaving two candidates equal', () => {
    /*
     * The test that actually exercises the tie-break.
     *
     * Every production weight band is a distinct number, so the fixture-wide
     * property test below cannot reach the `kind` and `key` terms -- it would
     * pass against a comparator that was nothing but `b.weight - a.weight`.
     * This one feeds the comparator the collision directly, which is the case
     * the contract exists for and the one a future weight change creates.
     */
    const at = (over: Partial<GroundedPrompt>): GroundedPrompt => ({
      key: 'coverage', text: 'A', reason: null, kind: 'coverage', weight: 55, ...over,
    })
    const coverage = at({})
    const recent = at({ key: 'recent_decision', kind: 'recent_decision' })
    expect(compareCandidates(coverage, recent)).toBeLessThan(0)
    expect(compareCandidates(recent, coverage)).toBeGreaterThan(0)

    /* Same weight AND same kind: the key is the last term, and it has to
       decide, because two candidates of one kind is the ordinary case. */
    const other = at({ key: 'coverage:zzz' })
    expect(compareCandidates(coverage, other)).toBeLessThan(0)
    expect(compareCandidates(other, coverage)).toBeGreaterThan(0)

    /* And a candidate equals only itself. */
    expect(compareCandidates(coverage, at({}))).toBe(0)
  })

  it('never returns 0 for two different candidates', () => {
    /* A safety net over the real candidate set, for the day two bands collide.
       It passes trivially today -- see the test above for why. */
    const all = candidatePrompts({ ...busy, limit: 50 })
    expect(all.length).toBeGreaterThan(6)
    for (const a of all) {
      for (const b of all) {
        if (a.key === b.key) continue
        expect(compareCandidates(a, b), `${a.key} vs ${b.key} tied`).not.toBe(0)
      }
    }
  })

  it('is antisymmetric, so the sort cannot depend on input order', () => {
    const all = candidatePrompts({ ...busy, limit: 50 })
    for (const a of all) {
      for (const b of all) {
        if (a.key === b.key) continue
        expect(Math.sign(compareCandidates(a, b))).toBe(-Math.sign(compareCandidates(b, a)))
      }
    }
  })

  it('honours the limit the layout asks for', () => {
    expect(candidatePrompts({ ...busy, limit: 4 })).toHaveLength(4)
    expect(candidatePrompts({ ...busy, limit: 6 })).toHaveLength(6)
    /* Research mode is a superset of compact: the reader who widens the pane
       must not lose a question they were just reading. */
    const four = candidatePrompts({ ...busy, limit: 4 }).map(c => c.key)
    const six = candidatePrompts({ ...busy, limit: 6 }).map(c => c.key)
    expect(six.slice(0, 4)).toEqual(four)
  })

  it('returns at least one question even when asked for none', () => {
    expect(candidatePrompts({ ...empty, limit: 0 }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('merging the two sources', () => {
  const grounded = candidatePrompts(busy)

  it('puts grounded questions ahead of bound-context ones', () => {
    const merged = mergePrompts(grounded, ['Analyze AAPL for blind spots'], 6)
    expect(merged[0].kind).toBe('pending_decision')
    expect(merged.some(c => c.text === 'Analyze AAPL for blind spots')).toBe(false)
    /* Crowded out at six, which is correct: a record beats a rephrasing of
       the subject the reader is already looking at.

       (Phrased that way on purpose. `vitest.config.ts` routes a test file to
       jsdom by regex-scanning its SOURCE TEXT for DOM hints, and one of them
       is the testing-library viewport handle followed by a dot. Writing that
       pair anywhere in this file -- in a comment, even inside a sentence
       explaining the trap -- sends a pure test to the jsdom project, where it
       appears in neither include list and silently does not run. */
  })

  it('uses bound-context questions to fill when little is open', () => {
    const thin = candidatePrompts({ limit: 4, coverage: { assetCount: 2 } })
    const merged = mergePrompts(thin, ['Analyze AAPL for blind spots', 'What are the key risks to AAPL?'], 4)
    expect(merged[0].kind).toBe('coverage')
    expect(merged.map(c => c.text)).toContain('Analyze AAPL for blind spots')
  })

  it('sorts the generic fallbacks below everything that arrived', () => {
    const merged = mergePrompts(candidatePrompts(empty), ['Analyze AAPL for blind spots'], 4)
    expect(merged[0].text).toBe('Analyze AAPL for blind spots')
    expect(merged.slice(1).every(c => c.kind === 'generic')).toBe(true)
  })

  it('offers the same question once, however it was phrased in', () => {
    const merged = mergePrompts(
      candidatePrompts(empty),
      ['What is in my Idea Pipeline?', 'what is in my idea pipeline?'],
      6,
    )
    const pipelineQuestions = merged.filter(c => /idea pipeline/i.test(c.text))
    expect(pipelineQuestions).toHaveLength(1)
  })

  it('drops blank contextual entries rather than rendering an empty button', () => {
    const merged = mergePrompts(candidatePrompts(empty), ['', '   '], 4)
    expect(merged.every(c => c.text.trim().length > 0)).toBe(true)
  })
})
