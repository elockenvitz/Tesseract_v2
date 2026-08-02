import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowRight, CalendarClock, Radar, Split, TimerReset,
} from 'lucide-react'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { TickerQuoteBadge } from './TickerQuoteBadge'
import type { SignalCard, SignalType } from '../../hooks/ideas/useIdeasFeed'

interface SignalFeedTileProps {
  signal: SignalCard
  onAssetClick?: (assetId: string, symbol: string) => void
}

const SIGNAL_CONFIG: Record<SignalType, { icon: typeof Radar; label: string; chip: string }> = {
  stale_coverage: {
    icon: TimerReset,
    label: 'Going stale',
    chip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  },
  attention_cluster: {
    icon: Radar,
    label: 'Team focus',
    chip: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  },
  conflict: {
    icon: Split,
    label: 'Disagreement',
    chip: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  },
  catalyst_proximity: {
    icon: CalendarClock,
    label: 'Catalyst near',
    chip: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800',
  },
  prompt: {
    icon: Radar,
    label: 'Signal',
    chip: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  },
}

/**
 * Signal cards in the same shape as decision and idea tiles.
 *
 * The shared SignalFeedCard is built for the desktop masonry grid — a compact
 * tile among many — so dropping it into a one-per-screen feed left it visibly
 * different from everything around it. This renders the same data in the
 * feed's structure: header band, chart, body, action row.
 *
 * Signals are observations rather than requests, so the action is navigation
 * to the asset rather than an accept/dismiss verb.
 */
export function SignalFeedTile({ signal, onAssetClick }: SignalFeedTileProps) {
  const config = SIGNAL_CONFIG[signal.signalType] ?? SIGNAL_CONFIG.prompt
  const Icon = config.icon
  const primary = signal.relatedAssets?.[0]

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border', config.chip)}>
          <Icon className="h-4 w-4" />
          {config.label}
        </span>
        {primary ? (
          <TickerQuoteBadge symbol={primary.symbol} className="ml-auto" />
        ) : signal.createdAt ? (
          <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">
            {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })}
          </span>
        ) : null}
      </div>

      {/* Headline leads, matching the decision card's instruction-first shape. */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1.5">
        <h2 className="text-xl font-bold leading-tight text-gray-900 dark:text-white">
          {signal.headline}
        </h2>
      </div>

      {primary && (
        <div className="flex-shrink-0 h-[50%] min-h-[250px] max-h-[400px] px-3">
          <ReelsChartPanel symbol={primary.symbol} hideHeader />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <p className="text-[15px] leading-relaxed text-gray-800 dark:text-gray-200">{signal.body}</p>

        {signal.metric && (
          <div className="mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">
              {signal.metricLabel ?? 'Metric'}
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">{signal.metric}</div>
          </div>
        )}

        {signal.relatedAssets?.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {signal.relatedAssets.slice(1, 5).map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAssetClick?.(a.id, a.symbol)}
                className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] dark:bg-gray-800 dark:text-gray-300 no-touch-target"
              >
                {a.symbol}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-stretch px-3 py-3 pb-safe border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => primary && onAssetClick?.(primary.id, primary.symbol)}
          disabled={!primary}
          className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-primary-600 text-white font-semibold disabled:opacity-40 no-touch-target"
        >
          {primary ? `Open ${primary.symbol}` : 'No linked asset'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
