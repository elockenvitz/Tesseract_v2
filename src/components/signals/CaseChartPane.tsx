import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { canChart, priceIdentity } from '../../lib/signals/price-availability'
import { CaseChartEditor, type EditableCase } from './CaseChartEditor'
import { CaseExplorer } from './CaseExplorer'

/**
 * Edit a ladder: on the tape where there is one, numerically where there is not.
 *
 * ── Why the choice lives here ─────────────────────────────────────────────
 *
 * Both editors need the same inputs and differ only in whether a price series
 * exists — and that answer is asynchronous, so the call site cannot make it
 * without becoming a hook host and a ternary wrapped around two large JSX
 * blocks. One component, one decision, and the feed passes props.
 *
 * ── Why the numeric editor survives ───────────────────────────────────────
 *
 * Dragging a case line across the price history is the better control by a
 * wide margin — it sets the number and shows what to judge it against in the
 * same gesture. But 135 of 912 assets have any cached history, so "no tape to
 * drag against" is the common case rather than an edge, and a drag gesture
 * over an empty box would be worse than the slider it replaced.
 *
 * The fallback is not a lesser version of the same idea; it is the honest one
 * for a name we cannot chart.
 */

interface CaseChartPaneProps {
  symbol: string
  cases: EditableCase[]
  currentPrice: number | null
  onSave: (caseId: string, price: number) => void
  saving?: boolean
  onAddCase?: () => void
}

export function CaseChartPane({
  symbol, cases, currentPrice, onSave, saving, onAddCase,
}: CaseChartPaneProps) {
  const { data } = useSymbolHistory(symbol)
  const id = priceIdentity(symbol, () => data)

  if (canChart(id)) {
    return (
      <CaseChartEditor
        symbol={id.symbol}
        series={id.series}
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
