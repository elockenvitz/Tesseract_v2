import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine
} from 'recharts'
import { Target, ChevronDown, Users } from 'lucide-react'
import { format, subMonths, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useScenarios } from '../../hooks/useScenarios'

interface PriceTargetHistoryChartProps {
  assetId: string
  className?: string
  height?: number
  currentPrice?: number
}

type TimeRange = '3M' | '6M' | '1Y' | '2Y' | 'ALL'

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '2Y', label: '2Y' },
  { value: 'ALL', label: 'All' }
]

// Format currency for display
const formatPrice = (value: number) => {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

// Custom tooltip
function CustomTooltip({ active, payload, label, currentPrice }: any) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 mb-2">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span className="font-medium">{formatPrice(entry.value)}</span>
          </div>
        ))}
      </div>
      {currentPrice && (
        <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
          Current: {formatPrice(currentPrice)}
        </div>
      )}
    </div>
  )
}

export function PriceTargetHistoryChart({
  assetId,
  className,
  height = 300,
  currentPrice
}: PriceTargetHistoryChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y')
  const [selectedScenario, setSelectedScenario] = useState<string>('all')

  const { scenarios } = useScenarios(assetId)

  // Calculate date range
  const dateRange = useMemo(() => {
    const now = new Date()
    switch (timeRange) {
      case '3M': return subMonths(now, 3)
      case '6M': return subMonths(now, 6)
      case '1Y': return subMonths(now, 12)
      case '2Y': return subMonths(now, 24)
      default: return new Date(2020, 0, 1)
    }
  }, [timeRange])

  // Fetch price target history
  const { data: historyData, isLoading } = useQuery({
    queryKey: ['price-target-history-chart', assetId, selectedScenario, dateRange.toISOString()],
    queryFn: async () => {
      // Fetch all price targets for this asset
      let targetsQuery = supabase
        .from('analyst_price_targets')
        .select(`
          id,
          user_id,
          scenario_id,
          price,
          created_at,
          updated_at,
          user:users!analyst_price_targets_user_id_fkey(first_name, last_name),
          scenario:scenarios!analyst_price_targets_scenario_id_fkey(name, color)
        `)
        .eq('asset_id', assetId)

      if (selectedScenario !== 'all') {
        targetsQuery = targetsQuery.eq('scenario_id', selectedScenario)
      }

      const { data: targets, error: targetsError } = await targetsQuery

      if (targetsError) throw targetsError

      if (!targets || targets.length === 0) return { dataPoints: [], analysts: [] }

      const targetIds = targets.map(t => t.id)

      // Fetch history for price changes
      const { data: history, error: histError } = await supabase
        .from('analyst_price_target_history')
        .select('*')
        .in('price_target_id', targetIds)
        .eq('field_name', 'price')
        .gte('changed_at', dateRange.toISOString())
        .order('changed_at', { ascending: true })

      if (histError) throw histError

      // Build timeline of values
      const userTargets = new Map<string, {
        value: number
        name: string
        scenario: string
        color: string
      }>()

      // Initialize with current values
      for (const t of targets) {
        const name = t.user
          ? `${t.user.first_name?.[0] || ''}. ${t.user.last_name || ''}`.trim()
          : 'Unknown'
        const scenario = t.scenario?.name || 'Base'
        const key = `${t.user_id}-${t.scenario_id}`
        userTargets.set(key, {
          value: Number(t.price),
          name: selectedScenario !== 'all' ? name : `${name} (${scenario})`,
          scenario,
          color: t.scenario?.color || '#6366f1'
        })
      }

      // Create data points by processing history in reverse
      const dataPoints: Array<{
        date: string
        timestamp: number
        consensus: number
        [key: string]: any
      }> = []

      // Group history by date
      const historyByDate = new Map<string, typeof history>()
      for (const h of history || []) {
        const dateKey = format(parseISO(h.changed_at), 'yyyy-MM-dd')
        if (!historyByDate.has(dateKey)) {
          historyByDate.set(dateKey, [])
        }
        historyByDate.get(dateKey)!.push(h)
      }

      // Current point
      const currentValues = Array.from(userTargets.values()).map(u => u.value)
      if (currentValues.length > 0) {
        const consensus = currentValues.reduce((a, b) => a + b, 0) / currentValues.length
        const point: any = {
          date: format(new Date(), 'MMM dd'),
          timestamp: Date.now(),
          consensus
        }
        for (const [key, data] of userTargets) {
          point[data.name] = data.value
        }
        dataPoints.push(point)
      }

      // Work backwards through history
      const sortedDates = Array.from(historyByDate.keys()).sort().reverse()
      const workingValues = new Map(userTargets)

      for (const dateKey of sortedDates) {
        const dayHistory = historyByDate.get(dateKey)!

        // Apply changes in reverse (using old_value)
        for (const h of dayHistory) {
          const target = targets.find(t => t.id === h.price_target_id)
          if (target && h.old_value) {
            const key = `${target.user_id}-${target.scenario_id}`
            const existing = workingValues.get(key)
            if (existing) {
              workingValues.set(key, {
                ...existing,
                value: Number(h.old_value)
              })
            }
          }
        }

        // Calculate consensus at this point
        const values = Array.from(workingValues.values()).map(u => u.value)
        if (values.length > 0) {
          const consensus = values.reduce((a, b) => a + b, 0) / values.length
          const point: any = {
            date: format(parseISO(dateKey), 'MMM dd'),
            timestamp: parseISO(dateKey).getTime(),
            consensus
          }
          for (const [key, data] of workingValues) {
            point[data.name] = data.value
          }
          dataPoints.unshift(point)
        }
      }

      // Get unique analyst names
      const analysts = Array.from(userTargets.values()).map(u => ({
        name: u.name,
        color: u.color
      }))

      return { dataPoints, analysts }
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  const chartData = historyData?.dataPoints || []
  const analysts = historyData?.analysts || []

  // Default colors for analysts
  const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4" />
          <div className="h-64 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="text-center py-8 text-gray-500">
          <Target className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No price target history available</p>
          <p className="text-xs mt-1">Price targets will appear here as analysts add and revise them</p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
            <Target className="w-4 h-4 text-gray-500" />
            Price Target History
          </h4>

          <div className="flex items-center gap-3">
            {/* Scenario filter */}
            {scenarios.length > 1 && (
              <div className="relative">
                <select
                  value={selectedScenario}
                  onChange={(e) => setSelectedScenario(e.target.value)}
                  className="text-xs px-2 py-1 pr-6 border border-gray-300 rounded-lg appearance-none bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="all">All Scenarios</option>
                  {scenarios.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              </div>
            )}

            {/* Time range */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {TIME_RANGES.map(range => (
                <button
                  key={range.value}
                  onClick={() => setTimeRange(range.value)}
                  className={clsx(
                    'px-2 py-0.5 text-xs font-medium rounded transition-colors',
                    timeRange === range.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  )}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Analyst count */}
        {analysts.length > 0 && (
          <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
            <Users className="w-3 h-3" />
            <span>{analysts.length} analyst{analysts.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <div className="p-4">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              tickFormatter={formatPrice}
              width={60}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<CustomTooltip currentPrice={currentPrice} />} />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="circle"
              iconSize={8}
            />

            {/* Current price reference line */}
            {currentPrice && (
              <ReferenceLine
                y={currentPrice}
                stroke="#9ca3af"
                strokeDasharray="5 5"
                label={{
                  value: 'Current',
                  position: 'right',
                  fontSize: 10,
                  fill: '#9ca3af'
                }}
              />
            )}

            {/* Consensus line (bold) */}
            <Line
              type="monotone"
              dataKey="consensus"
              name="Consensus"
              stroke="#1f2937"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />

            {/* Individual analyst lines */}
            {analysts.map((analyst, index) => (
              <Line
                key={analyst.name}
                type="monotone"
                dataKey={analyst.name}
                name={analyst.name}
                stroke={analyst.color || COLORS[index % COLORS.length]}
                strokeWidth={1}
                strokeDasharray="4 2"
                dot={false}
                activeDot={{ r: 3 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
