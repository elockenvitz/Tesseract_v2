/**
 * ActionLoopModule — Header chrome strip showing view-scoped active trade ideas,
 * follow-ups, recent decisions, and primary insight for the current asset.
 *
 * NOT a customizable research tile. Sits above the tile grid as header chrome.
 * Supports collapse/expand (persisted) and per-asset/global hide (localStorage).
 *
 * Layout: "Action Loop · {ViewUser}" | Primary Insight | pills | actions
 * Expanded: Active → Follow-ups → Recent (three sections, single column)
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  RefreshCw,
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
  AlertTriangle,
  MessageSquare,
  TrendingUp,
  X,
  Info,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useActionLoop, type ActionLoopIdea, type ActionLoopDecision } from '../../hooks/useActionLoop'
import { useActionLoopFollowups, type FollowupItem, type FollowupType } from '../../hooks/useActionLoopFollowups'
import { getDecisionLabel } from '../../hooks/useAssetRecentDecisions'
import type { TradeStage } from '../../types/trading'

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_GLOBAL_HIDDEN = 'actionLoop.hidden.global'
const LS_ASSET_HIDDEN_PREFIX = 'actionLoop.hidden.asset.'
const LS_COLLAPSED_PREFIX = 'actionLoop.collapsed.'

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}
function lsRemove(key: string) {
  try { localStorage.removeItem(key) } catch { /* noop */ }
}

export function isActionLoopGloballyHidden(): boolean {
  return lsGet(LS_GLOBAL_HIDDEN) === 'true'
}
export function isActionLoopHiddenForAsset(assetId: string): boolean {
  return lsGet(LS_ASSET_HIDDEN_PREFIX + assetId) === 'true'
}
export function setActionLoopGlobalHidden(hidden: boolean) {
  if (hidden) lsSet(LS_GLOBAL_HIDDEN, 'true')
  else lsRemove(LS_GLOBAL_HIDDEN)
}
export function setActionLoopAssetHidden(assetId: string, hidden: boolean) {
  if (hidden) lsSet(LS_ASSET_HIDDEN_PREFIX + assetId, 'true')
  else lsRemove(LS_ASSET_HIDDEN_PREFIX + assetId)
}
export function clearAllActionLoopHidden() {
  lsRemove(LS_GLOBAL_HIDDEN)
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(LS_ASSET_HIDDEN_PREFIX))
    keys.forEach(k => localStorage.removeItem(k))
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Style maps
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

const INSIGHT_ICON: Record<string, React.ElementType> = {
  amber: AlertTriangle,
  blue: TrendingUp,
  neutral: Info,
}

const INSIGHT_TONE_STYLE = {
  amber: 'text-amber-700 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  neutral: 'text-gray-500 dark:text-gray-400',
} as const

