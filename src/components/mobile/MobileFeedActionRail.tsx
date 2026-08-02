import { clsx } from 'clsx'
import { GitCompareArrows, MessageSquarePlus, PlusCircle, Share2, TrendingDown, TrendingUp } from 'lucide-react'
import { useIdeaReactions } from '../../hooks/ideas/useIdeaReactions'
import type { ItemType } from '../../hooks/ideas/types'

/** Height the feed card must leave clear for the bar. Exported so the caller
 *  insets its content by exactly this much instead of guessing. */
export const ACTION_BAR_HEIGHT = 64

interface MobileFeedActionRailProps {
  itemId: string
  itemType: ItemType
  onShare?: () => void
  onReadthrough?: () => void
  /** Turn a captured thought into a structured idea the team can evaluate.
   *  Only meaningful for quick thoughts, so the caller decides. */
  onPromote?: () => void
  /** Ask a colleague for input, carrying this item's asset as context. */
  onAsk?: () => void
  /** Fired on any reaction, so interest telemetry can record it. */
  onReact?: () => void
}

/**
 * Actions for the post currently on screen.
 *
 * A horizontal bar pinned to the bottom rather than a floating vertical rail:
 * the rail sat on top of the card and covered the text it was meant to act on.
 * A bar occupies its own reserved strip, so nothing overlaps and every action
 * still sits in the thumb zone.
 *
 * Bullish/bearish write to the existing `idea_reactions` table via
 * useIdeaReactions, so a signal marked here appears everywhere reactions
 * already do rather than becoming a mobile-only side channel.
 */
export function MobileFeedActionRail({
  itemId,
  itemType,
  onShare,
  onReadthrough,
  onPromote,
  onAsk,
  onReact,
}: MobileFeedActionRailProps) {
  const { reactionCounts, toggleReaction, isToggling } = useIdeaReactions(itemId, itemType)

  const bullish = reactionCounts?.bullish ?? { count: 0, hasReacted: false }
  const bearish = reactionCounts?.bearish ?? { count: 0, hasReacted: false }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1 px-2 pb-safe border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur"
      style={{ height: ACTION_BAR_HEIGHT }}
    >
      <BarButton
        icon={TrendingUp}
        label="Bullish"
        count={bullish.count}
        active={bullish.hasReacted}
        activeClass="text-emerald-600 dark:text-emerald-400"
        disabled={isToggling}
        onClick={() => { onReact?.(); toggleReaction('bullish') }}
      />
      <BarButton
        icon={TrendingDown}
        label="Bearish"
        count={bearish.count}
        active={bearish.hasReacted}
        activeClass="text-red-600 dark:text-red-400"
        disabled={isToggling}
        onClick={() => { onReact?.(); toggleReaction('bearish') }}
      />
      {onReadthrough && (
        <BarButton icon={GitCompareArrows} label="Read-thru" onClick={onReadthrough} />
      )}
      {onAsk && <BarButton icon={MessageSquarePlus} label="Ask" onClick={onAsk} />}
      {onShare && <BarButton icon={Share2} label="Share" onClick={onShare} />}
      {/* Promote is the strongest "move this forward" verb available, so it
          carries the accent when offered. */}
      {onPromote && (
        <BarButton icon={PlusCircle} label="Promote" activeClass="text-primary-600" active onClick={onPromote} />
      )}
    </div>
  )
}

function BarButton({
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
      className={clsx(
        'flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg disabled:opacity-50 no-touch-target',
        'active:bg-gray-100 dark:active:bg-gray-800 transition-colors',
        active ? activeClass : 'text-gray-500 dark:text-gray-400'
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[10px] font-medium leading-none">
        {count && count > 0 ? `${label} ${count}` : label}
      </span>
    </button>
  )
}
