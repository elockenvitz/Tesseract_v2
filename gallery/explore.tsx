import { useRef, useState } from 'react'

import { MobileExplore } from '../src/components/mobile/MobileExplore'
import { ExploreExpansion, measureTile, type ExpansionOrigin } from '../src/components/mobile/ExploreExpansion'
import { ExploreSpark, sparkWindowLabel } from '../src/components/signals/ExploreSpark'
import { aggregatesFor } from '../src/lib/mobile/explore-adapters'
import { resolveExploreItem } from '../src/lib/mobile/explore-resolve'
import { exploreSparkPlan, sliceWindow } from '../src/lib/mobile/explore-spark'
import { EXPLORE_FIXTURE, NOW } from '../src/lib/mobile/__tests__/explore-fixture'
import type { FeedCategory } from '../src/lib/mobile/feed-categories'
import type { ExploreItem } from '../src/lib/mobile/explore-item'
import { ExploreDetail } from '../src/components/mobile/ExploreDetail'

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
  /**
   * A deterministic walk that looks like a price, not like a waveform.
   *
   * The previous generator was `sin(i * 0.7)`, which at 400 points is a
   * high-frequency sawtooth — it read as a rendering fault rather than as a
   * chart, and any window sliced out of it looked identical to any other. A
   * price path needs a dominant slow trend, a medium swing and only a little
   * daily noise, which is the three terms below.
   *
   * Still no `Math.random`: the seed drives everything, so the page is
   * identical on every load, in every screenshot and in the phone suite.
   */
  let v = 100
  for (let i = 0; i < 400; i++) {
    /**
     * Amplitudes kept small enough that a sliced window lands in a believable
     * band. At 0.35%/day compounding, a ten-month slice reached -54% while the
     * card it sits under said "+18% since last look" — the harness showing a
     * self-contradiction the reader would rightly read as a bug. A fixture that
     * disagrees with itself teaches nothing about the design.
     */
    const trend = Math.sin((i / 400) * Math.PI * (1 + (seed % 3) * 0.5) + seed) * 0.09
    const swing = Math.sin(i / 34 + seed * 1.7) * 0.07
    // A tiny deterministic jitter so the line has texture without spikes.
    const jitter = (((i * 9301 + seed * 49297) % 233280) / 233280 - 0.5) * 0.10
    v = Math.max(v * (1 + (trend + swing + jitter) / 100), 5)
    out.push({ date: new Date(NOW - (400 - i) * 86_400_000).toISOString().slice(0, 10), close: v })
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
  // The news-reaction case. Present so the INLINE form renders somewhere.
  ['CLOV', fakeSeries(10)],
  // ROKU and TSM deliberately absent, so the no-sparkline path renders too.
])

const CANDIDATES = [...EXPLORE_FIXTURE, ...aggregatesFor(EXPLORE_FIXTURE, NOW)]

export function ExploreGallery() {
  const [category, setCategory] = useState<FeedCategory | null>(null)
  /**
   * The sheet, exercised here rather than only in the app.
   *
   * `ExploreExpansion` is the transition, and the gallery is where this
   * project reviews and measures card geometry. A shared-element animation
   * reviewed only inside a Supabase-backed dashboard is a shared-element
   * animation nobody can look at.
   */
  const [expanded, setExpanded] = useState<{ item: ExploreItem; origin: ExpansionOrigin | null } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  return (
    <div className="mx-auto mt-6 max-w-[390px]">
      <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
        Explore · 390×844
      </p>
      {/* A real phone viewport with a real bounded height, so the mosaic's own
          scroller is the one under test rather than the page's. */}
      <div
        ref={viewportRef}
        id="explore-viewport"
        className="relative h-[844px] overflow-hidden border-y-8 border-gray-200 bg-white dark:bg-gray-900"
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
          renderSparkline={(sym, { feature, form, since, sinceLabel, fallback }) => {
            const all = SERIES.get(sym.toUpperCase())
            // The same window rule the app applies, so the harness shows the
            // sliced series rather than a tidier full one.
            const cut = all ? sliceWindow(all, since) : undefined
            const pts = cut?.points
            // Height included, exactly as `TileSparkline` does it — the box
            // belongs to the thing that knows whether there is a line, or a
            // name with no series reserves space and fills it with nothing.
            if (!pts || pts.length < 2) return fallback ?? null
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
            // The same delta the app computes in `TileSparkline`, from the
            // same sliced points — the harness must not show a tidier chart
            // than the one that ships.
            const first = pts[0].close
            const lastC = pts[pts.length - 1].close
            const changePct = first > 0 ? ((lastC - first) / first) * 100 : null
            return (
              <ExploreSpark
                points={pts.map(p => p.close)}
                window={sparkWindowLabel(pts[0].date, pts[pts.length - 1].date)}
                feature={feature}
                form={form}
                sinceLabel={cut?.anchored ? sinceLabel : null}
                changePct={cut?.anchored ? changePct : null}
              />
            )
          }}
          category={category}
          onCategoryChange={setCategory}
          expandedId={expanded?.item.id ?? null}
          onOpen={(item, el) => {
            setExpanded({ item, origin: measureTile(el) })
            // The gallery has no router. Recording the destination on the DOM
            // lets a test assert where a tap WOULD go without one.
            document.body.setAttribute('data-explore-opened', item.id)
            document.body.setAttribute(
              'data-explore-destination',
              item.destination.kind === 'action' ? item.destination.action : item.destination.kind,
            )
            /**
             * And what the resolver decided, which is the thing that was
             * broken. A tile's DESTINATION was never the problem — every one of
             * them had one. What the destination RESOLVED to is where taps went
             * to die, so that is what a test needs to be able to see.
             */
            document.body.setAttribute('data-explore-action', resolveExploreItem(item).do)
          }}
          now={NOW}
        />

        {/* The sheet, over the mosaic, exactly as the app renders it. The
            content here is deliberately the PREVIEW's own facts plus the
            expanded-only material — the app substitutes the full Curate card
            where the feed is carrying one. */}
        {expanded && (
          <ExploreExpansion
            origin={expanded.origin}
            label={expanded.item.title}
            measureOrigin={() => measureTile(
              viewportRef.current?.querySelector(`[data-explore-tile="${expanded.item.id}"]`) ?? null,
            )}
            onClose={() => setExpanded(null)}
          >
            <ExploreDetail
              item={expanded.item}
              now={NOW}
              chart={(() => {
                const plan = exploreSparkPlan(expanded.item, NOW)
                const all = expanded.item.symbol ? SERIES.get(expanded.item.symbol.toUpperCase()) : undefined
                const cut = all ? sliceWindow(all, plan.since) : undefined
                const pts = cut?.points
                if (plan.form === 'none' || !pts || pts.length < 2) return undefined
                const first = pts[0].close
                const lastC = pts[pts.length - 1].close
                return (
                  <ExploreSpark
                    points={pts.map(p => p.close)}
                    window={sparkWindowLabel(pts[0].date, pts[pts.length - 1].date)}
                    form="detail"
                    sinceLabel={cut?.anchored ? plan.sinceLabel : null}
                    changePct={cut?.anchored && first > 0 ? ((lastC - first) / first) * 100 : null}
                  />
                )
              })()}
            />
          </ExploreExpansion>
        )}
      </div>
    </div>
  )
}
