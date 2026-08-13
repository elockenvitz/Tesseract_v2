import { useEffect, useRef, useState } from 'react'

interface WhenNearViewportProps {
  children: React.ReactNode
  /** Held while the content is still out of range — keeps the tile's height
   *  stable so nothing reflows when the real content arrives. */
  placeholder?: React.ReactNode
  /** How far outside the viewport counts as "near". One screen by default, so
   *  the next tile is ready before the user reaches it. */
  rootMargin?: string
  className?: string
}

/**
 * Render children only once they are near the viewport, and keep them after.
 *
 * The feed mounts every tile at once — it is one tall scroll-snap container,
 * not a windowed list — so a chart inside a tile twenty screens down starts
 * fetching price history immediately. With a chart on most tiles that is a
 * burst of concurrent requests at feed load, and the ones the user is actually
 * looking at queue behind the ones they are not. That is the slow first chart.
 *
 * Deliberately one-way: once shown, content stays mounted. Unmounting on exit
 * would re-fetch on every pass and make scrolling back up slower than scrolling
 * down, which is the opposite of what a feed should feel like.
 */
export function WhenNearViewport({
  children,
  placeholder = null,
  rootMargin = '100% 0px',
  className,
}: WhenNearViewportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return

    // No IntersectionObserver (old Safari, jsdom): show immediately rather than
    // never — degrading to the previous eager behaviour beats a blank tile.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown, rootMargin])

  return (
    <div ref={ref} className={className}>
      {shown ? children : placeholder}
    </div>
  )
}
