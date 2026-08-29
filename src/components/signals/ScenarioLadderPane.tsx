import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { range52wFrom } from '../../lib/signals/range-52w'
import { ScenarioLadder } from './ScenarioLadder'
import type { ScenarioCase } from '../../lib/signals/builders/scenarioGap'

/**
 * `ScenarioLadder` with its 52-week range fetched.
 *
 * The same split `LadderPane` and `CaseChartPane` already use: the chart is
 * pure and takes a range, and this shell is the one thing that touches the
 * price cache. That is what keeps the ladder renderable in the gallery, which
 * has no Supabase environment at all — and the gallery is where this card gets
 * measured at 390×844.
 *
 * ── Where the 52-week range comes from, exactly ───────────────────────────
 *
 * `useSymbolHistory` reads `price_history_cache` for ONE symbol: daily closes,
 * newest first, capped at 260 rows — about a trading year — then reversed for
 * the chart. It resolves renamed tickers through `useTickerAliases` first, so a
 * name that trades under a new symbol still finds its series.
 *
 * `range52wFrom` then takes the min and max of the closes inside a trailing
 * **365 calendar days**, and returns null below two points in that window.
 *
 * Two honest caveats, both of which the label has to survive:
 *
 *   - These are CLOSES. A true 52-week high is an intraday print, and this is
 *     the highest close. It is the same figure `CaseSpread` and
 *     `CaseLadderBuilder` already show as "52w", so the product is at least
 *     consistent with itself, and the difference is immaterial at the scale
 *     this axis draws.
 *   - The window is a real 365 days, not a shorter one relabelled. A symbol
 *     whose cache starts eight months ago yields the range of what exists
 *     inside the window, which is the honest reading of "the last year" for a
 *     series that is only eight months old.
 *
 * No new provider call and no new query. `PricePane` on the same card calls
 * `useSymbolHistory` with the same key, so the ladder and the tape share one
 * react-query cache entry by construction rather than by anyone remembering to
 * keep them in step.
 */

interface ScenarioLadderPaneProps {
  /** The card's ticker. Alias resolution happens inside the hook. */
  symbol: string
  price: number
  cases: ScenarioCase[]
  expected: number | null
}

export function ScenarioLadderPane({ symbol, price, cases, expected }: ScenarioLadderPaneProps) {
  const { data: series } = useSymbolHistory(symbol)
  return (
    <ScenarioLadder
      price={price}
      cases={cases}
      expected={expected}
      // Null while the series loads and null forever for a name with nothing
      // cached. The ladder simply draws without the context in both cases —
      // there is no skeleton, because a placeholder for a mark that may never
      // arrive is worse than the mark being absent.
      range52w={range52wFrom(series)}
    />
  )
}
