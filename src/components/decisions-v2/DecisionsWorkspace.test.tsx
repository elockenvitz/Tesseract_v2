/**
 * Focused test for the Decisions workspace.
 *
 * The data hook is mocked. What this file is for is the surface's own
 * decisions: that it opens as memory rather than as a queue, that a
 * system-written note is never presented as reasoning, that historical and
 * current facts stay apart, that price after a decision carries no verdict, and
 * that every route out reuses a seam another stage already owns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { DecisionRecord } from '../../lib/desktop-decisions'

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
  // Unbatched by default: a trade committed on its own is the ordinary case,
  // and the grouping must fall back to per-trade behaviour for it.
  batch: null,
  ...over,
})

const priceSeries = (days: number, rising: boolean) =>
  Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.now() - (days - i) * DAY).toISOString().slice(0, 10),
    close: rising ? 100 + i * 0.3 : 200 - i * 0.3,
  }))

let decisions: DecisionRecord[] = []
let detail: any = {}
let scanError: Error | null = null
const detailRequestedFor: string[] = []

vi.mock('../../hooks/useDesktopDecisions', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useDesktopDecisions')>()
  return {
    ...actual,
    useDecisionScan: () => ({ decisions, isLoading: false, error: scanError }),
    useDecisionDetail: (d: DecisionRecord | null) => {
      if (d) detailRequestedFor.push(d.id)
      return { detail: d ? detail : undefined, isLoading: false }
    },
  }
})

const openEngagement = vi.fn()
vi.mock('../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/engagement')>()
  return {
    ...actual,
    askAI: (t: any) => openEngagement('ai', t),
    discuss: (t: any) => openEngagement('discuss', t),
  }
})

/** What the lens asked the deck to expand. The seam itself is real. */
const opened: any[] = []
vi.mock('../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: (r: any) => { opened.push(r); return true } }
})

import { DecisionsWorkspace } from './DecisionsWorkspace'

const tabEvents: CustomEvent[] = []
const typedEvents: CustomEvent[] = []
const onTab = (e: Event) => tabEvents.push(e as CustomEvent)
const onTyped = (e: Event) => typedEvents.push(e as CustomEvent)

beforeEach(() => {
  decisions = []
  detail = {}
  scanError = null
  detailRequestedFor.length = 0
  opened.length = 0
  tabEvents.length = 0
  typedEvents.length = 0
  openEngagement.mockClear()
  window.addEventListener('decision-engine-action', onTab)
  window.addEventListener('tesseract:open-research', onTyped)
  window.addEventListener('tesseract:open-idea', onTyped)
})
afterEach(() => {
  window.removeEventListener('decision-engine-action', onTab)
  window.removeEventListener('tesseract:open-research', onTyped)
  window.removeEventListener('tesseract:open-idea', onTyped)
})

const metric = (label: string) =>
  screen.getAllByTestId('decision-metric').find(m => m.textContent?.includes(label))

/* ------------------------------------------------------------ entry state */

/*
 * ── This suite was written for a record, and the lens is now a queue ──────
 *
 * It carried the rule "it opens as memory, not as a queue", written after a
 * stage where every card shouted the same call to action. The reader has
 * since asked for the opposite in plain terms: "I should not see decisions I
 * have made, I should see decisions I need to make or decisions I have made
 * that need rationales."
 *
 * The old note diagnosed the wrong cause. What made the surface feel like an
 * inbox was not that it held work -- it was that every card demanded the SAME
 * work regardless of what it needed. Two genuinely different jobs, each with
 * its own card and its own visual, is not that.
 *
 * What survives untouched: entry still lands in the index rather than inside
 * a record, nothing auto-opens, and the detail pane still resolves ANY record
 * including the settled ones the index no longer lists.
 */
