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
import { TrendingUp, ChevronDown, Users, Calendar } from 'lucide-react'
import { format, subMonths, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useEstimateMetrics } from '../../hooks/useAnalystEstimates'

interface EstimateRevisionChartProps {
  assetId: string
  className?: string
  height?: number
}

type TimeRange = '3M' | '6M' | '1Y' | '2Y' | 'ALL'
type MetricKey = 'eps' | 'revenue' | 'ebitda'

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '2Y', label: '2Y' },
  { value: 'ALL', label: 'All' }
]

const METRIC_OPTIONS: { value: MetricKey; label: string }[] = [
  { value: 'eps', label: 'EPS' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'ebitda', label: 'EBITDA' }
]

// Get current fiscal year
const getCurrentFiscalYear = () => new Date().getFullYear()

// Format value for display
const formatValue = (value: number, metricKey: string) => {
  if (metricKey === 'revenue' || metricKey === 'ebitda') {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
    return `$${value.toFixed(0)}`
  }
  return `$${value.toFixed(2)}`
}

// Custom tooltip
function CustomTooltip({ active, payload, label, metricKey }: any) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 mb-2">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span className="font-medium">{formatValue(entry.value, metricKey)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EstimateRevisionChart({ assetId, className, height = 300 }: EstimateRevisionChartProps) {
  const currentFY = getCurrentFiscalYear()
  const nextFY = currentFY + 1

  const [timeRange, setTimeRange] = useState<TimeRange>('1Y')
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('eps')
  const [selectedYear, setSelectedYear] = useState<number>(currentFY)

  const { getMetricByKey } = useEstimateMetrics()

  // Calculate date range
  const dateRange = useMemo(() => {
    const now = new Date()
    switch (timeRange) {
      case '3M': return subMonths(now, 3)
      case '6M': return subMonths(now, 6)
      case '1Y': return subMonths(now, 12)
      case '2Y': return subMonths(now, 24)
      default: return new Date(2020, 0, 1) // ALL - go back far
    }
  }, [timeRange])

  // Fetch estimate history with revisions
  const { data: historyData, isLoading } = useQuery({
    queryKey: ['estimate-revisions', assetId, selectedMetric, selectedYear, dateRange.toISOString()],
    queryFn: async () => {
      // Fetch all estimates for this metric/year with their history
      const { data: estimates, error: estError } = await supabase
        .from('analyst_estimates')
        .select(`
          id,
          user_id,
          value,
          created_at,
          updated_at,
          user:users!analyst_estimates_user_id_fkey(first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .eq('metric_key', selectedMetric)
        .eq('fiscal_year', selectedYear)
        .eq('period_type', 'annual')

      if (estError) throw estError

      // Fetch history for value changes
      const estimateIds = (estimates || []).map(e => e.id)

      if (estimateIds.length === 0) return { dataPoints: [], analysts: [] }

      const { data: history, error: histError } = await supabase
        .from('analyst_estimate_history')
        .select('*')
        .in('estimate_id', estimateIds)
        .eq('field_name', 'value')
        .gte('changed_at', dateRange.toISOString())
        .order('changed_at', { ascending: true })

      if (histError) throw histError

      // Build timeline of consensus values
      // Start with current estimates and work backwards
      const userEstimates = new Map<string, { value: number; name: string }>()

      // Initialize with current values
      for (const est of estimates || []) {
        const name = est.user
          ? `${est.user.first_name?.[0] || ''}. ${est.user.last_name || ''}`.trim()
          : 'Unknown'
        userEstimates.set(est.user_id, {
          value: Number(est.value),
          name
        })
      }

      // Create data points by processing history in reverse
      const dataPoints: Array<{
        date: string
        timestamp: number
        consensus: number
        [key: string]: any
      }> = []

      // Group history by date (daily granularity)
      const historyByDate = new Map<string, typeof history>()
      for (const h of history || []) {
        const dateKey = format(parseISO(h.changed_at), 'yyyy-MM-dd')
        if (!historyByDate.has(dateKey)) {
          historyByDate.set(dateKey, [])
        }
        historyByDate.get(dateKey)!.push(h)
      }

      // Current point
      const currentValues = Array.from(userEstimates.values()).map(u => u.value)
      if (currentValues.length > 0) {
        const consensus = currentValues.reduce((a, b) => a + b, 0) / currentValues.length
        const point: any = {
          date: format(new Date(), 'MMM dd'),
          timestamp: Date.now(),
          consensus
        }
        // Add individual analyst values
        for (const [userId, data] of userEstimates) {
          point[data.name] = data.value
        }
        dataPoints.push(point)
      }

      // Work backwards through history to reconstruct past values
      const sortedDates = Array.from(historyByDate.keys()).sort().reverse()
      const workingValues = new Map(userEstimates)

      for (const dateKey of sortedDates) {
        const dayHistory = historyByDate.get(dateKey)!

        // Apply changes in reverse (using old_value)
        for (const h of dayHistory) {
          const est = (estimates || []).find(e => e.id === h.estimate_id)
          if (est && h.old_value) {
            const existingUser = workingValues.get(est.user_id)
            if (existingUser) {
              workingValues.set(est.user_id, {
                ...existingUser,
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
          for (const [userId, data] of workingValues) {
            point[data.name] = data.value
          }
          dataPoints.unshift(point) // Add to beginning
        }
      }

      // Get unique analyst names
      const analysts = Array.from(userEstimates.values()).map(u => u.name)

      return { dataPoints, analysts }
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  const chartData = historyData?.dataPoints || []
  const analysts = historyData?.analysts || []

  // Colors for different analysts
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
          <TrendingUp className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No estimate history available</p>
          <p className="text-xs mt-1">Estimates will appear here as analysts add and revise them</p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-500" />
            Estimate Revisions
          </h4>

          <div className="flex items-center gap-3">
            {/* Metric selector */}
            <div className="relative">
              <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value as MetricKey)}
                className="text-xs px-2 py-1 pr-6 border border-gray-300 rounded-lg appearance-none bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {METRIC_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>

            {/* Year selector */}
            <div className="relative">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="text-xs px-2 py-1 pr-6 border border-gray-300 rounded-lg appearance-none bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value={currentFY}>FY{String(currentFY).slice(-2)}</option>
                <option value={nextFY}>FY{String(nextFY).slice(-2)}</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>

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
              tickFormatter={(value) => formatValue(value, selectedMetric)}
              width={60}
            />
            <Tooltip content={<CustomTooltip metricKey={selectedMetric} />} />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="circle"
              iconSize={8}
            />

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
                key={analyst}
                type="monotone"
                dataKey={analyst}
                name={analyst}
                stroke={COLORS[index % COLORS.length]}
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
