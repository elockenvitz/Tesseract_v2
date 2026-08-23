import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { range52wFrom } from '../../lib/signals/range-52w'
import { CaseLadderBuilder, type LadderRow } from './CaseLadderBuilder'

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
  onSaveLadder: (rows: LadderRow[], horizon: string) => void
  onOpenDetails?: (name: string, price: number | null) => void
  saving?: boolean
}

export function LadderPane({
  symbol, currentPrice, onSaveLadder, onOpenDetails, saving,
}: LadderPaneProps) {
  const { data: series } = useSymbolHistory(symbol)
  return (
    <CaseLadderBuilder
      /**
       * Remounted when the range arrives.
       *
       * The seed is initial state, and the history resolves after the first
       * paint — so without this the builder would render three empty rows and
       * then never fill them, which is the failure that looks exactly like "the
       * seeding does not work".
       *
       * Safe because the rows are drafts and nothing has been typed yet: the
       * key changes once, from no-range to range, before there is any input to
       * lose.
       */
      key={series && series.length > 1 ? 'seeded' : 'bare'}
      symbol={symbol}
      currentPrice={currentPrice}
      range52w={range52wFrom(series)}
      onSaveLadder={onSaveLadder}
      onOpenDetails={onOpenDetails}
      saving={saving}
    />
  )
}
