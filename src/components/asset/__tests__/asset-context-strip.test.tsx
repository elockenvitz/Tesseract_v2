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
