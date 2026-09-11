import { ScenarioLadder } from './ScenarioLadder'
import { FeedPriceChart } from './FeedPriceChart'
import { WeightBars } from './WeightBars'
import type { FeedPreview as Descriptor } from '../../lib/signals/feed-preview'

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
    return (
      <ScenarioLadder
        price={preview.price as never}
        cases={preview.cases as never}
        expected={preview.expected as never}
        statedOn={preview.statedOn as never}
      />
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
