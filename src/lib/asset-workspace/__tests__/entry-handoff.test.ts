/**
 * Carrying an arrival across one navigation, and refusing to carry it twice.
 *
 * ── What is actually at risk here ─────────────────────────────────────────
 *
 * The thing being handed over is a READING of a moment: a stated target, the
 * book's mark against it, an overshoot, a timestamp. A page that states one
 * of those as current when it is not is worse than a page that states
 * nothing, and there are three distinct ways for that to happen:
 *
 *   the wrong name          a context built for AAPL taken by an MSFT page
 *   the wrong organisation  a context built in one org taken in another
 *   the wrong moment        an offer nobody claimed, picked up later by a
 *                           page the reader reached some other way
 *
 * Each has a guard and each guard has a test. The fourth property -- one
 * offer, one take -- is what makes returning to a tab show the page rather
 * than yesterday's orientation.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  offerEntryContext,
  takeEntryContext,
  clearEntryContext,
  hasPendingEntryContext,
  HANDOFF_TTL_MS,
} from '../entry-handoff'
import type { WorkspaceEntryContext } from '../entry-context'

const AAPL: WorkspaceEntryContext = {
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

const here = { assetId: 'a-aapl', organizationId: 'o1' }

beforeEach(clearEntryContext)

describe('the normal hop', () => {
  it('hands the context to the page that was opened', () => {
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext(here, 1_050)).toBe(AAPL)
  })

  it('is empty before anyone offers anything', () => {
    expect(hasPendingEntryContext()).toBe(false)
    expect(takeEntryContext(here)).toBeNull()
  })
})

describe('one offer, one take', () => {
  it('gives it up once, so a remount gets nothing', () => {
    /* Returning to a tab is a remount. The band is an orientation for an
       arrival, not a property of the page, so the second take is empty. */
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext(here, 1_010)).toBe(AAPL)
    expect(takeEntryContext(here, 1_020)).toBeNull()
  })

  it('empties the slot even when the context did not apply', () => {
    /* An offer that did not apply never will, and leaving it would hand it to
       whatever arrival came next. */
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext({ assetId: 'a-msft', organizationId: 'o1' }, 1_010)).toBeNull()
    expect(hasPendingEntryContext()).toBe(false)
    expect(takeEntryContext(here, 1_020)).toBeNull()
  })

  it('replaces an unclaimed offer rather than queueing behind it', () => {
    const other = { ...AAPL, symbol: 'AAPL (second press)' } as WorkspaceEntryContext
    offerEntryContext(AAPL, 1_000)
    offerEntryContext(other, 1_100)
    expect(takeEntryContext(here, 1_110)).toBe(other)
  })

  it('clears the slot when offered nothing', () => {
    offerEntryContext(AAPL, 1_000)
    offerEntryContext(null, 1_010)
    expect(hasPendingEntryContext()).toBe(false)
  })
})

describe('the wrong page', () => {
  it('refuses another name', () => {
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext({ assetId: 'a-msft', organizationId: 'o1' }, 1_010)).toBeNull()
  })

  it('refuses another organisation', () => {
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext({ assetId: 'a-aapl', organizationId: 'o2' }, 1_010)).toBeNull()
  })

  it('refuses a page whose organisation is not known yet', () => {
    /* Null matches nothing: the honest answer to "is this the right
       organisation" is unknown, and unknown must not render another
       organisation's event. The receiver waits for the id instead. */
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext({ assetId: 'a-aapl', organizationId: null }, 1_010)).toBeNull()
  })

  it('refuses a context built before its own organisation resolved', () => {
    offerEntryContext({ ...AAPL, organizationId: null } as WorkspaceEntryContext, 1_000)
    expect(takeEntryContext(here, 1_010)).toBeNull()
  })
})

describe('the wrong moment', () => {
  it('discards an offer nobody claimed in time', () => {
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext(here, 1_000 + HANDOFF_TTL_MS + 1)).toBeNull()
  })

  it('still honours one claimed right on the limit', () => {
    offerEntryContext(AAPL, 1_000)
    expect(takeEntryContext(here, 1_000 + HANDOFF_TTL_MS)).toBe(AAPL)
  })

  it('keeps the window short enough that a stale orientation is not plausible', () => {
    /* The gap between the offer and the take is one tab open. A long window
       buys nothing and risks an orientation on a page the reader reached by
       another route entirely. */
    expect(HANDOFF_TTL_MS).toBeLessThanOrEqual(30_000)
  })
})

describe('a sender that changes its mind', () => {
  it('can withdraw the offer', () => {
    offerEntryContext(AAPL, 1_000)
    clearEntryContext()
    expect(takeEntryContext(here, 1_010)).toBeNull()
  })
})
