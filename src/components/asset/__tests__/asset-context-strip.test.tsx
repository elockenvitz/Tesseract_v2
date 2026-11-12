/**
 * UX1a — the persistent investment-context strip.
 *
 * The strip is a pure pass-through of two org-scoped hooks, so these tests pin
 * the two things the design brief is explicit about and that are easy to get
 * wrong: (1) absence is shown quietly, never as a header full of "Not set";
 * (2) the FIRM consensus and the reader's OWN rating are never blurred.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

type Row = Record<string, unknown>
const ws = vi.hoisted(() => ({ data: null as Row | null, isLoading: false }))
const rt = vi.hoisted(() => ({ consensus: [] as Row[], ratings: [] as Row[], myRating: null as Row | null }))

vi.mock('../../../hooks/useAssetWorkspace', () => ({
  useAssetWorkspace: () => ws,
  // real-enough: pick the named book, else the first position
  primaryPosition: (positions: Array<{ portfolioId?: string }>, portfolioId: string | null) =>
    (portfolioId ? positions.find(p => p.portfolioId === portfolioId) : positions[0]) ?? null,
}))
vi.mock('../../../hooks/useAnalystRatings', () => ({ useAnalystRatings: () => rt }))

import { AssetContextStrip } from '../AssetContextStrip'

const EMPTY_WS = {
  sections: [], evidence: [], caseWrittenAt: null, spot: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}
const monthsAgo = (n: number) => new Date(Date.now() - n * 30.44 * 86_400_000).toISOString()

beforeEach(() => {
  cleanup()
  ws.data = { ...EMPTY_WS }; ws.isLoading = false
  rt.consensus = []; rt.ratings = []; rt.myRating = null
})

function renderStrip(spot: number | null = null) {
  return render(<AssetContextStrip assetId="a1" symbol="LLY" spot={spot} />)
}

describe('AssetContextStrip — absence is quiet, never "Not set"', () => {
  it('an asset with no data shows no "Not set" anywhere', () => {
    renderStrip()
    expect(screen.queryByText(/not set/i)).toBeNull()
    expect(screen.getByText('No rating yet')).toBeTruthy()
    expect(screen.getByText('No target yet')).toBeTruthy()
    expect(screen.getByText('Not held')).toBeTruthy()
    expect(screen.getByText('None open')).toBeTruthy()
    expect(screen.getByText('No case yet')).toBeTruthy()
  })

  it('always labels the firm-vs-personal cell as the FIRM rating', () => {
    renderStrip()
    expect(screen.getByText('Firm rating')).toBeTruthy()
  })
})

describe('AssetContextStrip — firm consensus vs the reader', () => {
  it('shows the consensus value and the count when the reader agrees (or has not rated)', () => {
    rt.consensus = [{ value: 'Buy', count: 2, percentage: 100 }]
    rt.ratings = [{}, {}]
    renderStrip()
    expect(screen.getByText('Buy')).toBeTruthy()
    expect(screen.getByText('2 of 2')).toBeTruthy()
    expect(screen.queryByText(/^You:/)).toBeNull()
  })

  it('never rounds a single analyst up to a firm position — the count travels with it', () => {
    // Guarantee migrated from the old conclusion band.
    rt.consensus = [{ value: 'UW', count: 1, percentage: 100 }]
    rt.ratings = [{}]
    renderStrip()
    expect(screen.getByText('UW')).toBeTruthy()
    expect(screen.getByText('1 of 1')).toBeTruthy()
  })

  it('surfaces the reader’s OWN rating separately when it diverges', () => {
    rt.consensus = [{ value: 'Buy', count: 2, percentage: 66 }]
    rt.ratings = [{}, {}, {}]
    rt.myRating = { rating_value: 'Hold' }
    renderStrip()
    expect(screen.getByText('Buy')).toBeTruthy()           // firm, unchanged
    expect(screen.getByText(/You:\s*Hold/)).toBeTruthy()   // personal, not merged
  })
})

describe('AssetContextStrip — target, upside, exposure attribution, freshness', () => {
  it('computes upside from the live spot and labels the target as the firm’s', () => {
    ws.data = { ...EMPTY_WS, target: 1480 }
    renderStrip(1240)
    expect(screen.getByText('$1,480')).toBeTruthy()
    expect(screen.getByText('+19.4%')).toBeTruthy() // (1480-1240)/1240
    expect(screen.getByText('firm target')).toBeTruthy()
  })

  it('shows a target with no upside when there is no spot to compare', () => {
    // Guarantee migrated from the old conclusion band: a target with no price
    // to compare is a number, not a return.
    ws.data = { ...EMPTY_WS, target: 180 }
    renderStrip(null)
    expect(screen.getByText('$180')).toBeTruthy()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('describes exposure without ever judging the sizing', () => {
    // Migrated guarantee: a landing surface states the weight, it does not
    // offer an over/underweight sizing opinion.
    ws.data = { ...EMPTY_WS, positions: [{ portfolioId: 'p1', portfolioName: 'Growth', weightPct: 2.1 }] }
    const { container } = renderStrip()
    expect(container.textContent ?? '').not.toMatch(/overweight|underweight|too small|too large|should/i)
  })

  it('attributes exposure to a named book and counts the rest', () => {
    ws.data = {
      ...EMPTY_WS,
      positions: [
        { portfolioId: 'p1', portfolioName: 'Vision Fund 10K', weightPct: 2.1 },
        { portfolioId: 'p2', portfolioName: 'Growth', weightPct: 0.4 },
      ],
    }
    renderStrip()
    expect(screen.getByText('2.1%')).toBeTruthy()
    expect(screen.getByText(/Vision Fund 10K · \+1 book/)).toBeTruthy()
  })

  it('flags a stale case and counts items written since', () => {
    ws.data = {
      ...EMPTY_WS,
      caseWrittenAt: monthsAgo(10),
      evidence: [{ isNewSinceReview: true }, { isNewSinceReview: true }, { isNewSinceReview: false }],
    }
    renderStrip()
    expect(screen.getByText('10 mo old')).toBeTruthy()
    expect(screen.getByText('2 new items since')).toBeTruthy()
  })

  it('an old case with no newer research is never called "up to date"', () => {
    // Refinement 1: case AGE and evidence freshness are separate facts.
    ws.data = { ...EMPTY_WS, caseWrittenAt: monthsAgo(11), evidence: [] }
    renderStrip()
    expect(screen.getByText('11 mo old')).toBeTruthy()
    expect(screen.getByText('no new research since')).toBeTruthy()
    expect(screen.queryByText(/up to date/i)).toBeNull()
  })
})

describe('AssetContextStrip — a ruling owed is not "nothing waiting"', () => {
  /*
   * The strip counted live IDEAS only, so a name with a buy request sitting
   * unanswered read "None open · nothing waiting" in a header that never
   * scrolls away -- directly above an Overview leading with the request. Two
   * parts of one screen disagreeing, with the sticky one wrong.
   */
  const request = (over: Row = {}): Row => ({
    id: 'dr-7', status: 'pending', action: 'buy', decidedAt: null,
    portfolioId: 'p1', portfolioName: 'Large Cap Growth', decisionNote: null,
    ideaId: null, ...over,
  })

  it('says a decision is waiting, and which book it is in', () => {
    ws.data = { ...EMPTY_WS, decisions: [request()] }
    renderStrip()
    expect(screen.getByText('Awaiting a decision')).toBeTruthy()
    expect(screen.getByText(/buy · Large Cap Growth/)).toBeTruthy()
    expect(screen.queryByText('None open')).toBeNull()
  })

  it('counts them when more than one is waiting', () => {
    ws.data = {
      ...EMPTY_WS,
      decisions: [request(), request({ id: 'dr-8', portfolioName: 'Equity Income', action: 'trim' })],
    }
    renderStrip()
    expect(screen.getByText('2 awaiting a decision')).toBeTruthy()
  })

  it('outranks an idea in play, because somebody is blocked on a human', () => {
    ws.data = {
      ...EMPTY_WS,
      decisions: [request()],
      liveIdeas: [{ id: 'idea-9', action: 'add', stage: 'exploring', portfolioName: 'Equity Income' }],
    }
    renderStrip()
    expect(screen.getByText('Awaiting a decision')).toBeTruthy()
  })

  it('counts a request raised on an idea once, as the Overview does', () => {
    /* One piece of work, not two. The strip's total and the Overview's rows
       are derived the same way so they cannot disagree. */
    ws.data = {
      ...EMPTY_WS,
      decisions: [],
      liveIdeas: [
        { id: 'idea-9', action: 'add', stage: 'deciding', portfolioName: 'Equity Income' },
        { id: 'idea-10', action: 'buy', stage: 'exploring', portfolioName: 'Equity Income' },
      ],
    }
    renderStrip()
    expect(screen.getByText('2 open')).toBeTruthy()

    cleanup()
    ws.data = {
      ...EMPTY_WS,
      decisions: [request({ ideaId: 'idea-9' })],
      liveIdeas: [
        { id: 'idea-9', action: 'add', stage: 'deciding', portfolioName: 'Equity Income' },
        { id: 'idea-10', action: 'buy', stage: 'exploring', portfolioName: 'Equity Income' },
      ],
    }
    renderStrip()
    /* The pair plus the loose idea is two, not three. */
    expect(screen.getByText('Awaiting a decision')).toBeTruthy()
  })

  it('ignores a request nobody is waiting on', () => {
    /* A withdrawn request is never ruled on, so its `reviewed_at` stays
       null. Filtering on that alone would leave it in the strip forever. */
    ws.data = { ...EMPTY_WS, decisions: [request({ status: 'withdrawn' })] }
    renderStrip()
    expect(screen.getByText('None open')).toBeTruthy()
    expect(screen.queryByText(/awaiting a decision/i)).toBeNull()
  })
})
