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

/**
 * The tint each signal wears, in both themes.
 *
 * ── Why every entry carries a dark half ───────────────────────────────────
 *
 * These were light-only: `from-blue-50 … to-white` with no `dark:` variant,
 * under a headline set to `dark:text-white`. The app's dark mode is real and
 * class-based (`ThemeContext` stamps `.dark` on the root, `darkMode: 'class'`
 * in the Tailwind config), so in dark mode the card kept its near-white
 * gradient and painted white text on top of it. The headline — the whole point
 * of a signal card — was unreadable.
 *
 * The dark values are deliberately dim rather than mirrored. A 50-weight tint
 * inverted to a 900 is a block of saturated colour at full card width; these
 * sit at low opacity over the page background, so the hue still distinguishes
 * a Debate from an Attention card without the card becoming the brightest
 * thing on a dark screen.
 */
const SIGNAL_CONFIG: Record<SignalType, {
  icon: React.ElementType
  gradient: string
  border: string
  badge: string
  label: string
}> = {
  attention_cluster: {
    icon: Users,
    gradient: 'from-blue-50 via-blue-50/50 to-white dark:from-blue-500/15 dark:via-blue-500/5 dark:to-gray-900',
    border: 'border-blue-200 dark:border-blue-500/30',
    badge: 'bg-blue-600 text-white',
    label: 'Trending',
  },
  conflict: {
    icon: AlertTriangle,
    gradient: 'from-amber-50 via-amber-50/50 to-white dark:from-amber-500/15 dark:via-amber-500/5 dark:to-gray-900',
    border: 'border-amber-200 dark:border-amber-500/30',
    badge: 'bg-amber-600 text-white',
    label: 'Debate',
  },
  stale_coverage: {
    icon: Clock,
    gradient: 'from-red-50 via-red-50/50 to-white dark:from-red-500/15 dark:via-red-500/5 dark:to-gray-900',
    border: 'border-red-200 dark:border-red-500/30',
    badge: 'bg-red-600 text-white',
    label: 'Attention',
  },
  catalyst_proximity: {
    icon: Zap,
    gradient: 'from-purple-50 via-purple-50/50 to-white dark:from-purple-500/15 dark:via-purple-500/5 dark:to-gray-900',
    border: 'border-purple-200 dark:border-purple-500/30',
    badge: 'bg-purple-600 text-white',
    label: 'Catalyst',
  },
  prompt: {
    icon: Eye,
    gradient: 'from-teal-50 via-teal-50/50 to-white dark:from-teal-500/15 dark:via-teal-500/5 dark:to-gray-900',
    border: 'border-teal-200 dark:border-teal-500/30',
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
        <h3 className="text-[15px] font-bold text-gray-900 leading-snug tracking-tight dark:text-white">
          {signal.headline}
        </h3>
      </div>

      {/* Chart — full bleed */}
      {primaryAsset && (
        <FeedChart symbol={primaryAsset.symbol} height={150} defaultTimeframe="1M" onExpand={onExpandChart} />
      )}

      {/* Consequence line + metric */}
      <div className="px-4 pt-2 pb-3.5">
        <p className="text-[12px] text-gray-600 leading-relaxed mb-3 dark:text-gray-400">{signal.body}</p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {signal.relatedAssets.map(a => (
              <button key={a.id} onClick={e => { e.stopPropagation(); onAssetClick?.(a.id, a.symbol) }}
                className="text-[11px] font-bold text-primary-700 bg-white hover:bg-primary-50 px-2 py-0.5 rounded border border-primary-200 transition-colors dark:border-primary-500/40 dark:bg-gray-800 dark:text-primary-300 dark:hover:bg-gray-700">
                ${a.symbol}
              </button>
            ))}
          </div>
          {signal.metric && (
            <div className="flex items-center gap-1.5">
              <Icon className="w-4 h-4 text-gray-400" />
              <span className="text-[18px] font-black text-gray-900 tabular-nums leading-none dark:text-white">{signal.metric}</span>
              {signal.metricLabel && <span className="text-[9px] text-gray-400 leading-none">{signal.metricLabel}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
