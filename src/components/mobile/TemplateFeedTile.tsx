import { clsx } from 'clsx'
import {
  ArrowRight, Activity, Scale, CalendarClock, BarChart3, Landmark, Coins,
} from 'lucide-react'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { FeedTileHeader } from './FeedTileHeader'
import { FeedTileTitle } from './FeedTileTitle'
import { ExpandableText } from './ExpandableText'
import type { TemplateCard, TemplateKind } from '../../lib/mobile/feed-templates'

interface TemplateFeedTileProps {
  card: TemplateCard
  onAssetClick?: (assetId: string, symbol: string) => void
  onCapture?: () => void
  /** Tapping the category chip narrows the feed to market-event cards. */
  onFilterKind?: () => void
}

const CONFIG: Record<TemplateKind, { icon: typeof Activity; label: string; chip: string }> = {
  unusual_move: {
    icon: Activity, label: 'Unusual move',
    chip: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
  },
  active_risk: {
    icon: Scale, label: 'Active risk',
    chip: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
  },
  earnings_ahead: {
    icon: CalendarClock, label: 'Earnings ahead',
    chip: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800',
  },
  earnings_result: {
    icon: BarChart3, label: 'Earnings result',
    chip: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  },
  corporate_action: {
    icon: Coins, label: 'Corporate action',
    chip: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  },
  economic: {
    icon: Landmark, label: 'Economic',
    chip: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
}

/**
 * Renders any of the derived content templates in the feed's shape.
 *
 * One component rather than six: the templates differ in what they compute,
 * not in how they read — every one is a claim, a number behind it, and a
 * reason it is worth your attention. Six near-identical tile files would drift
 * apart within a month.
 *
 * The chart appears only when the card is about a specific name. Economic
 * prints have no ticker, and rendering an empty chart frame under them would
 * imply one exists.
 */
export function TemplateFeedTile({ card, onAssetClick, onCapture, onFilterKind }: TemplateFeedTileProps) {
  const config = CONFIG[card.kind]
  const Icon = config.icon
  const toneClass =
    card.tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400'
    : card.tone === 'negative' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-white'

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      <FeedTileHeader
        badge={
          <button
            type="button"
            onClick={onFilterKind}
            disabled={!onFilterKind}
            title="Show only market events"
            className={clsx('flex shrink-0 items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap no-touch-target disabled:cursor-default', config.chip)}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {config.label}
          </button>
        }
        headline={card.headline}
      />

      <FeedTileTitle quoteSymbol={card.symbol ?? undefined} />

      {card.symbol && (
        <div className="flex-shrink-0 h-[33%] min-h-[170px] max-h-[300px] px-3">
          <ReelsChartPanel symbol={card.symbol} hideHeader />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden px-3 py-2">
        {/* The number leads on a card whose whole point is a number. */}
        {card.metric && (
          <div className="mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {card.metricLabel ?? 'Metric'}
            </div>
            <div className={clsx('text-2xl font-bold tabular-nums leading-tight', toneClass)}>
              {card.metric}
            </div>
          </div>
        )}

        <ExpandableText text={card.body} lines={5} />
      </div>

      <div className="flex-shrink-0 flex items-stretch gap-2 px-3 py-2 pb-safe border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onCapture}
          className="flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-gray-300 dark:border-gray-600 font-semibold text-gray-700 dark:text-gray-200 no-touch-target"
        >
          Capture
        </button>
        <button
          type="button"
          disabled={!card.assetId || !card.symbol}
          onClick={() => card.assetId && card.symbol && onAssetClick?.(card.assetId, card.symbol)}
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary-600 text-white font-semibold disabled:opacity-40 no-touch-target"
        >
          {card.symbol ? `Open ${card.symbol}` : 'No linked asset'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
