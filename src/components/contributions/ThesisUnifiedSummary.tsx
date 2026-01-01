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
  GitBranch,
  AlertTriangle
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Contribution } from '../../hooks/useContributions'
import { useUnifiedThesisAnalysis, AggregationMethod } from '../../hooks/useContributions'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type Sentiment = 'bullish' | 'neutral' | 'bearish'

interface UnifiedThesisAnalysis {
  executiveSummary: string
  overallSentiment: Sentiment
  sentimentBreakdown: {
    bullish: number
    neutral: number
    bearish: number
  }
  thesisSummary: string
  differentiatorsSummary: string
  risksSummary: string
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

interface ThesisUnifiedSummaryProps {
  assetId: string
  viewFilter: 'aggregated' | string
  thesisContributions: Contribution[]
  whereDiffContributions: Contribution[]
  risksContributions: Contribution[]
  coveringAnalystIds: Set<string>
  className?: string
}

// ============================================================================
// SIMPLE FALLBACK VIEW (No AI) - Condensed narrative format
// ============================================================================

interface SimpleSummaryProps {
  thesisContributions: Contribution[]
  whereDiffContributions: Contribution[]
  risksContributions: Contribution[]
  coveringAnalystIds: Set<string>
  viewFilter: 'aggregated' | string
}

// Helper to truncate text to first N sentences
function truncateToSentences(text: string, maxSentences: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]
  if (sentences.length <= maxSentences) return text
  return sentences.slice(0, maxSentences).join('').trim() + '...'
}

// Helper to get analyst display name
function getAnalystName(c: Contribution): string {
  if (c.user?.first_name && c.user?.last_name) {
    return `${c.user.first_name[0]}. ${c.user.last_name}`
  }
  return c.user?.full_name || 'Unknown'
}

