import { ArrowRight, FileQuestion, PenLine, Scale, TimerReset } from 'lucide-react'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { FeedTileHeader } from './FeedTileHeader'
import { WhenNearViewport } from './WhenNearViewport'
import { FeedKindBadge } from './FeedKindBadge'
import { FeedTileTitle } from './FeedTileTitle'
import { ExpandableText } from './ExpandableText'
import type { DerivedInsight, DerivedInsightKind } from '../../hooks/mobile/useDerivedInsights'

interface DerivedInsightTileProps {
  insight: DerivedInsight
  onAssetClick?: (assetId: string, symbol: string) => void
  /** Log a thought, idea, recommendation or prompt from this tile. */
  onCapture?: (insight: DerivedInsight) => void
  /** Narrow the feed to this kind, set by tapping the type chip. */
  onFilterKind?: () => void
}

const KIND_CONFIG: Record<DerivedInsightKind, { icon: typeof Scale; label: string; chip: string }> = {
  stale_research: {
    icon: TimerReset,
    label: 'Going stale',
    chip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  },
  no_thesis: {
    icon: FileQuestion,
    label: 'No research',
    chip: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  },
  large_unreviewed: {
    icon: Scale,
    label: 'Large position',
    chip: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  },
  concentration: {
    icon: Scale,
    label: 'Concentration',
    chip: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  },
}

/**
 * A derived observation about a real position, in the feed's shape.
 *
 * Structurally identical to the decision, idea and signal tiles so the feed
 * reads as one surface. The distinguishing feature is that the body is a
 * statement of fact with the numbers in it, not a prompt — the user should be
 * able to check it against the book.
 */
export function DerivedInsightTile({ insight, onAssetClick, onCapture, onFilterKind }: DerivedInsightTileProps) {
  const config = KIND_CONFIG[insight.kind] ?? KIND_CONFIG.large_unreviewed
  const Icon = config.icon

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      {/* A bare "4.20%" in the corner said nothing — it could have been a price
          move, a target, anything. Ticker and price go there instead; the
          weight is stated in words in the body, where it has context. */}
      <FeedTileHeader
        badge={
          <FeedKindBadge
            icon={Icon}
            label={config.label}
            chip={config.chip}
            onFilter={onFilterKind}
            filterLabel="Show only insights"
          />
        }
        // No author, so the headline takes that space and the band below
        // belongs entirely to the quote.
        headline={insight.headline}
      />

      <FeedTileTitle
        quoteSymbol={insight.symbol}
        quoteCompanyName={insight.companyName}
      />
      <div className="flex-shrink-0 px-3">
        {insight.portfolioName && (
          <p className="mt-0.5 text-sm font-medium text-gray-600 dark:text-gray-300">
            {insight.portfolioName}
          </p>
        )}
      </div>

      <WhenNearViewport className="flex-shrink-0 h-[33%] min-h-[170px] max-h-[300px] px-3" placeholder={<div className="w-full h-full rounded-lg bg-gray-50 dark:bg-gray-800/50 animate-pulse" />}>
        <ReelsChartPanel symbol={insight.symbol} hideHeader />
      </WhenNearViewport>

      <div className="flex-1 min-h-0 overflow-hidden px-3 py-2">
        <ExpandableText text={insight.body} lines={4} />
      </div>

      <div className="flex-shrink-0 flex items-stretch gap-2 px-3 py-2 pb-safe border-t border-gray-200 dark:border-gray-700">
        <CaptureButton onCapture={onCapture ? () => onCapture(insight) : undefined} />
        <button
          type="button"
          onClick={() => onAssetClick?.(insight.assetId, insight.symbol)}
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary-600 text-white font-semibold no-touch-target"
        >
          Open {insight.symbol}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** Capture sits on every tile type, in the same place, so logging a thought
 *  never depends on which kind of post happens to be on screen. */
function CaptureButton({ onCapture }: { onCapture?: () => void }) {
  if (!onCapture) return null
  return (
    <button
      type="button"
      onClick={onCapture}
      className="flex flex-col items-center justify-center gap-0.5 w-14 rounded-xl text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
      aria-label="Capture a thought"
    >
      <PenLine className="h-5 w-5" />
      <span className="text-[10px] font-medium leading-none">Capture</span>
    </button>
  )
}
