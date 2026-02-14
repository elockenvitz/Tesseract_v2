import React from 'react'
import { clsx } from 'clsx'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Edit3,
  AlertTriangle,
  Target,
  DollarSign,
  Sparkles,
  Loader2,
  ArrowRight
} from 'lucide-react'
import { format } from 'date-fns'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type Sentiment = 'bullish' | 'neutral' | 'bearish'

export interface EvolutionStats {
  totalRevisions: number
  firstEditDate: Date | null
  lastEditDate: Date | null
  thesisChanges: number
  riskUpdates: number
  priceTargetRevisions: number
  whereDifferentChanges: number
  referenceChanges: number
  sentimentTrajectory: 'more_bullish' | 'more_bearish' | 'stable' | 'unknown'
  initialSentiment?: Sentiment
  currentSentiment?: Sentiment
}

interface EvolutionOverviewProps {
  stats: EvolutionStats
  lastEditor?: { name: string; date: Date }
  isAnalyzing: boolean
  hasAnalysis: boolean
  isAnalysisStale: boolean
  onAnalyzeEvolution: () => void
  className?: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getSentimentTrajectoryConfig(trajectory: EvolutionStats['sentimentTrajectory']) {
  switch (trajectory) {
    case 'more_bullish':
      return {
        icon: TrendingUp,
        label: 'More Bullish',
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200'
      }
    case 'more_bearish':
      return {
        icon: TrendingDown,
        label: 'More Bearish',
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200'
      }
    case 'stable':
      return {
        icon: Minus,
        label: 'Stable',
        color: 'text-gray-600',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200'
      }
    default:
      return {
        icon: Minus,
        label: 'Unknown',
        color: 'text-gray-400',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200'
      }
  }
}

// ============================================================================
// STAT CARD COMPONENT
// ============================================================================

interface StatCardProps {
  icon: React.ElementType
  label: string
  value: string | number
  subValue?: string
  color: string
}

function StatCard({ icon: Icon, label, value, subValue, color }: StatCardProps) {
  return (
    <div className="flex items-center gap-3">
      <div className={clsx('p-2 rounded-lg', color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-lg font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
        {subValue && <p className="text-xs text-gray-400">{subValue}</p>}
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function EvolutionOverview({
  stats,
  lastEditor,
  isAnalyzing,
  hasAnalysis,
  isAnalysisStale,
  onAnalyzeEvolution,
  className
}: EvolutionOverviewProps) {
  const trajectoryConfig = getSentimentTrajectoryConfig(stats.sentimentTrajectory)
  const TrajectoryIcon = trajectoryConfig.icon

  if (stats.totalRevisions === 0) {
    return (
      <div className={clsx(
        'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center',
        className
      )}>
        <Edit3 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No revision history yet</p>
        <p className="text-xs text-gray-400 mt-1">Changes will be tracked as you edit</p>
      </div>
    )
  }

  return (
    <div className={clsx(
      'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden',
      className
    )}>
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Change Intelligence</h3>
            </div>
            {lastEditor && (
              <p className="text-xs text-gray-500 mt-0.5 ml-6">
                Last updated by {lastEditor.name} · {format(lastEditor.date, 'MMM d, yyyy')}
              </p>
            )}
          </div>

          {/* Sentiment Trajectory Badge */}
          <div className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
            trajectoryConfig.bgColor,
            trajectoryConfig.color,
            trajectoryConfig.borderColor
          )}>
            <TrajectoryIcon className="w-3.5 h-3.5" />
            {trajectoryConfig.label}
          </div>
        </div>
      </div>

      {/* Stats Grid - focused on material counts */}
      <div className="p-4">
        <div className="grid grid-cols-3 gap-4 mb-3">
          <StatCard
            icon={Target}
            label="Thesis Changes"
            value={stats.thesisChanges}
            color="bg-primary-50 text-primary-600"
          />
          <StatCard
            icon={DollarSign}
            label="Target Revisions"
            value={stats.priceTargetRevisions}
            color="bg-green-50 text-green-600"
          />
          <StatCard
            icon={AlertTriangle}
            label="Risk Updates"
            value={stats.riskUpdates}
            color="bg-amber-50 text-amber-600"
          />
        </div>

        {/* Sentiment Evolution Arrow (if we have both sentiments) */}
        {stats.initialSentiment && stats.currentSentiment && stats.initialSentiment !== stats.currentSentiment && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 mb-2">Sentiment Evolution</p>
            <div className="flex items-center gap-2">
              <SentimentBadge sentiment={stats.initialSentiment} />
              <ArrowRight className="w-4 h-4 text-gray-400" />
              <SentimentBadge sentiment={stats.currentSentiment} />
            </div>
          </div>
        )}
      </div>

      {/* Analyze link */}
      <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={onAnalyzeEvolution}
          disabled={isAnalyzing}
          className={clsx(
            'flex items-center gap-1.5 text-xs transition-colors',
            isAnalyzing
              ? 'text-gray-400 cursor-not-allowed'
              : isAnalysisStale
                ? 'text-amber-600 hover:text-amber-700'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
          )}
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              {hasAnalysis
                ? isAnalysisStale
                  ? 'Update analysis →'
                  : 'Refresh analysis →'
                : 'Analyze evolution →'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// SENTIMENT BADGE COMPONENT
// ============================================================================

function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const config = {
    bullish: { bg: 'bg-green-100', text: 'text-green-700', label: 'Bullish' },
    neutral: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Neutral' },
    bearish: { bg: 'bg-red-100', text: 'text-red-700', label: 'Bearish' }
  }

  const c = config[sentiment]
  return (
    <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', c.bg, c.text)}>
      {c.label}
    </span>
  )
}

export default EvolutionOverview
