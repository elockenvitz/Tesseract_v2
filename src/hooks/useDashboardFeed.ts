/**
 * useDashboardFeed — Composite hook for the Decision Engine Console.
 *
 * Merges Decision Engine + Attention System into DashboardItem[],
 * split by band (NOW/SOON/AWARE) with summaries and pipeline stats.
 *
 * Single entry point for the dashboard. All mapping, filtering, and
 * sorting is handled here — the page only renders.
 */

import { useMemo, useCallback, useState } from 'react'
import { useDecisionEngine, flattenForFilter } from '../engine/decisionEngine'
import { useAttention } from './useAttention'
import {
  mapAllToDashboardItems,
  splitByBand,
  computeTodaySummary,
  computeBandSummary,
  filterUrgent,
} from '../lib/dashboard/mapGdeToDashboardItems'
import type { NavigateFn, DecisionLoadSummary } from '../lib/dashboard/mapGdeToDashboardItems'
import { getSnoozedIds, snoozeItem } from '../lib/attention-feed/snooze'
import { computeExecutionStats } from '../components/dashboard/ExecutionSnapshotCard'
import type { DashboardItem, DashboardBandSummary } from '../types/dashboard-item'
import type { ExecutionStats } from '../components/dashboard/ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardFeedFilters {
  portfolioIds: string[]
  urgentOnly: boolean
}

export interface DashboardFeedResult {
  now: DashboardItem[]
  soon: DashboardItem[]
  aware: DashboardItem[]
  nowSummary: DashboardBandSummary
  soonSummary: DashboardBandSummary
  awareSummary: DashboardBandSummary
  todaySummary: DecisionLoadSummary
  pipelineStats: ExecutionStats
  isLoading: boolean
  totalCount: number
  snooze: (itemId: string, hours: number) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardFeed(
  filters: DashboardFeedFilters,
  navigate: NavigateFn,
): DashboardFeedResult {
  // Snooze state
  const [snoozeVersion, setSnoozeVersion] = useState(0)

  const handleSnooze = useCallback((itemId: string, hours: number) => {
    snoozeItem(itemId, hours)
    setSnoozeVersion(v => v + 1)
  }, [])

  // ---- Source 1: Global Decision Engine ----
  const {
    selectForDashboard,
    isLoading: engineLoading,
    tradeIdeas,
  } = useDecisionEngine()

  const engineSlice = selectForDashboard()

  // ---- Source 2: Attention System ----
  const {
    sections: attentionSections,
    isLoading: attentionLoading,
  } = useAttention({ windowHours: 24 })

  // ---- Portfolio filter set (empty = all) ----
  const portfolioSet = useMemo(
    () => new Set(filters.portfolioIds),
    [filters.portfolioIds],
  )
  const hasPortfolioFilter = portfolioSet.size > 0

  // ---- Pipeline stats ----
  const pipelineStats = useMemo(() => {
    let ideas = tradeIdeas
    if (hasPortfolioFilter) {
      ideas = ideas.filter((i: any) => portfolioSet.has(i.portfolio_id))
    }
    return computeExecutionStats(ideas)
  }, [tradeIdeas, portfolioSet, hasPortfolioFilter])

  // ---- Flatten attention sections ----
  const flatAttentionItems = useMemo(() => {
    return [
      ...attentionSections.action_required,
      ...attentionSections.decision_required,
      ...attentionSections.informational,
      ...attentionSections.alignment,
    ]
  }, [attentionSections])

  // ---- Flatten engine rollups for portfolio filter ----
  const filteredEngineAction = useMemo(() => {
    if (hasPortfolioFilter) {
      return flattenForFilter(
        engineSlice.action,
        i => portfolioSet.has(i.context.portfolioId),
      )
    }
    return engineSlice.action
  }, [engineSlice.action, portfolioSet, hasPortfolioFilter])

  const filteredEngineIntel = useMemo(() => {
    if (hasPortfolioFilter) {
      return engineSlice.intel.filter(i => portfolioSet.has(i.context.portfolioId))
    }
    return engineSlice.intel
  }, [engineSlice.intel, portfolioSet, hasPortfolioFilter])

  // ---- Map everything to DashboardItem[] ----
  const allItems = useMemo(() => {
    return mapAllToDashboardItems(
      filteredEngineAction,
      filteredEngineIntel,
      flatAttentionItems,
      navigate,
      handleSnooze,
      portfolioSet,
    )
  }, [filteredEngineAction, filteredEngineIntel, flatAttentionItems, navigate, handleSnooze, portfolioSet])

  // ---- Filter snoozed + urgent-only, split by band ----
  const { now, soon, aware, totalCount } = useMemo(() => {
    const snoozed = getSnoozedIds()
    void snoozeVersion
    let items = allItems.filter(i => !snoozed.has(i.id))

    if (filters.urgentOnly) {
      items = filterUrgent(items)
    }

    const bands = splitByBand(items)
    return {
      ...bands,
      totalCount: bands.now.length + bands.soon.length + bands.aware.length,
    }
  }, [allItems, filters.urgentOnly, snoozeVersion])

  // ---- Summaries ----
  const nowSummary = useMemo(() => computeBandSummary('NOW', now), [now])
  const soonSummary = useMemo(() => computeBandSummary('SOON', soon), [soon])
  const awareSummary = useMemo(() => computeBandSummary('AWARE', aware), [aware])
  const todaySummary = useMemo(() => computeTodaySummary({ now, soon, aware }), [now, soon, aware])

  return {
    now,
    soon,
    aware,
    nowSummary,
    soonSummary,
    awareSummary,
    todaySummary,
    pipelineStats,
    isLoading: engineLoading || attentionLoading,
    totalCount,
    snooze: handleSnooze,
  }
}
