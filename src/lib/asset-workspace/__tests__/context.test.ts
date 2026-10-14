/**
 * The workspace resolver decides what a reader sees first. These tests are
 * mostly about the claims it must refuse to make.
 *
 * A signal is rendered as a statement of fact with a link to the records
 * behind it. The failure mode is never a crash — it is a confident sentence
 * about a relationship the data does not actually support, shown at the top
 * of the page, next to a link that does not explain it.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveWorkspaceState, resolveLanding, resolveWorkspaceSignals,
  daysSince, STALE_CASE_DAYS, STATE_EMPHASIS,
  type WorkspaceFacts,
} from '../context'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

const facts = (over: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  symbol: 'AAPL',
  positions: [],
  coveringUserIds: [],
  caseWrittenAt: null,
  writtenSections: [],
  rating: null,
  target: null,
  spot: null,
  newEvidenceCount: 0,
  openDecisions: [],
  liveIdeaCount: 0,
  unobservedExecutionCount: 0,
  executionCount: 0,
  viewerId: 'u-me',
  arrivalIntent: null,
  ...over,
})

const pos = (name = 'Growth', id = 'pf-1', weightPct: number | null = 2.5) =>
  ({ portfolioId: id, portfolioName: name, weightPct })

describe('the situation is a closed set, resolved by precedence', () => {
  it('a waiting decision outranks everything', () => {
    // Somebody is blocked on a human. Nothing on this page matters more.
    const s = resolveWorkspaceState(facts({
      positions: [pos()], caseWrittenAt: ago(3), coveringUserIds: ['u-a'],
      openDecisions: [{ id: 'd1', action: 'buy', portfolioId: 'pf-1', portfolioName: 'Growth' }],
    }))
    expect(s).toBe('decision-pending')
  })

  it('separates a held name with a case from one without', () => {
    expect(resolveWorkspaceState(facts({ positions: [pos()], caseWrittenAt: ago(10) })))
      .toBe('position-monitored')
    expect(resolveWorkspaceState(facts({ positions: [pos()] })))
      .toBe('position-unexplained')
  })

  it('separates started research from the blank page', () => {
    expect(resolveWorkspaceState(facts({ coveringUserIds: ['u-a'], caseWrittenAt: ago(2) })))
      .toBe('research-active')
    expect(resolveWorkspaceState(facts({ coveringUserIds: ['u-a'] })))
      .toBe('research-unstarted')
  })

  it('calls a name nobody owns unowned', () => {
    expect(resolveWorkspaceState(facts())).toBe('unowned')
  })

  it('every state has an emphasis, and every emphasis covers every panel', () => {
    /*
     * A missing entry would silently drop a panel off the page for one
     * situation only — the kind of defect nobody finds because it needs the
     * exact record shape to reproduce.
     */
    const panels = ['conclusion', 'decision', 'case', 'position', 'work', 'memory']
    for (const state of Object.keys(STATE_EMPHASIS)) {
      const e = STATE_EMPHASIS[state as keyof typeof STATE_EMPHASIS]
      expect(e.label.length, state).toBeGreaterThan(0)
      expect([...e.order].sort(), state).toEqual([...panels].sort())
    }
  })
})

describe('where the reader lands', () => {
  it('honours an explicit focus above anything inferred', () => {
    const s = resolveWorkspaceState(facts({ positions: [pos()] }))
    expect(resolveLanding(s, { origin: 'today', focus: 'research', portfolioId: null }))
      .toBe('research')
  })

  it('lands in the decision when the sender was a decision surface', () => {
    expect(resolveLanding('decision-pending', { origin: 'decisions', focus: null, portfolioId: null }))
      .toBe('decisions')
    expect(resolveLanding('position-monitored', { origin: 'ideas', focus: null, portfolioId: null }))
      .toBe('decisions')
  })

  it('ignores a focus that is not a real destination', () => {
    // A sender passing junk must not produce a blank page.
    expect(resolveLanding('unowned', { origin: null, focus: 'nonsense', portfolioId: null }))
      .toBe('snapshot')
  })

  it('defaults to the Snapshot for every state', () => {
    /*
     * Deliberate: each state is a different EMPHASIS within the Snapshot, not
     * a different page. Sending an analyst straight to Research on an
     * unstarted name would skip the context they need to decide whether to
     * start at all.
     */
    for (const state of Object.keys(STATE_EMPHASIS)) {
      expect(resolveLanding(state as never, null)).toBe('snapshot')
    }
  })
})

