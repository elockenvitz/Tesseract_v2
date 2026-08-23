import { useState } from 'react'

import { MobileExplore } from '../src/components/mobile/MobileExplore'
import { Sparkline } from '../src/components/signals/Sparkline'
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
            return pts && pts.length > 1
              ? (
                <div className={feature ? 'h-16 pt-2' : 'h-12 pt-2'}>
                  <Sparkline points={pts.map(p => p.close)} />
                </div>
              )
              : null
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
