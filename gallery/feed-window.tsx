import { useState } from 'react'

import { FeedSlot } from '../src/components/mobile/FeedSlot'

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

function FakeCard({ i }: { i: number }) {
  return (
    <section
      // The same shape a real tile has: one scroller height, border-box, with
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
            render={() => <FakeCard i={i} />}
          />
        ))}
      </div>
    </div>
  )
}
