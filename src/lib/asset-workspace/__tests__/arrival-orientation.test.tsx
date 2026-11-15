/**
 * The receiving half of the hop, driven rather than read.
 *
 * ── What was unverified before this file ──────────────────────────────────
 *
 * `entry-handoff.test` proves the slot behaves: one offer, one take, the
 * wrong name refused, the wrong organisation refused, a stale offer dropped.
 * It says nothing about the page that does the taking, and the page is where
 * the two subtle mistakes live -- taking before the organisation resolves
 * (which consumes the offer and shows nothing) and not re-arming when a
 * second press lands on a tab that is already open (which shows nothing
 * either, for the opposite reason).
 *
 * Both of those were in `AssetTab`, which cannot be rendered in a test. They
 * are now in `useArrivalOrientation`, which can, so this file drives them.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useArrivalOrientation } from '../use-arrival-orientation'
import { offerEntryContext, clearEntryContext, hasPendingEntryContext } from '../entry-handoff'
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

beforeEach(clearEntryContext)

const mount = (props: {
  assetId?: string
  organizationId?: string | null
  focusRequestId?: string | number | null
}) =>
  renderHook(
    (p: Parameters<typeof useArrivalOrientation>[0]) => useArrivalOrientation(p),
    {
      initialProps: {
        assetId: props.assetId ?? 'a-aapl',
        organizationId: props.organizationId === undefined ? 'o1' : props.organizationId,
        focusRequestId: props.focusRequestId ?? 'r1',
      },
    },
  )

describe('the page takes what it was handed', () => {
  it('shows the arrival it was opened with', () => {
    offerEntryContext(AAPL)
    const { result } = mount({})
    expect(result.current).toBe(AAPL)
  })

  it('shows nothing when the reader arrived some other way', () => {
    const { result } = mount({})
    expect(result.current).toBeNull()
  })

  it('leaves another name alone', () => {
    offerEntryContext(AAPL)
    const { result } = mount({ assetId: 'a-msft' })
    expect(result.current).toBeNull()
  })

  it('leaves another organisation alone', () => {
    offerEntryContext(AAPL)
    const { result } = mount({ organizationId: 'o2' })
    expect(result.current).toBeNull()
  })
})

describe('an orientation the sender already gave', () => {
  /*
   * The reported defect: a reader opened a target-reached card, read the
   * orientation in the Dashboard's asset pane, pressed "Review the case",
   * and met the same orientation again as a second large band in the
   * canonical page's research content. Four competing attention indicators
   * on one screen, and this was one of them.
   *
   * The offer now carries the sender's declaration, and an orientation the
   * reader has already been given is consumed and not drawn.
   */
  it('draws nothing for an arrival the sender already explained', () => {
    offerEntryContext(AAPL, undefined, { oriented: true })
    const { result } = mount({})
    expect(result.current).toBeNull()
  })

  it('still consumes it, so a later unrelated mount cannot inherit it', () => {
    /* Refusing the take instead of consuming it would leave the offer in the
       slot for whatever arrived next, which is the guard this module exists
       to provide. The slot must be empty either way. */
    offerEntryContext(AAPL, undefined, { oriented: true })
    mount({})
    expect(hasPendingEntryContext()).toBe(false)
  })

  it('still draws for a sender that has explained nothing', () => {
    /* The other branch, which is what makes the one above a check rather
       than a deletion: a surface that opens the canonical page directly,
       with no pane in between, has not oriented anybody. */
    offerEntryContext(AAPL, undefined, { oriented: false })
    const { result } = mount({})
    expect(result.current).toBe(AAPL)
  })
})

describe('waiting for the organisation', () => {
  /*
   * The defect: the org id arrives a tick after the tab does, and a null
   * organisation matches nothing, so taking early both returns null AND
   * empties the slot. The band then never draws for the rest of the visit.
   */
  it('does not consume the offer before the organisation is known', () => {
    offerEntryContext(AAPL)
    mount({ organizationId: null })
    expect(hasPendingEntryContext()).toBe(true)
  })

  it('takes it once the organisation resolves', () => {
    offerEntryContext(AAPL)
    const { result, rerender } = mount({ organizationId: null })
    expect(result.current).toBeNull()

    act(() => {
      rerender({ assetId: 'a-aapl', organizationId: 'o1', focusRequestId: 'r1' })
    })

    expect(result.current).toBe(AAPL)
  })
})

describe('one arrival, one orientation', () => {
  it('gives it up on the first take, so a remount shows the page', () => {
    offerEntryContext(AAPL)
    const first = mount({})
    expect(first.result.current).toBe(AAPL)
    first.unmount()

    const second = mount({})
    expect(second.result.current).toBeNull()
  })

  it('does not take twice on a re-render with nothing changed', () => {
    offerEntryContext(AAPL)
    const { result, rerender } = mount({})
    act(() => {
      rerender({ assetId: 'a-aapl', organizationId: 'o1', focusRequestId: 'r1' })
      rerender({ assetId: 'a-aapl', organizationId: 'o1', focusRequestId: 'r1' })
    })
    /* Still the one it took. A second take would have found an empty slot
       and, under the clearing rule below, wiped the band. */
    expect(result.current).toBe(AAPL)
  })
})

describe('a second press on a tab that is already open', () => {
  /*
   * `openAsset` on an open tab stamps a new `focusRequestId` and does not
   * remount. Without that id in the dependency list the effect never re-runs
   * and the second press orients nobody.
   */
  it('picks up the new arrival', () => {
    const { result, rerender } = mount({})
    expect(result.current).toBeNull()

    offerEntryContext(AAPL)
    act(() => {
      rerender({ assetId: 'a-aapl', organizationId: 'o1', focusRequestId: 'r2' })
    })

    expect(result.current).toBe(AAPL)
  })

  it('clears the last orientation when the new arrival carries none', () => {
    /*
     * The defect this pins, which the page had: open AAPL from a
     * target-reached item, then open AAPL again from the search box. The band
     * stayed, still saying the target had been reached, now above a page the
     * reader got to by typing a name. A reading of one moment restated as
     * current is exactly what the handoff exists to prevent.
     */
    offerEntryContext(AAPL)
    const { result, rerender } = mount({})
    expect(result.current).toBe(AAPL)

    act(() => {
      rerender({ assetId: 'a-aapl', organizationId: 'o1', focusRequestId: 'r2' })
    })

    expect(result.current).toBeNull()
  })

  it('replaces one arrival with the next', () => {
    offerEntryContext(AAPL)
    const { result, rerender } = mount({})
    expect(result.current).toBe(AAPL)

    const again = { ...AAPL, symbol: 'AAPL (second press)' } as WorkspaceEntryContext
    offerEntryContext(again)
    act(() => {
      rerender({ assetId: 'a-aapl', organizationId: 'o1', focusRequestId: 'r3' })
    })

    expect(result.current).toBe(again)
  })
})
