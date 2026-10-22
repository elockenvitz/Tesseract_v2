/**
 * Whose move is it — the permission split behind the Work attention area.
 *
 * The failure this guards is asymmetric and both halves are bad:
 * an analyst told to decide something they cannot, or a PM never told a
 * decision is waiting on them. So every case is stated from both sides.
 */
import { describe, it, expect } from 'vitest'
import {
  splitAttention, attentionSummary, isOpenRequest,
  type WorkDecisionRequest,
} from '../attention'

const req = (over: Partial<WorkDecisionRequest> = {}): WorkDecisionRequest => ({
  id: 'r1', portfolioId: 'pf-a', requestedBy: 'analyst', status: 'pending', ...over,
})

const ME = 'me'

describe('a PM sees what is theirs to decide', () => {
  it('claims a request for a book they manage', () => {
    const { needsYourAction, awaitingOthers } = splitAttention(
      [req({ portfolioId: 'pf-a' })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(needsYourAction).toHaveLength(1)
    expect(awaitingOthers).toHaveLength(0)
  })

  it('claims it even when somebody else raised it', () => {
    const { needsYourAction } = splitAttention(
      [req({ requestedBy: 'someone-else' })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(needsYourAction).toHaveLength(1)
  })

  it('puts their own request under their action when they manage the book', () => {
    // A PM who raises a request for their own book must still act on it;
    // filing it under "awaiting others" would leave it waiting on nobody.
    const { needsYourAction, awaitingOthers } = splitAttention(
      [req({ requestedBy: ME, portfolioId: 'pf-a' })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(needsYourAction).toHaveLength(1)
    expect(awaitingOthers).toHaveLength(0)
  })
})

describe('an analyst is never told to do a PM\'s job', () => {
  it('files their own submitted request under awaiting others', () => {
    const { needsYourAction, awaitingOthers } = splitAttention(
      [req({ requestedBy: ME })],
      { userId: ME, pmPortfolioIds: [] },
    )
    expect(needsYourAction).toHaveLength(0)
    expect(awaitingOthers).toHaveLength(1)
  })

  it('never claims a request for a book they do not manage', () => {
    const { needsYourAction } = splitAttention(
      [req({ portfolioId: 'pf-other', requestedBy: 'someone-else' })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(needsYourAction).toHaveLength(0)
  })
})

describe('requests that are nobody\'s business here are shown to nobody', () => {
  it('drops a request the reader neither manages nor raised', () => {
    // Visible under RLS, but not this reader's attention. Counting it would
    // make the badge mean "things exist" rather than "things need you".
    const split = splitAttention(
      [req({ portfolioId: 'pf-other', requestedBy: 'someone-else' })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(split.needsYourAction).toHaveLength(0)
    expect(split.awaitingOthers).toHaveLength(0)
  })

  it('never claims a request with no portfolio as yours to decide', () => {
    const split = splitAttention(
      [req({ portfolioId: null, requestedBy: 'someone-else' })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(split.needsYourAction).toHaveLength(0)
  })

  it('still watches an unattributable request the reader raised', () => {
    const split = splitAttention(
      [req({ portfolioId: null, requestedBy: ME })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(split.awaitingOthers).toHaveLength(1)
  })

  it('excludes seeded tutorial rows from both lists', () => {
    const split = splitAttention(
      [req({ isExample: true }), req({ id: 'r2', requestedBy: ME, isExample: true })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(split.needsYourAction).toHaveLength(0)
    expect(split.awaitingOthers).toHaveLength(0)
  })
})

describe('only unresolved requests are work', () => {
  it.each(['pending', 'open', 'submitted', 'awaiting_decision', 'PENDING'])('%s is open', s => {
    expect(isOpenRequest(s)).toBe(true)
  })

  it.each(['approved', 'rejected', 'deferred', 'cancelled'])('%s is not open', s => {
    expect(isOpenRequest(s)).toBe(false)
  })

  it('treats a missing status as unresolved rather than silently done', () => {
    // A row nobody has acted on has not been decided. Reading null as closed
    // would hide real work.
    expect(isOpenRequest(null)).toBe(true)
    expect(isOpenRequest(undefined)).toBe(true)
  })

  it('keeps resolved requests out of attention entirely', () => {
    const split = splitAttention(
      [req({ status: 'approved' }), req({ id: 'r2', status: 'rejected', requestedBy: ME })],
      { userId: ME, pmPortfolioIds: ['pf-a'] },
    )
    expect(split.needsYourAction).toHaveLength(0)
    expect(split.awaitingOthers).toHaveLength(0)
  })
})

describe('the collapsed summary', () => {
  const split = (you: number, others: number) => ({
    needsYourAction: Array.from({ length: you }, (_, i) => i),
    awaitingOthers: Array.from({ length: others }, (_, i) => i),
  })

  it('is null when nothing is waiting, so the area is absent not empty', () => {
    expect(attentionSummary(split(0, 0))).toBeNull()
  })

  it('leads with what needs the reader', () => {
    expect(attentionSummary(split(2, 3))).toBe('2 need your action · 3 awaiting others')
  })

  it('agrees with itself on singulars', () => {
    expect(attentionSummary(split(1, 0))).toBe('1 needs your action')
    expect(attentionSummary(split(0, 1))).toBe('1 awaiting others')
  })
})

describe('no new permission semantics are invented', () => {
  it('derives everything from the ids the caller supplies', () => {
    // An empty PM set can never produce a "needs your action" row, whatever
    // the request says about itself. The server remains the authority.
    const many = [req(), req({ id: 'r2', portfolioId: 'pf-b' }), req({ id: 'r3', portfolioId: 'pf-c' })]
    expect(splitAttention(many, { userId: ME, pmPortfolioIds: [] }).needsYourAction).toHaveLength(0)
  })

  it('does not fall back to "mine" when the user is unknown', () => {
    const split = splitAttention([req({ requestedBy: null })], { userId: null, pmPortfolioIds: [] })
    expect(split.needsYourAction).toHaveLength(0)
    expect(split.awaitingOthers).toHaveLength(0)
  })
})
