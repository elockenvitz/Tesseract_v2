import { useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle, ArrowRight, BellOff, Check, Gavel, Info, PenLine, Share2, Users,
} from 'lucide-react'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { PairTradeChartCarousel } from '../feed/PairTradeChartCarousel'
import { FeedTileHeader } from './FeedTileHeader'
import { FeedKindBadge } from './FeedKindBadge'
import { WhenNearViewport } from './WhenNearViewport'
import { FeedTileTitle } from './FeedTileTitle'
import { ExpandablePanel } from './ExpandablePanel'
import { CarouselControls } from './CarouselControls'
import { useSwipe } from '../../hooks/useSwipe'
import { useDecisionContext } from '../../hooks/mobile/useDecisionContext'
import type { AttentionItem, AttentionType } from '../../types/attention'

interface AttentionFeedCardProps {
  item: AttentionItem
  /** Ticker for the linked asset, resolved by the caller in one batched query. */
  symbol?: string | null
  companyName?: string | null
  /** Every leg of the pair this item belongs to. Supplied when the feed has
   *  collapsed a multi-leg pair into a single card, so the tile can show the
   *  whole trade rather than the one leg that happened to raise the alert. */
  pairLegs?: Array<{ id: string; action?: string; pair_leg_type?: string | null; assets?: any }>
  onOpen?: (item: AttentionItem) => void
  onSnooze?: (item: AttentionItem) => void
  onAcknowledge?: (item: AttentionItem) => void
  onShare?: (item: AttentionItem) => void
  /** Log a thought, idea, recommendation or prompt against this item. */
  onCapture?: (item: AttentionItem) => void
  /** Narrow the feed to this kind, set by tapping the type chip. */
  onFilterKind?: () => void
}

const TYPE_CONFIG: Record<AttentionType, { icon: typeof Info; label: string; chip: string }> = {
  decision_required: {
    icon: Gavel,
    label: 'Decision needed',
    chip: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  },
  action_required: {
    icon: AlertTriangle,
    label: 'Action needed',
    chip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  },
  alignment: {
    icon: Users,
    label: 'Needs alignment',
    chip: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  },
  informational: {
    icon: Info,
    label: 'For information',
    chip: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  },
}

const ACTION_TONE: Record<string, string> = {
  sell: 'text-red-600 dark:text-red-400',
  trim: 'text-red-600 dark:text-red-400',
  buy: 'text-emerald-600 dark:text-emerald-400',
  add: 'text-emerald-600 dark:text-emerald-400',
}

/**
 * Full-screen card for something awaiting the user.
 *
 * Structured to match the idea cards — same header band, same chart block,
 * same bottom action bar — so the feed reads as one surface rather than two
 * systems interleaved.
 *
 * The instruction leads: "SELL DASH · Growth Fund" is what the user needs
 * before anything else, because the same verb means different things in
 * different books. Supporting detail moves into a swipeable panel below so
 * the chart can stay large enough to actually read.
 */
