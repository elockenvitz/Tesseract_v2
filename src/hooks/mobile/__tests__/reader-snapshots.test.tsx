import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useReaderSnapshots } from '../useReaderSnapshots'
import { recordInterest } from '../../../lib/mobile/feed-telemetry'
import { markSeen } from '../../../lib/mobile/feed-rotation'

/**
 * The snapshots belong to a reader, and the reader is not always known on the
 * first render.
 *
 * `useAuth` seeds `user` from `auth-user-cache` and only then confirms the
 * session, so `userId` is undefined for the first frames of a cold start.
 * These two were `useState` initialisers with nothing to correct them, so a
 * mount that began in that window kept the ANONYMOUS snapshot for its whole
 * life — nothing demoted, nothing personalised, no way back but a reload.
 * `dispositions` already had a `[userId]` effect; these did not.
 */

const A = 'user-a'
const B = 'user-b'

beforeEach(() => localStorage.clear())

/** Give a reader some history to be found. */
function seedHistory(userId: string, itemId: string, assetId: string) {
  markSeen(userId, [itemId])
  recordInterest({ userId, signal: 'dwell', assetId, authorId: null, dwellMs: 8000, kind: 'idea' })
}

describe('reader snapshots hydrate when the reader becomes known', () => {
  it('starts empty when nobody is identified yet', () => {
    seedHistory(A, 'item-1', 'asset-1')
    const { result } = renderHook(() => useReaderSnapshots(undefined))
    expect(Object.keys(result.current.seenAtMount)).toHaveLength(0)
  })

  /** THE regression: undefined → resolved must load that reader's state. */
  it('loads the seen map once the user id resolves', () => {
    seedHistory(A, 'item-1', 'asset-1')
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useReaderSnapshots(id),
      { initialProps: { id: undefined as string | undefined } },
    )
    expect(result.current.seenAtMount['item-1']).toBeUndefined()

    act(() => { rerender({ id: A }) })

    expect(result.current.seenAtMount['item-1']).toBeDefined()
  })

  it('loads the interest vector once the user id resolves', () => {
    seedHistory(A, 'item-1', 'asset-1')
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useReaderSnapshots(id),
      { initialProps: { id: undefined as string | undefined } },
    )
    const before = result.current.interestAtMount

    act(() => { rerender({ id: A }) })

    expect(result.current.interestAtMount).not.toBe(before)
    // Something was actually learned about this reader, not just a new object.
    expect(JSON.stringify(result.current.interestAtMount))
      .not.toBe(JSON.stringify(before))
  })

  /** Two readers on one device do not inherit each other's history. */
  it('re-snapshots when the reader becomes somebody else', () => {
    seedHistory(A, 'item-a', 'asset-a')
    seedHistory(B, 'item-b', 'asset-b')
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useReaderSnapshots(id),
      { initialProps: { id: A } },
    )
    expect(result.current.seenAtMount['item-a']).toBeDefined()
    expect(result.current.seenAtMount['item-b']).toBeUndefined()

    act(() => { rerender({ id: B }) })

    expect(result.current.seenAtMount['item-b']).toBeDefined()
    expect(result.current.seenAtMount['item-a']).toBeUndefined()
  })

  /**
   * And the snapshot stays frozen otherwise. This is the whole reason they are
   * snapshots: `rotateBySeen` and `interestScore` read stores this same session
   * writes to as the reader scrolls, so re-reading live would move the card
   * being looked at because it is the card being recorded.
   */
  it('does not re-read when the stores change under the same reader', () => {
    seedHistory(A, 'item-1', 'asset-1')
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useReaderSnapshots(id),
      { initialProps: { id: A } },
    )
    const frozen = result.current.seenAtMount

    // The reader scrolls past something new.
    act(() => { markSeen(A, ['item-2']); rerender({ id: A }) })

    expect(result.current.seenAtMount).toBe(frozen)
    expect(result.current.seenAtMount['item-2']).toBeUndefined()
  })

  /** undefined and '' are the same reader — nobody — so this is not a change. */
  it('does not re-snapshot between undefined and empty string', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useReaderSnapshots(id),
      { initialProps: { id: undefined as string | undefined } },
    )
    const first = result.current.seenAtMount
    act(() => { rerender({ id: '' }) })
    expect(result.current.seenAtMount).toBe(first)
  })

  /** A cold start where the id is already cached must not pay a second read. */
  it('uses the initialiser when the reader is known on the first render', () => {
    seedHistory(A, 'item-1', 'asset-1')
    const { result } = renderHook(() => useReaderSnapshots(A))
    expect(result.current.seenAtMount['item-1']).toBeDefined()
  })
})