describe('it opens as a queue of work, never auto-opening one', () => {
  /*
   * All three are accepted with no written reason, so all three are work of
   * the `explain` kind and all three are listed. Longest-waiting first, so
   * the OLDEST leads -- the opposite end from the record's newest-first.
   */
  const three = () => {
    decisions = [
      decision({ id: 'newest', symbol: 'AAA', decidedAt: daysAgo(5) }),
      decision({ id: 'middle', symbol: 'BBB', decidedAt: daysAgo(50) }),
      decision({ id: 'oldest', symbol: 'CCC', decidedAt: daysAgo(500) }),
    ]
  }

  it('lands in the record, not inside one of them', () => {
    three()
    render(<DecisionsWorkspace />)
    expect(screen.getByTestId('decisions-lens')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-detail')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('decision-tile')).toHaveLength(3)
    // Opening the newest on arrival is the queue reading again, quieter.
    expect(detailRequestedFor).toHaveLength(0)
  })

  it('asks the deck to expand the record that was clicked', async () => {
    const user = userEvent.setup()
    three()
    render(<DecisionsWorkspace />)
    // Longest waiting first, so the first tile is the oldest unexplained
    // record -- ordering, not opening.
    await user.click(screen.getAllByTestId('decision-tile')[0])

    const req = opened[opened.length - 1]!
    expect(req.target.objectId).toBe('oldest')
    expect(req.target.originLens).toBe('decisions')
    expect(req.backLabel).toBe('Decisions')
    // The whole record travels, in date order; the deck windows it around
    // whatever is expanded, so nothing is permanently dropped.
    // The rail carries the queue in the queue's order, not the chronology's.
    expect(req.rail.map((c: any) => c.id)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('gives the chosen record the whole canvas', () => {
    three()
    render(<DecisionsWorkspace focusObjectId="newest" />)
    expect(screen.getByTestId('decision-detail')).toBeInTheDocument()
    expect(screen.queryAllByTestId('decision-tile')).toHaveLength(0)
    expect(detailRequestedFor).toEqual(['newest'])
  })

  it('has no standalone card grid and no repeated revisit button', () => {
    three()
    render(<DecisionsWorkspace />)
    expect(screen.queryAllByTestId('decision-card')).toHaveLength(0)
    // Selection is the revisit; a CTA per row is what read as an inbox.
    expect(screen.queryByRole('button', { name: /Revisit this decision/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All decisions' })).not.toBeInTheDocument()
  })

  it('orders by what has waited longest, not by what happened last', () => {
    three()
    render(<DecisionsWorkspace />)
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows.map(r => within(r).getAllByText(/^[A-Z]{3}$/)[0].textContent))
      // CCC waited longest, so CCC leads.
      .toEqual(['CCC', 'BBB', 'AAA'])
  })

  it('distinguishes a read failure from an empty history', () => {
    scanError = new Error('relation lookup failed')
    render(<DecisionsWorkspace />)
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText(/No decisions on record yet/)).not.toBeInTheDocument()
  })

  it('says nothing is recorded when nothing is', () => {
    render(<DecisionsWorkspace />)
    expect(screen.getByText(/No decisions on record yet/)).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- metrics */

describe('the header counts say what they mean', () => {
  it('never calls submission context a decision rationale', () => {
    decisions = [
      // The header counts describe the book, not the queue -- so 'a' is
      // counted here even though, being explained, it does not tile.
      decision({ id: 'a', decisionNote: 'i like this idea, makes sense', contextNote: 'we need 2%' }),
      decision({ id: 'b', decisionNote: 'Self-proposed via Trade Lab Execute', contextNote: 'get long pal' }),
      decision({ id: 'c', decisionNote: 'Self-proposed via Trade Lab Execute', contextNote: 'earnings' }),
    ]
    render(<DecisionsWorkspace />)

    // One person wrote a reason for deciding; three wrote a reason for asking.
    expect(metric('decision rationale')).toHaveTextContent('1')
    expect(metric('with submission context')).toHaveTextContent('3')
    // The fused label that overstated the record fourfold.
    expect(screen.queryByText(/carry a written reason/)).not.toBeInTheDocument()
    expect(screen.queryByText(/3 decision rationale/)).not.toBeInTheDocument()
  })

  it('counts only human notes as rationale', () => {
    decisions = [
      decision({ id: 'a', decisionNote: 'Self-proposed via Trade Lab Execute' }),
      decision({ id: 'b', decisionNote: 'Withdrawn during cleanup — no active recommendation' }),
    ]
    render(<DecisionsWorkspace />)
    expect(metric('decision rationales')).toHaveTextContent('0')
  })

  it('counts resolved and executed separately', () => {
    decisions = [
      decision({ id: 'a', status: 'accepted',
                 execution: { id: 'x', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' } }),
      decision({ id: 'b', status: 'accepted', execution: null }),
      decision({ id: 'c', status: 'pending', decidedAt: null, decidedByName: null }),
    ]
    render(<DecisionsWorkspace />)
    expect(metric('resolved')).toHaveTextContent('2')
    expect(metric('executed')).toHaveTextContent('1')
  })
})

/* -------------------------------------------------------------- the index */

describe('the index is a queue of what still wants something', () => {
  it('lists every unexplained outcome, and never a withdrawal', () => {
    /*
     * Accepted and rejected both had a person rule on them, so both can owe a
     * reason. Withdrawn cannot: the requester pulled it before anyone ruled,
     * so there is no decision to explain and asking for one would be asking
     * the desk to justify something it never did.
     */
    decisions = [
      decision({ id: 'a', status: 'accepted', symbol: 'AAA', decidedAt: daysAgo(5) }),
      decision({ id: 'b', status: 'rejected', symbol: 'BBB', decidedAt: daysAgo(6) }),
      decision({ id: 'c', status: 'withdrawn', symbol: 'CCC', decidedAt: daysAgo(7) }),
    ]
    render(<DecisionsWorkspace />)
    expect(screen.getAllByTestId('decision-tile').map(r => r.getAttribute('data-outcome')))
      .toEqual(['declined', 'accepted'])
  })

  it('I. shows one card for a batch, and gives it one position in the queue', () => {
    /*
     * The composition half of the same problem. Five legs must not consume
     * five positions and recreate the repetition through the layout after the
     * data stopped causing it.
     */
    // Dated apart, so this asserts the real ordering rule -- longest waiting
    // first -- rather than the id tie-break.
    const b = { id: 'b-1', name: 'Semis rotation', description: null }
    decisions = [
      decision({ id: 't1', symbol: 'AAA', decisionNote: null, batch: b, decidedAt: daysAgo(200) }),
      decision({ id: 't2', symbol: 'BBB', decisionNote: null, batch: b, decidedAt: daysAgo(200) }),
      decision({ id: 't3', symbol: 'CCC', decisionNote: null, batch: b, decidedAt: daysAgo(200) }),
      decision({ id: 'solo', symbol: 'ZZZ', decisionNote: null, decidedAt: daysAgo(20) }),
    ]
    render(<DecisionsWorkspace />)
    const tiles = screen.getAllByTestId('decision-tile')
    expect(tiles).toHaveLength(2)

    // Identity is a real id, carried on the element, never a rendered string.
    expect(tiles.map(t => t.getAttribute('data-subject')))
      .toEqual(['trade_batch:b-1', 'decision_request:solo'])
    expect(tiles[0].getAttribute('data-legs')).toBe('3')

    // The legs are still inspectable on the card.
    const legs = within(tiles[0]).getByTestId('batch-legs')
    expect(legs.textContent).toContain('AAA')
    expect(legs.textContent).toContain('BBB')
    expect(legs.textContent).toContain('CCC')
  })

  it('shows the batch description, and how much of the act is explained', () => {
    /*
     * Two facts a reader needs before writing a rationale: whatever the batch
     * already says about itself, and how much of it is still owed. The
     * description is labelled by provenance, because a workflow line printed
     * unlabelled beside a request for a reason reads as though the desk had
     * already answered.
     */
    const b = {
      id: 'b-1', name: 'Semis into staples',
      description: 'Auto-created from Trade Lab execute, 3 legs.',
    }
    decisions = [
      decision({ id: 't1', symbol: 'AAA', batch: b, decisionNote: 'Trimmed into the print.' }),
      decision({ id: 't2', symbol: 'BBB', batch: b, decisionNote: null }),
      decision({ id: 't3', symbol: 'CCC', batch: b, decisionNote: null }),
    ]
    render(<DecisionsWorkspace />)
    const tile = screen.getByTestId('decision-tile')

    expect(within(tile).getByTestId('batch-description').textContent)
      .toContain('Auto-created from Trade Lab execute')
    // A workflow line is NOT labelled as a reason.
    expect(within(tile).getByTestId('batch-description').textContent)
      .toContain('Recorded on the batch')

    expect(within(tile).getByTestId('batch-rationale-count').textContent)
      .toContain('1 of 3 explained')
    expect(within(tile).getByTestId('batch-rationale-count').textContent)
      .toContain('2 without a reason')

    // Every leg is listed, explained or not -- an explained leg does not stop
    // being part of what was committed.
    const legs = within(tile).getByTestId('batch-legs')
    for (const sym of ['AAA', 'BBB', 'CCC']) expect(legs.textContent).toContain(sym)
    expect(within(legs).getAllByLabelText('no reason recorded')).toHaveLength(2)
    expect(within(legs).getAllByLabelText('has a reason')).toHaveLength(1)
  })

  it("never shows one leg's submission note as the batch's", () => {
    /*
     * The lead is one of several trades, and its `contextNote` is why THAT
     * trade was asked for. Printing it under the batch's name says the desk
     * proposed three names for one leg's reason -- the same error as reading
     * a leg's decision note upward, made in the other field.
     */
    const b = { id: 'b-1', name: 'Semis into staples', description: null }
    decisions = [
      decision({ id: 't1', symbol: 'AAA', batch: b, decisionNote: null, contextNote: 'AAA looks cheap' }),
      decision({ id: 't2', symbol: 'BBB', batch: b, decisionNote: null, contextNote: 'BBB is crowded' }),
    ]
    render(<DecisionsWorkspace />)
    const tile = screen.getByTestId('decision-tile')
    expect(tile.textContent).not.toContain('AAA looks cheap')
    expect(tile.textContent).not.toContain('BBB is crowded')
  })

  it('clears the whole batch when the batch itself carries the reason', () => {
    const b = {
      id: 'b-1', name: null,
      description: 'Rotated the semis overweight into staples ahead of the print.',
    }
    decisions = [
      decision({ id: 't1', symbol: 'AAA', decisionNote: null, batch: b }),
      decision({ id: 't2', symbol: 'BBB', decisionNote: null, batch: b }),
    ]
    render(<DecisionsWorkspace />)
    // Nothing owed, so nothing queued -- and that reads as the good state it
    // is rather than as an empty lens.
    expect(screen.queryAllByTestId('decision-tile')).toHaveLength(0)
    expect(screen.getByText(/every decision in this book carries/i)).toBeInTheDocument()
  })

  it('H. a single unbatched trade is unchanged', () => {
    decisions = [decision({ id: 'solo', symbol: 'ZZZ', decisionNote: null })]
    render(<DecisionsWorkspace />)
    const tile = screen.getByTestId('decision-tile')
    // Its own identity, one leg, and no batch language anywhere on it.
    expect(tile.getAttribute('data-subject')).toBe('decision_request:solo')
    expect(tile.getAttribute('data-legs')).toBe('1')
    expect(within(tile).queryByTestId('batch-legs')).toBeNull()
    expect(tile.textContent).not.toMatch(/approved together/)
  })

  it('leaves out what was decided AND explained, and says how many', () => {
    // Not deleted -- the detail pane still opens it. It just does not spend a
    // tile on a surface whose question is what needs doing.
    decisions = [
      decision({ id: 'done', symbol: 'AAA', decisionNote: 'Sized to 2% on the cohort data.' }),
      decision({ id: 'owed', symbol: 'BBB', decisionNote: null }),
    ]
    render(<DecisionsWorkspace />)
    const tiles = screen.getAllByTestId('decision-tile')
    expect(tiles).toHaveLength(1)
    expect(tiles[0].textContent).toContain('BBB')
    expect(screen.getByText(/not listed/)).toBeInTheDocument()
  })

  it('does not drop a decision whose idea has been executed', () => {
    decisions = [decision({
      status: 'accepted',
      execution: { id: 'at', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' },
    })]
    render(<DecisionsWorkspace />)
    // The active-Ideas filter would remove exactly this record.
    expect(screen.getAllByTestId('decision-tile')).toHaveLength(1)
  })

  it('shows the ask on a tile, and keeps the rationale for the record', () => {
    /*
     * ── Reframed, because the old subject cannot occur ────────────────────
     *
     * This asserted that a tile quotes a real written rationale. Under the
     * queue it cannot: a decision with a human reason is explained, and an
     * explained decision is not work, so it never tiles. The words are still
     * shown -- in the detail pane, which its own tests cover -- and the tile
     * carries what the queued record actually has, which is why it was asked
     * for in the first place.
     */
    decisions = [
      decision({ id: 'owed', decisionNote: null, contextNote: 'we need 2%' }),
      decision({ id: 'done', symbol: 'ZZZ', decisionNote: 'i like this idea, makes sense' }),
    ]
    render(<DecisionsWorkspace />)
    const tiles = screen.getAllByTestId('decision-tile')
    expect(tiles).toHaveLength(1)
    expect(within(tiles[0]).getByText(/we need 2%/)).toBeInTheDocument()
    expect(screen.queryByText(/i like this idea, makes sense/)).not.toBeInTheDocument()
  })
})

/* -------------------------------------------------- portfolio-scoped memory */

describe('the same idea in two books is two decisions', () => {
  beforeEach(() => {
    decisions = [
      decision({ id: 'core', portfolioId: 'p1', portfolioName: 'Large Cap Core', status: 'accepted', decidedAt: daysAgo(10) }),
      decision({ id: 'growth', portfolioId: 'p2', portfolioName: 'Large Cap Growth', status: 'withdrawn', decidedAt: daysAgo(11) }),
    ]
  })

  it('queues the one that owes a reason, not the one that was pulled', () => {
    /*
     * Both books are still scanned and both records still exist. Withdrawn
     * owes nothing: the requester pulled it before anyone ruled, so there is
     * no decision to explain.
     */
    render(<DecisionsWorkspace />)
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Large Cap Core')).toBeInTheDocument()
    expect(rows[0]).toHaveAttribute('data-outcome', 'accepted')
  })

  it('scopes the index when one book is chosen', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace />)
    await user.click(screen.getByRole('button', { name: /All portfolios/ }))
    await user.click(screen.getByRole('option', { name: /Large Cap Core/ }))
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Large Cap Core')).toBeInTheDocument()
  })

  it('narrows the record without stranding the reader', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace />)
    await user.click(screen.getByRole('button', { name: /All portfolios/ }))
    await user.click(screen.getByRole('option', { name: /Large Cap Core/ }))

    // Never a Growth decision left open under a Core filter.
    expect(screen.queryByTestId('decision-detail')).not.toBeInTheDocument()
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Large Cap Core')).toBeInTheDocument()
  })
})

/* ----------------------------------------------------------- the Why module */

describe('a system string is never shown as reasoning', () => {
  it('gives a real reason the strongest treatment on the page', () => {
    decisions = [decision({ id: 'x', decisionNote: 'i like this idea, makes sense' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const why = screen.getByText('Why we decided').closest('section')!
    const quote = within(why).getByText(/i like this idea, makes sense/)
    expect(quote.tagName.toLowerCase()).toBe('blockquote')
    // Larger than anything else on the page, and unboxed: a border would make
    // it a panel among panels rather than the reason the record exists.
    expect(quote.className).toMatch(/text-\[21px\]/)
    expect(why.querySelector('[data-testid="desktop-module"]')).toBeNull()
    expect(screen.queryByText('Decision record')).not.toBeInTheDocument()
  })

  it('compresses the absence instead of giving it a hero box', () => {
    decisions = [decision({ id: 'x', decisionNote: 'Self-proposed via Trade Lab Execute' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Decision record')).toBeInTheDocument()
    expect(screen.getByText('No human rationale was captured.')).toBeInTheDocument()
    expect(screen.getByText(/written by the system, not a stated rationale/)).toBeInTheDocument()
    // Never dressed up as reasoning.
    expect(screen.queryByText('Why we decided')).not.toBeInTheDocument()
  })

  it('keeps the proposal rationale separately attributed', () => {
    decisions = [decision({ id: 'x', decisionNote: null, contextNote: 'get long pal' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Why it was proposed')).toBeInTheDocument()
    expect(screen.getByText(/get long pal/)).toBeInTheDocument()
    expect(screen.getByText(/Submitted by Seb Barbero/)).toBeInTheDocument()
    expect(screen.getByText(/the proposal rationale, not the decider/)).toBeInTheDocument()
    expect(screen.queryByText('Why we decided')).not.toBeInTheDocument()
  })

  it('keeps both apart when both exist', () => {
    decisions = [decision({
      id: 'x',
      decisionNote: 'i like this idea, makes sense',
      contextNote: 'We need to be 2% in this portfolio',
    })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Why we decided')).toBeInTheDocument()
    expect(screen.getByText('Why it was proposed')).toBeInTheDocument()
    expect(screen.getByText(/Submitted by Seb Barbero/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------ then versus today */

describe('what we knew then is kept apart from what is true now', () => {
  const selected = (over: Partial<DecisionRecord> = {}) => {
    decisions = [decision({ id: 'x', ...over })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    return {
      then: screen.getByText('At the decision').closest('section')!,
      now: screen.getByText('Today').closest('section')!,
    }
  }

  it('names the framework facts that were never captured, quietly', () => {
    const { then } = selected()
    const note = within(then).getByText(/Historical framework not captured/)
    expect(note).toBeInTheDocument()
    // A footnote, not the loudest thing in the column it qualifies.
    expect(note.className).toMatch(/text-\[10px\]/)
  })

  it('shows a decision-time weight only where the snapshot recorded one', () => {
    const { then } = selected({ baselineWeight: 3.9 })
    expect(within(then).getByText('Weight then')).toBeInTheDocument()
    expect(within(then).getByText('3.9%')).toBeInTheDocument()
  })

  it('omits it rather than borrowing today’s weight', () => {
    detail = { currentWeightPct: 1.1 }
    const { then, now } = selected({ baselineWeight: null })
    expect(within(then).queryByText('Weight then')).not.toBeInTheDocument()
    expect(within(now).getByText('Weight now')).toBeInTheDocument()
    expect(within(now).getByText('1.1%')).toBeInTheDocument()
  })

  it('labels the current column as current', () => {
    const { now } = selected()
    expect(within(now).getByText('current state')).toBeInTheDocument()
    expect(within(now).getByText(/the state right now, not the state when the decision was made/))
      .toBeInTheDocument()
  })

  it('shows a decision-time price where one was captured', () => {
    detail = { priceAtDecision: 120.5, currentPrice: 46.86 }
    const { then, now } = selected()
    expect(within(then).getByText('Price then')).toBeInTheDocument()
    expect(within(now).getByText('Price now')).toBeInTheDocument()
  })

  it('omits it rather than borrowing today’s price', () => {
    detail = { currentPrice: 46.86 }
    const { then } = selected()
    expect(within(then).queryByText('Price then')).not.toBeInTheDocument()
  })

  it('states the outcome once, not four times, before the substance', () => {
    selected({ decidedByName: 'Eric Lockenvitz' })
    const detailEl = screen.getByTestId('decision-detail')
    const header = detailEl.firstElementChild as HTMLElement
    // The actor appears in the narrative sentence and nowhere else in the header.
    expect(within(header).getAllByText(/Eric Lockenvitz/)).toHaveLength(1)
  })
})

/* -------------------------------------------------------- what happened next */

describe('price after a decision carries no verdict', () => {
  const withPath = (rising: boolean) => {
    detail = { history: priceSeries(300, rising) }
    decisions = [decision({ id: 'x', decidedAt: daysAgo(160) })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    return screen.getByTestId('price-since-decision')
  }

  it('does not paint a fall in critical red', () => {
    const chart = withPath(false)
    expect(chart.querySelector('svg')!.innerHTML).not.toMatch(/rose|red-/)
    expect(within(chart).getByText(/^-\d/)).toBeInTheDocument()
  })

  it('does not paint a rise in success green', () => {
    const chart = withPath(true)
    expect(chart.querySelector('svg')!.innerHTML).not.toMatch(/emerald|green-/)
    expect(within(chart).getByText(/^\+\d/)).toBeInTheDocument()
  })

  it('draws the same ink either way', () => {
    const down = withPath(false).querySelector('path')!.getAttribute('class')
    screen.getByTestId('decision-detail')
    const upChart = (() => {
      detail = { history: priceSeries(300, true) }
      decisions = [decision({ id: 'y', decidedAt: daysAgo(160) })]
      const { container } = render(<DecisionsWorkspace selectedDecisionId="y" />)
      return container.querySelector('[data-testid="price-since-decision"] path')!
    })()
    expect(upChart.getAttribute('class')).toBe(down)
  })

  it('keeps the sign on the number, because the sign is a fact', () => {
    const chart = withPath(false)
    const value = within(chart).getByText(/^-\d/)
    expect(value.className).not.toMatch(/rose|emerald|red-|green-/)
  })

  it('anchors at the decision only when history reaches it', () => {
    withPath(false)
    expect(screen.getByText('Price after decision')).toBeInTheDocument()
    expect(screen.getByText('DECIDED')).toBeInTheDocument()
    expect(screen.getByText(/Not a verdict on the decision/)).toBeInTheDocument()
  })

  it('refuses the claim when history starts after the decision', () => {
    detail = { history: priceSeries(30, false) }
    decisions = [decision({ id: 'x', decidedAt: daysAgo(400) })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Price over available history')).toBeInTheDocument()
    expect(screen.queryByText('DECIDED')).not.toBeInTheDocument()
  })

  it('renders no module at all when nothing followed', () => {
    detail = {}
    decisions = [decision({ id: 'x' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.queryByTestId('price-since-decision')).not.toBeInTheDocument()
    expect(screen.queryByText('What happened next')).not.toBeInTheDocument()
  })

  it('keeps the chronology readable beside the chart', () => {
    detail = { history: priceSeries(300, false) }
    decisions = [decision({
      id: 'x', decidedAt: daysAgo(160),
      execution: { id: 'at', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' },
    })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const chron = screen.getByTestId('decision-chronology')
    expect(within(chron).getByText(/Proposed by/)).toBeInTheDocument()
    expect(within(chron).getByText(/Accepted by/)).toBeInTheDocument()
    expect(within(chron).getByText(/Executed by/)).toBeInTheDocument()
  })

  it('says plainly when an accepted decision was never executed', () => {
    detail = { history: priceSeries(300, true) }
    decisions = [decision({ id: 'x', status: 'accepted', decidedAt: daysAgo(160), execution: null })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getAllByText(/No execution is recorded/).length).toBeGreaterThan(0)
  })
})

/* ----------------------------------------------------------------- routing */

describe('navigating and routing', () => {
  it('switches decision without leaving the workspace', async () => {
    const user = userEvent.setup()
    decisions = [
      decision({ id: 'a', symbol: 'AAA', decidedAt: daysAgo(10) }),
      decision({ id: 'b', symbol: 'BBB', decidedAt: daysAgo(20) }),
    ]
    render(<DecisionsWorkspace />)
    // Longest waiting first, so 'b' leads and 'a' is second.
    await user.click(screen.getAllByTestId('decision-tile')[1])
    // Switching happens by rotating in the deck, which asks for the next
    // record rather than opening one here.
    expect(opened[opened.length - 1]!.target.objectId).toBe('a')
    // The rail is the queue in the queue's order: 'b' waited longer.
    expect(opened[opened.length - 1]!.rail.map((c: any) => c.id)).toEqual(['b', 'a'])
  })

  it('enriches only the decision the deck expanded', () => {
    decisions = [
      decision({ id: 'a', decidedAt: daysAgo(10) }),
      decision({ id: 'b', decidedAt: daysAgo(20) }),
    ]
    const { rerender } = render(<DecisionsWorkspace />)
    expect(detailRequestedFor).toHaveLength(0)
    rerender(<DecisionsWorkspace focusObjectId="a" />)
    expect(new Set(detailRequestedFor)).toEqual(new Set(['a']))
  })

  it('opens the asset itself, on the exact name', async () => {
    const user = userEvent.setup()
    decisions = [decision({ id: 'x', assetId: 'a-orcl' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    await user.click(screen.getByRole('button', { name: /Review the case today/ }))

    // The case lives on the asset, and that is a tab of its own -- not the
    // Research lens standing in as a waypoint.
    const tab = tabEvents.at(-1)!.detail
    expect(tab.id).toBe('a-orcl')
    expect(tab.type).toBe('asset')
    expect(tab.data.focus).toBe('research')
    expect(tab.data.origin).toBe('decisions')
  })

  it('opens Ideas V2 on the exact idea, never the legacy pipeline', async () => {
    const user = userEvent.setup()
    decisions = [decision({ id: 'x', ideaId: 'tq-9' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    await user.click(screen.getByRole('button', { name: 'Open the idea' }))
    expect(tabEvents.at(-1)!.detail.id).toBe('ideas-v2')
    expect(tabEvents.at(-1)!.detail.data.selectedIdeaId).toBe('tq-9')
    expect(tabEvents.some(e => e.detail?.type === 'trade-queue')).toBe(false)
  })

  it('binds Ask AI to the decision, its book and its outcome', async () => {
    const user = userEvent.setup()
    decisions = [decision({ id: 'x', portfolioId: 'p2', portfolioName: 'Large Cap Growth' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    await user.click(screen.getByRole('button', { name: 'Ask AI' }))

    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('ai')
    expect(target.objectId).toBe('a-orcl')
    expect(target.portfolioId).toBe('p2')
    expect(target.origin.itemId).toBe('x')
  })

  it('shows Ask AI as an action, not as a number', () => {
    decisions = [decision({ id: 'x' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const btn = screen.getByRole('button', { name: 'Ask AI' })
    // The old "Ask AI 7" was contextChips.length — an implementation detail.
    expect(btn.textContent?.trim()).toBe('Ask AI')
  })
})

/* ----------------------------------------------------------------- outcomes */

describe('outcome chips are categories, not grades', () => {
  it('uses no severity colour for a settled outcome', () => {
    /*
     * Withdrawn drops out of this case because a withdrawal owes no reason
     * and so never queues -- not because its treatment changed. The rule
     * under test is unchanged: an outcome is a category, and categories are
     * not graded.
     */
    decisions = [
      decision({ id: 'a', status: 'accepted', symbol: 'AAA', decidedAt: daysAgo(5) }),
      decision({ id: 'b', status: 'rejected', symbol: 'BBB', decidedAt: daysAgo(6) }),
    ]
    render(<DecisionsWorkspace />)
    for (const label of ['Accepted', 'Declined']) {
      const chip = screen.getAllByText(label)[0]
      expect(chip.className).not.toMatch(/rose|amber|emerald|red-|green-/)
    }
  })

  it('keeps blue for the one genuinely live state', () => {
    decisions = [decision({ status: 'pending', decidedAt: null, decidedByName: null })]
    render(<DecisionsWorkspace />)
    expect(screen.getAllByText('Awaiting decision')[0].className).toMatch(/blue/)
  })
})
