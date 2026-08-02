import { useRef, useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle, ArrowRight, BellOff, Check, Gavel, Info, Users,
} from 'lucide-react'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { TickerQuoteBadge } from './TickerQuoteBadge'
import { ExpandableText } from './ExpandableText'
import { useDecisionContext } from '../../hooks/mobile/useDecisionContext'
import type { AttentionItem, AttentionType } from '../../types/attention'

interface AttentionFeedCardProps {
  item: AttentionItem
  /** Ticker for the linked asset, resolved by the caller in one batched query. */
  symbol?: string | null
  companyName?: string | null
  onOpen?: (item: AttentionItem) => void
  onSnooze?: (item: AttentionItem) => void
  onAcknowledge?: (item: AttentionItem) => void
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
  item,
  symbol,
  companyName,
  onOpen,
  onSnooze,
  onAcknowledge,
}: AttentionFeedCardProps) {
  const config = TYPE_CONFIG[item.attention_type] ?? TYPE_CONFIG.informational
  const TypeIcon = config.icon
  const isOverdue = !!item.due_at && new Date(item.due_at).getTime() < Date.now()
  const { data: decision } = useDecisionContext(item)

  const scrollerRef = useRef<HTMLDivElement>(null)
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
      body: <ExpandableText text={rationale} lines={5} />,
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

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== panel) setPanel(i)
  }

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header band — mirrors the idea card's, so the two read as one feed. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border', config.chip)}>
          <TypeIcon className="h-4 w-4" />
          {config.label}
        </span>
        {symbol ? (
          <TickerQuoteBadge symbol={symbol} companyName={companyName} className="ml-auto" />
        ) : (
          <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">
            {formatDistanceToNow(new Date(item.last_activity_at || item.created_at), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* The instruction, first and unmissable. */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-2xl font-bold leading-tight min-w-0">
            <span className={tone}>{(decision?.action || verb || '').toUpperCase()}</span>{' '}
            <span className="text-gray-900 dark:text-white">{ticker}</span>
          </h2>
          {/* Attribution sits with the instruction it attributes — as its own
              labelled row inside a panel called "Recommendation" it read as
              the same word twice. */}
          {decision?.recommendedBy && (
            <span className="ml-auto shrink-0 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[9rem]">
              by {decision.recommendedBy}
            </span>
          )}
        </div>
        {item.subtitle && (
          <p className="mt-0.5 text-sm font-medium text-gray-600 dark:text-gray-300">{item.subtitle}</p>
        )}
      </div>

      {symbol && (
        <div className="flex-shrink-0 h-[50%] min-h-[250px] max-h-[400px] px-3">
          <ReelsChartPanel symbol={symbol} hideHeader />
        </div>
      )}

      {/* Supporting detail, swipeable so the chart above keeps its height. */}
      <div className="flex-1 min-h-0 flex flex-col pt-3">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain scrollbar-hide"
        >
          {panels.map(p => (
            <div key={p.key} className="w-full flex-shrink-0 snap-start snap-always px-3 overflow-hidden">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                {p.label}
              </div>
              {p.body}
            </div>
          ))}
        </div>

        {panels.length > 1 && (
          <div className="flex-shrink-0 flex items-center justify-center gap-1.5 py-2">
            {panels.map((p, i) => (
              <span
                key={p.key}
                aria-hidden="true"
                className={clsx(
                  'h-1.5 rounded-full transition-all',
                  i === panel ? 'w-4 bg-gray-500 dark:bg-gray-300' : 'w-1.5 bg-gray-300 dark:bg-gray-600'
                )}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-stretch gap-2 px-3 py-3 pb-safe border-t border-gray-200 dark:border-gray-700">
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
        <button
          type="button"
          onClick={() => onOpen?.(item)}
          className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-primary-600 text-white font-semibold no-touch-target"
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
