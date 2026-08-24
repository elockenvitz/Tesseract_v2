import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { Sparkline } from '../signals/Sparkline'

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
 * The cost is more requests in flight on a mosaic than on a windowed feed —
 * Explore mounts every tile. They are 260-row reads with an hour of
 * `staleTime`, deduplicated by React Query across tiles about the same name,
 * and none of them blocks anything else. That trade is the right way round:
 * twenty small independent reads that paint progressively beat two large ones
 * that paint together and late.
 */

interface TileSparklineProps {
  /** Already uppercased and resolved by the caller. */
  symbol: string | null | undefined
  /** A featured tile is wider, so its line gets more room to say something. */
  feature?: boolean
}

export function TileSparkline({ symbol, feature }: TileSparklineProps) {
  const { data } = useSymbolHistory(symbol)

  /**
   * Nothing while loading, and nothing when there is no history.
   *
   * Deliberately not a skeleton. A tile is a preview whose content stands on
   * its own — 135 of 912 assets have any history at all, so an empty chart
   * slot is the common case rather than an exception, and animating a
   * placeholder for it would put a shimmer on most of the page. The line
   * appears when there is a line.
   */
  if (!data || data.length < 2) return null

  /**
   * How long a window the line covers, said on the tile.
   *
   * ── Why an unlabelled line is worse than no line ──────────────────────────
   *
   * `Sparkline` colours itself from the first close to the last, so a name that
   * fell today and rose over the year draws GREEN under a metric reading
   * "-6.2% TODAY" in red. Both are true and the tile said neither period, so
   * the two read as a contradiction the reader has to resolve — and the usual
   * resolution is to distrust the number, which is the one thing on the tile
   * that was unambiguous.
   *
   * Naming the window costs no height: the box was already fixed, and the
   * caption comes out of the chart rather than out of the tile.
   */
  const first = new Date(data[0].date).getTime()
  const last = new Date(data[data.length - 1].date).getTime()
  const months = Math.max(1, Math.round((last - first) / (30 * 86_400_000)))
  const window = months >= 12 ? `${Math.round(months / 12)}Y` : `${months}M`

  /**
   * The height lives here, not in the tile.
   *
   * The tile reserved a fixed box whenever an item had a SYMBOL — but a symbol
   * is not history, and this draws nothing without it. So a name with no cached
   * closes reserved 48px and filled it with nothing: an empty band in the
   * middle of the tile, indistinguishable from a bug and reported as one.
   *
   * Nothing above this line can know whether there is a line to draw. Owning
   * the space is the only arrangement where "no history" costs no height.
   *
   * Taller than 28px, which flattened a month of movement until every name
   * looked like the same gentle slope.
   */
  return (
    <div className={feature ? 'h-16 pt-2' : 'h-12 pt-2'}>
      {/* The caption takes its 12px FROM the chart rather than adding to the
          tile, so labelling the window changes no tile's height. */}
      <div className="h-[calc(100%-12px)]">
        <Sparkline points={data.map(p => p.close)} />
      </div>
      <p data-explore-spark-window className="h-3 text-[9px] font-semibold uppercase tracking-wide leading-3 text-gray-400">
        {window}
      </p>
    </div>
  )
}
