import { useMemo } from 'react'

import { useSymbolHistory } from './useSymbolHistory'
import {
  resolvePriceSnapshot, type PriceSnapshot, type SnapshotInput,
} from '../../lib/signals/price-snapshot'

/**
 * The card's single price, fetched once and shared by everything on it.
 *
 * ── Why a hook rather than a prop threaded from the feed ──────────────────
 *
 * Because the chart already fetches. `PricePane` calls `useSymbolHistory` for
 * its own symbol, and any second source of "the current price" is a second
 * number that can disagree with the one the reader is looking at — which is
 * exactly how the editor came to say $142.80 under a chart ending at $348.06.
 *
 * Calling the same hook with the same symbol is not a second request.
 * `useSymbolHistory` is a react-query hook keyed on the traded symbol, so the
 * chart pane and the review pane resolve to one cache entry, one fetch, and one
 * series. Consistency is then structural: there is no path by which the two can
 * hold different data, because they are reading the same object.
 *
 * ── On the holdings fallback ──────────────────────────────────────────────
 *
 * Passed in, not fetched. The book mark is already in hand wherever a lens
 * built the card, and this hook has no business reaching for holdings — its job
 * is to prefer the close and to make the fallback say what it is. See
 * `price-snapshot` for the rule.
 */
export function useCanonicalPrice(
  /** Already the TRADED ticker where it differs from the display symbol. */
  symbol: string | null | undefined,
  fallback?: Pick<SnapshotInput, 'holdingsMark' | 'holdingsAsOf'>,
): { snapshot: PriceSnapshot | null; isLoading: boolean } {
  const { data, isLoading } = useSymbolHistory(symbol)
  const mark = fallback?.holdingsMark ?? null
  const markAsOf = fallback?.holdingsAsOf ?? null

  const snapshot = useMemo(
    () => resolvePriceSnapshot({ closes: data ?? null, holdingsMark: mark, holdingsAsOf: markAsOf }),
    [data, mark, markAsOf],
  )

  return { snapshot, isLoading }
}
