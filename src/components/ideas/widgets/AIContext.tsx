import React from 'react'
import { clsx } from 'clsx'
import { Bot, TrendingUp, TrendingDown, Minus, Sparkles, AlertTriangle, Lightbulb } from 'lucide-react'

type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'mixed'
type Confidence = 'high' | 'medium' | 'low'

interface AIContextProps {
  summary?: string
  sentiment?: Sentiment
  confidence?: Confidence
  keyPoints?: string[]
  isLoading?: boolean
  className?: string
}

const sentimentConfig: Record<Sentiment, { icon: typeof TrendingUp; label: string; color: string; bg: string }> = {
  bullish: { icon: TrendingUp, label: 'Bullish', color: 'text-green-600', bg: 'bg-green-50' },
  bearish: { icon: TrendingDown, label: 'Bearish', color: 'text-red-600', bg: 'bg-red-50' },
  neutral: { icon: Minus, label: 'Neutral', color: 'text-gray-600', bg: 'bg-gray-50' },
  mixed: { icon: AlertTriangle, label: 'Mixed', color: 'text-amber-600', bg: 'bg-amber-50' }
}

const confidenceConfig: Record<Confidence, { label: string; color: string }> = {
  high: { label: 'High confidence', color: 'text-green-600' },
  medium: { label: 'Medium confidence', color: 'text-amber-600' },
  low: { label: 'Low confidence', color: 'text-gray-500' }
}

export function AIContext({
  summary,
  sentiment = 'neutral',
  confidence = 'medium',
  keyPoints = [],
  isLoading = false,
  className
}: AIContextProps) {
  const sentimentInfo = sentimentConfig[sentiment]
  const SentimentIcon = sentimentInfo.icon
  const confidenceInfo = confidenceConfig[confidence]

  if (isLoading) {
    return (
      <div className={clsx(
        'p-3 bg-gradient-to-br from-cyan-50 to-blue-50 rounded-lg border border-cyan-100',
        className
      )}>
        <div className="flex items-center gap-2 mb-2">
          <Bot className="h-4 w-4 text-cyan-600 animate-pulse" />
          <span className="text-sm font-medium text-cyan-700">AI analyzing...</span>
        </div>
        <div className="space-y-2 animate-pulse">
          <div className="h-4 bg-cyan-100 rounded w-3/4" />
          <div className="h-4 bg-cyan-100 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!summary && keyPoints.length === 0) {
    return null
  }

  return (
    <div className={clsx(
      'p-3 bg-gradient-to-br from-cyan-50 to-blue-50 rounded-lg border border-cyan-100',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-cyan-100 rounded">
            <Bot className="h-3.5 w-3.5 text-cyan-600" />
          </div>
          <span className="text-sm font-medium text-cyan-700">AI Context</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Sentiment badge */}
          <span className={clsx(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
            sentimentInfo.bg, sentimentInfo.color
          )}>
            <SentimentIcon className="h-3 w-3" />
            {sentimentInfo.label}
          </span>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-sm text-gray-700 mb-2">
          {summary}
        </p>
      )}

      {/* Key points */}
      {keyPoints.length > 0 && (
        <div className="space-y-1">
          {keyPoints.map((point, index) => (
            <div key={index} className="flex items-start gap-2 text-xs text-gray-600">
              <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
              <span>{point}</span>
            </div>
          ))}
        </div>
      )}

      {/* Confidence */}
      <div className="mt-2 pt-2 border-t border-cyan-100">
        <span className={clsx('text-xs', confidenceInfo.color)}>
          {confidenceInfo.label}
        </span>
      </div>
    </div>
  )
}

// Generate AI context for an item (placeholder - would connect to AI service)
export function useAIContext(content: string, _enabled = true) {
  // This would normally call an AI service to generate context
  // For now, return a simple analysis based on keywords

  const hasPositive = /bullish|buy|growth|increase|gain|up|positive|strong/i.test(content)
  const hasNegative = /bearish|sell|decline|decrease|loss|down|negative|weak/i.test(content)

  let sentiment: Sentiment = 'neutral'
  if (hasPositive && hasNegative) sentiment = 'mixed'
  else if (hasPositive) sentiment = 'bullish'
  else if (hasNegative) sentiment = 'bearish'

  return {
    sentiment,
    confidence: 'medium' as Confidence,
    summary: content.length > 100 ? content.substring(0, 100) + '...' : undefined,
    keyPoints: [],
    isLoading: false
  }
}

export default AIContext
