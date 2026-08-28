import { useCallback, useEffect, useRef } from 'react'
import { recordInterest } from '../../lib/mobile/feed-telemetry'

interface DwellTarget {
  assetId?: string | null
  authorId?: string | null
  /**
   * Which tile type this was.
   *
   * Dwell on an asset says the *name* is interesting; dwell on a kind says the
   * *format* earns its screen. Without this the feed could never learn that a
   * whole tile type is being scrolled past — and tiles about no particular
   * asset recorded nothing at all, so the kinds most likely to be filler were
   * exactly the ones it could not learn to stop showing.
   */
  kind?: string | null
}

/**
 * Measures how long each feed card is actually on screen.
 *
 * Dwell is the only implicit signal a feed gets for free, and it is the
 * difference between "shown" and "read". Measured with IntersectionObserver
 * rather than scroll maths: it reports real visibility, costs nothing per
 * frame, and stays correct through snap scrolling and orientation changes.
 *
 * A card counts as being read only while it is majority-visible, and the timer
 * pauses when the tab is hidden — otherwise leaving the app on a card would
 * record minutes of phantom interest.
 */
/**
 * Notified every time a card leaves the majority-visible state, with how long
 * it held it.
 *
 * An escape hatch rather than a second telemetry path: dwell is already the
 * only "this was actually read" signal the feed measures, and anything else
 * that needs to know a card was read would otherwise build a parallel
 * IntersectionObserver over the same elements. The hook stays ignorant of what
 * the caller does with it — coverage, activation and interest scoring are all
 * somebody else's concern.
 */
export type DwellObserver = (target: DwellTarget, dwellMs: number) => void

export function useFeedDwell(userId: string | undefined, onDwell?: DwellObserver) {
  const targets = useRef(new Map<Element, DwellTarget>())
  const startedAt = useRef(new Map<Element, number>())
  const observer = useRef<IntersectionObserver | null>(null)

  // Held in a ref so a caller passing an inline arrow does not re-create the
  // observer on every render — the observer effect runs once, and a changing
  // dependency would tear down and re-register every tracked element.
  const onDwellRef = useRef(onDwell)
  useEffect(() => { onDwellRef.current = onDwell })

  const flush = useCallback((el: Element) => {
    const start = startedAt.current.get(el)
    if (start == null) return
    startedAt.current.delete(el)

    const target = targets.current.get(el)
    if (!target) return

    const dwellMs = Date.now() - start
    // Before the userId guard: an observer may care about a read that interest
    // scoring does not record.
    onDwellRef.current?.(target, dwellMs)

    if (!userId) return

    recordInterest({
      userId,
      signal: 'dwell',
      assetId: target.assetId,
      authorId: target.authorId,
      kind: target.kind,
      dwellMs,
    })
  }, [userId])

  useEffect(() => {
    observer.current = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (!startedAt.current.has(entry.target)) {
              startedAt.current.set(entry.target, Date.now())
            }
          } else {
            flush(entry.target)
          }
        }
      },
      // 0.6 rather than any visibility: during a snap scroll two cards are
      // briefly on screen at once, and both should not accrue time.
      { threshold: [0, 0.6, 1] }
    )

    const onVisibility = () => {
      if (document.hidden) {
        for (const el of Array.from(startedAt.current.keys())) flush(el)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      // Credit whatever was on screen at unmount rather than discarding it.
      for (const el of Array.from(startedAt.current.keys())) flush(el)
      document.removeEventListener('visibilitychange', onVisibility)
      observer.current?.disconnect()
      observer.current = null
    }
  }, [flush])

  /** Ref callback for a feed section. Pass the item's asset/author. */
  const track = useCallback((target: DwellTarget) => (el: HTMLElement | null) => {
    if (!el) return
    targets.current.set(el, target)
    observer.current?.observe(el)
  }, [])

  return { track }
}
