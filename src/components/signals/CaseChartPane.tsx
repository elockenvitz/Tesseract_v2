import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { range52wFrom } from '../../lib/signals/range-52w'
import { CaseSpread, type SpreadCase } from './CaseSpread'
import { CaseExplorer } from './CaseExplorer'

/**
 * Edit a ladder as a distribution, or numerically when there is nothing to
 * distribute.
 *
 * The choice lives here because it depends on the CASES rather than on the
 * call site: a ladder with two or more priced cases has a spread worth
 * drawing, and one without does not. Keeping that in the component means the
 * feed passes props and never reasons about which editor a name deserves.
 */

interface CaseChartPaneProps {
  symbol: string
  cases: SpreadCase[]
  currentPrice: number | null
  onSave: (caseId: string, price: number) => void
  /** Open the full case editor. See CaseSpread. */
  onEditCase: (caseId: string) => void
  saving?: boolean
  onAddCase?: () => void
}

export function CaseChartPane({
  symbol, cases, currentPrice, onSave, onEditCase, saving, onAddCase,
}: CaseChartPaneProps) {
  /**
   * The 52-week range, from the same per-symbol cache the cards use.
   *
   * Optional by construction: 135 of 912 assets have history, so most ladders
   * show the spread without it. That is a missing reality check, not a broken
   * card — and better than inventing a range from the cases themselves, which
   * would make the ladder its own evidence.
   */
  const { data: series } = useSymbolHistory(symbol)
  const range52w = range52wFrom(series)
  /**
   * The distribution needs no price history, which is the point.
   *
   * The chart version needed a cached series, and only 135 of 912 assets have
   * one — so the better control was unavailable on most names and the fallback
   * was the common path. A distribution is drawn from the cases themselves, so
   * every ladder gets it.
   *
   * The numeric editor survives for a ladder with nothing to distribute: one
   * case, or none with a price. A single bar on an axis is not a distribution,
   * and drawing one would imply a spread that does not exist.
   */
  /**
   * The spread needs two priced cases and a price to stand between them.
   *
   * Without a current price there is no downside, no upside and no ratio —
   * the entire argument the card makes is relative to where the name trades
   * today. With one case there is no spread to be asymmetric about.
   *
   * Neither is an edge case worth faking. The numeric editor is the honest
   * answer for a ladder that cannot yet say anything.
   */
  const priced = cases.filter(c => c.price != null && Number.isFinite(c.price))
  if (priced.length >= 2 && currentPrice != null && currentPrice > 0) {
    return (
      <CaseSpread
        cases={cases}
        currentPrice={currentPrice}
        onEditCase={onEditCase}
        range52w={range52w}
        saving={saving}
      />
    )
  }

  return (
    <CaseExplorer
      symbol={symbol}
      cases={cases.map(c => ({ id: c.id, name: c.name, price: c.price ?? 0 }))}
      currentPrice={currentPrice}
      onSave={onSave}
      saving={saving}
      onAddCase={onAddCase}
    />
  )
}
