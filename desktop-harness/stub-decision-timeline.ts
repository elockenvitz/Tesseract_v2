/**
 * Fixtures for the asset Decision Memory timeline.
 *
 * Every distinction the timeline exists to make gets a row here, because a
 * harness that only shows the happy path cannot show that the hard cases
 * render — and the hard cases are the point:
 *
 *   - an analyst recommendation, separate from the PM ruling on it
 *   - an acceptance WITH MODIFICATION, distinct from a plain acceptance
 *   - a commitment that has NOT executed
 *   - an execution the app observed (verified)
 *   - an execution a PM's approval merely assumed (assumed)
 *   - an execution written by a migration (backfilled)
 *   - an execution with no provenance at all (unattributed)
 *   - a withdrawal, which is not a rejection
 *   - a review, and a scored price target
 *
 * The shapes mirror production: statuses and origins are the real vocabulary
 * (`decision_requests.status` check constraint, `EXECUTION_ORIGIN`), and the
 * same-day date/timestamp mix is the one that exposed the sort bug.
 */

import type { DecisionTimelineEvent, TimelinePhase } from '../src/types/decision-timeline'

const actor = (name: string) => {
  const [a, b] = name.split(' ')
  return { name, initials: `${a?.[0] ?? '?'}${b?.[0] ?? ''}`.toUpperCase() }
}

const BOOK = { id: 'pf-growth', name: 'Tech & Consumer Growth' }
const BOOK_B = { id: 'pf-income', name: 'Core Income' }

function ev(e: Partial<DecisionTimelineEvent> & Pick<DecisionTimelineEvent, 'id' | 'type' | 'timestamp' | 'title'>): DecisionTimelineEvent {
  return {
    phase: 'formal',
    subtitle: null,
    actor: null,
    portfolio: BOOK,
    sizing: null,
    rationale: null,
    disposition: 'neutral',
    executionProof: null,
    sourceRef: { type: 'trade_idea', id: e.id },
    provenance: { table: 'fixture', rowId: e.id, ideaId: 'idea-1', portfolioId: BOOK.id },
    ...e,
  } as DecisionTimelineEvent
}

