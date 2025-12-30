import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { chartDataService, CandlestickData, timeframeToParams } from '../lib/chartData'
import { useAnalystPriceTargets, AnalystPriceTarget } from './useAnalystPriceTargets'
import { useTargetOutcomes, TargetOutcome } from './useTargetOutcomes'

export type ChartTimeframe = '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | '10Y'
export type TargetViewMode = 'all' | 'covering' | 'byScenario' | 'single'

export interface ChartTarget {
  id: string
  price: number
  scenarioId: string
  scenarioName: string
  scenarioColor: string
  userId: string
  userName: string
  isCovering: boolean
  timeframe: string | null
  timeframeType: string
  targetDate: string | null // Expected achievement date (expiration)
  isRolling: boolean
  status: 'pending' | 'hit' | 'missed' | 'expired' | 'cancelled'
  probability: number | null
  reasoning: string | null
  createdAt: string
  updatedAt: string // Last update (used for expiration calc on Fixed targets)
}

export interface RiskRewardZone {
  id: string
  type: 'risk' | 'reward'
  priceFrom: number
  priceTo: number
  label: string
  percentChange: number
  scenarioName: string
  color: string
}

export interface PriceTargetChartData {
  historicalPrices: CandlestickData[]
  priceTargets: ChartTarget[]
  outcomes: TargetOutcome[]
  currentPrice: number
  priceChange: number
  priceChangePercent: number
  riskRewardZones: RiskRewardZone[]
  riskRewardRatio: number | null
  loading: boolean
  fetching: boolean // True when refetching (changing timeframe)
  error: Error | null
}

interface UsePriceTargetChartOptions {
  assetId: string
  symbol: string
  timeframe?: ChartTimeframe
  viewMode?: TargetViewMode
  selectedUserId?: string
  coveringOnly?: boolean
}

// Calculate target date based on timeframe settings
function calculateTargetDate(
  updatedAt: string, // Use updated_at - saving restarts the timer for Fixed targets
  timeframe: string | null,
  timeframeType: string | null,
  targetDate: string | null,
  isRolling: boolean
): string | null {
  // If explicit target date is set, use it
  if (timeframeType === 'date' && targetDate) {
    return targetDate
  }

  if (!timeframe) return null

  // For rolling targets, calculate from NOW
  // For fixed targets, calculate from updated_at (saving restarts the timer)
  const baseDate = isRolling ? new Date() : new Date(updatedAt)
  const tf = timeframe.toLowerCase()

  if (tf.includes('3 month')) {
    baseDate.setMonth(baseDate.getMonth() + 3)
  } else if (tf.includes('6 month')) {
    baseDate.setMonth(baseDate.getMonth() + 6)
  } else if (tf.includes('12 month') || tf.includes('1 year')) {
    baseDate.setFullYear(baseDate.getFullYear() + 1)
  } else if (tf.includes('18 month')) {
    baseDate.setMonth(baseDate.getMonth() + 18)
  } else if (tf.includes('24 month') || tf.includes('2 year')) {
    baseDate.setFullYear(baseDate.getFullYear() + 2)
  } else {
    // Default to 12 months
    baseDate.setFullYear(baseDate.getFullYear() + 1)
  }

  return baseDate.toISOString().split('T')[0]
}