function SimpleSummaryView({
  thesisContributions,
  whereDiffContributions,
  risksContributions,
  coveringAnalystIds,
  viewFilter
}: SimpleSummaryProps) {
  // Filter contributions based on viewFilter
  const filterContributions = (contributions: Contribution[]) => {
    if (viewFilter === 'aggregated') return contributions
    return contributions.filter(c => c.created_by === viewFilter)
  }

  const filteredThesis = filterContributions(thesisContributions)
  const filteredDiff = filterContributions(whereDiffContributions)
  const filteredRisks = filterContributions(risksContributions)

  const hasContent = filteredThesis.length > 0 || filteredDiff.length > 0 || filteredRisks.length > 0

  // Get covering analyst thesis (prioritized)
  const coveringThesis = filteredThesis.filter(c => coveringAnalystIds.has(c.created_by))
  const primaryThesis = coveringThesis.length > 0 ? coveringThesis[0] : filteredThesis[0]

  if (!hasContent) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No contributions to summarize</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Combined Narrative Card */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Primary Thesis Highlight */}
        {primaryThesis && (
          <div className="p-4 bg-primary-50 border-b border-primary-100">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-primary-600" />
              <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">Core Thesis</span>
              {coveringAnalystIds.has(primaryThesis.created_by) && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">
                  <Star className="w-2.5 h-2.5 fill-yellow-500" />
                  Covering
                </span>
              )}
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">
              {truncateToSentences(primaryThesis.content, 3)}
            </p>
            <p className="text-xs text-gray-500 mt-2">- {getAnalystName(primaryThesis)}</p>
          </div>
        )}

        {/* Section Summaries */}
        <div className="p-4 space-y-4">
          {/* Thesis Points */}
          {filteredThesis.length > 1 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-3.5 h-3.5 text-primary-600" />
                <span className="text-xs font-semibold text-gray-700">Other Thesis Views ({filteredThesis.length - 1})</span>
              </div>
              <ul className="space-y-1.5 pl-5">
                {filteredThesis.slice(1).map((c) => (
                  <li key={c.id} className="text-xs text-gray-600 leading-relaxed">
                    <span className="font-medium text-gray-700">{getAnalystName(c)}:</span>{' '}
                    {truncateToSentences(c.content, 2)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Differentiators */}
          {filteredDiff.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-xs font-semibold text-gray-700">Where We're Different ({filteredDiff.length})</span>
              </div>
              <ul className="space-y-1.5 pl-5">
                {filteredDiff.map((c) => (
                  <li key={c.id} className="text-xs text-gray-600 leading-relaxed">
                    <span className="font-medium text-gray-700">{getAnalystName(c)}:</span>{' '}
                    {truncateToSentences(c.content, 2)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {filteredRisks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold text-gray-700">Key Risks ({filteredRisks.length})</span>
              </div>
              <ul className="space-y-1.5 pl-5">
                {filteredRisks.map((c) => (
                  <li key={c.id} className="text-xs text-gray-600 leading-relaxed">
                    <span className="font-medium text-gray-700">{getAnalystName(c)}:</span>{' '}
                    {truncateToSentences(c.content, 2)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// ============================================================================
// AGGREGATION TOOLBAR
// ============================================================================

interface AggregationToolbarProps {
  method: AggregationMethod
  onMethodChange: (method: AggregationMethod) => void
  isStale: boolean
  isGenerating: boolean
  onRegenerate: () => void
  analystCount: number
}

function AggregationToolbar({
  method,
  onMethodChange,
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
    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg">
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
// EXECUTIVE SUMMARY
// ============================================================================

interface ExecutiveSummaryProps {
  summary: string
  sentiment: Sentiment
  thesisSummary: string
  differentiatorsSummary: string
  risksSummary: string
  analystCount: number
  generatedAt: string
}

function ExecutiveSummary({
  summary,
  sentiment,
  thesisSummary,
  differentiatorsSummary,
  risksSummary,
  analystCount,
  generatedAt
}: ExecutiveSummaryProps) {
  const sentimentConfig = {
    bullish: { icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', label: 'Bullish' },
    neutral: { icon: Minus, color: 'text-gray-600', bg: 'bg-gray-100', label: 'Neutral' },
    bearish: { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', label: 'Bearish' }
  }

  const config = sentimentConfig[sentiment]
  const Icon = config.icon

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          <h4 className="text-base font-semibold text-gray-900">Unified Thesis Summary</h4>
        </div>
        <div className={clsx('flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium', config.bg, config.color)}>
          <Icon className="w-3 h-3" />
          {config.label}
        </div>
      </div>

      {/* Executive Summary */}
      <p className="text-sm text-gray-700 leading-relaxed mb-5">{summary}</p>

      {/* Section Summaries */}
      <div className="space-y-4 border-t border-gray-100 pt-4">
        {/* Thesis */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-3.5 h-3.5 text-primary-600" />
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Investment Thesis</span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed pl-5">{thesisSummary}</p>
        </div>

        {/* Differentiators */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Where We're Different</span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed pl-5">{differentiatorsSummary}</p>
        </div>

        {/* Risks */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Key Risks</span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed pl-5">{risksSummary}</p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-400">
        <span>{analystCount} analyst{analystCount !== 1 ? 's' : ''}</span>
        <span>-</span>
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

  const size = 80
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">Sentiment Distribution</h4>
      <div className="flex items-center gap-4">
        <div className="relative">
          <svg width={size} height={size} className="transform -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
            {bullishPct > 0 && (
              <circle
                cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#22c55e" strokeWidth={strokeWidth}
                strokeDasharray={circumference} strokeDashoffset={circumference * (1 - bullishPct / 100)} strokeLinecap="round"
              />
            )}
            {neutralPct > 0 && (
              <circle
                cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#9ca3af" strokeWidth={strokeWidth}
                strokeDasharray={`${(neutralPct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-bullishPct / 100 * circumference} strokeLinecap="round"
              />
            )}
            {bearishPct > 0 && (
              <circle
                cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#ef4444" strokeWidth={strokeWidth}
                strokeDasharray={`${(bearishPct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-(bullishPct + neutralPct) / 100 * circumference} strokeLinecap="round"
              />
            )}
          </svg>
        </div>
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
// CONSENSUS CARDS
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
                <span className="text-green-500 mt-0.5">-</span>
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
  analysts: {
    analystId: string
    name: string
    isCovering: boolean
    sentiment: Sentiment
    keyPoint: string
    updatedAt: string
  }[]
}

function ComparisonTable({ analysts }: ComparisonTableProps) {
  const sentimentConfig = {
    bullish: { color: 'text-green-600', bg: 'bg-green-50' },
    neutral: { color: 'text-gray-600', bg: 'bg-gray-100' },
    bearish: { color: 'text-red-600', bg: 'bg-red-50' }
  }

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
                      {analyst.isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
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
// INDIVIDUAL VIEWS DROPDOWN
// ============================================================================

interface IndividualViewsProps {
  thesisContributions: Contribution[]
  whereDiffContributions: Contribution[]
  risksContributions: Contribution[]
  coveringAnalystIds: Set<string>
  viewFilter: 'aggregated' | string
}

function IndividualViews({
  thesisContributions,
  whereDiffContributions,
  risksContributions,
  coveringAnalystIds,
  viewFilter
}: IndividualViewsProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const filterContributions = (contributions: Contribution[]) => {
    if (viewFilter === 'aggregated') return contributions
    return contributions.filter(c => c.created_by === viewFilter)
  }

  const filteredThesis = filterContributions(thesisContributions)
  const filteredDiff = filterContributions(whereDiffContributions)
  const filteredRisks = filterContributions(risksContributions)

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-medium text-gray-700">Individual Views</span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {isExpanded && (
        <div className="p-4 space-y-6 bg-white">
          {filteredThesis.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-3.5 h-3.5 text-primary-600" />
                <span className="text-xs font-semibold text-gray-700">Investment Thesis</span>
              </div>
              {filteredThesis.map((c) => {
                const isCovering = coveringAnalystIds.has(c.created_by)
                return (
                  <div key={c.id} className="text-sm text-gray-700 leading-relaxed mb-2">
                    <span className="font-medium text-gray-900 inline-flex items-center gap-1">
                      {isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                      {c.user?.full_name}:
                    </span>{' '}
                    {c.content}
                  </div>
                )
              })}
            </div>
          )}
          {filteredDiff.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-xs font-semibold text-gray-700">Where We're Different</span>
              </div>
              {filteredDiff.map((c) => {
                const isCovering = coveringAnalystIds.has(c.created_by)
                return (
                  <div key={c.id} className="text-sm text-gray-700 leading-relaxed mb-2">
                    <span className="font-medium text-gray-900 inline-flex items-center gap-1">
                      {isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                      {c.user?.full_name}:
                    </span>{' '}
                    {c.content}
                  </div>
                )
              })}
            </div>
          )}
          {filteredRisks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold text-gray-700">Risks</span>
              </div>
              {filteredRisks.map((c) => {
                const isCovering = coveringAnalystIds.has(c.created_by)
                return (
                  <div key={c.id} className="text-sm text-gray-700 leading-relaxed mb-2">
                    <span className="font-medium text-gray-900 inline-flex items-center gap-1">
                      {isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                      {c.user?.full_name}:
                    </span>{' '}
                    {c.content}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ThesisUnifiedSummary({
  assetId,
  viewFilter,
  thesisContributions,
  whereDiffContributions,
  risksContributions,
  coveringAnalystIds,
  className
}: ThesisUnifiedSummaryProps) {
  // Use the unified analysis hook
  const {
    analysis,
    isLoading,
    isGenerating,
    isStale,
    isConfigured,
    error,
    generateAnalysis
  } = useUnifiedThesisAnalysis({
    assetId,
    thesisContributions,
    whereDiffContributions,
    risksContributions,
    coveringAnalystIds
  })

  // Load persisted preferences
  const storageKey = `thesis-unified-prefs-${assetId}`
  const [aggregationMethod, setAggregationMethod] = useState<AggregationMethod>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return JSON.parse(saved).method || 'equal'
    } catch {}
    return 'equal'
  })
  const hasAutoGenerated = useRef(false)

  // Persist preferences
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ method: aggregationMethod }))
    } catch {}
  }, [aggregationMethod, storageKey])

  // Get unique analyst count
  const uniqueAnalysts = useMemo(() => {
    const ids = new Set<string>()
    ;[...thesisContributions, ...whereDiffContributions, ...risksContributions].forEach(c => ids.add(c.created_by))
    return ids.size
  }, [thesisContributions, whereDiffContributions, risksContributions])

  // Auto-generate on first view
  useEffect(() => {
    if (
      !hasAutoGenerated.current &&
      !analysis &&
      !isLoading &&
      !isGenerating &&
      isConfigured &&
      uniqueAnalysts > 0
    ) {
      hasAutoGenerated.current = true
      generateAnalysis(aggregationMethod)
    }
  }, [analysis, isLoading, isGenerating, isConfigured, uniqueAnalysts, generateAnalysis, aggregationMethod])

  // If AI not configured, show simple view
  if (!isConfigured) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600 flex-shrink-0" />
          <p className="text-sm text-purple-700">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('openSettings'))}
              className="font-medium hover:underline"
            >
              Enable AI for richer insights
            </button>
            <span className="text-purple-600"> — Configure AI in{' '}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('openSettings'))}
                className="font-medium hover:underline"
              >
                Settings
              </button>
              {' '}for sentiment analysis, consensus points, and auto-generated summaries.
            </span>
          </p>
        </div>
        <SimpleSummaryView
          thesisContributions={thesisContributions}
          whereDiffContributions={whereDiffContributions}
          risksContributions={risksContributions}
          coveringAnalystIds={coveringAnalystIds}
          viewFilter={viewFilter}
        />
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
        <div className="h-48 bg-gray-100 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  // No contributions state
  if (uniqueAnalysts === 0) {
    return (
      <div className={clsx('bg-gray-50 border border-gray-200 rounded-lg p-6 text-center', className)}>
        <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No contributions yet</p>
        <p className="text-xs text-gray-400 mt-1">Add your view to start building the analysis</p>
      </div>
    )
  }

  // Generating state (no analysis yet)
  if (!analysis && isGenerating) {
    return (
      <div className={clsx('bg-white border border-gray-200 rounded-lg p-8 text-center', className)}>
        <Loader2 className="w-8 h-8 text-primary-500 mx-auto mb-3 animate-spin" />
        <p className="text-sm text-gray-700 font-medium">Analyzing Contributions</p>
        <p className="text-xs text-gray-500 mt-1">Synthesizing views from {uniqueAnalysts} analyst{uniqueAnalysts !== 1 ? 's' : ''}...</p>
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
          Generate a unified AI analysis of all thesis sections
        </p>
        <button
          onClick={() => generateAnalysis(aggregationMethod)}
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
      <div className={clsx('space-y-4', className)}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-4 h-4" />
            <p className="text-sm font-medium">Analysis Error</p>
          </div>
          <p className="text-xs text-red-600 mt-1">{error.message}</p>
          <button
            onClick={() => generateAnalysis(aggregationMethod)}
            className="mt-3 text-xs text-red-700 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
        <SimpleSummaryView
          thesisContributions={thesisContributions}
          whereDiffContributions={whereDiffContributions}
          risksContributions={risksContributions}
          coveringAnalystIds={coveringAnalystIds}
          viewFilter={viewFilter}
        />
      </div>
    )
  }

  // Main render with analysis
  return (
    <div className={clsx('space-y-4', className)}>
      {/* Toolbar */}
      <AggregationToolbar
        method={aggregationMethod}
        onMethodChange={setAggregationMethod}
        isStale={isStale}
        isGenerating={isGenerating}
        onRegenerate={() => generateAnalysis(aggregationMethod)}
        analystCount={uniqueAnalysts}
      />

      {/* Executive Summary + Sentiment */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ExecutiveSummary
            summary={analysis.executiveSummary}
            sentiment={analysis.overallSentiment}
            thesisSummary={analysis.thesisSummary}
            differentiatorsSummary={analysis.differentiatorsSummary}
            risksSummary={analysis.risksSummary}
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

      {/* Analyst Comparison Table */}
      {analysis.analystSentiments.length > 0 && (
        <ComparisonTable analysts={analysis.analystSentiments} />
      )}

      {/* Individual Views (Progressive Disclosure) */}
      <IndividualViews
        thesisContributions={thesisContributions}
        whereDiffContributions={whereDiffContributions}
        risksContributions={risksContributions}
        coveringAnalystIds={coveringAnalystIds}
        viewFilter={viewFilter}
      />
    </div>
  )
}