describe('signals state relationships the data supports, and no others', () => {
  it('names a rating that disagrees with an open recommendation', () => {
    const s = resolveWorkspaceSignals(facts({
      rating: { value: 'Underweight', count: 3, total: 5 },
      openDecisions: [{ id: 'd1', action: 'Buy', portfolioId: 'pf-1', portfolioName: 'Growth' }],
    }), NOW)
    const c = s.find(x => x.kind === 'contradiction')
    expect(c?.headline).toMatch(/Underweight by 3 of 5/)
    expect(c?.headline).toMatch(/pending buy in Growth/)
    // Both records are named, so the UI can link to each.
    expect(c?.evidence.map(e => e.table)).toEqual(['asset_ratings', 'decision_requests'])
  })

  it('does not fire when the rating and the recommendation agree', () => {
    const s = resolveWorkspaceSignals(facts({
      rating: { value: 'Buy', count: 3, total: 5 },
      openDecisions: [{ id: 'd1', action: 'Add', portfolioId: null, portfolioName: null }],
    }), NOW)
    expect(s.filter(x => x.kind === 'contradiction')).toEqual([])
  })

  it('does not guess a tone it does not recognise', () => {
    /*
     * An org with a custom rating scale ("Tier 2", "Watch") must not have a
     * disagreement invented for it out of a word match that failed.
     */
    const s = resolveWorkspaceSignals(facts({
      rating: { value: 'Tier 2', count: 1, total: 1 },
      openDecisions: [{ id: 'd1', action: 'Buy', portfolioId: null, portfolioName: null }],
    }), NOW)
    expect(s.filter(x => x.kind === 'contradiction')).toEqual([])
  })

  it('reports exposure with no case, naming the books', () => {
    const s = resolveWorkspaceSignals(facts({ positions: [pos('Growth'), pos('Income', 'pf-2')] }), NOW)
    const g = s.find(x => x.id === 'gap-held-uncased')
    expect(g?.headline).toBe('Held in 2 books with no investment case on record')
    expect(g?.evidence).toHaveLength(2)
  })

  it('does not report that gap when a case exists', () => {
    const s = resolveWorkspaceSignals(facts({ positions: [pos()], caseWrittenAt: ago(5) }), NOW)
    expect(s.find(x => x.id === 'gap-held-uncased')).toBeUndefined()
  })

  it('flags a case that has aged past the threshold, and not before', () => {
    const fresh = resolveWorkspaceSignals(facts({ caseWrittenAt: ago(STALE_CASE_DAYS - 1) }), NOW)
    expect(fresh.find(x => x.id === 'staleness-case-age')).toBeUndefined()
    const stale = resolveWorkspaceSignals(facts({ caseWrittenAt: ago(STALE_CASE_DAYS + 1) }), NOW)
    expect(stale.find(x => x.id === 'staleness-case-age')).toBeDefined()
  })

  it('states spot against target only when both numbers exist', () => {
    expect(resolveWorkspaceSignals(facts({ target: 200, spot: null }), NOW)
      .find(x => x.id === 'contradiction-spot-past-target')).toBeUndefined()
    expect(resolveWorkspaceSignals(facts({ target: null, spot: 220 }), NOW)
      .find(x => x.id === 'contradiction-spot-past-target')).toBeUndefined()
    const s = resolveWorkspaceSignals(facts({ target: 200, spot: 220 }), NOW)
    expect(s.find(x => x.id === 'contradiction-spot-past-target')?.headline)
      .toBe('Trading at or above the target (220.00 vs 200.00)')
  })

  it('reports execution provenance as a ratio, not an accusation', () => {
    const s = resolveWorkspaceSignals(facts({
      unobservedExecutionCount: 4, executionCount: 5,
    }), NOW)
    const p = s.find(x => x.kind === 'provenance')
    expect(p?.headline).toBe('4 of 5 executions are not evidenced by an observed fill')
    // Not "may not have happened" — the evidence is weak, the trades are not
    // being called into question.
    expect(p?.headline).not.toMatch(/did not|may not have|suspect|unverified trade/i)
  })

  it('says nothing at all about a name with no records', () => {
    expect(resolveWorkspaceSignals(facts(), NOW)).toEqual([])
  })

  it('gives every signal evidence to link to', () => {
    /*
     * A signal with no evidence is a feeling with a chip around it. The UI
     * renders `evidence` as links, so an empty array is a dead end.
     */
    const s = resolveWorkspaceSignals(facts({
      positions: [pos()], rating: { value: 'Sell', count: 2, total: 4 },
      openDecisions: [{ id: 'd1', action: 'Buy', portfolioId: 'pf-1', portfolioName: 'Growth' }],
      caseWrittenAt: ago(400), newEvidenceCount: 3, target: 100, spot: 150,
      unobservedExecutionCount: 1, executionCount: 2,
    }), NOW)
    expect(s.length).toBeGreaterThan(3)
    for (const sig of s) {
      expect(sig.evidence.length, sig.id).toBeGreaterThan(0)
      expect(sig.headline.length, sig.id).toBeGreaterThan(0)
    }
  })

  it('orders the most urgent first', () => {
    const s = resolveWorkspaceSignals(facts({
      positions: [pos()],
      rating: { value: 'Sell', count: 2, total: 4 },
      openDecisions: [{ id: 'd1', action: 'Buy', portfolioId: 'pf-1', portfolioName: 'Growth' }],
      unobservedExecutionCount: 1, executionCount: 2,
    }), NOW)
    // `pending` leads: somebody is blocked on a human, which outranks a
    // disagreement nobody is waiting on. Provenance is the weakest — the
    // records are fine, their evidence is merely thinner than it looks.
    expect(s[0].kind).toBe('pending')
    expect(s[1].kind).toBe('contradiction')
    expect(s[s.length - 1].kind).toBe('provenance')
  })

  it('never phrases a signal as an instruction', () => {
    /*
     * These sit at the top of the page. A surface that tells a PM what to do
     * from a word match has exceeded what the data supports; it reports, and
     * the human decides.
     */
    const s = resolveWorkspaceSignals(facts({
      positions: [pos()], caseWrittenAt: ago(400), newEvidenceCount: 2,
      rating: { value: 'Sell', count: 1, total: 1 },
      openDecisions: [{ id: 'd1', action: 'Buy', portfolioId: null, portfolioName: null }],
      target: 100, spot: 150, unobservedExecutionCount: 1, executionCount: 1,
      coveringUserIds: [],
    }), NOW)
    for (const sig of s) {
      expect(sig.headline, sig.id).not.toMatch(/\byou should\b|\bconsider\b|\brecommend(ed)?\b|\bmust\b|\bneed to\b/i)
    }
  })
})