export const HARNESS_EVENTS: DecisionTimelineEvent[] = [
  // ── Review ───────────────────────────────────────────────────────────
  ev({
    id: 'review-1', type: 'review_recorded', phase: 'review',
    timestamp: '2026-07-20T16:10:00.000Z',
    title: 'Decision reviewed — good',
    subtitle: 'Sized correctly; entry was early but thesis held.',
    actor: actor('Dana Reyes'), portfolio: null,
    disposition: 'positive',
    sourceRef: { type: 'review', id: 'review-1' },
  }),
  ev({
    id: 'outcome-1', type: 'outcome_evaluated', phase: 'review',
    timestamp: '2026-07-18T13:00:00.000Z',
    title: 'Price target hit — $238.00',
    subtitle: '94% accuracy', actor: actor('Ana Bell'), portfolio: null,
    disposition: 'positive',
    sourceRef: { type: 'outcome', id: 'outcome-1' },
  }),

  // ── Execution: the four grades of proof ──────────────────────────────
  ev({
    id: 'exec-verified', type: 'trade_executed', phase: 'execution',
    // A bare DATE, as portfolio_trade_events stores it.
    timestamp: '2026-06-02',
    title: 'Add — +45bps, +12,000 shs',
    subtitle: BOOK.name, disposition: 'positive',
    executionProof: 'verified',
    sizing: { action: 'add', weightDelta: 0.0045, sharesDelta: 12000, weightBefore: 0.021, weightAfter: 0.0255 },
    sourceRef: { type: 'trade_event', id: 'exec-verified' },
    provenance: { table: 'portfolio_trade_events', rowId: 'exec-verified', ideaId: 'idea-1', portfolioId: BOOK.id, acceptedTradeId: 'at-1' },
  }),
  ev({
    id: 'exec-assumed', type: 'trade_executed', phase: 'execution',
    timestamp: '2026-05-28',
    title: 'Trim — -20bps, -5,500 shs',
    subtitle: BOOK.name, disposition: 'negative',
    // The one that must never read as observed.
    executionProof: 'assumed',
    sourceRef: { type: 'trade_event', id: 'exec-assumed' },
    provenance: { table: 'portfolio_trade_events', rowId: 'exec-assumed', ideaId: 'idea-1', portfolioId: BOOK.id, acceptedTradeId: 'at-2' },
  }),
  ev({
    id: 'exec-attested', type: 'trade_executed', phase: 'execution',
    timestamp: '2026-05-21',
    title: 'Buy — +30bps', subtitle: BOOK_B.name, portfolio: BOOK_B,
    disposition: 'positive', executionProof: 'attested',
    sourceRef: { type: 'trade_event', id: 'exec-attested' },
    provenance: { table: 'portfolio_trade_events', rowId: 'exec-attested', ideaId: 'idea-2', portfolioId: BOOK_B.id, batchId: 'batch-9' },
  }),
  ev({
    id: 'exec-backfilled', type: 'trade_executed', phase: 'execution',
    timestamp: '2026-04-30',
    title: 'Initiate — +100bps', subtitle: BOOK.name,
    disposition: 'positive', executionProof: 'backfilled',
    sourceRef: { type: 'trade_event', id: 'exec-backfilled' },
    provenance: { table: 'portfolio_trade_events', rowId: 'exec-backfilled', ideaId: null, portfolioId: BOOK.id },
  }),
  ev({
    id: 'exec-unattributed', type: 'trade_executed', phase: 'execution',
    timestamp: '2026-04-11',
    title: 'Add — +15bps', subtitle: BOOK.name,
    disposition: 'positive', executionProof: 'unattributed',
    sourceRef: { type: 'trade_event', id: 'exec-unattributed' },
    provenance: { table: 'portfolio_trade_events', rowId: 'exec-unattributed', ideaId: null, portfolioId: BOOK.id },
  }),

  // ── Commitment, including one that never filled ──────────────────────
  ev({
    id: 'at-pending', type: 'execution_pending', phase: 'execution',
    timestamp: '2026-06-01T15:40:00.000Z',
    title: 'Buy committed, awaiting execution — +25bps',
    subtitle: 'Committed from inbox; the book has not moved',
    actor: actor('Priya Nair'), disposition: 'deferred',
    sourceRef: { type: 'accepted_trade', id: 'at-pending' },
    provenance: { table: 'accepted_trades', rowId: 'at-pending', portfolioId: BOOK.id, acceptedTradeId: 'at-pending' },
  }),
  ev({
    id: 'at-done', type: 'trade_committed', phase: 'execution',
    timestamp: '2026-06-02T09:30:00.000Z',
    title: 'Add committed — +45bps, +12,000 shs',
    subtitle: 'Raising to target on the print.',
    actor: actor('Priya Nair'), disposition: 'positive',
    sourceRef: { type: 'accepted_trade', id: 'at-done' },
    provenance: { table: 'accepted_trades', rowId: 'at-done', portfolioId: BOOK.id, acceptedTradeId: 'at-done', batchId: 'batch-4' },
  }),

  // ── The PM rulings, distinct from the recommendations ────────────────
  ev({
    id: 'dr-1-ruling', type: 'decision_accepted',
    timestamp: '2026-06-02T08:55:00.000Z',
    title: 'Add — Accepted',
    subtitle: 'Agree on the setup; take it to 2.5%.',
    actor: actor('Priya Nair'), disposition: 'positive',
    sourceRef: { type: 'decision_request', id: 'dr-1' },
  }),
  ev({
    id: 'dr-2-ruling', type: 'decision_accepted',
    timestamp: '2026-05-27T14:02:00.000Z',
    title: 'Trim — Accepted (modified)',
    subtitle: 'Half the requested size; keeping optionality.',
    actor: actor('Priya Nair'), disposition: 'positive',
    sourceRef: { type: 'decision_request', id: 'dr-2' },
  }),
  ev({
    id: 'dr-3-ruling', type: 'decision_rejected',
    timestamp: '2026-05-14T11:20:00.000Z',
    title: 'Buy — Rejected',
    subtitle: 'Position is already at the risk limit.',
    actor: actor('Priya Nair'), disposition: 'negative',
    sourceRef: { type: 'decision_request', id: 'dr-3' },
  }),
  ev({
    id: 'dr-4-ruling', type: 'decision_deferred',
    timestamp: '2026-05-06T10:00:00.000Z',
    title: 'Add — Deferred until 2026-07-01',
    subtitle: 'Revisit after the next print.',
    actor: actor('Priya Nair'), disposition: 'deferred',
    sourceRef: { type: 'decision_request', id: 'dr-4' },
  }),
  ev({
    id: 'dr-5-withdrawn', type: 'decision_withdrawn',
    timestamp: '2026-04-28T09:15:00.000Z',
    title: 'Buy — Withdrawn',
    subtitle: 'Withdrawn before a decision was made',
    disposition: 'neutral',
    sourceRef: { type: 'decision_request', id: 'dr-5' },
  }),

  // ── The analyst recommendations ──────────────────────────────────────
  ev({
    id: 'dr-1-sub', type: 'proposal_submitted',
    timestamp: '2026-06-01T07:40:00.000Z',
    title: 'Recommendation submitted — 2.5%',
    subtitle: 'Datacenter mix shift is not in the multiple yet.',
    actor: actor('Ana Bell'), disposition: 'neutral',
    sizing: { action: 'add', weightDelta: null, sharesDelta: null, weightBefore: null, weightAfter: 2.5 },
    sourceRef: { type: 'decision_request', id: 'dr-1' },
  }),
  ev({
    id: 'dr-2-sub', type: 'proposal_submitted',
    timestamp: '2026-05-26T08:05:00.000Z',
    title: 'Recommendation submitted — 1.0%',
    subtitle: 'Trimming into strength.',
    actor: actor('Tom Vega'), disposition: 'neutral',
    sourceRef: { type: 'decision_request', id: 'dr-2' },
  }),

  // ── Exploratory ──────────────────────────────────────────────────────
  ev({
    id: 'thesis-1', type: 'thesis_changed', phase: 'exploratory',
    timestamp: '2026-05-30T12:00:00.000Z',
    title: 'Thesis — bull case edit', subtitle: 'bull_case',
    actor: actor('Ana Bell'), portfolio: null, disposition: 'neutral',
    sourceRef: { type: 'memory_event', id: 'thesis-1' },
    provenance: { table: 'memory_events', rowId: 'thesis-1' },
  }),
  ev({
    id: 'esc-1', type: 'idea_escalated', phase: 'exploratory',
    timestamp: '2026-05-31T16:45:00.000Z',
    title: 'Escalated to deciding', disposition: 'neutral',
    sourceRef: { type: 'trade_idea', id: 'idea-1' },
  }),
  ev({
    id: 'idea-1', type: 'idea_created', phase: 'exploratory',
    timestamp: '2026-05-20T10:30:00.000Z',
    title: 'Add idea created',
    subtitle: 'Accelerating backlog, and the sell side has not moved.',
    actor: actor('Ana Bell'), disposition: 'positive',
    sourceRef: { type: 'trade_idea', id: 'idea-1' },
  }),
]

