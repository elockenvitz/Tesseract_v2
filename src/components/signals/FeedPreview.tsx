import { useState } from 'react'
import { ScenarioLadder } from './ScenarioLadder'
import { FeedPriceChart } from './FeedPriceChart'
import { WeightBars } from './WeightBars'
import { VisualPager } from '../desktop/VisualPager'
import type { FeedPreview as Descriptor, FeedPreviewPane } from '../../lib/signals/feed-preview'

/**
 * One switch, from a semantic descriptor to a shared primitive.
 *
 * The alternative is family-specific JSX spread through the feed component,
 * which is how a tile system becomes nine special cases. `previewFor` decides
 * WHAT object a candidate supports; this decides only how to draw it, and
 * every branch resolves to a primitive that already exists.
 *
 * Adding a family means teaching `previewFor` about its data, not editing the
 * feed.
 */
export function FeedPreview({ preview }: { preview: Descriptor }) {
  if (preview.kind === 'price') {
    /*
     * The desktop regime, not `ExploreSpark`. That one is `Sparkline` in a
     * 48px frame — correct on a phone tile and a flattened strip across a
     * 30-to-40rem column. See `FeedPriceChart` for why this is a second
     * regime rather than a change to the shared passive chart.
     */
    return (
      <FeedPriceChart
        series={preview.series}
        reference={preview.reference}
        referenceLabel="Target"
      />
    )
  }

  if (preview.kind === 'scenario_ladder') {
    /*
     * The ladder needs a DEFINITE height, and this is where it gets one.
     *
     * Its root is `h-full` and its axis is `flex-1` over absolutely positioned
     * marks, which is correct inside the card's pane band — that band is a
     * share of a phone screen and always has a resolved height. Here the host
     * is content-sized, so `h-full` resolved to auto, the axis' `basis: 0`
     * resolved to 0, and every mark on it was out of flow: the header rendered
     * and the ladder itself was a zero-height box. Measured at 0px.
     *
     * A box, not a redesign — the ladder is untouched. 16rem is its own
     * geometry added up: a 210px axis at its ceiling, the legend above it and
     * the padding around both.
     */
    return (
      <div className="h-64">
        <ScenarioLadder
          price={preview.price as never}
          cases={preview.cases as never}
          expected={preview.expected as never}
          statedOn={preview.statedOn as never}
        />
      </div>
    )
  }

  /*
   * `WeightBars` is already interactive in the way a preview should be:
   * pressing a row reads out its distance from the baseline. That is
   * inspection, reversible and local — no editing, which stays in the
   * workspace.
   */
  return (
    <WeightBars
      rows={preview.rows}
      baselineIndex={preview.baselineIndex}
      unitNote={preview.unitNote}
    />
  )
}

/**
 * The feed card's objects, as one carousel.
 *
 * ── Why the feed had no pager and the gallery did ────────────────────────
 *
 * `VisualPager` is a shared component with a header explaining that two
 * surfaces should page with one gesture, and until now only one of them
 * paged: the Explore tile built a list of panels and cycled them, while the
 * feed card drew whatever single object `previewFor` returned and offered no
 * way to anything else. A reader meeting the two surfaces back to back got
 * one vocabulary on a tile and none on a card.
 *
 * ── Why the state lives HERE ─────────────────────────────────────────────
 *
 * Which pane a card is on is that card's business and nobody else's. Held in
 * the feed it would be a map keyed by entry, mutated from inside a `map`
 * callback, and every keystroke would re-render every card in the column --
 * the exact shape that made the Explore gallery drop frames on selection.
 * A component per card means a paging card re-renders itself and nothing
 * else.
 *
 * ── Why the box is fixed and the pane is not ─────────────────────────────
 *
 * The panes are different heights: the ladder is 16rem by its own geometry
 * and the price chart is shorter. Letting the box follow the pane means
 * paging a card resizes it and shoves every card below it down the column --
 * a read that relayouts the page under the cursor. The gallery tile solved
 * this the same way and its note is worth repeating: the cost is some empty
 * room under the shorter pane, which is the right way round.
 */
export function FeedPreviewCarousel({ panes }: { panes: FeedPreviewPane[] }) {
  const [index, setIndex] = useState(0)
  if (panes.length === 0) return null

  const active = Math.min(index, panes.length - 1)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* `h-64` is the ladder's own height, which is the taller of the two.
          See the header: the box does not follow the pane. */}
      <div className="min-w-0" style={{ minHeight: panes.length > 1 ? '16rem' : undefined }}>
        <FeedPreview preview={panes[active].preview} />
      </div>
      {/* Draws nothing below two panes, by its own contract. */}
      <VisualPager
        labels={panes.map(p => p.label)}
        keys={panes.map(p => p.id)}
        index={active}
        onChange={setIndex}
        describe={i => `Show the ${panes[i].label.toLowerCase()}`}
        className="justify-center"
      />
    </div>
  )
}
