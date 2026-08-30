import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDispositions } from '../useDispositions'
import {
  DISPOSITIONS_CHANGED_EVENT,
  recordDisposition,
} from '../../../lib/signals/dispositions'
import { judgmentRefFor } from '../../../lib/ideas/feed-suppression'
import { TRIAGE_JUDGMENT } from '../../../lib/signals/feed-triage'

/**
 * [11] The recomputation half of desktop suppression parity.
 *
 * Suppression itself is decided in `feed-suppression`; what is proven here is
 * that the desktop feed learns about an answer without a reload, and that it
 * does so by being told rather than by looking. An interval would satisfy the
 * first requirement and violate the second.
 */

const USER = 'reader-1'
const OTHER = 'reader-2'
const POST = { id: 'post-1', type: 'quick_thought' }

const write = (userId: string, key: string) => {
  const ref = judgmentRefFor(POST)
  return recordDisposition(userId, ref.type, ref.entityId, {
    kind: 'settled',
    key,
    label: 'Dismiss',
    question: 'Feed triage',
    cardType: ref.type,
    until: Date.now() + 30 * 86_400_000,
  })
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('useDispositions', () => {
  it('reads what is already stored on mount', () => {
    write(USER, TRIAGE_JUDGMENT.dismiss.key)
    const { result } = renderHook(() => useDispositions(USER))
    expect(result.current[judgmentRefFor(POST).storeKey]).toBeDefined()
  })

  it('is empty, not stale, without a user', () => {
    write(USER, TRIAGE_JUDGMENT.dismiss.key)
    const { result } = renderHook(() => useDispositions(null))
    expect(result.current).toEqual({})
  })

  /**
   * The case the browser's own `storage` event cannot cover: it does not fire
   * in the tab that wrote. Without this the surface that recorded the answer
   * would be the one surface that never noticed it.
   */
  it('picks up a write made in this tab, without a reload', () => {
    const { result } = renderHook(() => useDispositions(USER))
    expect(result.current).toEqual({})

    act(() => { write(USER, TRIAGE_JUDGMENT.dismiss.key) })

    expect(result.current[judgmentRefFor(POST).storeKey]?.key)
      .toBe(TRIAGE_JUDGMENT.dismiss.key)
  })

  it('picks up a write made in another tab', () => {
    const { result } = renderHook(() => useDispositions(USER))

    act(() => {
      write(USER, TRIAGE_JUDGMENT.snooze.key)
      // What the browser delivers to a tab that did NOT do the writing.
      window.dispatchEvent(new StorageEvent('storage', {
        key: `tesseract:signal-disposition:${USER}`,
      }))
    })

    expect(result.current[judgmentRefFor(POST).storeKey]?.key)
      .toBe(TRIAGE_JUDGMENT.snooze.key)
  })

  /**
   * `storage` fires for every key on the origin. Re-reading on an unrelated
   * write would replace the map with an equal-but-different object and re-key
   * every query that depends on it — a feed refetch caused by somebody else's
   * cache entry.
   */
  it('ignores a storage event for another key', () => {
    const { result } = renderHook(() => useDispositions(USER))
    const before = result.current

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some:other:cache' }))
    })

    expect(result.current).toBe(before)
  })

  it('stops listening once unmounted', () => {
    const { unmount } = renderHook(() => useDispositions(USER))
    unmount()
    // No listener, no throw, and nothing left holding the old user's state.
    expect(() => {
      write(USER, TRIAGE_JUDGMENT.dismiss.key)
      window.dispatchEvent(new CustomEvent(DISPOSITIONS_CHANGED_EVENT))
    }).not.toThrow()
  })

  it('does not leak one reader\'s answers to another', () => {
    write(OTHER, TRIAGE_JUDGMENT.dismiss.key)
    const { result } = renderHook(() => useDispositions(USER))
    expect(result.current).toEqual({})
  })
})
