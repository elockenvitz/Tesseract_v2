/**
 * SignalFeedCard — System-generated signal card.
 *
 * Visually distinct: gradient bg, no white shell, strong headline,
 * chart-forward, clear consequence framing.
 * These are the "stop and look" interruptions in the feed.
 */

import React from 'react'
import { clsx } from 'clsx'
import { Zap, AlertTriangle, Users, Clock, Eye } from 'lucide-react'
import type { SignalCard, SignalType } from '../../../hooks/ideas/useIdeasFeed'
import { FeedChart } from './FeedChart'

const SIGNAL_CONFIG: Record<SignalType, {
  icon: React.ElementType
  gradient: string
  border: string
  badge: string
  label: string
}> = {
  attention_cluster: {
    icon: Users,
    gradient: 'from-blue-50 via-blue-50/50 to-white',
    border: 'border-blue-200',
    badge: 'bg-blue-600 text-white',
    label: 'Trending',
  },
  conflict: {
    icon: AlertTriangle,
    gradient: 'from-amber-50 via-amber-50/50 to-white',
    border: 'border-amber-200',
    badge: 'bg-amber-600 text-white',
    label: 'Debate',
  },
  stale_coverage: {
    icon: Clock,
    gradient: 'from-red-50 via-red-50/50 to-white',
    border: 'border-red-200',
    badge: 'bg-red-600 text-white',
    label: 'Attention',
  },
  catalyst_proximity: {
    icon: Zap,
    gradient: 'from-purple-50 via-purple-50/50 to-white',
    border: 'border-purple-200',
    badge: 'bg-purple-600 text-white',
    label: 'Catalyst',
  },
  prompt: {
    icon: Eye,
    gradient: 'from-teal-50 via-teal-50/50 to-white',
    border: 'border-teal-200',
    badge: 'bg-teal-600 text-white',
    label: 'Review',
  },
}

interface SignalFeedCardProps {
  signal: SignalCard
  onAssetClick?: (assetId: string, symbol: string) => void
  onCardClick?: (signal: SignalCard) => void
  onExpandChart?: (symbol: string) => void
}

export const SignalFeedCard = React.memo(function SignalFeedCard({
  signal,
  onAssetClick,
  onCardClick,
  onExpandChart,
}: SignalFeedCardProps) {
  const config = SIGNAL_CONFIG[signal.signalType] || SIGNAL_CONFIG.attention_cluster
  const Icon = config.icon
  const primaryAsset = signal.relatedAssets[0]

  return (
    <div
      onClick={() => onCardClick?.(signal)}
      className={clsx(
        'rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg border',
        `bg-gradient-to-b ${config.gradient}`,
        config.border,
      )}
    >
      {/* Signal badge + headline — single row */}
      <div className="px-4 pt-3 pb-1.5 flex items-start gap-2.5">
        <span className={clsx('inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5', config.badge)}>
          <Zap className="w-2.5 h-2.5" />
          {config.label}
        </span>
        <h3 className="text-[15px] font-bold text-gray-900 leading-snug tracking-tight">
          {signal.headline}
        </h3>
      </div>

      {/* Chart — full bleed */}
      {primaryAsset && (
        <FeedChart symbol={primaryAsset.symbol} height={150} defaultTimeframe="1M" onExpand={onExpandChart} />
      )}

      {/* Consequence line + metric */}
      <div className="px-4 pt-2 pb-3.5">
        <p className="text-[12px] text-gray-600 leading-relaxed mb-3">{signal.body}</p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {signal.relatedAssets.map(a => (
              <button key={a.id} onClick={e => { e.stopPropagation(); onAssetClick?.(a.id, a.symbol) }}
                className="text-[11px] font-bold text-primary-700 bg-white hover:bg-primary-50 px-2 py-0.5 rounded border border-primary-200 transition-colors">
                ${a.symbol}
              </button>
            ))}
          </div>
          {signal.metric && (
            <div className="flex items-center gap-1.5">
              <Icon className="w-4 h-4 text-gray-400" />
              <span className="text-[18px] font-black text-gray-900 tabular-nums leading-none">{signal.metric}</span>
              {signal.metricLabel && <span className="text-[9px] text-gray-400 leading-none">{signal.metricLabel}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
