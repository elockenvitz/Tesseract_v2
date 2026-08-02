import { useCallback, useEffect, useRef } from 'react'
import { recordInterest } from '../../lib/mobile/feed-telemetry'

interface DwellTarget {
  assetId?: string | null
  authorId?: string | null
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
export function useFeedDwell(userId: string | undefined) {
  const targets = useRef(new Map<Element, DwellTarget>())
  const startedAt = useRef(new Map<Element, number>())
  const observer = useRef<IntersectionObserver | null>(null)

  const flush = useCallback((el: Element) => {
    const start = startedAt.current.get(el)
    if (start == null) return
    startedAt.current.delete(el)

    const target = targets.current.get(el)
    if (!userId || !target) return

    recordInterest({
      userId,
      signal: 'dwell',
      assetId: target.assetId,
      authorId: target.authorId,
      dwellMs: Date.now() - start,
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
