/**
 * DecisionSystem — Institutional decision execution queue.
 *
 * Layout:
 *   1. Metrics strip (situational awareness, 5 tiles)
 *   2. Split: Queue (left) | Detail pane (right, for selected row)
 *
 * Click a row → detail pane shows context, actions, consequence.
 * Auto-advances after execute/defer.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  ArrowRight,
  Clock,
  FlaskConical,
  FileText,
  Ban,
  TrendingDown,
  Target,
} from 'lucide-react'
import {
  rankDecisionItems,
  buildHeroConsequence,
  type RankedDecisionItem,
} from '../../lib/dashboard/dashboardIntelligence'
import { ExecutiveMetricsBar } from './ExecutiveMetricsBar'
import type { CockpitViewModel } from '../../types/cockpit'
import type { ExecutionStats } from './ExecutionSnapshotCard'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Driver classification
// ---------------------------------------------------------------------------

type DriverKey = 'BLOCKING' | 'TIMING_RISK' | 'RISK_REDUCTION' | 'EXPOSURE_GAP' | 'STANDARD'

interface Driver {
  key: DriverKey
  label: string
  consequence: string
  ctaLabel: string
  badgeCls: string
  accentBorder: string
  accentBar: string
  ctaBg: string
}

function getDriver(item: DashboardItem): Driver {
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const urgency = item.meta?.urgency
  const weight = item.meta?.proposedWeight

  if (urgency === 'urgent' || (age >= 14 && item.severity === 'HIGH')) {
    return {
      key: 'BLOCKING', label: 'Blocking',
      consequence: age >= 14 ? 'Stalled \u2014 pipeline blocked' : 'Blocks downstream trades',
      ctaLabel: 'Resolve Now',
      badgeCls: 'bg-red-600 text-white dark:bg-red-500',
      accentBorder: 'border-l-red-500',
      accentBar: 'bg-red-600',
      ctaBg: 'bg-red-600 hover:bg-red-700',
    }
  }
  if (age >= 7) {
    return {
      key: 'TIMING_RISK', label: 'Entry risk',
      consequence: 'Entry cost increasing',
      ctaLabel: 'Execute Now',
      badgeCls: 'bg-amber-500 text-white dark:bg-amber-500',
      accentBorder: 'border-l-amber-400',
      accentBar: 'bg-amber-400',
      ctaBg: 'bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900',
    }
  }
  if (action === 'Sell' || action === 'Trim') {
    return {
      key: 'RISK_REDUCTION', label: 'Downside',
      consequence: 'Portfolio exposed while position open',
      ctaLabel: 'Reduce Exposure',
      badgeCls: 'bg-red-500/90 text-white dark:bg-red-500/80',
      accentBorder: 'border-l-red-400',
      accentBar: 'bg-red-500',
      ctaBg: 'bg-red-600 hover:bg-red-700',
    }
  }
  if (weight != null && weight >= 2) {
    return {
      key: 'EXPOSURE_GAP', label: 'Exposure gap',
      consequence: `${weight.toFixed(1)}% allocation gap`,
      ctaLabel: 'Execute Now',
      badgeCls: 'bg-violet-500 text-white dark:bg-violet-500',
      accentBorder: 'border-l-violet-400',
      accentBar: 'bg-violet-400',
      ctaBg: 'bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900',
    }
  }
  return {
    key: 'STANDARD', label: '',
    consequence: 'Awaiting your decision',
    ctaLabel: 'Decide',
    badgeCls: '',
    accentBorder: 'border-l-gray-200 dark:border-l-gray-700',
    accentBar: 'bg-gray-300 dark:bg-gray-600',
    ctaBg: 'bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900',
  }
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const ACTION_COLOR: Record<string, string> = {
  Buy: 'text-emerald-600 dark:text-emerald-400', Add: 'text-emerald-600 dark:text-emerald-400',
  Sell: 'text-red-600 dark:text-red-400', Trim: 'text-red-600 dark:text-red-400',
}

const ACTION_BG: Record<string, { text: string; bg: string; border: string }> = {
  Buy: { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800/40' },
  Add: { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800/40' },
  Sell: { text: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800/40' },
  Trim: { text: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800/40' },
}

function ageColor(d: number) {
  return d >= 10 ? 'text-red-600 dark:text-red-400' : d >= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'
}

// ---------------------------------------------------------------------------
// Status — what this item needs from the user
// ---------------------------------------------------------------------------

interface ItemStatus {
  label: string
  cls: string
}

// ---------------------------------------------------------------------------
// Item type — what kind of thing is this
// ---------------------------------------------------------------------------

function getItemType(item: DashboardItem): { label: string; cls: string } {
  if (item.id.startsWith('a2-execution')) {
    return { label: 'Execution', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  }
  if (item.id.startsWith('a1-proposal') || item.meta?.stage === 'deciding' || item.meta?.stage === 'ready_for_decision') {
    return { label: 'Proposal', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
  }
  if (item.id.startsWith('a3-unsimulated') || item.type === 'SIMULATION') {
    return { label: 'Idea', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
  }
  if (item.meta?.stage === 'idea' || item.meta?.stage === 'aware') {
    return { label: 'Idea', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' }
  }
  if (item.meta?.stage === 'thesis_forming' || item.meta?.stage === 'deep_research' || item.meta?.stage === 'simulating' || item.meta?.stage === 'modeling') {
    return { label: 'Idea', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' }
  }
  if (item.type === 'DECISION') {
    return { label: 'Proposal', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
  }
  return { label: 'Item', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' }
}

// ---------------------------------------------------------------------------
// Stage — where in the process is this
// ---------------------------------------------------------------------------

function getItemStage(item: DashboardItem): { label: string; cls: string } {
  const stage = item.meta?.stage

  if (stage === 'approved') return { label: 'Approved', cls: 'text-emerald-600 dark:text-emerald-400' }
  if (stage === 'deciding' || stage === 'ready_for_decision') {
    if (item.meta?.needsPM) return { label: 'Awaiting PM', cls: 'text-orange-600 dark:text-orange-400' }
    return { label: 'Awaiting you', cls: 'text-red-600 dark:text-red-400' }
  }
  if (stage === 'thesis_forming') return { label: 'Thesis forming', cls: 'text-indigo-600 dark:text-indigo-400' }
  if (stage === 'deep_research' || stage === 'simulating' || stage === 'modeling') return { label: 'Researching', cls: 'text-purple-600 dark:text-purple-400' }
  if (stage === 'investigate' || stage === 'working_on' || stage === 'discussing') return { label: 'Investigating', cls: 'text-amber-600 dark:text-amber-400' }
  if (stage === 'aware' || stage === 'idea') return { label: 'Early stage', cls: 'text-sky-600 dark:text-sky-400' }

  // ID-based fallback
  if (item.id.startsWith('a2-execution')) return { label: 'Confirm exec', cls: 'text-emerald-600 dark:text-emerald-400' }
  if (item.id.startsWith('a3-unsimulated')) return { label: 'Not simulated', cls: 'text-blue-600 dark:text-blue-400' }
  if (item.id.startsWith('a1-proposal')) {
    if (item.meta?.needsPM) return { label: 'Awaiting PM', cls: 'text-orange-600 dark:text-orange-400' }
    return { label: 'Awaiting you', cls: 'text-red-600 dark:text-red-400' }
  }

  if (item.type === 'DECISION') return { label: 'Awaiting you', cls: 'text-red-600 dark:text-red-400' }
  return { label: 'Pending', cls: 'text-gray-400 dark:text-gray-500' }
}

function getItemStatus(item: DashboardItem, driver: Driver): ItemStatus {
  const stage = item.meta?.stage

  // Non-deciding stages — show the pipeline position
  if (stage === 'approved') {
    return { label: 'Approved · confirm execution', cls: 'text-emerald-600 dark:text-emerald-400' }
  }
  if (stage === 'thesis_forming') {
    return { label: 'Thesis forming', cls: 'text-indigo-600 dark:text-indigo-400' }
  }
  if (stage === 'deep_research' || stage === 'simulating' || stage === 'modeling') {
    return { label: 'In research', cls: 'text-purple-600 dark:text-purple-400' }
  }
  if (stage === 'investigate' || stage === 'working_on' || stage === 'discussing') {
    return { label: 'Investigating', cls: 'text-amber-600 dark:text-amber-400' }
  }
  if (stage === 'aware' || stage === 'idea') {
    return { label: 'Idea · needs work', cls: 'text-sky-600 dark:text-sky-400' }
  }
  if (item.id.startsWith('a3-unsimulated')) {
    return { label: 'Idea · needs simulation', cls: 'text-blue-600 dark:text-blue-400' }
  }

  // Items needing PM — distinct from items needing you
  if (item.meta?.needsPM) {
    return { label: 'Prompt PM for decision', cls: 'text-orange-600 dark:text-orange-400' }
  }

  // Deciding / proposal items — use driver consequence to differentiate
  const isSevere = driver.key === 'BLOCKING' || driver.key === 'RISK_REDUCTION'
  return {
    label: driver.consequence,
    cls: isSevere ? 'text-red-600/70 dark:text-red-400/60' : 'text-gray-500 dark:text-gray-400',
  }
}

const SNOOZE_OPTIONS = [
  { label: 'Later today', hours: 4 },
  { label: 'Tomorrow', hours: 24 },
  { label: 'Next week', hours: 168 },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DecisionSystemProps {
  id?: string
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  isLoading?: boolean
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
  onOpenTradeQueue?: (filter?: string) => void
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function DecisionSystem({
  id, viewModel, pipelineStats, isLoading, onItemClick, onSnooze, onOpenTradeQueue,
}: DecisionSystemProps) {
  const ranked = useMemo(() => rankDecisionItems(viewModel), [viewModel])
  const totalCount = viewModel.decide.totalItems

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedItemId = useMemo(() => {
    if (ranked.length === 0) return null
    if (selectedId && ranked.some(r => r.item.id === selectedId)) return selectedId
    return ranked[0]?.item.id ?? null
  }, [ranked, selectedId])

  const selected = useMemo(() => {
    if (!selectedItemId) return null
    return ranked.find(r => r.item.id === selectedItemId) ?? null
  }, [ranked, selectedItemId])

  const handleSelect = useCallback((itemId: string) => {
    setSelectedId(itemId)
    setFeedback(null)
  }, [])

  const advanceToNext = useCallback(() => {
    const idx = ranked.findIndex(r => r.item.id === selectedItemId)
    const next = ranked[idx + 1] ?? ranked[0]
    if (next && next.item.id !== selectedItemId) {
      setSelectedId(next.item.id)
      const ticker = next.item.asset?.ticker
      const action = next.item.meta?.action
      const label = ticker ? `${action ? action + ' ' : ''}${ticker}` : next.item.title
      setFeedback(`\u2192 ${label}`)
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setFeedback(null), 2000)
    }
  }, [selectedItemId, ranked])

  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current) }, [])

  // Narrative summary with breakdown
  const narrative = useMemo(() => {
    if (ranked.length === 0) return ''
    const yours = ranked.filter(r => !r.item.meta?.needsPM).length
    const pm = ranked.filter(r => r.item.meta?.needsPM).length
    const drivers = ranked.map(r => getDriver(r.item))
    const blocking = drivers.filter(d => d.key === 'BLOCKING').length
    const parts: string[] = []
    if (yours > 0) parts.push(`${yours} need you`)
    if (pm > 0) parts.push(`${pm} need PM`)
    if (blocking > 0) parts.push(`${blocking} blocking`)
    return parts.join(' \u00B7 ')
  }, [ranked])

  // Empty state
  if (totalCount === 0 && !isLoading) {
    return (
      <div id={id} className="space-y-2">
        <ExecutiveMetricsBar
          viewModel={viewModel}
          pipelineStats={pipelineStats}
          isLoading={isLoading}
          onOpenTradeQueue={onOpenTradeQueue}
        />
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-4 py-6 text-center">
          <p className="text-[12px] font-medium text-gray-600 dark:text-gray-300">Decision queue clear.</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">No decisions waiting on you.</p>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className="space-y-2">
      {/* Metrics strip */}
      <ExecutiveMetricsBar
        viewModel={viewModel}
        pipelineStats={pipelineStats}
        isLoading={isLoading}
        onOpenTradeQueue={onOpenTradeQueue}
      />

      {/* Queue + Detail pane */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-2 items-start transition-all duration-300 ease-in-out">
        {/* Left: Decision queue */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
          {/* Queue header */}
          <div className="flex items-center gap-3 px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-gray-800 dark:text-gray-100 tabular-nums">
                {totalCount}
              </span>
              <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Decisions
              </span>
            </div>
            {narrative && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {narrative}
              </span>
            )}
            {feedback && (
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ml-auto animate-pulse">
                {feedback}
              </span>
            )}
          </div>

          {/* Ranked rows */}
          <div>
            {ranked.map((r, idx) => (
              <QueueRow
                key={r.item.id}
                ranked={r}
                rank={idx + 1}
                isSelected={r.item.id === selectedItemId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </div>

        {/* Right: Detail pane */}
        {selected && (
          <DetailPane
            ranked={selected}
            onItemClick={onItemClick}
            onSnooze={onSnooze}
            onAdvanceNext={advanceToNext}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QueueRow — Compact single-line row, no inline expansion
// ---------------------------------------------------------------------------

function QueueRow({
  ranked,
  rank,
  isSelected,
  onSelect,
}: {
  ranked: RankedDecisionItem
  rank: number
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const { item } = ranked
  const driver = useMemo(() => getDriver(item), [item])
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const ticker = item.asset?.ticker
  const isPairTrade = item.meta?.isPairTrade
  const weight = item.meta?.proposedWeight
  const isSevere = driver.key === 'BLOCKING' || driver.key === 'RISK_REDUCTION'

  const stageInfo = getItemStage(item)

  return (
    <div
      onClick={() => onSelect(item.id)}
      className={clsx(
        'border-l-[3px] cursor-pointer transition-colors',
        driver.accentBorder,
        isSelected
          ? 'bg-blue-50 dark:bg-blue-900/20'
          : 'hover:bg-gray-50/40 dark:hover:bg-gray-800/40',
        rank > 1 && 'border-t border-t-gray-100 dark:border-t-gray-700/30',
      )}
    >
      <div className="flex items-center px-3 py-[7px]">
        {/* Rank */}
        <span className={clsx(
          'w-[20px] shrink-0 text-[11px] font-bold tabular-nums text-right',
          isSelected ? 'text-gray-800 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600',
        )}>
          {rank}
        </span>

        {/* Action */}
        <span className={clsx('w-[40px] shrink-0 text-[12px] font-bold ml-2', isPairTrade ? 'text-blue-600 dark:text-blue-400' : action ? (ACTION_COLOR[action] ?? 'text-gray-500') : '')}>
          {isPairTrade ? 'Pair' : action ?? ''}
        </span>

        {/* Ticker */}
        <span className={clsx(
          'w-[110px] shrink-0 text-[12px] font-bold truncate ml-3',
          !isPairTrade && (isSelected ? 'text-gray-900 dark:text-gray-50' : 'text-gray-700 dark:text-gray-200'),
        )}>
          {isPairTrade && action
            ? action.split(/\s*\/\s*/).map((leg, i) => {
                const isBuy = /^(Buy|Add)\b/i.test(leg.trim())
                const isSell = /^(Sell|Trim)\b/i.test(leg.trim())
                const tickerOnly = leg.trim().replace(/^(Buy|Sell|Add|Trim)\s+/i, '')
                return (
                  <span key={i}>
                    {i > 0 && <span className="text-gray-300 dark:text-gray-600"> / </span>}
                    <span className={isBuy ? 'text-emerald-600 dark:text-emerald-400' : isSell ? 'text-red-600 dark:text-red-400' : ''}>{tickerOnly}</span>
                  </span>
                )
              })
            : ticker || item.title}
        </span>

        {/* Portfolio */}
        <span className="w-[110px] shrink-0 text-[11px] text-gray-400 dark:text-gray-500 truncate ml-3">
          {item.portfolio?.name ?? ''}
        </span>

        {/* Weight: current → target */}
        <span className="w-[80px] shrink-0 text-[11px] tabular-nums ml-2">
          {weight != null ? (
            <>
              <span className="text-gray-400 dark:text-gray-500">
                {item.meta?.deltaWeight != null
                  ? (weight - item.meta.deltaWeight).toFixed(1)
                  : '0.0'}
                <span className="text-gray-300 dark:text-gray-600 mx-0.5">&rarr;</span>
              </span>
              <span className="font-bold text-violet-600 dark:text-violet-400">{weight.toFixed(1)}%</span>
            </>
          ) : ''}
        </span>

        {/* Stage */}
        <span className={clsx('w-[84px] shrink-0 text-[10px] font-semibold truncate ml-3', stageInfo.cls)}>
          {stageInfo.label}
        </span>

        {/* Age */}
        <span className={clsx('w-[32px] shrink-0 text-[11px] font-bold tabular-nums text-right ml-2', ageColor(age))}>
          {age}d
        </span>

        {/* Driver badge */}
        {driver.label && (
          <span className={clsx('shrink-0 text-[8px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded ml-3', driver.badgeCls)}>
            {driver.label}
          </span>
        )}

        {/* Context — fills remaining */}
        <span className={clsx(
          'flex-1 min-w-0 text-[10px] truncate ml-3',
          isSevere ? 'text-red-600/60 dark:text-red-400/50' : 'text-gray-400 dark:text-gray-500',
        )}>
          {driver.consequence}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DetailPane — Right-hand detail for the selected decision
// ---------------------------------------------------------------------------

function DetailPane({
  ranked,
  onItemClick,
  onSnooze,
  onAdvanceNext,
}: {
  ranked: RankedDecisionItem
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
  onAdvanceNext: () => void
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const { item } = ranked
  const driver = useMemo(() => getDriver(item), [item])
  const consequence = useMemo(() => buildHeroConsequence(item), [item])
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const actionBg = action ? ACTION_BG[action] : null
  const ticker = item.asset?.ticker
  const isPairTrade = item.meta?.isPairTrade
  const display = isPairTrade && action ? action : ticker || item.title
  const weight = item.meta?.proposedWeight
  const isSevere = driver.key === 'BLOCKING' || driver.key === 'RISK_REDUCTION'

  const handleDefer = useCallback((hours: number) => {
    onSnooze?.(item.id, hours)
    setSnoozeOpen(false)
    onAdvanceNext()
  }, [item.id, onSnooze, onAdvanceNext])

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden lg:sticky lg:top-3">
      {/* Accent bar */}
      <div className={clsx('h-[2px]', driver.accentBar)} />

      <div className="px-4 py-3">
        {/* Header: driver + age + portfolio */}
        <div className="flex items-center gap-2 mb-2.5">
          {driver.label && (
            <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded', driver.badgeCls)}>
              {driver.label}
            </span>
          )}
          <div className="flex items-center gap-1">
            <Clock className={clsx('w-3 h-3', ageColor(age))} />
            <span className={clsx('text-[11px] font-bold tabular-nums', ageColor(age))}>{age}d</span>
          </div>
          {item.portfolio?.name && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.portfolio.name}</span>
          )}
        </div>

        {/* Action + Ticker */}
        <div className="flex items-center gap-2 mb-2">
          {actionBg && action && !isPairTrade && (
            <span className={clsx('text-[14px] font-bold px-2.5 py-0.5 rounded border', actionBg.text, actionBg.bg, actionBg.border)}>
              {action}
            </span>
          )}
          <span className="text-[20px] font-bold text-gray-900 dark:text-gray-50 leading-tight">
            {display}
          </span>
          {weight != null && (
            <span className="text-[14px] font-bold tabular-nums text-violet-600 dark:text-violet-400">
              {weight.toFixed(1)}%
            </span>
          )}
        </div>

        {/* Consequence */}
        <p className={clsx(
          'text-[12px] font-medium leading-snug',
          isSevere ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-200',
        )}>
          {consequence.tension}
        </p>
        {consequence.ifIgnored && (
          <p className="text-[10px] text-red-600/60 dark:text-red-400/50 leading-snug mt-0.5">
            {consequence.ifIgnored}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/40">
        {/* Primary CTA */}
        <button
          onClick={() => item.primaryAction.onClick()}
          className={clsx(
            'w-full flex items-center justify-center gap-2 text-[13px] font-bold text-white px-4 py-2.5 rounded-lg transition-colors shadow-sm mb-2',
            driver.ctaBg,
          )}
        >
          {driver.ctaLabel}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        {/* Secondary actions */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => { if (item.portfolio?.id) window.dispatchEvent(new CustomEvent('openTradeLab', { detail: { portfolioId: item.portfolio.id } })) }}
            className="flex flex-col items-center gap-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Simulate
          </button>
          {item.asset?.id && (
            <button
              onClick={() => onItemClick?.(item)}
              className="flex flex-col items-center gap-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Thesis
            </button>
          )}
          {onSnooze && (
            <div className="relative">
              <button
                onClick={() => setSnoozeOpen(!snoozeOpen)}
                className="w-full flex flex-col items-center gap-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <Clock className="w-3.5 h-3.5" />
                Defer
              </button>
              {snoozeOpen && (
                <div className="absolute bottom-full left-0 mb-1 z-50 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1">
                  {SNOOZE_OPTIONS.map(opt => (
                    <button
                      key={opt.hours}
                      onClick={() => handleDefer(opt.hours)}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context section */}
      {consequence.factors?.summary && (
        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700/40">
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Priority factors</div>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
            {consequence.factors.summary}
          </p>
        </div>
      )}
    </div>
  )
}
