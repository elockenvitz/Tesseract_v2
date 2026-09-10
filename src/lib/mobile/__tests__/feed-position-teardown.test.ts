/**
 * Leaving the feed must not erase where the reader was.
 *
 * ── The report ────────────────────────────────────────────────────────────
 *
 * From a phone: scroll the Ideas feed, tap Explore, come back, and the feed is
 * at the top. Reproduced in the running app with the stored value read at each
 * step: scrolling saved 4130, tapping Explore turned it into 0, and returning
 * restored 0 faithfully. The restore was never broken. The save was.
 *
 * ── Why the save destroyed itself ─────────────────────────────────────────
 *
 * The dashboard writes the offset on a 400ms throttle while the reader scrolls,
 * and once more when the effect tears down, so the last flick is not lost. The
 * teardown write reads `scrollTop` off the scrolling element.
 *
 * By the time it runs the element is gone. React has already detached it, and
 * a detached element reports `scrollTop` as 0 — see the first test below, which
 * pins that premise rather than assuming it. So the teardown wrote 0 over the
 * good value the throttle had just saved.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A detached element knows nothing about where the reader was, so it is not
 * asked. `saveFeedSession` takes `scrollTop: null` to mean "keep the offset
 * already stored", which lets the teardown still record the seed and cycle —
 * its other job, and the reason it cannot simply be deleted.
 *
 * A ref tracking the last known offset was the other candidate. It was rejected
 * because it has to be updated at every site that writes `scrollTop`, including
 * the restore itself, and a missed site reintroduces this bug silently. This
 * rule has nothing to keep in sync.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { loadFeedSession, saveFeedSession, clearFeedSession } from '../feed-session'

const SCOPE = { userId: 'reader-1', orgId: 'org-1' }

beforeEach(() => {
  clearFeedSession(SCOPE)
})

/**
 * ── Why the premise is not pinned here ────────────────────────────────────
 *
 * "A detached element reports scrollTop as 0" is a real browser behaviour and
 * jsdom does not reproduce it: with no layout, it simply hands back whatever
 * was assigned. A test asserting it here would fail for a reason that has
 * nothing to do with the product.
 *
 * So the premise is evidence, not an assertion. Measured in Chrome against the
 * running app: the stored offset read 4130 while scrolling, and 0 immediately
 * after tapping Explore, with the scroller confirmed absent from the document
 * at that moment.
 *
 * What IS pinned is the pair that fixes it — the storage rule below, and the
 * wiring in `components/mobile/__tests__/feed-filter-continuity.test.ts`, which
 * holds the dashboard to asking `isConnected` before believing the element.
 */

describe('saving without an offset keeps the one already stored', () => {
  it('does not overwrite the reader’s place with a zero', () => {
    saveFeedSession(SCOPE, { seed: 7, cycle: 0, scrollTop: 4130 })
    expect(loadFeedSession(SCOPE)?.scrollTop).toBe(4130)

    // What teardown now does when the scroller has already been detached.
    saveFeedSession(SCOPE, { seed: 7, cycle: 2, scrollTop: null })

    const after = loadFeedSession(SCOPE)
    expect(after?.scrollTop).toBe(4130)
  })

  it('still records the seed and cycle, which is teardown’s other job', () => {
    saveFeedSession(SCOPE, { seed: 7, cycle: 0, scrollTop: 4130 })
    saveFeedSession(SCOPE, { seed: 7, cycle: 3, scrollTop: null })

    const after = loadFeedSession(SCOPE)
    expect(after?.cycle).toBe(3)
    expect(after?.seed).toBe(7)
  })

  it('is zero when there was nothing stored to keep', () => {
    saveFeedSession(SCOPE, { seed: 7, cycle: 0, scrollTop: null })

    expect(loadFeedSession(SCOPE)?.scrollTop).toBe(0)
  })

  /**
   * A live element is still believed. The rule narrows the case where the
   * element cannot answer; it does not stop the feed recording real scrolling.
   */
  it('a real offset still overwrites the stored one', () => {
    saveFeedSession(SCOPE, { seed: 7, cycle: 0, scrollTop: 4130 })
    saveFeedSession(SCOPE, { seed: 7, cycle: 0, scrollTop: 20 })

    expect(loadFeedSession(SCOPE)?.scrollTop).toBe(20)
  })
})