/** The empty case — an unheld security nobody has worked on. */
export const HARNESS_EMPTY: DecisionTimelineEvent[] = []

function countPhases(events: DecisionTimelineEvent[]) {
  const counts: Record<TimelinePhase | 'all', number> = {
    all: events.length, exploratory: 0, formal: 0, execution: 0, review: 0,
  }
  for (const e of events) counts[e.phase]++
  return counts
}

/**
 * Stands in for `useAssetDecisionTimeline`. Mirrors its return shape exactly,
 * including the client-side phase filter, so the harness exercises the real
 * filter logic rather than a simplified copy of it.
 *
 * `assetId === 'empty'` selects the no-history case.
 */
export function useAssetDecisionTimeline({
  assetId,
  filter = 'all',
  portfolioId = null,
}: {
  assetId: string
  filter?: 'all' | TimelinePhase
  portfolioId?: string | null
  enabled?: boolean
}) {
  const source = assetId === 'empty' ? HARNESS_EMPTY : HARNESS_EVENTS

  // The real hook applies the portfolio filter server-side AND keeps events
  // with no portfolio (they are asset-level, not book-level). Same rule here.
  const scoped = portfolioId
    ? source.filter(e => !e.portfolio || e.portfolio.id === portfolioId)
    : source

  const events = filter === 'all' ? scoped : scoped.filter(e => e.phase === filter)

  return {
    events,
    allEvents: scoped,
    phaseCounts: countPhases(scoped),
    isLoading: false,
    isError: false,
  }
}
