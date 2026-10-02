/**
 * The first candidate that exists because of memory, and its ranking.
 *
 * Eligibility is most of this file. Every clause that keeps a candidate OUT
 * is a case where showing it would be wrong — a decided idea, a row RLS
 * hid, a date the user set for next month — and each one is cheap to break
 * accidentally.
 */
import { describe, it, expect } from 'vitest'
import {
  readyToRevisitCandidates,
  evaluateReadyToRevisit,
  isEligible,
  candidateId,
  whereYouLeftIt,
  factsForTile,
  READY_TO_REVISIT_KIND,
  MAX_FACTS_SHOWN,
} from '../ready-to-revisit'
import type { RevisitCandidate } from '../due-obligations'
import type { ChangeFact } from '../what-changed'
import {
  computeSortScore,
  USER_REQUESTED_BONUS,
  EVIDENCE_BONUS,
  MAX_EVIDENCE_COUNTED,
} from '../../../engine/decisionEngine/scoring'
import type { DecisionItem } from '../../../engine/decisionEngine/types'

const NOW = new Date('2026-10-01T12:00:00Z')

const candidate = (over: Partial<RevisitCandidate> = {}): RevisitCandidate => ({
  obligationId: 'ob-1',
  kind: 'idea_revisit',
  subjectType: 'idea',
  subjectId: 'idea-1',
  ideaId: 'idea-1',
  ownerId: 'user-1',
  parkedAt: '2026-09-10T00:00:00Z',
  dueAt: '2026-09-20T00:00:00Z',
  waitingFor: null,
  dueState: 'due',
  daysOverdue: 11,
  daysParked: 10,
  symbol: 'NVDA',
  companyName: 'NVIDIA Corp',
  assetId: 'asset-1',
  portfolioId: 'pf-1',
  portfolioName: 'Core Growth',
  stage: 'researching',
  conviction: 'medium',
  terminal: false,
  href: '/trade-queue?idea=idea-1',
  resolved: true,
  ...over,
})

const fact = (over: Partial<ChangeFact> = {}): ChangeFact => ({
  kind: 'price_change',
  label: '+8.4% price',
  from: '2026-09-09',
  to: '2026-09-30',
  confidence: 'SAFE_WITH_ATTRIBUTION',
  sourceType: 'price_history_cache',
  sourceIds: ['NVDA'],
  magnitude: 8.4,
  ...over,
})

const produce = (
  candidates: RevisitCandidate[],
  facts: Record<string, ChangeFact[]> = {},
  dismissedIds?: Set<string>,
) =>
  readyToRevisitCandidates({
    candidates,
    factsBySubject: new Map(Object.entries(facts)),
    dismissedIds,
    now: NOW,
  })

describe('eligibility', () => {
  it('a due, resolved, live obligation produces a candidate', () => {
    expect(produce([candidate()])).toHaveLength(1)
  })

  it('a scheduled obligation does not — they asked for later', () => {
    expect(produce([candidate({ dueState: 'scheduled' })])).toHaveLength(0)
  })

  it('an open-ended obligation does not — no date means no "now"', () => {
    expect(produce([candidate({ dueState: 'open_ended', dueAt: null })])).toHaveLength(0)
  })

  it('an unresolved subject does not — RLS hid it or it is gone', () => {
    // A candidate that cannot name what it is about must not speak.
    expect(produce([candidate({ resolved: false })])).toHaveLength(0)
  })

  it('a terminal subject does not — nothing to resume', () => {
    // The obligation stays OPEN (only a real action clears it, and nobody
    // performed one) but the idea was decided or archived while parked.
    expect(produce([candidate({ terminal: true })])).toHaveLength(0)
  })

  it('a dismissed candidate does not, and loses no ranking slot', () => {
    const c = candidate()
    expect(produce([c], {}, new Set([candidateId(c)]))).toHaveLength(0)
  })

  it('isEligible is the single gate', () => {
    expect(isEligible(candidate(), undefined)).toBe(true)
    expect(isEligible(candidate({ terminal: true }), undefined)).toBe(false)
  })
})

