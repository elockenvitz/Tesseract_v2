import React, { useState, useMemo, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  RefreshCw,
  Users,
  Star,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Target,
  Zap,
  GitBranch
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Contribution } from '../../hooks/useContributions'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type Sentiment = 'bullish' | 'neutral' | 'bearish'
export type AggregationMethod = 'equal' | 'covering_only' | 'role_weighted' | 'recency'

export interface ThesisAnalysis {
  executiveSummary: string
  overallSentiment: Sentiment
  sentimentBreakdown: {
    bullish: number
    neutral: number
    bearish: number
  }
  consensusPoints: string[]
  divergentViews: {
    topic: string
    views: { analyst: string; position: string }[]
  }[]
  keyCatalysts: { theme: string; count: number; analysts: string[] }[]
  analystSentiments: {
    analystId: string
    name: string
    isCovering: boolean
    sentiment: Sentiment
    keyPoint: string
    updatedAt: string
  }[]
  generatedAt: string
  contributionCount: number
}

interface ThesisSummaryViewProps {
  contributions: Contribution[]
  analysis: ThesisAnalysis | null
  isLoading: boolean
  isGenerating: boolean
  isStale: boolean
  isConfigured: boolean
  error: Error | null
  onRegenerate: (method?: AggregationMethod) => void
  coveringAnalystIds: Set<string>
  assetId: string
  section: string
  className?: string
}

// ============================================================================
// AGGREGATION TOOLBAR
// ============================================================================

interface AggregationToolbarProps {
  method: AggregationMethod
  onMethodChange: (method: AggregationMethod) => void
  showCombined: boolean
  onToggleCombined: () => void
  isStale: boolean
  isGenerating: boolean
  onRegenerate: () => void
  analystCount: number
}