export function usePriceTargetChart({
  assetId,
  symbol,
  timeframe = '1Y',
  viewMode = 'all',
  selectedUserId,
  coveringOnly = false
}: UsePriceTargetChartOptions): PriceTargetChartData {
  // Fetch historical price data
  const params = timeframeToParams[timeframe] || timeframeToParams['1Y']

  const {
    data: historicalPrices,
    isLoading: pricesLoading,
    isFetching: pricesFetching,
    error: pricesError
  } = useQuery({
    queryKey: ['chart-data', symbol, params.interval, params.range],
    queryFn: async () => {
      const data = await chartDataService.getChartData({
        symbol,
        interval: params.interval as any,
        range: params.range as any
      })
      return data
    },
    enabled: !!symbol,
    staleTime: 60000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: keepPreviousData // Keep previous data while fetching new timeframe
  })

  // Fetch price targets
  const {
    priceTargets: rawTargets,
    isLoading: targetsLoading,
    error: targetsError
  } = useAnalystPriceTargets({
    assetId,
    officialOnly: coveringOnly
  })

  // Fetch outcomes for the asset
  const {
    outcomes,
    isLoading: outcomesLoading,
    error: outcomesError
  } = useTargetOutcomes({
    assetId
  })

  // Calculate current price from latest historical data
  const currentPrice = historicalPrices && historicalPrices.length > 0
    ? historicalPrices[historicalPrices.length - 1].close
    : 0

  // Calculate price change
  const priceChange = historicalPrices && historicalPrices.length > 1
    ? currentPrice - historicalPrices[0].close
    : 0

  const priceChangePercent = historicalPrices && historicalPrices.length > 1
    ? (priceChange / historicalPrices[0].close) * 100
    : 0

  // Create outcome status map for quick lookup
  const outcomeMap = new Map<string, TargetOutcome>()
  outcomes.forEach(o => {
    outcomeMap.set(o.price_target_id, o)
  })

  // Filter and transform price targets based on view mode
  let filteredTargets = rawTargets || []

  if (viewMode === 'covering') {
    filteredTargets = filteredTargets.filter(t => !!t.coverage)
  } else if (viewMode === 'single' && selectedUserId) {
    filteredTargets = filteredTargets.filter(t => t.user_id === selectedUserId)
  }

  // Transform to ChartTarget format
  const priceTargets: ChartTarget[] = filteredTargets.map(target => {
    const outcome = outcomeMap.get(target.id)
    return {
      id: target.id,
      price: target.price,
      scenarioId: target.scenario_id,
      scenarioName: target.scenario?.name || 'Unknown',
      scenarioColor: target.scenario?.color || '#6b7280',
      userId: target.user_id,
      userName: target.user?.full_name || 'Unknown',
      isCovering: !!target.coverage,
      timeframe: target.timeframe,
      timeframeType: target.timeframe_type || 'preset',
      targetDate: calculateTargetDate(
        target.updated_at || target.created_at, // Use updated_at - saving restarts timer
        target.timeframe,
        target.timeframe_type || 'preset',
        target.target_date || null,
        target.is_rolling || false
      ),
      isRolling: target.is_rolling || false,
      status: outcome?.status || 'pending',
      probability: target.probability,
      reasoning: target.reasoning,
      createdAt: target.created_at,
      updatedAt: target.updated_at || target.created_at
    }
  })

  // Calculate risk/reward zones
  const riskRewardZones: RiskRewardZone[] = []

  if (currentPrice > 0) {
    // Get aggregated prices by scenario
    const scenarioAggregates = new Map<string, {
      prices: number[]
      name: string
      color: string
    }>()

    priceTargets.forEach(target => {
      const key = target.scenarioName
      if (!scenarioAggregates.has(key)) {
        scenarioAggregates.set(key, {
          prices: [],
          name: target.scenarioName,
          color: target.scenarioColor
        })
      }
      scenarioAggregates.get(key)!.prices.push(target.price)
    })

    // Calculate average price for each scenario
    scenarioAggregates.forEach((data, scenarioName) => {
      if (data.prices.length === 0) return

      const avgPrice = data.prices.reduce((a, b) => a + b, 0) / data.prices.length
      const percentChange = ((avgPrice - currentPrice) / currentPrice) * 100

      const isBear = scenarioName.toLowerCase().includes('bear')
      const isBull = scenarioName.toLowerCase().includes('bull')

      riskRewardZones.push({
        id: `zone-${scenarioName}`,
        type: isBear ? 'risk' : 'reward',
        priceFrom: Math.min(currentPrice, avgPrice),
        priceTo: Math.max(currentPrice, avgPrice),
        label: `${scenarioName}: ${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%`,
        percentChange,
        scenarioName,
        color: data.color
      })
    })
  }

  // Calculate risk/reward ratio
  let riskRewardRatio: number | null = null
  const bullZone = riskRewardZones.find(z => z.scenarioName.toLowerCase().includes('bull'))
  const bearZone = riskRewardZones.find(z => z.scenarioName.toLowerCase().includes('bear'))

  if (bullZone && bearZone && bearZone.percentChange !== 0) {
    riskRewardRatio = Math.abs(bullZone.percentChange / bearZone.percentChange)
  }

  // isLoading = initial load (no cached data)
  // isFetching = any fetch including refetch (has cached data but fetching new)
  const loading = pricesLoading || targetsLoading || outcomesLoading
  const fetching = pricesFetching
  const error = pricesError || targetsError || outcomesError

  return {
    historicalPrices: historicalPrices || [],
    priceTargets,
    outcomes,
    currentPrice,
    priceChange,
    priceChangePercent,
    riskRewardZones,
    riskRewardRatio,
    loading,
    fetching, // True when refetching with existing data
    error: error as Error | null
  }
}

// Utility hook to get all unique analysts with targets for a given asset
export function useChartAnalysts(assetId: string) {
  const { priceTargets } = useAnalystPriceTargets({ assetId })

  const analysts = new Map<string, { id: string; name: string; isCovering: boolean }>()

  priceTargets?.forEach(target => {
    if (!analysts.has(target.user_id)) {
      analysts.set(target.user_id, {
        id: target.user_id,
        name: target.user?.full_name || 'Unknown',
        isCovering: !!target.coverage
      })
    }
  })

  return Array.from(analysts.values())
}

// Utility hook for target position calculations on chart
export function useTargetChartPositions(
  targets: ChartTarget[],
  priceRange: { min: number; max: number }
) {
  // Group overlapping targets to avoid visual clutter
  const groupedTargets: { targets: ChartTarget[]; avgPrice: number }[] = []
  const tolerance = (priceRange.max - priceRange.min) * 0.02 // 2% of price range

  const sortedTargets = [...targets].sort((a, b) => a.price - b.price)

  sortedTargets.forEach(target => {
    // Find existing group within tolerance
    const existingGroup = groupedTargets.find(
      g => Math.abs(g.avgPrice - target.price) < tolerance
    )

    if (existingGroup) {
      existingGroup.targets.push(target)
      // Recalculate average
      existingGroup.avgPrice = existingGroup.targets.reduce((sum, t) => sum + t.price, 0) / existingGroup.targets.length
    } else {
      groupedTargets.push({
        targets: [target],
        avgPrice: target.price
      })
    }
  })

  return groupedTargets
}
