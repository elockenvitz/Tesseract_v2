import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { sliceSince } from '../../lib/mobile/explore-spark'
import type { SparkForm } from '../../lib/mobile/explore-spark'
import { ExploreSpark, sparkWindowLabel } from '../signals/ExploreSpark'

/**
 * One tile's price path, fetched for that tile.
 *
 * ── Why this replaces the shared map ──────────────────────────────────────
 *
 * Explore was handed one `Map` filled by a batched query. That query pages at
 * 1,000 rows and lives behind a single React Query key, so nothing rendered
 * until every page landed — twenty tiles all waiting on the slowest request,
 * which is what "the sparklines take too long" describes. Cutting the payload
 * to sixty closes took it from seven requests to two, and two is still two
 * more than the reader should wait for before seeing anything.
 *
 * Per symbol, each tile resolves on its own and draws the moment its own data
 * arrives. The bigger win is the cache: this is the SAME key the Curate cards
 * use, so any name already read for a card is instant here, and switching
 * between the two modes stops re-fetching what it just had.
 *
 * ── Why the fetch waits for the viewport ──────────────────────────────────
 *
 * Explore mounts every tile — there is no windowing in the mosaic, deliberately,
 * because a discovery surface wants many things visible at once. That was
 * affordable while three cards in sixty asked for a line. Widening eligibility
 * (see `explore-spark`) makes it a request per charted tile on mount, on a
 * phone, over a mobile connection, all competing with the queries that fill the
 * feed itself.
 *
 * So the query is gated on an `IntersectionObserver` with a generous root
 * margin: a tile fetches when it is within roughly one screen of view, and the
 * reader has never seen a chart appear late because the margin is wider than a
 * thumb-flick. Once seen, it stays enabled — React Query caches the result and
 * re-arming would refetch on every scroll reversal.
 */

interface TileSparklineProps {
  /** Already uppercased and resolved by the caller. */
  symbol: string | null | undefined
  /** A featured tile is wider, so its line gets more room to say something. */
  feature?: boolean
  /** Where the line sits. See `SparkForm`. */
  form?: Exclude<SparkForm, 'none'>
  /** ISO date the window opens at, where the card's finding names one. */
  since?: string | null
  /** What that moment means: `Last look`, `Idea`, `Published`. */
  sinceLabel?: string | null
  /**
   * What to draw when the cache has no series for this name.
   *
   * ── Why this exists ─────────────────────────────────────────────────────
   *
   * A minority of the asset universe has cached closes, and only this
   * component can know whether a given name is in that minority. Without a
   * fallback, letting a real price path REPLACE a schematic archetype — which
   * is the right call for a stale-research card, where the actual move since
   * the review says more than a marker and a number — would mean trading a
   * picture that always renders for one that usually does not.
   *
   * With it, the card asks for the better picture and keeps the honest one
   * when the better picture is unavailable. Absent for cards that simply have
   * no line, which correctly render nothing.
   */
  fallback?: ReactNode
}

export function TileSparkline({
  symbol, feature, form = 'primary', since = null, sinceLabel = null, fallback,
}: TileSparklineProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (near) return
    const el = hostRef.current
    if (!el) return
    // jsdom has no IntersectionObserver and the phone suite runs in a real
    // browser, so the absence of one means a test environment: fetch rather
    // than never rendering.
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setNear(true) },
      // One screen of lead time. Wider than a flick, so the line is there
      // before the tile is.
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  const { data } = useSymbolHistory(symbol, { enabled: near })

  /**
   * Nothing while loading, and nothing when there is no history.
   *
   * Deliberately not a skeleton. A tile is a preview whose content stands on
   * its own — a minority of the asset universe has any cached history at all,
   * so an empty chart slot is the common case rather than an exception, and
   * animating a placeholder for it would put a shimmer on most of the page.
   * The line appears when there is a line.
   *
   * The anchor span always renders, because something has to be observed
   * before the query is allowed to run. It is zero-height and carries no box.
   */
  const points = data ? sliceSince(data, since) : null
  if (!points || points.length < 2) {
    return (
      <span ref={hostRef} data-explore-spark-anchor-el className="block">
        {fallback ?? null}
      </span>
    )
  }

  return (
    <span ref={hostRef} className="block">
      <ExploreSpark
        points={points.map(p => p.close)}
        window={sparkWindowLabel(points[0].date, points[points.length - 1].date)}
        feature={feature}
        form={form}
        sinceLabel={sinceLabel}
      />
    </span>
  )
}
