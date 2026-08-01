import { clsx } from 'clsx'
import {
  GitCompareArrows, LineChart, PlusCircle, Share2, TrendingDown, TrendingUp,
} from 'lucide-react'
import { useIdeaReactions } from '../../hooks/ideas/useIdeaReactions'
import type { ItemType } from '../../hooks/ideas/types'

interface MobileFeedActionRailProps {
  itemId: string
  itemType: ItemType
  /** Absent when the item has no associated asset — chart action is hidden. */
  symbol?: string | null
  onOpenChart?: () => void
  onShare?: () => void
  onCreateIdea?: () => void
  onReadthrough?: () => void
}

/**
 * Vertical action rail over a full-screen feed item.
 *
 * Right-edge placement is deliberate: it sits under the thumb on a phone and
 * leaves the card content unobstructed, and it keeps every action reachable
 * without leaving the post — the interaction model the feed is built around.
 *
 * Bullish/bearish write to the existing `idea_reactions` table via
 * useIdeaReactions, so signals marked here show up everywhere reactions
 * already do rather than becoming a mobile-only side channel.
 */
export function MobileFeedActionRail({
  itemId,
  itemType,
  symbol,
  onOpenChart,
  onShare,
  onCreateIdea,
  onReadthrough,
}: MobileFeedActionRailProps) {
  const { reactionCounts, toggleReaction, isToggling } = useIdeaReactions(itemId, itemType)

  const bullish = reactionCounts?.bullish ?? { count: 0, hasReacted: false }
  const bearish = reactionCounts?.bearish ?? { count: 0, hasReacted: false }

  return (
    <div className="absolute right-2 bottom-24 z-40 flex flex-col items-center gap-1 pb-safe">
      <RailButton
        icon={TrendingUp}
        label="Bullish"
        count={bullish.count}
        active={bullish.hasReacted}
        activeClass="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300"
        disabled={isToggling}
        onClick={() => toggleReaction('bullish')}
      />
      <RailButton
        icon={TrendingDown}
        label="Bearish"
        count={bearish.count}
        active={bearish.hasReacted}
        activeClass="text-red-600 bg-red-100 dark:bg-red-900/40 dark:text-red-300"
        disabled={isToggling}
        onClick={() => toggleReaction('bearish')}
      />
      {onReadthrough && (
        <RailButton icon={GitCompareArrows} label="Readthrough" onClick={onReadthrough} />
      )}
      {symbol && onOpenChart && (
        <RailButton icon={LineChart} label="Chart" onClick={onOpenChart} />
      )}
      {onShare && <RailButton icon={Share2} label="Share" onClick={onShare} />}
      {onCreateIdea && (
        <RailButton
          icon={PlusCircle}
          label="Idea"
          activeClass="text-primary-700 bg-primary-100"
          active
          onClick={onCreateIdea}
        />
      )}
    </div>
  )
}

function RailButton({
  icon: Icon,
  label,
  count,
  active = false,
  activeClass,
  disabled = false,
  onClick,
}: {
  icon: typeof TrendingUp
  label: string
  count?: number
  active?: boolean
  activeClass?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className="flex flex-col items-center gap-0.5 w-14 py-1.5 disabled:opacity-50 no-touch-target"
    >
      <span
        className={clsx(
          'flex items-center justify-center h-11 w-11 rounded-full transition-colors',
          'bg-white/85 dark:bg-gray-800/85 backdrop-blur shadow-sm ring-1 ring-black/5',
          active && activeClass
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 leading-none">
        {count && count > 0 ? count : label}
      </span>
    </button>
  )
}
