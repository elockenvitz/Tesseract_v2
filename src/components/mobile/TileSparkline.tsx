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
}

export function TileSparkline({ symbol }: TileSparklineProps) {
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

  return <Sparkline points={data.map(p => p.close)} />
}