describe('the claim', () => {
  it('says what was asked and when, without saying why', () => {
    // We recorded THAT the work was parked, never the reasoning. The claim
    // must not imply we know the latter.
    const [c] = produce([candidate()])
    expect(c.reason).toContain('You asked to revisit this idea 11 days ago.')
    expect(c.reason).not.toMatch(/because|since you (thought|believed)/i)
  })

  it('says "today" and "yesterday" rather than 0 and 1 days', () => {
    expect(produce([candidate({ daysOverdue: 0 })])[0].reason).toContain('today')
    expect(produce([candidate({ daysOverdue: 1 })])[0].reason).toContain('yesterday')
  })

  it('mentions changes only when there are some', () => {
    expect(produce([candidate()])[0].reason).not.toMatch(/changed/i)
    const withFacts = produce([candidate()], { 'idea-1': [fact()] })
    expect(withFacts[0].reason).toMatch(/changed/i)
  })

  it('names a deferred recommendation as a recommendation', () => {
    const [c] = produce([candidate({ kind: 'decision_revisit', subjectType: 'decision' })])
    expect(c.reason).toContain('this recommendation')
    expect(c.subjectType).toBe('decision')
  })

  it('finds a deferred recommendation\'s facts under its IDEA, not its request', () => {
    // The obligation's subject is the decision request; the facts were
    // gathered against the idea behind it. Keying on subjectId here would
    // silently return no changes for every deferred candidate.
    const [c] = produce(
      [candidate({ kind: 'decision_revisit', subjectType: 'decision', subjectId: 'dr-1', ideaId: 'idea-1' })],
      { 'idea-1': [fact()] },
    )
    expect(c.facts?.changeCount).toBe(1)
    expect(c.facts?.changeSummary).toBe('+8.4% price')
  })

  it('quotes the stated reason rather than the elapsed time', () => {
    const [c] = produce([candidate({ waitingFor: 'Q3 earnings' })])
    expect(c.reason).toBe('You parked this idea while waiting for Q3 earnings.')
  })

  it('falls back to the generic wording when no reason was given', () => {
    expect(produce([candidate({ waitingFor: null })])[0].reason)
      .toContain('You asked to revisit this idea 11 days ago.')
  })

  it('never says the awaited thing happened, however overdue', () => {
    // The only inference a reader might expect, and the one that would be
    // false: there is no earnings calendar and no price watcher, so a
    // passed due date is evidence about the calendar and nothing else.
    const [c] = produce([candidate({ waitingFor: 'Q3 earnings', daysOverdue: 120 })])
    expect(c.reason).not.toMatch(/happened|occurred|has now|reported|released|took place/i)
  })

  it('carries the reason verbatim for the surface to quote', () => {
    const [c] = produce([candidate({ waitingFor: 'the CFO search to conclude' })])
    expect(c.facts?.waitingFor).toBe('the CFO search to conclude')
  })

  it('measures from when it was parked, not from when this ran', () => {
    expect(produce([candidate()])[0].occurredAt).toBe('2026-09-10T00:00:00Z')
  })

  it('points at the obligation that caused it', () => {
    const [c] = produce([candidate()])
    expect(c.memoryRefs).toEqual([{ kind: 'obligation', id: 'ob-1' }])
    expect(c.provenance).toMatchObject({ sourceType: 'memory_obligations', sourceId: 'ob-1' })
  })

  it('has a stable id with nothing time-varying in it', () => {
    // An id carrying the day count would make every dismissal an orphan the
    // next morning — the defect two existing producers already have.
    const a = candidateId(candidate({ daysOverdue: 11 }))
    const b = candidateId(candidate({ daysOverdue: 40 }))
    expect(a).toBe(b)
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('carried facts', () => {
  it('carries scalars a surface needs, not blobs', () => {
    const [c] = produce([candidate()])
    for (const v of Object.values(c.facts ?? {})) {
      // `undefined` is allowed alongside null: the contract's facts map is
      // `string | number | null`, and an absent key is how a producer says
      // "we do not have this" without the surface rendering an empty slot.
      expect(['string', 'number', 'object', 'undefined']).toContain(typeof v)
      if (typeof v === 'object') expect(v).toBeNull()
    }
  })

  it('carries where you left it', () => {
    const [c] = produce([candidate()])
    expect(c.facts).toMatchObject({ stage: 'researching', conviction: 'medium' })
  })

  it('summarises at most three changes but counts them all', () => {
    const many = [fact(), fact({ kind: 'research_added', label: '3 new research items' }),
      fact({ kind: 'idea_edited', label: 'The idea was edited' }),
      fact({ kind: 'decision_recorded', label: '1 decision recorded' })]
    const [c] = produce([candidate()], { 'idea-1': many })
    expect(c.facts?.changeCount).toBe(4)
    expect(String(c.facts?.changeSummary).split(' · ')).toHaveLength(MAX_FACTS_SHOWN)
  })

  it('leaves the summary null when nothing changed', () => {
    expect(produce([candidate()])[0].facts?.changeSummary).toBeNull()
  })

  it('never carries an UNRELIABLE fact', () => {
    const bad = [fact({ confidence: 'UNRELIABLE', label: 'earnings happened' })]
    const [c] = produce([candidate()], { 'idea-1': bad })
    expect(c.facts?.changeCount).toBe(0)
    expect(c.facts?.changeSummary).toBeNull()
  })

  it('factsForTile agrees with the summary about which three', () => {
    const many = [fact(), fact({ kind: 'research_added', label: 'b' }), fact({ kind: 'idea_edited', label: 'c' }), fact({ kind: 'trade_committed', label: 'd' })]
    const map = new Map([['idea-1', many]])
    const tile = factsForTile(map, 'idea-1').map(f => f.label)
    const [c] = produce([candidate()], { 'idea-1': many })
    expect(String(c.facts?.changeSummary)).toBe(tile.join(' · '))
  })
})

describe('where you left it', () => {
  it('joins stage and conviction', () => {
    expect(whereYouLeftIt('researching', 'medium')).toBe('Researching · Medium conviction')
  })

  it('renders only what exists', () => {
    expect(whereYouLeftIt('researching', null)).toBe('Researching')
    expect(whereYouLeftIt(null, 'high')).toBe('High conviction')
  })

  it('returns null rather than "Unknown · Unknown"', () => {
    expect(whereYouLeftIt(null, null)).toBeNull()
  })
})

/* ── Phase 4: ranking ─────────────────────────────────────────────────── */

const scored = (item: Partial<DecisionItem>): number =>
  computeSortScore({
    id: 'x', surface: 'action', severity: 'yellow', category: 'process',
    title: 't', titleKey: 'K', description: '', chips: [], context: {},
    ctas: [], dismissible: false, decisionTier: 'coverage', sortScore: 0,
    createdAt: NOW.toISOString(), ...item,
  } as DecisionItem, NOW)

describe('ranking', () => {
  it('explicit user intent outranks an inferred finding of the same shape', () => {
    expect(scored({ userRequested: true })).toBe(scored({}) + USER_REQUESTED_BONUS)
  })

  it('but cannot outrank a more severe item in the same tier', () => {
    // 1500 is less than the 2000 step from yellow to orange. A quiet
    // reminder must not sit above a real finding.
    expect(scored({ userRequested: true, severity: 'yellow' }))
      .toBeLessThan(scored({ severity: 'orange' }))
  })

  it('and cannot promote a coverage item above a capital one', () => {
    expect(scored({ userRequested: true, evidenceCount: 10, decisionTier: 'coverage' }))
      .toBeLessThan(scored({ decisionTier: 'capital', severity: 'gray' }))
  })

  it('evidence lifts it, with a cap', () => {
    expect(scored({ evidenceCount: 2 })).toBe(scored({}) + 2 * EVIDENCE_BONUS)
    expect(scored({ evidenceCount: 99 })).toBe(scored({}) + MAX_EVIDENCE_COUNTED * EVIDENCE_BONUS)
  })

  it('no evidence is no bonus, not a penalty', () => {
    expect(scored({ evidenceCount: 0 })).toBe(scored({}))
    expect(scored({ evidenceCount: undefined })).toBe(scored({}))
  })

  it('overdue magnitude is already priced by age, not double counted', () => {
    // createdAt is the park date, so the existing age term carries it.
    const fresh = scored({ createdAt: NOW.toISOString() })
    const old = scored({ createdAt: '2026-09-01T12:00:00Z' })
    expect(old).toBeGreaterThan(fresh)
  })

  it('the whole memory bonus is smaller than one severity step', () => {
    const maxBonus = USER_REQUESTED_BONUS + MAX_EVIDENCE_COUNTED * EVIDENCE_BONUS
    expect(maxBonus).toBeLessThan(10000 - 7000) // red − orange
  })
})

describe('as decision items', () => {
  const items = (cands: RevisitCandidate[], facts: Record<string, ChangeFact[]> = {}) =>
    evaluateReadyToRevisit({
      candidates: cands, factsBySubject: new Map(Object.entries(facts)), now: NOW,
    })

  it('is marked user-requested and carries its evidence count', () => {
    const [i] = items([candidate()], { 'idea-1': [fact(), fact({ kind: 'idea_edited', label: 'x' })] })
    expect(i.userRequested).toBe(true)
    expect(i.evidenceCount).toBe(2)
    expect(i.titleKey).toBe(READY_TO_REVISIT_KIND)
  })

  it('sits in the coverage tier — the reader\'s own queue, not a capital event', () => {
    expect(items([candidate()])[0].decisionTier).toBe('coverage')
  })

  it('offers exactly one CTA, back to the work', () => {
    const [i] = items([candidate()])
    expect(i.ctas).toHaveLength(1)
    expect(i.ctas[0]).toMatchObject({ actionKey: 'RESUME_WORK', label: 'Resume work' })
    expect(i.ctas[0].payload).toMatchObject({ tradeQueueItemId: 'idea-1', href: '/trade-queue?idea=idea-1' })
  })

  it('drops empty chips rather than rendering blanks', () => {
    const [i] = items([candidate({ portfolioName: null })])
    expect((i.chips ?? []).map(c => c.label)).not.toContain('Portfolio')
  })

  it('many due obligations all produce items', () => {
    const many = Array.from({ length: 12 }, (_, n) =>
      candidate({ obligationId: `ob-${n}`, subjectId: `idea-${n}` }))
    expect(items(many)).toHaveLength(12)
  })

  it('a mixed batch yields only the eligible ones', () => {
    const mixed = [
      candidate({ obligationId: 'a', subjectId: 'i-a' }),
      candidate({ obligationId: 'b', subjectId: 'i-b', terminal: true }),
      candidate({ obligationId: 'c', subjectId: 'i-c', dueState: 'scheduled' }),
      candidate({ obligationId: 'd', subjectId: 'i-d', resolved: false }),
    ]
    expect(items(mixed)).toHaveLength(1)
  })
})
