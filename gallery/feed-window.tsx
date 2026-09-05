import { useState } from 'react'

import { FeedSlot } from '../src/components/mobile/FeedSlot'
import type { TileRequirement } from '../src/lib/signals/tile-geometry'
import { rowsVisual, plotVisual } from '../src/lib/signals/tile-geometry'

/**
 * The feed's windowing, in a scroller a browser can actually measure.
 *
 * The dashboard itself cannot be a subject for this: it needs Supabase, live
 * holdings and a signed-in org, none of which exist here and none of which
 * would be stable enough to assert a scroll offset against. What the windowing
 * claims, though, is purely geometric — a collapsed slot occupies exactly the
 * box its card would have — and that claim can be measured on fake content as
 * honestly as on real content.
 *
 * The tiles are deliberately expensive-looking in structure and trivial in
 * content: what is being measured is how MANY are mounted, not what is in them.
 */

const COUNT = 60

/** The fixture's own box, so slot geometry is deterministic here. */
const CONTAINER = { width: 390, height: 600 }

/**
 * Mixed SHAPES, because a uniform fixture cannot fail the thing being tested.
 *
 * Every tile used to be one scroller height, so "a collapsed slot occupies the
 * box its card would have" held for a trivial reason — every box was the same.
 * With geometry resolved from content it is a real claim, and this is the only
 * place it can be measured. Cycling three shapes means every assertion runs
 * against neighbours of unequal height.
 */
const SHAPES: TileRequirement[] = [
  // Sparse text: a claim, some context, a tray.
  { claimChars: 30, contextRows: 1, bodyLines: 2, hasActionTray: true },
  // A row visual, which takes its rows and no more.
  { claimChars: 44, hasMetric: true, contextRows: 1, visual: rowsVisual(5), hasActionTray: true },
  // A plot, which can use room the container can afford.
  { claimChars: 46, hasMetric: true, contextRows: 1, bodyLines: 2,
    visual: plotVisual(), hasActionTray: true },
]
const shapeFor = (i: number): TileRequirement => SHAPES[i % SHAPES.length]

function FakeCard({ i }: { i: number }) {
  return (
    <section
      // The same shape a real tile has: it FILLS whatever slot it is given,
      // border-box, with
      // the 8px separator inside that height. If this drifts from
      // SignalCardSection the measurements below stop meaning anything.
      className="relative h-full w-full snap-start snap-always overflow-hidden border-b-8 border-gray-200 bg-white"
      data-fake-card={i}
    >
      <div className="p-4 text-sm text-gray-900">Card {i}</div>
    </section>
  )
}

export function FeedWindowGallery() {
  const [scroller, setScroller] = useState<HTMLElement | null>(null)

  return (
    <div className="mx-auto flex h-[600px] w-full max-w-md flex-col border border-gray-300">
      <div
        id="window-viewport"
        ref={setScroller}
        data-slot-count={COUNT}
        className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory overscroll-contain"
      >
        {Array.from({ length: COUNT }, (_, i) => (
          <FeedSlot
            key={i}
            root={scroller}
            initiallyNear={i < 2}
            requirement={shapeFor(i)}
            container={CONTAINER}
            render={() => <FakeCard i={i} />}
          />
        ))}
      </div>
    </div>
  )
}
