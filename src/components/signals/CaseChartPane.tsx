import { CaseDistributionEditor, type DistributionCase } from './CaseDistributionEditor'
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
  cases: DistributionCase[]
  currentPrice: number | null
  onSave: (caseId: string, price: number) => void
  saving?: boolean
  onAddCase?: () => void
}

export function CaseChartPane({
  symbol, cases, currentPrice, onSave, saving, onAddCase,
}: CaseChartPaneProps) {
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
  const priced = cases.filter(c => c.price != null && Number.isFinite(c.price))
  if (priced.length >= 2) {
    return (
      <CaseDistributionEditor
        cases={cases}
        currentPrice={currentPrice}
        onSave={onSave}
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
