/**
 * IdeasDecisionsStrip — Compact strip showing active trade ideas and
 * recent decisions for the current asset.
 *
 * Sits between the research view-filter bar and the main content tiles.
 * Two-column layout on desktop, stacked on narrow widths.
 */

import { useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Lightbulb,
  Wrench,
  FlaskConical,
  Scale,
  ChevronRight,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useAssetTradeIdeas, type AssetTradeIdea } from '../../hooks/useAssetTradeIdeas'
import { useAssetRecentDecisions, getDecisionLabel, type AssetRecentDecision } from '../../hooks/useAssetRecentDecisions'
import type { TradeStage } from '../../types/trading'

// ---------------------------------------------------------------------------
// Stage styling (mirrors TradeQueuePage)
// ---------------------------------------------------------------------------

const STAGE_STYLE: Record<TradeStage, { label: string; bg: string; icon: React.ElementType }> = {
  idea: { label: 'Idea', bg: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Lightbulb },
  working_on: { label: 'Working On', bg: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', icon: Wrench },
  modeling: { label: 'Modeling', bg: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300', icon: FlaskConical },
  deciding: { label: 'Deciding', bg: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: Scale },
}

const ACTION_LABEL: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  add: 'Add',
  trim: 'Trim',
}

const OUTCOME_ICON: Record<string, { icon: React.ElementType; color: string }> = {
  executed: { icon: CheckCircle2, color: 'text-emerald-600' },
  accepted: { icon: CheckCircle2, color: 'text-emerald-600' },
  rejected: { icon: XCircle, color: 'text-red-500' },
  deferred: { icon: Clock, color: 'text-gray-500' },
}

function getInitials(creator: { first_name: string | null; last_name: string | null } | null): string {
  if (!creator) return '?'
  const f = creator.first_name?.charAt(0)?.toUpperCase() ?? ''
  const l = creator.last_name?.charAt(0)?.toUpperCase() ?? ''
  return f + l || '?'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface IdeasDecisionsStripProps {
  assetId: string
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
  onCreateIdea?: () => void
}

export function IdeasDecisionsStrip({
  assetId,
  onNavigate,
  onCreateIdea,
}: IdeasDecisionsStripProps) {
  const { ideas, isLoading: ideasLoading, hasMore: hasMoreIdeas } = useAssetTradeIdeas({ assetId })
  const { decisions, isLoading: decisionsLoading, hasMore: hasMoreDecisions } = useAssetRecentDecisions({ assetId })

  const handleOpenIdea = useCallback((idea: AssetTradeIdea) => {
    // Open the trade queue with this idea selected
    onNavigate?.({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: { selectedTradeId: idea.id },
    })
  }, [onNavigate])

  const handleOpenDecision = useCallback((decision: AssetRecentDecision) => {
    onNavigate?.({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: { selectedTradeId: decision.id },
    })
  }, [onNavigate])

  const handleViewAllIdeas = useCallback(() => {
    onNavigate?.({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: {},
    })
  }, [onNavigate])

  const handleViewAllDecisions = useCallback(() => {
    onNavigate?.({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: {},
    })
  }, [onNavigate])

  // Don't render while both are still loading — avoid layout shift
  if (ideasLoading && decisionsLoading) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
      {/* ---- Active Ideas ---- */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Ideas
            </span>
            {ideas.length > 0 && (
              <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full">
                {hasMoreIdeas ? '5+' : ideas.length} Active
              </span>
            )}
          </div>
          {ideas.length > 0 && hasMoreIdeas && (
            <button
              onClick={handleViewAllIdeas}
              className="text-[11px] text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium flex items-center gap-0.5"
            >
              View all
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
          {ideas.length === 0 && onCreateIdea && (
            <button
              onClick={onCreateIdea}
              className="text-[11px] text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" />
              Create idea
            </button>
          )}
        </div>

        <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
          {ideas.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
              No active ideas
            </div>
          ) : (
            ideas.map((idea) => {
              const stage = STAGE_STYLE[idea.stage]
              const StageIcon = stage.icon
              return (
                <button
                  key={idea.id}
                  onClick={() => handleOpenIdea(idea)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
                >
                  {/* Owner initials */}
                  <span className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] font-medium text-gray-600 dark:text-gray-400 flex items-center justify-center shrink-0">
                    {getInitials(idea.creator)}
                  </span>

                  {/* Action + rationale */}
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase shrink-0">
                      {ACTION_LABEL[idea.action] ?? idea.action}
                    </span>
                    <span className="text-xs text-gray-800 dark:text-gray-200 truncate">
                      {idea.rationale || '(no rationale)'}
                    </span>
                  </div>

                  {/* Stage pill */}
                  <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0', stage.bg)}>
                    <StageIcon className="w-2.5 h-2.5" />
                    {stage.label}
                  </span>

                  {/* Portfolio */}
                  {idea.portfolio && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 hidden lg:inline truncate max-w-[80px]">
                      {idea.portfolio.name}
                    </span>
                  )}

                  {/* Relative time */}
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
                    {formatDistanceToNow(new Date(idea.updated_at), { addSuffix: false })}
                  </span>

                  <ArrowUpRight className="w-3 h-3 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 shrink-0" />
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ---- Recent Decisions ---- */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Recent Decisions
            </span>
            {decisions.length > 0 && (
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
                {decisions.length}
              </span>
            )}
          </div>
          {decisions.length > 0 && hasMoreDecisions && (
            <button
              onClick={handleViewAllDecisions}
              className="text-[11px] text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium flex items-center gap-0.5"
            >
              View all
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
          {decisions.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
              No recent decisions
            </div>
          ) : (
            decisions.map((dec) => {
              const resolvedOutcome = dec.outcome || dec.decision_outcome || 'executed'
              const outcomeStyle = OUTCOME_ICON[resolvedOutcome] ?? OUTCOME_ICON.executed
              const OutcomeIcon = outcomeStyle.icon
              const label = getDecisionLabel(dec.action, dec.outcome, dec.decision_outcome)
              const resolvedDate = dec.outcome_at || dec.decided_at

              return (
                <button
                  key={dec.id}
                  onClick={() => handleOpenDecision(dec)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
                >
                  {/* Outcome icon */}
                  <OutcomeIcon className={clsx('w-3.5 h-3.5 shrink-0', outcomeStyle.color)} />

                  {/* Date */}
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">
                    {resolvedDate ? format(new Date(resolvedDate), 'MMM d') : '—'}
                  </span>

                  {/* Action verb */}
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200 shrink-0">
                    {label}
                  </span>

                  {/* Size delta if available */}
                  {dec.proposed_weight != null && dec.proposed_weight !== 0 && (
                    <span className={clsx(
                      'text-[11px] font-medium shrink-0',
                      dec.proposed_weight > 0 ? 'text-emerald-600' : 'text-red-500'
                    )}>
                      {dec.proposed_weight > 0 ? '+' : ''}{(dec.proposed_weight * 100).toFixed(0)} bps
                    </span>
                  )}

                  {/* Portfolio */}
                  {dec.portfolio && (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate flex-1 min-w-0">
                      {dec.portfolio.name}
                    </span>
                  )}
                  {!dec.portfolio && <span className="flex-1" />}

                  <ArrowUpRight className="w-3 h-3 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 shrink-0" />
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