export function AttentionFeedCard({
  onFilterKind,
  item,
  symbol,
  companyName,
  pairLegs,
  onOpen,
  onSnooze,
  onAcknowledge,
  onShare,
  onCapture,
}: AttentionFeedCardProps) {
  const config = TYPE_CONFIG[item.attention_type] ?? TYPE_CONFIG.informational
  const TypeIcon = config.icon
  const isOverdue = !!item.due_at && new Date(item.due_at).getTime() < Date.now()
  const { data: decision } = useDecisionContext(item)

  // A pair is a relationship between names, so one chart misrepresents it.
  const isPair = (pairLegs?.filter(l => (l as any)?.assets?.symbol).length ?? 0) > 1
  const isLongLeg = (l: any) =>
    l.pair_leg_type === 'long' || (l.pair_leg_type == null && (l.action === 'buy' || l.action === 'add'))
  // Only legs with a resolved asset — the others have nothing to chart or name.
  const chartableLegs = (pairLegs ?? []).filter(l => (l as any)?.assets?.symbol)
  const longLegs = chartableLegs.filter(isLongLeg).map(l => ({ id: l.id, action: l.action, asset: l.assets }))
  const shortLegs = chartableLegs.filter(l => !isLongLeg(l)).map(l => ({ id: l.id, action: l.action, asset: l.assets }))

  const [panel, setPanel] = useState(0)

  // `title` arrives as "SELL DASH" — split so the verb can carry the tone
  // while the ticker stays neutral and dominant.
  const [verb, ...rest] = (item.title || '').split(' ')
  const ticker = rest.join(' ') || symbol || ''
  const tone = ACTION_TONE[(decision?.action || verb || '').toLowerCase()] ?? 'text-gray-900 dark:text-white'

  const panels: { key: string; label: string; body: React.ReactNode }[] = []

  if (item.source_type === 'trade_queue_item') {
    panels.push({
      key: 'recommendation',
      label: 'Recommendation',
      body: (
        <div className="space-y-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Weight
            </div>
            {decision?.proposedWeight != null ? (
              <div className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <span>{fmtPct(decision?.currentWeight)}</span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
                <span className={tone}>{fmtPct(decision.proposedWeight)}</span>
                {decision?.currentWeight != null && (
                  <span className="text-sm font-medium text-gray-500">
                    ({fmtDelta(decision.proposedWeight - decision.currentWeight)})
                  </span>
                )}
              </div>
            ) : (
              // Say the target is missing rather than showing an em-dash. It is
              // an optional field on the recommendation, and most are submitted
              // without it — the reviewer should know that is why there is no
              // number, not be left wondering whether it failed to load.
              <div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {decision?.currentWeight != null
                    ? `${fmtPct(decision.currentWeight)} today`
                    : 'Not currently held'}
                </div>
                <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                  No target weight was given with this recommendation.
                </p>
              </div>
            )}
          </div>
          {decision?.targetPrice != null && (
            <Row label="Target price" value={`$${decision.targetPrice.toFixed(2)}`} />
          )}
        </div>
      ),
    })
  }

  const rationale = decision?.rationale || item.preview
  if (rationale) {
    panels.push({
      key: 'rationale',
      label: 'Rationale',
      body: <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{rationale}</p>,
    })
  }

  panels.push({
    key: 'why',
    label: 'Why you',
    body: (
      <div className="space-y-3">
        {item.reason_text && (
          <p className="text-sm text-gray-700 dark:text-gray-300">{item.reason_text}</p>
        )}
        {item.next_action && <Row label="Next action" value={item.next_action} />}
        {item.due_at && (
          <p className={clsx('text-sm font-medium', isOverdue ? 'text-red-600 dark:text-red-400' : 'text-gray-500')}>
            {isOverdue ? 'Overdue — due ' : 'Due '}
            {formatDistanceToNow(new Date(item.due_at), { addSuffix: true })}
          </p>
        )}
      </div>
    ),
  })

  const activePanel = Math.min(panel, Math.max(0, panels.length - 1))

  // Swipe pages the supporting panels. Axis-locked, so a vertical drag started
  // here still pages the feed — the reason this was tap-only before.
  const panelSwipe = useSwipe({
    onNext: () => setPanel(i => Math.min(panels.length - 1, i + 1)),
    onPrevious: () => setPanel(i => Math.max(0, i - 1)),
    enabled: panels.length > 1,
  })

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      <FeedTileHeader
        badge={
          <FeedKindBadge
            icon={TypeIcon}
            label={config.label}
            chip={config.chip}
            onFilter={onFilterKind}
            filterLabel="Show only items needing attention"
          />
        }
        authorName={decision?.recommendedBy}
        timestamp={item.last_activity_at || item.created_at}
      />

      {/* The instruction, first and unmissable. A pair's legs each carry their
          own quote in the carousel; one here could only describe half the trade. */}
      <FeedTileTitle
        action={isPair ? null : (decision?.action || verb)}
        symbol={isPair ? null : ticker}
        longSymbols={longLegs.map(l => l.asset?.symbol).filter(Boolean) as string[]}
        shortSymbols={shortLegs.map(l => l.asset?.symbol).filter(Boolean) as string[]}
        subtitle={item.subtitle}
        quoteSymbol={isPair ? null : symbol}
        quoteCompanyName={companyName}
      />

      {(isPair || symbol) && (
        <div className={clsx("flex-shrink-0 px-3", isPair ? "h-[42%] min-h-[230px] max-h-[380px]" : "h-[33%] min-h-[170px] max-h-[300px]")}>
          <WhenNearViewport
            className="w-full h-full"
            placeholder={<div className="w-full h-full rounded-lg bg-gray-50 dark:bg-gray-800/50 animate-pulse" />}
          >
            {isPair ? (
              <PairTradeChartCarousel longLegs={longLegs as any} shortLegs={shortLegs as any} />
            ) : (
              <ReelsChartPanel symbol={symbol!} hideHeader />
            )}
          </WhenNearViewport>
        </div>
      )}

      {/* Supporting detail, paged so the chart above keeps its height.
          Swipe sideways to page; vertical drags pass through to the feed
          because the gesture is axis-locked rather than owned by a scroll
          container. */}
      <div className="flex-1 min-h-0 flex flex-col pt-2">
        <div className="flex-1 min-h-0 px-3 flex flex-col" ref={panelSwipe.ref}>
          <div className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            {panels[activePanel]?.label}
          </div>
          <ExpandablePanel resetKey={activePanel}>{panels[activePanel]?.body}</ExpandablePanel>
        </div>

        <CarouselControls
          className="flex-shrink-0 py-1"
          count={panels.length}
          index={activePanel}
          onChange={setPanel}
          dotLabel={i => `Show ${panels[i].label}`}
          label={`${panels[activePanel]?.label} — ${activePanel + 1} of ${panels.length}`}
        />
      </div>

      <div className="flex-shrink-0 flex items-stretch gap-2 px-3 py-2 pb-safe border-t border-gray-200 dark:border-gray-700">
        {onSnooze && (
          <button
            type="button"
            onClick={() => onSnooze(item)}
            className="flex flex-col items-center justify-center gap-0.5 w-16 rounded-xl text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
            aria-label="Snooze"
          >
            <BellOff className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">Snooze</span>
          </button>
        )}
        {onAcknowledge && (
          <button
            type="button"
            onClick={() => onAcknowledge(item)}
            className="flex flex-col items-center justify-center gap-0.5 w-16 rounded-xl text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
            aria-label="Acknowledge"
          >
            <Check className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">Got it</span>
          </button>
        )}
        {onShare && (
          <button
            type="button"
            onClick={() => onShare(item)}
            className="flex flex-col items-center justify-center gap-0.5 w-14 rounded-xl text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
            aria-label="Share"
          >
            <Share2 className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">Share</span>
          </button>
        )}
        {onCapture && (
          <button
            type="button"
            onClick={() => onCapture(item)}
            className="flex flex-col items-center justify-center gap-0.5 w-14 rounded-xl text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
            aria-label="Capture a thought"
          >
            <PenLine className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">Capture</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen?.(item)}
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary-600 text-white font-semibold no-touch-target"
        >
          Open
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm text-gray-800 dark:text-gray-200">{value}</div>
    </div>
  )
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(2)}%`
}

function fmtDelta(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}pp`
}