function AggregationToolbar({
  method,
  onMethodChange,
  showCombined,
  onToggleCombined,
  isStale,
  isGenerating,
  onRegenerate,
  analystCount
}: AggregationToolbarProps) {
  const methods: { value: AggregationMethod; label: string; description: string }[] = [
    { value: 'equal', label: 'Equal', description: 'All analysts weighted equally' },
    { value: 'covering_only', label: 'Covering Only', description: 'Only covering analysts' },
    { value: 'role_weighted', label: 'By Role', description: 'Primary > Secondary > Tertiary' },
    { value: 'recency', label: 'Recent First', description: 'More recent views weighted higher' }
  ]

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
      <div className="flex items-center gap-4">
        {/* Aggregation Method */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Weight:</span>
          <select
            value={method}
            onChange={(e) => onMethodChange(e.target.value as AggregationMethod)}
            className="text-xs bg-white border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          >
            {methods.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Scope Toggle */}
        <button
          onClick={onToggleCombined}
          className={clsx(
            'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors',
            showCombined
              ? 'bg-primary-100 text-primary-700'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          )}
        >
          <GitBranch className="w-3 h-3" />
          Combined View
        </button>
      </div>

      <div className="flex items-center gap-3">
        {/* Analyst Count */}
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Users className="w-3 h-3" />
          {analystCount} analyst{analystCount !== 1 ? 's' : ''}
        </div>

        {/* Regenerate Button */}
        <button
          onClick={onRegenerate}
          disabled={isGenerating}
          className={clsx(
            'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors',
            isStale
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
            isGenerating && 'opacity-50 cursor-not-allowed'
          )}
        >
          <RefreshCw className={clsx('w-3 h-3', isGenerating && 'animate-spin')} />
          {isGenerating ? 'Analyzing...' : isStale ? 'Update' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// EXECUTIVE SUMMARY CARD
// ============================================================================

interface ExecutiveSummaryProps {
  summary: string
  sentiment: Sentiment
  analystCount: number
  generatedAt: string
}

function ExecutiveSummary({ summary, sentiment, analystCount, generatedAt }: ExecutiveSummaryProps) {
  const sentimentConfig = {
    bullish: { icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', label: 'Bullish' },
    neutral: { icon: Minus, color: 'text-gray-600', bg: 'bg-gray-100', label: 'Neutral' },
    bearish: { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', label: 'Bearish' }
  }

  const config = sentimentConfig[sentiment]
  const Icon = config.icon

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          <h4 className="text-sm font-semibold text-gray-900">Executive Summary</h4>
        </div>
        <div className={clsx('flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', config.bg, config.color)}>
          <Icon className="w-3 h-3" />
          {config.label}
        </div>
      </div>
      <p className="text-sm text-gray-700 leading-relaxed">{summary}</p>
      <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
        <span>{analystCount} analyst{analystCount !== 1 ? 's' : ''}</span>
        <span>•</span>
        <span>Generated {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}</span>
      </div>
    </div>
  )
}

// ============================================================================
// SENTIMENT METER
// ============================================================================

interface SentimentMeterProps {
  breakdown: { bullish: number; neutral: number; bearish: number }
}

function SentimentMeter({ breakdown }: SentimentMeterProps) {
  const total = breakdown.bullish + breakdown.neutral + breakdown.bearish
  const bullishPct = total > 0 ? Math.round((breakdown.bullish / total) * 100) : 0
  const neutralPct = total > 0 ? Math.round((breakdown.neutral / total) * 100) : 0
  const bearishPct = total > 0 ? Math.round((breakdown.bearish / total) * 100) : 0

  // SVG circular progress
  const size = 80
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const bullishOffset = circumference * (1 - bullishPct / 100)
  const neutralStart = bullishPct / 100
  const bearishStart = (bullishPct + neutralPct) / 100

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">Sentiment Distribution</h4>
      <div className="flex items-center gap-4">
        {/* Circular Chart */}
        <div className="relative">
          <svg width={size} height={size} className="transform -rotate-90">
            {/* Background circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth={strokeWidth}
            />
            {/* Bullish segment */}
            {bullishPct > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#22c55e"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - bullishPct / 100)}
                strokeLinecap="round"
              />
            )}
            {/* Neutral segment */}
            {neutralPct > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#9ca3af"
                strokeWidth={strokeWidth}
                strokeDasharray={`${(neutralPct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-bullishPct / 100 * circumference}
                strokeLinecap="round"
              />
            )}
            {/* Bearish segment */}
            {bearishPct > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#ef4444"
                strokeWidth={strokeWidth}
                strokeDasharray={`${(bearishPct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-(bullishPct + neutralPct) / 100 * circumference}
                strokeLinecap="round"
              />
            )}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-xs text-gray-600">Bullish</span>
            </div>
            <span className="text-xs font-medium text-gray-900">{bullishPct}%</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <span className="text-xs text-gray-600">Neutral</span>
            </div>
            <span className="text-xs font-medium text-gray-900">{neutralPct}%</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-xs text-gray-600">Bearish</span>
            </div>
            <span className="text-xs font-medium text-gray-900">{bearishPct}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// CONSENSUS CARDS (3-column grid)
// ============================================================================

interface ConsensusCardsProps {
  consensusPoints: string[]
  divergentViews: { topic: string; views: { analyst: string; position: string }[] }[]
  keyCatalysts: { theme: string; count: number; analysts: string[] }[]
}

function ConsensusCards({ consensusPoints, divergentViews, keyCatalysts }: ConsensusCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Consensus Points */}
      <div className="bg-white border border-gray-200 rounded-lg p-4" style={{ borderTopColor: '#22c55e', borderTopWidth: '3px' }}>
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-green-600" />
          <h4 className="text-sm font-semibold text-gray-900">Consensus Points</h4>
        </div>
        {consensusPoints.length > 0 ? (
          <ul className="space-y-2">
            {consensusPoints.slice(0, 5).map((point, idx) => (
              <li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                {point}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400 italic">No consensus points identified</p>
        )}
      </div>

      {/* Divergent Views */}
      <div className="bg-white border border-gray-200 rounded-lg p-4" style={{ borderTopColor: '#f59e0b', borderTopWidth: '3px' }}>
        <div className="flex items-center gap-2 mb-3">
          <GitBranch className="w-4 h-4 text-amber-600" />
          <h4 className="text-sm font-semibold text-gray-900">Divergent Views</h4>
        </div>
        {divergentViews.length > 0 ? (
          <div className="space-y-3">
            {divergentViews.slice(0, 3).map((dv, idx) => (
              <div key={idx}>
                <p className="text-xs font-medium text-gray-900 mb-1">{dv.topic}</p>
                <div className="space-y-1">
                  {dv.views.slice(0, 2).map((v, vIdx) => (
                    <p key={vIdx} className="text-xs text-gray-600">
                      <span className="font-medium">{v.analyst}:</span> {v.position}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No significant divergence found</p>
        )}
      </div>

      {/* Key Catalysts */}
      <div className="bg-white border border-gray-200 rounded-lg p-4" style={{ borderTopColor: '#6366f1', borderTopWidth: '3px' }}>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-indigo-600" />
          <h4 className="text-sm font-semibold text-gray-900">Key Catalysts</h4>
        </div>
        {keyCatalysts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {keyCatalysts.slice(0, 8).map((cat, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-full"
                title={`Mentioned by: ${cat.analysts.join(', ')}`}
              >
                {cat.theme}
                <span className="text-indigo-400">({cat.count})</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No key catalysts identified</p>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// ANALYST COMPARISON TABLE
// ============================================================================

interface ComparisonTableProps {
  analysts: ThesisAnalysis['analystSentiments']
}

function ComparisonTable({ analysts }: ComparisonTableProps) {
  const sentimentConfig = {
    bullish: { color: 'text-green-600', bg: 'bg-green-50' },
    neutral: { color: 'text-gray-600', bg: 'bg-gray-100' },
    bearish: { color: 'text-red-600', bg: 'bg-red-50' }
  }

  // Sort: covering analysts first, then by recency
  const sortedAnalysts = [...analysts].sort((a, b) => {
    if (a.isCovering && !b.isCovering) return -1
    if (!a.isCovering && b.isCovering) return 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="text-sm font-semibold text-gray-900">Analyst Breakdown</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Analyst</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key Point</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Sentiment</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedAnalysts.map((analyst) => {
              const config = sentimentConfig[analyst.sentiment]
              return (
                <tr key={analyst.analystId} className={analyst.isCovering ? 'bg-yellow-50/30' : ''}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {analyst.isCovering && (
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                      )}
                      <span className="text-sm font-medium text-gray-900">{analyst.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-gray-600 line-clamp-2">{analyst.keyPoint}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', config.bg, config.color)}>
                      {analyst.sentiment}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className="text-xs text-gray-400">
                      {formatDistanceToNow(new Date(analyst.updatedAt), { addSuffix: true })}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================================
// KEY THEMES TAG CLOUD
// ============================================================================

interface KeyThemesProps {
  themes: { theme: string; count: number; analysts: string[] }[]
}

function KeyThemes({ themes }: KeyThemesProps) {
  if (themes.length === 0) return null

  const maxCount = Math.max(...themes.map(t => t.count))

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">Key Themes</h4>
      <div className="flex flex-wrap gap-2">
        {themes.map((theme, idx) => {
          // Scale font size based on frequency
          const scale = theme.count / maxCount
          const fontSize = 0.75 + scale * 0.25 // 0.75rem to 1rem
          const opacity = 0.6 + scale * 0.4

          return (
            <span
              key={idx}
              className="px-2 py-1 bg-primary-50 text-primary-700 rounded-md cursor-default transition-colors hover:bg-primary-100"
              style={{ fontSize: `${fontSize}rem`, opacity }}
              title={`Mentioned by: ${theme.analysts.join(', ')}`}
            >
              {theme.theme}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ThesisSummaryView({
  contributions,
  analysis,
  isLoading,
  isGenerating,
  isStale,
  isConfigured,
  error,
  onRegenerate,
  coveringAnalystIds,
  assetId,
  section,
  className
}: ThesisSummaryViewProps) {
  // Load persisted preferences
  const storageKey = `thesis-analysis-prefs-${assetId}`
  const [aggregationMethod, setAggregationMethod] = useState<AggregationMethod>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.method || 'equal'
      }
    } catch {}
    return 'equal'
  })
  const [showCombined, setShowCombined] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.combined || false
      }
    } catch {}
    return false
  })
  const [showIndividualViews, setShowIndividualViews] = useState(false)
  const hasAutoGenerated = useRef(false)

  // Persist preferences
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        method: aggregationMethod,
        combined: showCombined
      }))
    } catch {}
  }, [aggregationMethod, showCombined, storageKey])

  // Auto-generate analysis when first viewing (if not already generated)
  useEffect(() => {
    if (
      !hasAutoGenerated.current &&
      !analysis &&
      !isLoading &&
      !isGenerating &&
      isConfigured &&
      contributions.length > 0
    ) {
      hasAutoGenerated.current = true
      onRegenerate(aggregationMethod)
    }
  }, [analysis, isLoading, isGenerating, isConfigured, contributions.length, onRegenerate, aggregationMethod])

  // Handle method change - regenerate with new method
  const handleMethodChange = (method: AggregationMethod) => {
    setAggregationMethod(method)
    // Optionally regenerate with new method
    // onRegenerate(method)
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
        <div className="h-32 bg-gray-100 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  // Not configured state
  if (!isConfigured) {
    return (
      <div className={clsx('bg-amber-50 border border-amber-200 rounded-lg p-6 text-center', className)}>
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-amber-700 font-medium">AI Not Configured</p>
        <p className="text-xs text-amber-600 mt-1">Configure AI in Settings to enable thesis analysis</p>
      </div>
    )
  }

  // No contributions state
  if (contributions.length === 0) {
    return (
      <div className={clsx('bg-gray-50 border border-gray-200 rounded-lg p-6 text-center', className)}>
        <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No contributions yet</p>
        <p className="text-xs text-gray-400 mt-1">Add your view to start building the analysis</p>
      </div>
    )
  }

  // No analysis yet - prompt to generate
  if (!analysis) {
    return (
      <div className={clsx('bg-white border border-gray-200 rounded-lg p-6 text-center', className)}>
        <Sparkles className="w-8 h-8 text-purple-400 mx-auto mb-2" />
        <p className="text-sm text-gray-700 font-medium">Ready to Analyze</p>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          Generate an AI-powered analysis of {contributions.length} contribution{contributions.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={onRegenerate}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate Analysis
            </>
          )}
        </button>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={clsx('bg-red-50 border border-red-200 rounded-lg p-4', className)}>
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="w-4 h-4" />
          <p className="text-sm font-medium">Analysis Error</p>
        </div>
        <p className="text-xs text-red-600 mt-1">{error.message}</p>
        <button
          onClick={() => onRegenerate(aggregationMethod)}
          className="mt-3 text-xs text-red-700 underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Toolbar */}
      <AggregationToolbar
        method={aggregationMethod}
        onMethodChange={handleMethodChange}
        showCombined={showCombined}
        onToggleCombined={() => setShowCombined(!showCombined)}
        isStale={isStale}
        isGenerating={isGenerating}
        onRegenerate={() => onRegenerate(aggregationMethod)}
        analystCount={contributions.length}
      />

      {/* Executive Summary + Sentiment Meter */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ExecutiveSummary
            summary={analysis.executiveSummary}
            sentiment={analysis.overallSentiment}
            analystCount={analysis.contributionCount}
            generatedAt={analysis.generatedAt}
          />
        </div>
        <div>
          <SentimentMeter breakdown={analysis.sentimentBreakdown} />
        </div>
      </div>

      {/* Consensus Cards */}
      <ConsensusCards
        consensusPoints={analysis.consensusPoints}
        divergentViews={analysis.divergentViews}
        keyCatalysts={analysis.keyCatalysts}
      />

      {/* Key Themes */}
      {analysis.keyCatalysts.length > 0 && (
        <KeyThemes themes={analysis.keyCatalysts} />
      )}

      {/* Analyst Comparison Table */}
      {analysis.analystSentiments.length > 0 && (
        <ComparisonTable analysts={analysis.analystSentiments} />
      )}

      {/* Progressive Disclosure - Individual Views */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowIndividualViews(!showIndividualViews)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <span className="text-sm font-medium text-gray-700">Individual Views</span>
          {showIndividualViews ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>
        {showIndividualViews && (
          <div className="p-4 space-y-4 bg-white">
            {contributions.map((c) => {
              const isCovering = coveringAnalystIds.has(c.created_by)
              return (
                <div key={c.id} className="text-gray-700 leading-relaxed">
                  <span className="font-medium text-gray-900 inline-flex items-center gap-1">
                    {isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                    {c.user?.full_name}:
                  </span>{' '}
                  <span className="text-sm">{c.content}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
