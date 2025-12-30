import React, { useState } from 'react'
import { clsx } from 'clsx'
import {
  Trophy,
  Medal,
  Award,
  TrendingUp,
  Target,
  ChevronDown,
  ChevronUp,
  User,
  Crown
} from 'lucide-react'
import { usePerformanceLeaderboard, PerformanceLeaderboardEntry } from '../../hooks/useAnalystPerformance'
import { useAuth } from '../../hooks/useAuth'

interface PerformanceLeaderboardProps {
  assetId?: string
  limit?: number
  className?: string
  showCurrentUser?: boolean
}

type SortField = 'rank' | 'hitRate' | 'avgAccuracy' | 'totalTargets' | 'overallScore'
type SortDirection = 'asc' | 'desc'

// Rank badge component
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30">
        <Crown className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
      </div>
    )
  }
  if (rank === 2) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700">
        <Medal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      </div>
    )
  }
  if (rank === 3) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30">
        <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-800">
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">#{rank}</span>
    </div>
  )
}

// Score bar component
function ScoreBar({ value, maxValue = 100, color = 'blue' }: { value: number; maxValue?: number; color?: string }) {
  const percentage = Math.min(100, (value / maxValue) * 100)
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    purple: 'bg-purple-500'
  }

  return (
    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
      <div
        className={clsx('h-full rounded-full transition-all duration-500', colorClasses[color as keyof typeof colorClasses] || colorClasses.blue)}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}

// Sortable header component
function SortableHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  align = 'left'
}: {
  label: string
  field: SortField
  currentSort: SortField
  currentDirection: SortDirection
  onSort: (field: SortField) => void
  align?: 'left' | 'center' | 'right'
}) {
  const isActive = currentSort === field
  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right'
  }

  return (
    <button
      onClick={() => onSort(field)}
      className={clsx(
        'flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-300 transition-colors',
        alignClasses[align],
        align === 'right' && 'ml-auto'
      )}
    >
      {label}
      <span className="flex flex-col">
        <ChevronUp
          className={clsx(
            'w-3 h-3 -mb-1',
            isActive && currentDirection === 'asc' ? 'text-blue-600' : 'text-gray-300 dark:text-gray-600'
          )}
        />
        <ChevronDown
          className={clsx(
            'w-3 h-3',
            isActive && currentDirection === 'desc' ? 'text-blue-600' : 'text-gray-300 dark:text-gray-600'
          )}
        />
      </span>
    </button>
  )
}

export function PerformanceLeaderboard({
  assetId,
  limit = 10,
  className,
  showCurrentUser = true
}: PerformanceLeaderboardProps) {
  const { user } = useAuth()
  const { leaderboard, isLoading, error } = usePerformanceLeaderboard({ assetId, limit })
  const [sortField, setSortField] = useState<SortField>('rank')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expanded, setExpanded] = useState(false)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection(field === 'rank' ? 'asc' : 'desc')
    }
  }

  // Sort the leaderboard
  const sortedLeaderboard = [...leaderboard].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1
    switch (sortField) {
      case 'hitRate':
        return (a.hitRate - b.hitRate) * multiplier
      case 'avgAccuracy':
        return (a.avgAccuracy - b.avgAccuracy) * multiplier
      case 'totalTargets':
        return (a.totalTargets - b.totalTargets) * multiplier
      case 'overallScore':
        return (a.overallScore - b.overallScore) * multiplier
      default:
        return (a.rank - b.rank) * multiplier
    }
  })

  // Find current user's entry
  const currentUserEntry = showCurrentUser && user
    ? leaderboard.find(e => e.userId === user.id)
    : null

  // Determine display count
  const displayCount = expanded ? sortedLeaderboard.length : Math.min(5, sortedLeaderboard.length)
  const displayedEntries = sortedLeaderboard.slice(0, displayCount)

  if (isLoading) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full" />
              <div className="flex-1 h-8 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="text-center py-4 text-red-500">
          <p>Failed to load leaderboard</p>
        </div>
      </div>
    )
  }

  if (leaderboard.length === 0) {
    return (
      <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6', className)}>
        <div className="text-center py-8">
          <Trophy className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No leaderboard data yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Analysts will appear here once they have resolved price targets
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700', className)}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Performance Leaderboard
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {assetId ? 'Asset-specific rankings' : 'Overall analyst rankings'}
            </p>
          </div>
        </div>
      </div>

      {/* Current User Highlight */}
      {currentUserEntry && (
        <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800">
          <div className="flex items-center gap-3">
            <RankBadge rank={currentUserEntry.rank} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-blue-900 dark:text-blue-100">Your Position</span>
                <span className="text-sm text-blue-600 dark:text-blue-400">
                  #{currentUserEntry.rank} of {leaderboard.length}
                </span>
              </div>
              <div className="text-sm text-blue-700 dark:text-blue-300">
                {currentUserEntry.hitRate.toFixed(0)}% hit rate • Score: {currentUserEntry.overallScore.toFixed(0)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-3 text-left">
                <SortableHeader
                  label="Rank"
                  field="rank"
                  currentSort={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
              </th>
              <th className="px-4 py-3 text-left">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Analyst
                </span>
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Hit Rate"
                  field="hitRate"
                  currentSort={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                  align="center"
                />
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Accuracy"
                  field="avgAccuracy"
                  currentSort={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                  align="center"
                />
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Targets"
                  field="totalTargets"
                  currentSort={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                  align="center"
                />
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Score"
                  field="overallScore"
                  currentSort={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                  align="right"
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {displayedEntries.map(entry => {
              const isCurrentUser = user?.id === entry.userId

              return (
                <tr
                  key={entry.userId}
                  className={clsx(
                    'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors',
                    isCurrentUser && 'bg-blue-50/50 dark:bg-blue-900/10'
                  )}
                >
                  <td className="px-4 py-3">
                    <RankBadge rank={entry.rank} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <User className="w-4 h-4 text-gray-500" />
                      </div>
                      <div>
                        <div className={clsx(
                          'font-medium',
                          isCurrentUser ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'
                        )}>
                          {entry.userName}
                          {isCurrentUser && <span className="ml-2 text-xs">(You)</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className={clsx(
                        'font-semibold',
                        entry.hitRate >= 70 ? 'text-green-600' : entry.hitRate >= 50 ? 'text-amber-600' : 'text-red-600'
                      )}>
                        {entry.hitRate.toFixed(0)}%
                      </span>
                      <ScoreBar value={entry.hitRate} color="green" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {entry.avgAccuracy.toFixed(0)}%
                      </span>
                      <ScoreBar value={entry.avgAccuracy} color="blue" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                      <Target className="w-3 h-3" />
                      {entry.totalTargets}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                        {entry.overallScore.toFixed(0)}
                      </span>
                      {entry.rank <= 3 && (
                        <TrendingUp className={clsx(
                          'w-4 h-4',
                          entry.rank === 1 ? 'text-yellow-500' : entry.rank === 2 ? 'text-gray-400' : 'text-amber-500'
                        )} />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Show More / Less */}
      {sortedLeaderboard.length > 5 && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                Show All ({sortedLeaderboard.length})
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default PerformanceLeaderboard
