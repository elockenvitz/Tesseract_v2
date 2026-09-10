/**
 * Leaving Safari and coming back is not a refresh.
 *
 * ── The report ────────────────────────────────────────────────────────────
 *
 * From an iPhone: leave the browser for another app, come back, and the Ideas
 * feed is at the top. "It needs to maintain the position unless I hard
 * refresh."
 *
 * `feed-continuity` deliberately held its snapshot in a module-level Map, and
 * the reasoning was sound for the case it considered: an in-app navigation
 * keeps the bundle alive, a reload evaluates the module afresh, and a reload
 * is the reader asking for a fresh feed.
 *
 * The last step is false on a phone. iOS evicts a backgrounded tab under memory
 * pressure and reloads it when the reader returns, and `performance.navigation`
 * reports that as `reload` exactly like a deliberate refresh. So a page load
 * nobody asked for, and which the reader could not tell had happened, threw
 * away the order and the tile.
 *
 * ── What tells them apart ─────────────────────────────────────────────────
 *
 * What the page was doing when it died. A reader who hits reload is LOOKING at
 * the page; a tab iOS discards was hidden. So a marker is written on the way
 * out of view and cleared on the way back in, and a page that loads to find one
 * knows it was killed rather than refreshed.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearFeedContinuity, hydrateFeedContinuity, markFeedHidden,
  persistFeedContinuity, readFeedContinuity, wasFeedBackgrounded, writeFeedContinuity,
} from '../feed-continuity'

const SCOPE = 'reader-1:org-1'

/** A reload: the module is evaluated afresh, so its Map is empty again. */
const simulateReload = () => clearFeedContinuityInMemoryOnly()

/**
 * Drop the in-memory entry WITHOUT touching storage, which is what a page load
 * actually does. `clearFeedContinuity` is the pull-to-refresh path and
 * deliberately clears both.
 */
function clearFeedContinuityInMemoryOnly(): void {
  // The module exposes no such door on purpose, so this stands in for one by
  // clearing every scope and putting the storage entry back.
  const stored = sessionStorage.getItem('tesseract:feed-continuity:' + SCOPE)
  const hidden = sessionStorage.getItem('tesseract:feed-hidden:' + SCOPE)
  clearFeedContinuity()
  if (stored) sessionStorage.setItem('tesseract:feed-continuity:' + SCOPE, stored)
  if (hidden) sessionStorage.setItem('tesseract:feed-hidden:' + SCOPE, hidden)
}

/** A reader five screens down, with an order and a tile remembered. */
function aReaderInProgress(): void {
  writeFeedContinuity(SCOPE, {
    baseOrder: ['a', 'b', 'c', 'd', 'e', 'f'],
    position: { baseKey: 'd', viewKey: 'd' },
    readDepth: 4,
  })
}

beforeEach(() => {
  sessionStorage.clear()
  clearFeedContinuity()
})

describe('the hidden marker', () => {
  it('is not set until the page goes out of view', () => {
    expect(wasFeedBackgrounded(SCOPE)).toBe(false)
  })

  it('is set on the way out and cleared on the way back in', () => {
    markFeedHidden(SCOPE, true)
    expect(wasFeedBackgrounded(SCOPE)).toBe(true)
    markFeedHidden(SCOPE, false)
    expect(wasFeedBackgrounded(SCOPE)).toBe(false)
  })

  it('is scoped to the reader', () => {
    markFeedHidden(SCOPE, true)
    expect(wasFeedBackgrounded('someone-else:org-1')).toBe(false)
  })

  it('answers no with no scope at all', () => {
    markFeedHidden(SCOPE, true)
    expect(wasFeedBackgrounded(null)).toBe(false)
  })
})

describe('coming back from another app', () => {
  it('hands the order and the tile back', () => {
    aReaderInProgress()
    // Safari backgrounds the tab, then kills it.
    markFeedHidden(SCOPE, true)
    persistFeedContinuity(SCOPE)
    simulateReload()

    expect(readFeedContinuity(SCOPE).position.baseKey).toBeNull()
    expect(hydrateFeedContinuity(SCOPE)).toBe(true)

    const back = readFeedContinuity(SCOPE)
    expect(back.position.baseKey).toBe('d')
    expect(back.baseOrder).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(back.readDepth).toBe(4)
  })

  it('keeps the active filter too', () => {
    writeFeedContinuity(SCOPE, { family: 'project_overdue', position: { viewKey: 'c' } })
    markFeedHidden(SCOPE, true)
    persistFeedContinuity(SCOPE)
    simulateReload()
    hydrateFeedContinuity(SCOPE)

    expect(readFeedContinuity(SCOPE).family).toBe('project_overdue')
  })
})

describe('a deliberate refresh still starts fresh', () => {
  /**
   * The behaviour the continuity module's header argues for, and which this
   * must not cost: a reader who asks for a new feed gets one.
   */
  it('refuses to hydrate when the page was visible', () => {
    aReaderInProgress()
    persistFeedContinuity(SCOPE)
    // No hidden marker: the reader hit reload while looking at the page.
    simulateReload()

    expect(hydrateFeedContinuity(SCOPE)).toBe(false)
    expect(readFeedContinuity(SCOPE).position.baseKey).toBeNull()
  })

  /** And it clears the stale copy, so a later eviction cannot resurrect it. */
  it('drops the persisted copy on that refusal', () => {
    aReaderInProgress()
    persistFeedContinuity(SCOPE)
    simulateReload()
    hydrateFeedContinuity(SCOPE)

    markFeedHidden(SCOPE, true)
    expect(hydrateFeedContinuity(SCOPE)).toBe(false)
  })

  /**
   * Backgrounding, returning to a LIVE tab, then refreshing is a refresh. The
   * marker is cleared on the way back into view, so the reload finds none.
   */
  it('does not mistake a later refresh for the earlier backgrounding', () => {
    aReaderInProgress()
    markFeedHidden(SCOPE, true)
    persistFeedContinuity(SCOPE)
    // The tab survived, so the page comes back into view.
    markFeedHidden(SCOPE, false)
    simulateReload()

    expect(hydrateFeedContinuity(SCOPE)).toBe(false)
  })
})

describe('what must not be overwritten', () => {
  /**
   * An in-app navigation already holds the real thing in memory, and it is
   * newer than anything on disk.
   */
  it('never overwrites a live entry', () => {
    aReaderInProgress()
    markFeedHidden(SCOPE, true)
    persistFeedContinuity(SCOPE)
    writeFeedContinuity(SCOPE, { position: { baseKey: 'f', viewKey: 'f' } })

    expect(hydrateFeedContinuity(SCOPE)).toBe(false)
    expect(readFeedContinuity(SCOPE).position.baseKey).toBe('f')
  })

  /** Pull-to-refresh IS the reader asking, so it clears both copies. */
  it('is undone by a deliberate refresh of the feed', () => {
    aReaderInProgress()
    markFeedHidden(SCOPE, true)
    persistFeedContinuity(SCOPE)

    clearFeedContinuity(SCOPE)
    markFeedHidden(SCOPE, true)

    expect(hydrateFeedContinuity(SCOPE)).toBe(false)
    expect(readFeedContinuity(SCOPE).position.baseKey).toBeNull()
  })
})
