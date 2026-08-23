import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { range52wFrom } from '../../lib/signals/range-52w'
import { CaseLadderBuilder } from './CaseLadderBuilder'

/**
 * `CaseLadderBuilder` with its 52-week range fetched.
 *
 * The same split as `CaseChartPane`: the control is pure and takes a range, and
 * this shell is the one thing that touches the price cache. That is what keeps
 * the builder renderable in the gallery, which has no Supabase environment at
 * all — and the gallery is where a card of this size gets measured.
 */

interface LadderPaneProps {
  symbol: string
  currentPrice: number | null
  onOpenDetails: (name: string, price: number | null, horizon: string) => void
}

export function LadderPane({ symbol, currentPrice, onOpenDetails }: LadderPaneProps) {
  const { data: series } = useSymbolHistory(symbol)
  return (
    <CaseLadderBuilder
      /* No remount key any more: the suggested prices are derived on every
         render rather than held as initial state, so the range simply appears
         when the history resolves. The key existed to work around exactly that
         staleness, and there is now no draft it could have discarded. */
      currentPrice={currentPrice}
      range52w={range52wFrom(series)}
      onOpenDetails={onOpenDetails}
    />
  )
}
