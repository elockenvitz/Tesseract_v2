import { useState } from 'react'

import { MobileExplore } from '../src/components/mobile/MobileExplore'
import { ExploreSpark, sparkWindowLabel } from '../src/components/signals/ExploreSpark'
import { aggregatesFor } from '../src/lib/mobile/explore-adapters'
import { EXPLORE_FIXTURE, NOW } from '../src/lib/mobile/__tests__/explore-fixture'
import type { FeedCategory } from '../src/lib/mobile/feed-categories'

/**
 * Explore, at phone width, composed from the same fixture the unit tests use.
 *
 * Sharing the fixture is the point: a gallery that renders its own tidy data
 * would agree with itself forever while the tests exercised something else.
 * This one is deliberately lopsided — four AAPL items, six decisions against
 * two workflow rows, one artifact arriving through two adapters — because a
 * balanced fixture passes every diversity assertion without the code doing
 * anything.
 *
 * Imports only pure modules, so it mounts in the gallery entry, which has no
 * Supabase environment.
 */

/** A synthetic month of closes, so sparkline rendering is exercised. */
function fakeSeries(seed: number): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = []
  let v = 100
  for (let i = 0; i < 30; i++) {
    // Deterministic: no Math.random, so the page is identical on every load and
    // in every screenshot.
    v += Math.sin((i + seed) * 0.7) * 2.4 + (seed % 3) - 1
    out.push({ date: new Date(NOW - (30 - i) * 86_400_000).toISOString().slice(0, 10), close: Math.max(v, 5) })
  }
  return out
}

const SERIES = new Map<string, { date: string; close: number }[]>([
  ['NVDA', fakeSeries(1)],
  ['CEG', fakeSeries(2)],
  ['AAPL', fakeSeries(3)],
  ['MSFT', fakeSeries(4)],
  ['CLOV', fakeSeries(5)],
  ['AMZN', fakeSeries(6)],
  ['JNJ', fakeSeries(7)],
  // TGT has a series so the ABSENCE of a chart on its card is a layout
  // decision rather than missing data — §11: an idea's content is its
  // argument, and a year of closes under it implies the price explains it.
  ['TGT', fakeSeries(8)],
  // The one card that still earns a sparkline — see `d-tsla-move`. Without a
  // series behind it the harness cannot tell "the chart is correctly gone from
  // the cards that never needed one" from "the chart is broken".
  ['TSLA', fakeSeries(9)],
  // ROKU and TSM deliberately absent, so the no-sparkline path renders too.
])

const CANDIDATES = [...EXPLORE_FIXTURE, ...aggregatesFor(EXPLORE_FIXTURE, NOW)]

export function ExploreGallery() {
  const [category, setCategory] = useState<FeedCategory | null>(null)

  return (
    <div className="mx-auto mt-6 max-w-[390px]">
      <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
        Explore · 390×844
      </p>
      {/* A real phone viewport with a real bounded height, so the mosaic's own
          scroller is the one under test rather than the page's. */}
      <div
        id="explore-viewport"
        className="h-[844px] overflow-hidden border-y-8 border-gray-200 bg-white dark:bg-gray-900"
      >
        <MobileExplore
          candidates={CANDIDATES}
          /**
           * A static sparkline from the fixture.
           *
           * The app injects one backed by `useSymbolHistory`, which reaches
           * Supabase — and the gallery has none, so importing that component
           * here would take the whole page down at module load. Injection is
           * what keeps the harness pure while still exercising the real tile
           * layout, including the names with no series at all.
           */
          renderSparkline={(sym, { feature }) => {
            const pts = SERIES.get(sym.toUpperCase())
            // Height included, exactly as `TileSparkline` does it — the box
            // belongs to the thing that knows whether there is a line, or a
            // name with no series reserves space and fills it with nothing.
            if (!pts || pts.length < 2) return null
            /**
             * The frame the app ships, not a simpler one.
             *
             * The injection exists so the harness stays pure, not so it can
             * render something else. This page is where card geometry is
             * reviewed and where the phone suite measures it, so it renders
             * `ExploreSpark` — the same component `TileSparkline` renders —
             * and the two cannot drift apart the way the hand-copied version
             * of this markup could.
             */
            return (
              <ExploreSpark
                points={pts.map(p => p.close)}
                window={sparkWindowLabel(pts[0].date, pts[pts.length - 1].date)}
                feature={feature}
              />
            )
          }}
          category={category}
          onCategoryChange={setCategory}
          onOpen={item => {
            // The gallery has no router. Recording the destination on the DOM
            // lets a test assert where a tap WOULD go without one.
            document.body.setAttribute('data-explore-opened', item.id)
            document.body.setAttribute(
              'data-explore-destination',
              item.destination.kind === 'action' ? item.destination.action : item.destination.kind,
            )
          }}
          now={NOW}
        />
      </div>
    </div>
  )
}
