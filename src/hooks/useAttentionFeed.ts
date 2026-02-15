/**
 * useAttentionFeed — Composite hook merging Decision Engine + Attention System
 * into a unified, band-sorted attention feed.
 *
 * Single entry point for the dashboard. Returns items split by band (NOW/SOON/AWARE),
 * with summaries and filter support.
 */

import { useMemo, useCallback, useState } from 'react'
import { useDecisionEngine, flattenForFilter } from '../engine/decisionEngine'
import { useAttention } from './useAttention'
import { useAuth } from './useAuth'
import { adaptDecisionItem, adaptAttentionItem, mergeAndDedup } from '../lib/attention-feed/adapters'
import { sortByBand, computeBandSummary, filterUrgentOnly } from '../lib/attention-feed/bandAssignment'
import { getSnoozedIds, snoozeItem } from '../lib/attention-feed/snooze'
import { computeExecutionStats } from '../components/dashboard/ExecutionSnapshotCard'
import type { AttentionFeedItem, BandSummary } from '../types/attention-feed'
import type { ExecutionStats } from '../components/dashboard/ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttentionFeedFilters {
  portfolioId: string | null
  urgentOnly: boolean
}

export interface AttentionFeedResult {
  now: AttentionFeedItem[]
  soon: AttentionFeedItem[]
  aware: AttentionFeedItem[]
  nowSummary: BandSummary
  soonSummary: BandSummary
  awareSummary: BandSummary
  pipelineStats: ExecutionStats
  isLoading: boolean
  isError: boolean
  /** Total items across all bands before limiting */
  totalCount: number
  /** Snooze an item locally */
  snooze: (itemId: string, hours: number) => void
  /** Force re-read of snooze state */
  refreshSnooze: () => void
  /** Mark deliverable as done */
  markDeliverableDone: (deliverableId: string) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAttentionFeed(
  filters: AttentionFeedFilters,
): AttentionFeedResult {
  const { user } = useAuth()
  const now = useMemo(() => new Date(), [])

  // Snooze state — trigger re-render when changed
  const [snoozeVersion, setSnoozeVersion] = useState(0)

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
    markDeliverableDone: markDone,
  } = useAttention({ windowHours: 24 })

  // ---- Pipeline stats ----
  const pipelineStats = useMemo(() => {
    let ideas = tradeIdeas
    if (filters.portfolioId) {
      ideas = ideas.filter((i: any) => i.portfolio_id === filters.portfolioId)
    }
    return computeExecutionStats(ideas)
  }, [tradeIdeas, filters.portfolioId])

  // ---- Convert engine items ----
  const engineFeedItems = useMemo(() => {
    // Flatten rollups to get individual items, but also keep rollup parents
    let actionItems = engineSlice.action
    let intelItems = engineSlice.intel

    // Portfolio filter
    if (filters.portfolioId) {
      actionItems = flattenForFilter(
        actionItems,
        i => i.context.portfolioId === filters.portfolioId,
      )
      intelItems = intelItems.filter(
        i => i.context.portfolioId === filters.portfolioId,
      )
    }

    // Flatten rollup children for feed display
    const flatAction: typeof actionItems = []
    for (const item of actionItems) {
      if (item.children?.length) {
        flatAction.push(...item.children)
      } else {
        flatAction.push(item)
      }
    }

    return [
      ...flatAction.map(i => adaptDecisionItem(i, now)),
      ...intelItems.map(i => adaptDecisionItem(i, now)),
    ]
  }, [engineSlice, filters.portfolioId, now])

  // ---- Convert attention items ----
  const attentionFeedItems = useMemo(() => {
    const items: AttentionFeedItem[] = []

    // Skip trade_queue_item sources (engine handles these)
    const skipSourceTypes = new Set(['trade_queue_item'])

    for (const section of [
      attentionSections.action_required,
      attentionSections.decision_required,
      attentionSections.informational,
      attentionSections.alignment,
    ]) {
      for (const item of section) {
        if (skipSourceTypes.has(item.source_type)) continue

        // Portfolio filter
        if (filters.portfolioId) {
          if (item.context?.portfolio_id && item.context.portfolio_id !== filters.portfolioId) {
            continue
          }
        }

        items.push(adaptAttentionItem(item, now))
      }
    }

    return items
  }, [attentionSections, filters.portfolioId, now])

  // ---- Merge, dedup, filter, sort ----
  const { now: nowItems, soon: soonItems, aware: awareItems, totalCount } = useMemo(() => {
    // Merge
    let merged = mergeAndDedup(engineFeedItems, attentionFeedItems)

    // Filter out snoozed items
    const snoozed = getSnoozedIds()
    // eslint-disable-next-line no-unused-vars
    void snoozeVersion // re-read on snooze change
    merged = merged.filter(i => !snoozed.has(i.id))

    // Urgent-only filter
    if (filters.urgentOnly) {
      merged = filterUrgentOnly(merged)
    }

    // Sort by band
    const sorted = sortByBand(merged)

    return {
      ...sorted,
      totalCount: sorted.now.length + sorted.soon.length + sorted.aware.length,
    }
  }, [engineFeedItems, attentionFeedItems, filters.urgentOnly, snoozeVersion])

  // ---- Summaries ----
  const nowSummary = useMemo(() => computeBandSummary('now', nowItems), [nowItems])
  const soonSummary = useMemo(() => computeBandSummary('soon', soonItems), [soonItems])
  const awareSummary = useMemo(() => computeBandSummary('aware', awareItems), [awareItems])

  // ---- Actions ----
  const handleSnooze = useCallback((itemId: string, hours: number) => {
    snoozeItem(itemId, hours)
    setSnoozeVersion(v => v + 1)
  }, [])

  const refreshSnooze = useCallback(() => {
    setSnoozeVersion(v => v + 1)
  }, [])

  const handleMarkDone = useCallback((deliverableId: string) => {
    markDone(deliverableId)
  }, [markDone])

  return {
    now: nowItems,
    soon: soonItems,
    aware: awareItems,
    nowSummary,
    soonSummary,
    awareSummary,
    pipelineStats,
    isLoading: engineLoading || attentionLoading,
    isError: false,
    totalCount,
    snooze: handleSnooze,
    refreshSnooze,
    markDeliverableDone: handleMarkDone,
  }
}
