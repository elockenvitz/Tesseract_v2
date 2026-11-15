/**
 * Where the reader was in a scroller they are coming back to.
 *
 * ── The complaint this serves ─────────────────────────────────────────────
 *
 * "Both the canonical Asset Page and embedded Asset Workspace appear to
 * reload when I navigate to another application tab and return."
 *
 * Part of that is the scroll offset, and the reason it is lost differs by
 * surface, which is why one module serves both:
 *
 *   the work pane      Its scroller is inside the Dashboard tab, and
 *                      `DashboardPage.renderTabContent()` renders the
 *                      ACTIVE tab only -- so the element is destroyed and
 *                      rebuilt, taking its offset with it.
 *   the Asset Page     Its scroller is NOT its own. `Layout` owns one
 *                      `overflow-auto` div and every non-full-width tab
 *                      renders into it, so the element survives the tab
 *                      change and its `scrollTop` does not: the next tab's
 *                      content is a different height, the browser clamps
 *                      the offset to that height, and coming back the
 *                      reader is at the top of a page they had read down.
 *
 * Both end up needing the same thing, which is this.
 *
 * ── Why memory, and not storage ──────────────────────────────────────────
 *
 * An offset is only meaningful against the content that produced it. The
 * same asset a day later has a different case, different evidence and a
 * different height, so an offset written to storage and revived tomorrow
 * puts the reader somewhere arbitrary and calls it where they were. A
 * module-scoped value lasts exactly as long as the complaint describes:
 * switch away, come back. A reload starts at the top, which is correct.
 *
 * ── Why a factory and not one shared map ─────────────────────────────────
 *
 * Each caller gets its own bounded map. A reader moving through a dozen
 * names in the work pane must not evict the tab offsets, and the two key
 * spaces -- feed selection keys and tab ids -- would otherwise share a
 * budget for no reason. Separate maps also mean a caller's `forget()` in a
 * test cannot reach another's.
 *
 * ── Why it is not keyed by the reader ────────────────────────────────────
 *
 * There is nothing in a pixel offset to attribute, and nothing a second
 * reader could learn from one. Stated so the difference from `place.ts`,
 * which IS keyed by reader because it holds a reader's material, is a
 * decision rather than an oversight.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'

export interface ScrollPosition {
  /** The scroller's offset, in CSS pixels. */
  scrollTop: number
}

/** The default for a key nobody has scrolled. The top of it. */
export const TOP: ScrollPosition = { scrollTop: 0 }

export interface ScrollMemory {
  /** What was remembered for this key, or the top. */
  read(key: string | null | undefined): ScrollPosition
  /** Remember this key's offset, evicting the least recently written. */
  remember(key: string | null | undefined, scrollTop: number): void
  /** For tests, and for a deliberate reset. */
  forget(): void
  /** How many keys this memory holds at once. */
  readonly limit: number
}

/**
 * A bounded, least-recently-written map of scroll offsets.
 *
 * Bounded because a reader works through many names and many tabs in a
 * session, and a map that only grows is a leak however small each entry is.
 * Dropping the oldest costs nothing a reader would notice: the point of this
 * is the trip they just made.
 */
export function createScrollMemory(limit: number): ScrollMemory {
  const offsets = new Map<string, ScrollPosition>()

  return {
    limit,

    read(key) {
      if (!key) return TOP
      return offsets.get(key) ?? TOP
    },

    remember(key, scrollTop) {
      if (!key) return
      /* Not a finite number means the DOM gave us something unusable. A
         stored NaN is applied on the way back and moves the reader nowhere
         in particular, which reads as the surface jumping. */
      if (!Number.isFinite(scrollTop)) return
      /* Re-inserted rather than mutated, so the Map's insertion order tracks
         recency and the eviction below drops the right one.

         A zero is stored like any other value rather than treated as
         "nothing": scrolling back to the top is a deliberate act, and
         dropping it would hand the reader back the offset they just left. */
      offsets.delete(key)
      offsets.set(key, { scrollTop: Math.max(0, Math.round(scrollTop)) })
      while (offsets.size > limit) {
        const oldest = offsets.keys().next()
        if (oldest.done) break
        offsets.delete(oldest.value)
      }
    },

    forget() {
      offsets.clear()
    },
  }
}

/**
 * Keep one scroller's offset across the key changing under it.
 *
 * ── Why this is not a loop ───────────────────────────────────────────────
 *
 * The first version of this retried for twenty animation frames, so that a
 * surface still filling in would eventually be tall enough to take the
 * offset. It could not tell its own scroll events from the reader's, which
 * means a reader who started reading during those frames got pulled back to
 * where they had been. That is worse than landing at the top.
 *
 * So: assign once in a layout effect, before paint, and retry ONCE on the
 * next frame for the common case where the content had not laid out yet. If
 * the surface is still too short by then, the reader keeps the top of it.
 *
 * `applying` is what keeps the assignment out of the memory. Without it the
 * restore writes its own target back through `onScroll`, which is harmless
 * until the assignment is clamped short -- and then it overwrites the real
 * offset with the clamped one and the next return lands even higher.
 */
export function useRememberedScroll<T extends HTMLElement>(
  memory: ScrollMemory,
  key: string | null | undefined,
) {
  const scroller = useRef<T | null>(null)
  const applying = useRef(false)

  useLayoutEffect(() => {
    const want = memory.read(key).scrollTop
    if (want <= 0) return
    const apply = () => {
      const el = scroller.current
      if (!el) return false
      applying.current = true
      el.scrollTop = want
      applying.current = false
      /* Whether it took. A scroller shorter than the offset clamps, and a
         clamped assignment is not a restore. */
      return el.scrollTop >= want
    }
    if (apply()) return
    const raf = requestAnimationFrame(() => { apply() })
    return () => cancelAnimationFrame(raf)
  }, [memory, key])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el || applying.current) return
    memory.remember(key, el.scrollTop)
  }, [memory, key])

  return { scroller, onScroll }
}
