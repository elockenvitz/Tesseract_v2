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
  Legend
} from 'recharts'
import { ThumbsUp, Users } from 'lucide-react'
import { format, subMonths, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface RatingHistoryChartProps {
  assetId: string
  className?: string
  height?: number
}

type TimeRange = '3M' | '6M' | '1Y' | '2Y' | 'ALL'

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '2Y', label: '2Y' },
  { value: 'ALL', label: 'All' }
]

// Map rating values to numeric scores for charting
// Higher = more bullish
const RATING_SCORES: Record<string, number> = {
  // Three-tier scale
  'OW': 3, 'Overweight': 3, 'Buy': 3, 'Strong Buy': 3.5,
  'N': 2, 'Neutral': 2, 'Hold': 2, 'Equal Weight': 2, 'EW': 2,
  'UW': 1, 'Underweight': 1, 'Sell': 1, 'Strong Sell': 0.5,
  // Five-tier scale
  'Strong Outperform': 5, 'Outperform': 4, 'Market Perform': 3, 'Underperform': 2, 'Strong Underperform': 1
}

const getRatingScore = (rating: string): number => {
  return RATING_SCORES[rating] ?? 2 // Default to neutral
}

const getRatingLabel = (score: number): string => {
  if (score >= 3.5) return 'Strong Buy'
  if (score >= 2.5) return 'Bullish'
  if (score >= 1.5) return 'Neutral'
  if (score >= 0.5) return 'Bearish'
  return 'Strong Sell'
}

const getRatingColor = (score: number): string => {
  if (score >= 2.5) return '#22c55e' // green
  if (score >= 1.5) return '#f59e0b' // amber
  return '#ef4444' // red
}

// Custom tooltip
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 mb-2">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => {
          const rating = entry.payload[`${entry.dataKey}_raw`] || getRatingLabel(entry.value)
          return (
            <div key={index} className="flex items-center justify-between gap-4">
              <span style={{ color: entry.color }}>{entry.name}</span>
              <span className="font-medium">{rating}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function RatingHistoryChart({
  assetId,
  className,
  height = 250
}: RatingHistoryChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y')

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

  // Fetch rating history
  const { data: historyData, isLoading } = useQuery({
    queryKey: ['rating-history-chart', assetId, dateRange.toISOString()],
    queryFn: async () => {
      // Fetch all ratings for this asset
      const { data: ratings, error: ratingsError } = await supabase
        .from('analyst_ratings')
        .select(`
          id,
          user_id,
          rating_value,
          created_at,
          updated_at,
          user:users!analyst_ratings_user_id_fkey(first_name, last_name)
        `)
        .eq('asset_id', assetId)

      if (ratingsError) throw ratingsError

      if (!ratings || ratings.length === 0) return { dataPoints: [], analysts: [] }

      const ratingIds = ratings.map(r => r.id)

      // Fetch history for rating value changes
      const { data: history, error: histError } = await supabase
        .from('analyst_rating_history')
        .select('*')
        .in('rating_id', ratingIds)
        .eq('field_name', 'rating_value')
        .gte('changed_at', dateRange.toISOString())
        .order('changed_at', { ascending: true })

      if (histError) throw histError

      // Build timeline of rating scores
      const userRatings = new Map<string, {
        value: string
        score: number
        name: string
      }>()

      // Initialize with current values
      for (const r of ratings) {
        const name = r.user
          ? `${r.user.first_name?.[0] || ''}. ${r.user.last_name || ''}`.trim()
          : 'Unknown'
        userRatings.set(r.user_id, {
          value: r.rating_value,
          score: getRatingScore(r.rating_value),
          name
        })
      }

      // Create data points
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
      const currentScores = Array.from(userRatings.values()).map(u => u.score)
      if (currentScores.length > 0) {
        const consensus = currentScores.reduce((a, b) => a + b, 0) / currentScores.length
        const point: any = {
          date: format(new Date(), 'MMM dd'),
          timestamp: Date.now(),
          consensus,
          consensus_raw: getRatingLabel(consensus)
        }
        for (const [userId, data] of userRatings) {
          point[data.name] = data.score
          point[`${data.name}_raw`] = data.value
        }
        dataPoints.push(point)
      }

      // Work backwards through history
      const sortedDates = Array.from(historyByDate.keys()).sort().reverse()
      const workingValues = new Map(userRatings)

      for (const dateKey of sortedDates) {
        const dayHistory = historyByDate.get(dateKey)!

        // Apply changes in reverse
        for (const h of dayHistory) {
          const rating = ratings.find(r => r.id === h.rating_id)
          if (rating && h.old_value) {
            const existing = workingValues.get(rating.user_id)
            if (existing) {
              workingValues.set(rating.user_id, {
                ...existing,
                value: h.old_value,
                score: getRatingScore(h.old_value)
              })
            }
          }
        }

        // Calculate consensus at this point
        const scores = Array.from(workingValues.values()).map(u => u.score)
        if (scores.length > 0) {
          const consensus = scores.reduce((a, b) => a + b, 0) / scores.length
          const point: any = {
            date: format(parseISO(dateKey), 'MMM dd'),
            timestamp: parseISO(dateKey).getTime(),
            consensus,
            consensus_raw: getRatingLabel(consensus)
          }
          for (const [userId, data] of workingValues) {
            point[data.name] = data.score
            point[`${data.name}_raw`] = data.value
          }
          dataPoints.unshift(point)
        }
      }

      // Get unique analyst names
      const analysts = Array.from(userRatings.values()).map(u => u.name)

      return { dataPoints, analysts }
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  const chartData = historyData?.dataPoints || []
  const analysts = historyData?.analysts || []

  const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="text-center py-8 text-gray-500">
          <ThumbsUp className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No rating history available</p>
          <p className="text-xs mt-1">Ratings will appear here as analysts add and revise them</p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
            <ThumbsUp className="w-4 h-4 text-gray-500" />
            Rating History
          </h4>

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
              domain={[0.5, 3.5]}
              ticks={[1, 2, 3]}
              tickFormatter={(value) => {
                if (value >= 2.5) return 'Bull'
                if (value >= 1.5) return 'Ntrl'
                return 'Bear'
              }}
              width={35}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="circle"
              iconSize={8}
            />

            {/* Consensus line (bold) */}
            <Line
              type="stepAfter"
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
                type="stepAfter"
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
