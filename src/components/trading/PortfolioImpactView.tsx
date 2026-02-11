import { useMemo } from 'react'
import type { SimulationMetrics, BaselineHolding } from '../../types/trading'
import type { SimulationRow } from '../../hooks/useSimulationRows'
import type { TradeAttribution } from './SectorExposureChart'
import { ImpactHeadlineBand } from './ImpactHeadlineBand'
import { SectorExposureChart } from './SectorExposureChart'
import { PortfolioCharacteristics } from './PortfolioCharacteristics'
import { PortfolioFundamentalsCard } from './PortfolioFundamentalsCard'
import { HoldingsComparison } from './HoldingsComparison'

interface PortfolioImpactViewProps {
  metrics: SimulationMetrics
  baseline: BaselineHolding[]
  simulationRows: SimulationRow[]
}

export function PortfolioImpactView({ metrics, baseline, simulationRows }: PortfolioImpactViewProps) {
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

  return (
    <div className="space-y-5">
      {/* Layer 1: Headline + KPI pills */}
      <ImpactHeadlineBand metrics={metrics} simulationRows={simulationRows} />

      {/* Row 1: Sector exposure + characteristics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <SectorExposureChart
            before={metrics.sector_exposure_before}
            after={metrics.sector_exposure_after}
            tradeAttribution={tradeAttribution}
          />
        </div>
        <PortfolioCharacteristics metrics={metrics} simulationRows={simulationRows} />
      </div>

      {/* Row 2: Portfolio fundamentals */}
      <PortfolioFundamentalsCard holdingsAfterCount={metrics.position_count_after} />

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
