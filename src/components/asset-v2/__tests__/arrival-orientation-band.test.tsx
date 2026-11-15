/**
 * What the canonical page draws when a reader arrives with an event, and what
 * it refuses to draw.
 *
 * ── Why this file, when `entry-orientation.test` exists ───────────────────
 *
 * That file proves the band renders its own content correctly from a context
 * and a set of facts. The three claims here are different, and belonged to
 * `AssetTab` -- a 6,300-line component with a hundred imports, where they sat
 * as a JSX conditional that nothing could observe:
 *
 *   both or neither   a context arrives instantly; the facts come from a
 *                     fetch. Drawing the band on a context alone would state
 *                     an event with nothing to compare it against.
 *   one destination   the page has ONE place for the case and the framework,
 *                     because the framework is a section of Research. Two
 *                     buttons leading to the same screen is the duplicate
 *                     control the band was rewritten to remove.
 *   the waiting one   "Open the request" reaches the page's decisions
 *                     surface. Whether it is DRAWN is `EntryOrientation`'s
 *                     own `facts.pending` gate and is covered there -- a
 *                     second gate in the band proved unobservable under
 *                     injection and was removed rather than left as
 *                     decoration. The case below pins the wiring, and the
 *                     one after it pins the composed result.
 *
 * Plus the issue a question carries, which is composed from the context and
 * decides what ACT AI is told the reader was looking at.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ArrivalOrientationBand, arrivalAskIssue } from '../ArrivalOrientationBand'
import type { OrientationPageFacts } from '../EntryOrientation'
import type { WorkspaceEntryContext } from '../../../lib/asset-workspace/entry-context'

afterEach(cleanup)

const CONTEXT: WorkspaceEntryContext = {
  intent: 'target_review',
  assetId: 'a-aapl',
  organizationId: 'o1',
  symbol: 'AAPL',
  sourceItem: null,
  why: { headline: 'AAPL has reached the target you set for it', reason: 'target_reached' },
  portfolioId: null,
  portfolioName: null,
  decisionId: null,
  workflow: null,
  event: {
    kind: 'target_reached',
    caseName: 'Base',
    targetPrice: 240,
    observedPrice: 266,
    observedBasis: 'holdings_mark',
    overshootPct: 0.108,
    statedAt: '2026-03-02T00:00:00Z',
    asOf: '2026-11-10T00:00:00Z',
    ladder: [],
    heldIn: [],
  },
}

const FACTS: OrientationPageFacts = {
  ladder: [],
  officialTarget: 240,
  spot: 266,
  spotAsOf: '2026-11-10',
  caseWrittenAt: '2026-03-02T00:00:00Z',
  position: { portfolioName: 'Core Equity', weightPct: 2.4, valueUsd: 1_200_000 },
  alsoHeldIn: [],
  pending: null,
}

function band(overrides: Partial<Parameters<typeof ArrivalOrientationBand>[0]> = {}) {
  const calls = { reviewCase: 0, openPending: 0, asked: [] as [string, unknown][] }
  render(
    <ArrivalOrientationBand
      context={CONTEXT}
      facts={FACTS}
      onReviewCase={() => { calls.reviewCase += 1 }}
      onOpenPending={() => { calls.openPending += 1 }}
      onAsk={(q, issue) => { calls.asked.push([q, issue]) }}
      now={Date.parse('2026-11-10T12:00:00Z')}
      {...overrides}
    />,
  )
  return calls
}

const slot = () => document.querySelector('[data-slot="asset-arrival-orientation"]')
const openDetail = () => fireEvent.click(screen.getByTestId('entry-detail-toggle'))

describe('both or neither', () => {
  it('draws the band when the page has the figures to compare against', () => {
    band()
    expect(slot()).not.toBeNull()
    expect(screen.getByTestId('entry-target-review')).toBeTruthy()
  })

  it('draws nothing while the facts are still being fetched', () => {
    band({ facts: null })
    expect(slot()).toBeNull()
  })

  it('draws nothing for a reader who arrived without an event', () => {
    band({ context: null })
    expect(slot()).toBeNull()
  })
})

describe('one destination for the case', () => {
  it('reviews the case where the page keeps it', () => {
    const calls = band()
    fireEvent.click(screen.getByTestId('target-review-case'))
    expect(calls.reviewCase).toBe(1)
  })

  it('draws no second button to the same screen', () => {
    /* `openScenarios` lands in Research too on this page, so it is not given
       and must not be drawn. */
    band()
    openDetail()
    expect(screen.queryByTestId('target-open-scenarios')).toBeNull()
  })

  it('offers no link to the page the reader is standing on', () => {
    band()
    expect(screen.queryByTestId('target-open-full')).toBeNull()
  })
})

describe('the waiting request', () => {
  it('is offered when one is actually open', () => {
    const calls = band({
      facts: { ...FACTS, pending: { label: 'Trim to target', note: null, portfolioName: 'Core Equity' } },
    })
    openDetail()
    fireEvent.click(screen.getByTestId('target-open-pending'))
    expect(calls.openPending).toBe(1)
  })

  it('is absent when nothing is waiting', () => {
    /* The composed surface, not the band's own wiring: the control is not
       drawn because there is no request beside it to open. */
    band()
    openDetail()
    expect(screen.queryByTestId('target-open-pending')).toBeNull()
    expect(screen.queryByTestId('target-pending-decision')).toBeNull()
  })
})

describe('what a question tells ACT AI', () => {
  it('carries the headline the reader pressed and the intent it came from', () => {
    const calls = band()
    fireEvent.click(screen.getByTestId('target-assess'))
    expect(calls.asked.length).toBe(1)
    expect(calls.asked[0]![1]).toEqual({
      title: 'AAPL has reached the target you set for it',
      reason: 'entry:target_review',
    })
  })

  it('sends a real question, not an empty seed', () => {
    const calls = band()
    fireEvent.click(screen.getByTestId('target-assess'))
    expect(String(calls.asked[0]![0]).length).toBeGreaterThan(20)
  })

  it('says nothing about the issue when the context carries no reason', () => {
    /* Omitted rather than invented: a question with a fabricated headline
       would tell ACT AI the reader was looking at something they were not. */
    const calls = band({ context: { ...CONTEXT, why: null } as WorkspaceEntryContext })
    fireEvent.click(screen.getByTestId('target-assess'))
    expect(calls.asked[0]![1]).toBeNull()
  })

  it('composes the issue from the context, without rendering', () => {
    expect(arrivalAskIssue(CONTEXT)).toEqual({
      title: 'AAPL has reached the target you set for it',
      reason: 'entry:target_review',
    })
    expect(arrivalAskIssue({ ...CONTEXT, why: null } as WorkspaceEntryContext)).toBeNull()
  })
})