describe('daysSince', () => {
  it('returns null rather than a number for a missing or bad date', () => {
    expect(daysSince(null)).toBeNull()
    expect(daysSince('not a date')).toBeNull()
  })
  it('counts whole days', () => {
    expect(daysSince(ago(5), NOW)).toBe(5)
  })
})

describe('a waiting decision is itself a signal', () => {
  it('names the request and the book', () => {
    /*
     * The first build announced the state "A decision is waiting" above a
     * list that never said WHICH decision. A situation label with no
     * corresponding fact is the surface asserting something it then declines
     * to evidence.
     */
    const s = resolveWorkspaceSignals(facts({
      openDecisions: [{ id: 'd1', action: 'Buy', portfolioId: 'pf-1', portfolioName: 'Growth' }],
    }), NOW)
    const p = s.find(x => x.kind === 'pending')
    expect(p?.headline).toBe('A buy in Growth is waiting on a decision')
    expect(p?.evidence[0]).toMatchObject({ table: 'decision_requests', id: 'd1' })
  })

  it('outranks every other signal', () => {
    const s = resolveWorkspaceSignals(facts({
      positions: [pos()], caseWrittenAt: null,
      openDecisions: [{ id: 'd1', action: 'Buy', portfolioId: null, portfolioName: null }],
      target: 100, spot: 150,
    }), NOW)
    expect(s[0].kind).toBe('pending')
  })

  it('copes with a request that records no action, and gets the article right', () => {
    const s = resolveWorkspaceSignals(facts({
      openDecisions: [{ id: 'd1', action: null, portfolioId: null, portfolioName: null }],
    }), NOW)
    expect(s[0].headline).toBe('A request is waiting on a decision')
  })

  it('every state named by the band has a signal to show for it', () => {
    /*
     * The band renders `STATE_EMPHASIS[state].label` as a heading. If a state
     * can arise with no signals, that heading appears over an empty list — or
     * the band hides and the state is never explained. Asserted for the one
     * state that claims something is outstanding.
     */
    const f = facts({ openDecisions: [{ id: 'd', action: 'Buy', portfolioId: null, portfolioName: null }] })
    expect(resolveWorkspaceState(f)).toBe('decision-pending')
    expect(resolveWorkspaceSignals(f, NOW).length).toBeGreaterThan(0)
  })
})

describe('the pending headline reads as English', () => {
  it('uses "An" before a vowel', () => {
    // "A add in Tech & Consumer Growth" was on screen.
    const s = resolveWorkspaceSignals(facts({
      openDecisions: [{ id: 'd1', action: 'Add', portfolioId: null, portfolioName: 'Growth' }],
    }), NOW)
    expect(s[0].headline).toBe('An add in Growth is waiting on a decision')
  })
  it('uses "A" before a consonant', () => {
    const s = resolveWorkspaceSignals(facts({
      openDecisions: [{ id: 'd1', action: 'Trim', portfolioId: null, portfolioName: 'Growth' }],
    }), NOW)
    expect(s[0].headline).toBe('A trim in Growth is waiting on a decision')
  })
})
