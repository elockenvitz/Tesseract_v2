import { useMemo } from 'react'
import type { SimulationMetrics, BaselineHolding } from '../../types/trading'
import type { SimulationRow } from '../../hooks/useSimulationRows'
import type { TradeAttribution } from './SectorExposureChart'
import { ImpactHeadlineBand } from './ImpactHeadlineBand'
import { SectorExposureChart } from './SectorExposureChart'
import { PortfolioCharacteristics } from './PortfolioCharacteristics'
import { PortfolioFundamentalsCard } from './PortfolioFundamentalsCard'
import { PortfolioRiskCard } from './PortfolioRiskCard'
import { HoldingsComparison } from './HoldingsComparison'

interface PortfolioImpactViewProps {
  metrics: SimulationMetrics
  baseline: BaselineHolding[]
  simulationRows: SimulationRow[]
  benchmarkWeightMap: Record<string, number>
  hasBenchmark: boolean
}

export function PortfolioImpactView({
  metrics,
  baseline,
  simulationRows,
  benchmarkWeightMap,
  hasBenchmark,
}: PortfolioImpactViewProps) {
  // Derive trade attribution from simulation rows for sector chart
  const tradeAttribution = useMemo<TradeAttribution[]>(() =>
    simulationRows
      .filter(r => r.variant?.sizing_input && Math.abs(r.deltaWeight) >= 0.005)
      .map(r => ({
        sector: r.sector || 'Other',
        symbol: r.symbol,
        deltaWeight: r.deltaWeight,
      })),
    [simulationRows],
  )

  /*
   * Phones get this view unchanged from the desktop — there is no mobile
   * variant — so every card arrives at 390px still carrying the 20px padding
   * and 20px gutters it was drawn with for a two-column 1400px layout. Six
   * stacked cards then spend roughly a fifth of their height on air.
   *
   * The `md:` prefix is deliberate rather than `sm:`: it is the same 768px
   * boundary `useIsMobile()` uses, so nothing above phone width changes.
   */
  return (
    <div className="space-y-3 md:space-y-5">
      {/* Layer 1: Headline + KPI pills */}
      <ImpactHeadlineBand metrics={metrics} simulationRows={simulationRows} />

      {/* Row 1: Sector exposure + characteristics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 md:p-4">
          <SectorExposureChart
            before={metrics.sector_exposure_before}
            after={metrics.sector_exposure_after}
            tradeAttribution={tradeAttribution}
          />
        </div>
        <PortfolioCharacteristics metrics={metrics} simulationRows={simulationRows} />
      </div>

      {/* Row 2: Portfolio fundamentals + Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <PortfolioFundamentalsCard holdingsAfterCount={metrics.position_count_after} />
        <PortfolioRiskCard
          simulationRows={simulationRows}
          benchmarkWeightMap={benchmarkWeightMap}
          hasBenchmark={hasBenchmark}
        />
      </div>

      {/* Row 3: Holdings comparison */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <HoldingsComparison
          holdings={metrics.holdings_after}
          baseline={baseline}
        />
      </div>
    </div>
  )
}