// CTA action → primary insight CTA label
const INSIGHT_CTA: Record<string, { label: string; action: FollowupItem['ctaAction'] }> = {
  decision_research_gap: { label: 'Update thesis', action: 'update_thesis' },
  high_ev_no_idea: { label: 'New idea', action: 'create_idea' },
  rating_ev_mismatch: { label: 'Update rating', action: 'update_rating' },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ActionLoopModuleProps {
  assetId: string
  assetSymbol?: string
  viewFilter: 'aggregated' | string
  currentUserId?: string
  accessibleUserIds?: string[]
  currentPrice?: number
  viewUserDisplayName?: string
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
  onCreateIdea?: () => void
}

export function ActionLoopModule({
  assetId,
  assetSymbol,
  viewFilter,
  currentUserId,
  accessibleUserIds,
  currentPrice,
  viewUserDisplayName,
  onNavigate,
  onCreateIdea,
}: ActionLoopModuleProps) {
  const {
    ideas,
    hasMoreIdeas,
    activeCount,
    decisions,
    hasMoreDecisions,
    followUp,
    isLoading,
  } = useActionLoop({ assetId, viewFilter })

  const {
    visibleFollowups,
    followupCount,
    primaryInsight,
    suppress24h,
    isSuppressing,
  } = useActionLoopFollowups({
    assetId,
    viewFilter,
    currentPrice,
    accessibleUserIds,
    latestDecisionInfo: followUp.latestDecision,
    researchTimestamp: followUp.researchTimestamp,
    ideas,
    activeCount,
  })

  // ---- Prompt visibility: hide when viewing own research ----
  const isViewingSelf = viewFilter === 'aggregated' || viewFilter === currentUserId
  const showPrompt = !isViewingSelf && !!viewUserDisplayName

  // ---- Hide state (localStorage) ----
  const [hiddenAsset, setHiddenAsset] = useState(() => isActionLoopHiddenForAsset(assetId))
  const [hiddenGlobal, setHiddenGlobal] = useState(() => isActionLoopGloballyHidden())

  useEffect(() => {
    setHiddenAsset(isActionLoopHiddenForAsset(assetId))
    setHiddenGlobal(isActionLoopGloballyHidden())
  }, [assetId])

  useEffect(() => {
    const handler = () => {
      setHiddenGlobal(isActionLoopGloballyHidden())
      setHiddenAsset(isActionLoopHiddenForAsset(assetId))
    }
    window.addEventListener('actionloop-visibility-changed', handler)
    return () => window.removeEventListener('actionloop-visibility-changed', handler)
  }, [assetId])

  // ---- Collapse state (per-view, defaults to collapsed) ----
  const recentCount = decisions.length

  const collapseKey = `${LS_COLLAPSED_PREFIX}${assetId}.${viewFilter}`
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(() => {
    const stored = lsGet(collapseKey)
    return stored !== null ? stored === 'true' : null
  })

  // Reset when view changes
  useEffect(() => {
    const stored = lsGet(collapseKey)
    setUserCollapsed(stored !== null ? stored === 'true' : null)
  }, [collapseKey])

  const isCollapsed = userCollapsed ?? true // default collapsed

  const toggleCollapsed = useCallback(() => {
    setUserCollapsed(prev => {
      const next = !(prev ?? true)
      lsSet(collapseKey, String(next))
      return next
    })
  }, [collapseKey])

  // ---- Header label ----
  const headerLabel = useMemo(() => {
    if (viewFilter === 'aggregated' || !viewUserDisplayName) return 'Action Loop'
    return `Action Loop \u00B7 ${viewUserDisplayName}`
  }, [viewFilter, viewUserDisplayName])

  // ---- Action handlers ----

  const handleOpenIdea = useCallback((idea: ActionLoopIdea) => {
    onNavigate?.({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: { selectedTradeId: idea.id },
    })
  }, [onNavigate])

  const handleOpenDecision = useCallback((decision: ActionLoopDecision) => {
    onNavigate?.({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: { selectedTradeId: decision.id },
    })
  }, [onNavigate])

  const handleViewAll = useCallback(() => {
    onNavigate?.({
      id: 'trade-queue',
      title: 'Trade Queue',
      type: 'trade-queue',
      data: {},
    })
  }, [onNavigate])

  // + New Idea: open right pane with QuickTradeIdeaCapture, asset prefilled
  const handleNewIdea = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
      detail: {
        contextType: 'asset',
        contextId: assetId,
        contextTitle: assetSymbol || undefined,
        captureType: 'trade_idea',
      }
    }))
  }, [assetId, assetSymbol])

  // Prompt: open right pane with PromptModal, asset context prefilled
  const handlePrompt = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
      detail: {
        contextType: 'asset',
        contextId: assetId,
        contextTitle: assetSymbol || undefined,
        captureType: 'prompt',
      }
    }))
  }, [assetId, assetSymbol])

  // Scroll + trigger edit event
  const scrollAndTrigger = useCallback((anchorId: string, eventName: string) => {
    const el = document.getElementById(anchorId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(eventName, { detail: { assetId } }))
    }, 400)
  }, [assetId])

  const handleUpdateRating = useCallback(() => {
    scrollAndTrigger('asset-warning-anchor-rating', 'actionloop-edit-rating')
  }, [scrollAndTrigger])

  const handleUpdateTargets = useCallback(() => {
    scrollAndTrigger('asset-warning-anchor-targets', 'actionloop-edit-targets')
  }, [scrollAndTrigger])

  const handleUpdateThesis = useCallback(() => {
    scrollAndTrigger('asset-anchor-thesis', 'actionloop-edit-thesis')
  }, [scrollAndTrigger])

  // Follow-up CTA handler
  const handleFollowupCta = useCallback((action: FollowupItem['ctaAction']) => {
    switch (action) {
      case 'update_rating': handleUpdateRating(); break
      case 'update_targets': handleUpdateTargets(); break
      case 'update_thesis': handleUpdateThesis(); break
      case 'create_idea': handleNewIdea(); break
      case 'open_trade_lab':
        onNavigate?.({
          id: 'trade-lab',
          title: 'Trade Lab',
          type: 'trade-lab',
          data: { assetId },
        })
        break
    }
  }, [handleUpdateRating, handleUpdateTargets, handleUpdateThesis, handleNewIdea, onNavigate, assetId])

  // Primary insight CTA handler
  const handleInsightCta = useCallback(() => {
    // Find the first visible followup that matches the primary insight
    const first = visibleFollowups[0]
    if (first) {
      handleFollowupCta(first.ctaAction)
    }
  }, [visibleFollowups, handleFollowupCta])

  // ---- Derived: primary insight CTA info ----
  const insightCta = useMemo(() => {
    const first = visibleFollowups[0]
    if (!first) return null
    return INSIGHT_CTA[first.type] ?? null
  }, [visibleFollowups])

  // ---- Render guards ----
  if (isLoading) return null
  if (hiddenGlobal || hiddenAsset) return null

  const hasAnyContent = activeCount > 0 || followupCount > 0 || recentCount > 0

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded bg-gray-50/50 dark:bg-gray-800/50 overflow-hidden">
      {/* ---- Summary strip (always visible) ---- */}
      <div className="flex items-center h-7 px-2.5 gap-1.5">
        {/* Collapse toggle + label */}
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-1 shrink-0 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          <ChevronRight className={clsx(
            'w-2.5 h-2.5 transition-transform',
            !isCollapsed && 'rotate-90'
          )} />
          <RefreshCw className="w-2.5 h-2.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">
            {headerLabel}
          </span>
        </button>

        {/* Primary insight — single line with icon + CTA link */}
        {primaryInsight && (
          <span className={clsx(
            'inline-flex items-center gap-1 text-[10px] truncate max-w-[340px]',
            INSIGHT_TONE_STYLE[primaryInsight.tone]
          )}>
            {(() => {
              const InsightIcon = INSIGHT_ICON[primaryInsight.tone]
              return <InsightIcon className="w-2.5 h-2.5 shrink-0" />
            })()}
            <span className="truncate">{primaryInsight.text}</span>
            {insightCta && (
              <button
                onClick={handleInsightCta}
                className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
              >
                {insightCta.label}
              </button>
            )}
          </span>
        )}

        {/* Summary pills — only non-zero counts */}
        <div className="flex items-center gap-1">
          {activeCount > 0 && (
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-px rounded-full tabular-nums">
              {activeCount} Active
            </span>
          )}
          {followupCount > 0 && (
            <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-100/60 dark:bg-amber-900/20 px-1.5 py-px rounded-full inline-flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" />
              {followupCount}
            </span>
          )}
          {recentCount > 0 && (
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-px rounded-full tabular-nums">
              {recentCount} Recent
            </span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Inline actions */}
        <button
          onClick={handleNewIdea}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
        >
          <Plus className="w-2.5 h-2.5" />
          New Idea
        </button>
        {showPrompt && (
          <button
            onClick={handlePrompt}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded transition-colors"
          >
            <MessageSquare className="w-2.5 h-2.5" />
            Prompt {viewUserDisplayName?.split(' ')[0]}
          </button>
        )}
      </div>

      {/* ---- Expanded body ---- */}
      {!isCollapsed && (
        <div className="border-t border-gray-200 dark:border-gray-700">

          {/* No activity state */}
          {!hasAnyContent && (
            <div className="px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500 text-center">
              No activity yet. Ideas, decisions, and follow-ups appear here.
            </div>
          )}

          {/* ======== SECTION 1: Active Ideas ======== */}
          {(activeCount > 0 || followupCount === 0) && hasAnyContent && (
            <div>
              <div className="px-2.5 pt-1 pb-0.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Active Ideas
                </span>
                {ideas.length > 0 && (hasMoreIdeas || ideas.length > 4) && (
                  <button
                    onClick={handleViewAll}
                    className="text-[10px] text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium flex items-center gap-0.5"
                  >
                    View all <ChevronRight className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {ideas.length === 0 ? (
                  <div className="px-3 py-1.5 text-[11px] text-gray-400 dark:text-gray-500 text-center">
                    {followupCount > 0
                      ? 'No active ideas \u2014 see follow-ups below.'
                      : 'No active ideas.'}
                  </div>
                ) : (
                  ideas.slice(0, 4).map((idea) => {
                    const stage = STAGE_STYLE[idea.stage]
                    const StageIcon = stage.icon
                    return (
                      <button
                        key={idea.id}
                        onClick={() => handleOpenIdea(idea)}
                        className="w-full flex items-center gap-1.5 px-2.5 py-0.5 text-left hover:bg-gray-100/60 dark:hover:bg-gray-700/40 transition-colors group"
                      >
                        <span className="w-4 h-4 rounded-full bg-gray-100 dark:bg-gray-700 text-[9px] font-medium text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
                          {getInitials(idea.creator)}
                        </span>
                        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase shrink-0">
                          {ACTION_LABEL[idea.action] ?? idea.action}
                        </span>
                        <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate flex-1 min-w-0">
                          {idea.rationale || '(no rationale)'}
                        </span>
                        <span className={clsx('inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium shrink-0', stage.bg)}>
                          <StageIcon className="w-2 h-2" />
                          {stage.label}
                        </span>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
                          {formatDistanceToNow(new Date(idea.updated_at), { addSuffix: false })}
                        </span>
                        <ArrowUpRight className="w-2.5 h-2.5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 shrink-0" />
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* ======== SECTION 2: Follow-ups ======== */}
          {visibleFollowups.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-2.5 pt-1 pb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500 dark:text-amber-400">
                  Follow-ups
                </span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {visibleFollowups.map((fu) => (
                  <FollowupRow
                    key={fu.type}
                    item={fu}
                    onCta={() => handleFollowupCta(fu.ctaAction)}
                    onDismiss={() => suppress24h(fu.type)}
                    isDismissing={isSuppressing}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ======== SECTION 3: Recent Decisions ======== */}
          {recentCount > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-2.5 pt-1 pb-0.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Recent Decisions
                </span>
                {(hasMoreDecisions || decisions.length > 4) && (
                  <button
                    onClick={handleViewAll}
                    className="text-[10px] text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium flex items-center gap-0.5"
                  >
                    View all <ChevronRight className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {decisions.slice(0, 4).map((dec) => {
                  const resolvedOutcome = dec.outcome || dec.decision_outcome || 'executed'
                  const outcomeStyle = OUTCOME_ICON[resolvedOutcome] ?? OUTCOME_ICON.executed
                  const OutcomeIcon = outcomeStyle.icon
                  const label = getDecisionLabel(dec.action, dec.outcome, dec.decision_outcome)
                  const resolvedDate = dec.outcome_at || dec.decided_at

                  return (
                    <button
                      key={dec.id}
                      onClick={() => handleOpenDecision(dec)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-0.5 text-left hover:bg-gray-100/60 dark:hover:bg-gray-700/40 transition-colors group"
                    >
                      <OutcomeIcon className={clsx('w-3 h-3 shrink-0', outcomeStyle.color)} />
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">
                        {resolvedDate ? format(new Date(resolvedDate), 'MMM d') : '\u2014'}
                      </span>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200 shrink-0">
                        {label}
                      </span>
                      {dec.proposed_weight != null && dec.proposed_weight !== 0 && (
                        <span className={clsx(
                          'text-[10px] font-medium shrink-0',
                          dec.proposed_weight > 0 ? 'text-emerald-600' : 'text-red-500'
                        )}>
                          {dec.proposed_weight > 0 ? '+' : ''}{(dec.proposed_weight * 100).toFixed(0)} bps
                        </span>
                      )}
                      {dec.portfolio && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate flex-1 min-w-0">
                          {dec.portfolio.name}
                        </span>
                      )}
                      {!dec.portfolio && <span className="flex-1" />}
                      <ArrowUpRight className="w-2.5 h-2.5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 shrink-0" />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FollowupRow — Compact follow-up row (no background fill)
// ---------------------------------------------------------------------------

function FollowupRow({
  item,
  onCta,
  onDismiss,
  isDismissing,
}: {
  item: FollowupItem
  onCta: () => void
  onDismiss: () => void
  isDismissing: boolean
}) {
  const isEV = item.type === 'high_ev_no_idea'
  const Icon = isEV ? TrendingUp : AlertTriangle
  const iconColor = isEV
    ? 'text-blue-500 dark:text-blue-400'
    : 'text-amber-500 dark:text-amber-400'
  const borderColor = isEV
    ? 'border-l-blue-400 dark:border-l-blue-500'
    : 'border-l-amber-400 dark:border-l-amber-500'

  return (
    <div className={clsx(
      'flex items-center gap-1.5 px-2.5 py-0.5 border-l-2 group',
      borderColor,
    )}>
      <Icon className={clsx('w-3 h-3 shrink-0', iconColor)} />
      <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate flex-1 min-w-0">
        {item.headline}
      </span>
      <button
        onClick={onCta}
        className="shrink-0 text-[10px] font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 underline underline-offset-2"
      >
        {item.ctaLabel}
      </button>
      <button
        onClick={onDismiss}
        disabled={isDismissing}
        className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
        title="Dismiss for 24 hours"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  )
}
