/**
 * The mobile Ideas feed's pagination sentinel, reproduced.
 *
 * ── What is being reproduced ─────────────────────────────────────────────
 *
 * `MobileDashboard` renders Explore and the feed as the two arms of one
 * ternary:
 *
 *     {mode === 'explore' ? ( …explore… ) : ( …feed… )}
 *
 * So leaving the feed for Explore UNMOUNTS the feed's subtree — scroller,
 * slots and the pagination sentinel — while `MobileDashboard` itself stays
 * mounted and keeps all of its state and refs.
 *
 * The scroller survives that, because it is attached through a callback that
 * puts it in STATE (`attachScroller` -> `setScroller`), so every effect that
 * observes it re-runs against the new element.
 *
 * The sentinel was attached through `useRef`. Writing to a ref does not
 * render, so the `IntersectionObserver` effect — whose dependencies are
 * `[hasNextPage, isFetchingNextPage, fetchNextPage, baseFeedEntries.length,
 * tailVariety]`, none of which change on a return — never re-ran. The
 * observer kept watching the DETACHED node, which can never intersect
 * anything again, so `fetchNextPage()` and `setCycle(c => c + 1)` stopped
 * firing for the life of the session.
 *
 * ── Why this is a miniature and not the real component ───────────────────
 *
 * `MobileDashboard` is 9,000 lines behind Supabase, a signed-in org and live
 * holdings; the gallery's own note says it cannot be a subject. What can be
 * reproduced faithfully is the LIFECYCLE, which is where the defect lives:
 * the same ternary, the same two attachment styles, the same observer effect
 * with the same dependency shape, in a real browser with real scrolling.
 *
 * `?mode=ref` is the broken attachment, `?mode=state` the fixed one. Both are
 * kept so the probe can show the fix is load-bearing rather than incidental.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const PAGE = 8

export function FeedSentinelRepro({
  attach, initial = PAGE, exhausted = false,
}: {
  attach: 'ref' | 'state'
  /** Starting tile count. 0 and 1 are the degenerate feeds. */
  initial?: number
  /**
   * The server has no more pages AND there is nothing to cycle.
   *
   * Stands in for a genuinely finished feed, which must present an end rather
   * than grow. The fix must not turn "nothing more to show" into an endless
   * scroll — the instruction was explicit that filler is not a fix.
   */
  exhausted?: boolean
}) {
  /** Stands in for Explore. The feed is the other arm of the ternary. */
  const [mode, setMode] = useState<'feed' | 'explore'>('feed')

  /** Stands in for `fetchNextPage` + `setCycle`. */
  const [count, setCount] = useState(initial)
  const [loads, setLoads] = useState(0)

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)

  // The two attachment styles, side by side.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null)

  /*
   * Declared here, not inline in the JSX.
   *
   * The first draft put this `useCallback` inside the feed arm of the
   * ternary, so switching to Explore rendered fewer hooks than the previous
   * pass and React threw. Worth leaving a note on: it is the same class of
   * mistake as the bug under investigation — something that belongs to the
   * component's lifetime placed inside a subtree that comes and goes.
   */
  const attachSentinel = useCallback((el: HTMLDivElement | null) => {
    sentinelRef.current = el
    setSentinelEl(el)
  }, [])

  /*
   * The observer effect, with the dependency shape the real one has: the
   * things that decide WHETHER to fetch, and nothing about the element. In
   * `attach: 'state'` the element is a dependency, which is the fix.
   */
  useEffect(() => {
    const sentinel = attach === 'ref' ? sentinelRef.current : sentinelEl
    if (!sentinel) return
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      // An exhausted feed still OBSERVES — it simply has nothing to add. The
      // real component's `else if (baseFeedEntries.length > 0)` guard is the
      // same shape: reaching the end is not the same as being able to grow.
      setLoads(n => n + 1)
      if (exhausted) return
      setCount(c => c + PAGE)
    }, { rootMargin: '400px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach, ...(attach === 'state' ? [sentinelEl] : [])])

  return (
    <div style={{ width: 390, height: 640, display: 'flex', flexDirection: 'column' }}
         data-harness="feed-sentinel">
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #e5e7eb' }}>
        <button data-testid="go-explore" onClick={() => setMode('explore')}>Explore</button>
        <button data-testid="go-feed" onClick={() => setMode('feed')}>Feed</button>
        <span data-testid="loads" style={{ font: '12px monospace' }}>loads={loads}</span>
        <span data-testid="count" style={{ font: '12px monospace' }}>tiles={count}</span>
      </div>

      {mode === 'explore' ? (
        <div style={{ flex: 1, padding: 16 }} data-testid="explore">Explore</div>
      ) : (
        <div
          ref={setScroller}
          data-testid="feed-scroller"
          style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            scrollSnapType: 'y mandatory', background: '#f9fafb',
          }}
        >
          {Array.from({ length: count }, (_, i) => (
            <section
              key={i}
              data-feed-tile={i}
              style={{
                height: 560, scrollSnapAlign: 'start',
                borderBottom: '8px solid #e5e7eb', background: '#fff',
                padding: 16, boxSizing: 'border-box',
              }}
            >
              Tile {i}
            </section>
          ))}
          <div
            data-testid="sentinel"
            style={{ height: 1 }}
            ref={attachSentinel}
          />
        </div>
      )}
      <div hidden data-testid="scroller-attached">{scroller ? 'yes' : 'no'}</div>
    </div>
  )
}
