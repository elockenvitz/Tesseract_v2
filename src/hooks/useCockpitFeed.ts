/**
 * useCockpitFeed — Wraps useDashboardFeed with the stacking layer.
 *
 * Merges all DashboardItems from the existing feed into a CockpitViewModel
 * with ranked stacks in DECIDE / ADVANCE / AWARE bands.
 */

import { useMemo } from 'react'
import { useDashboardFeed } from './useDashboardFeed'
import { buildCockpitViewModel } from '../lib/dashboard/dashboardStacks'
import type { DashboardFeedFilters } from './useDashboardFeed'
import type { NavigateFn } from '../lib/dashboard/mapGdeToDashboardItems'
import type { CockpitViewModel } from '../types/cockpit'
import type { ExecutionStats } from '../components/dashboard/ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CockpitFeedResult {
  viewModel: CockpitViewModel
  pipelineStats: ExecutionStats
  isLoading: boolean
  totalCount: number
  snooze: (itemId: string, hours: number) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCockpitFeed(
  filters: DashboardFeedFilters,
  navigate: NavigateFn,
): CockpitFeedResult {
  const feed = useDashboardFeed(filters, navigate)

  const allItems = useMemo(
    () => [...feed.now, ...feed.soon, ...feed.aware],
    [feed.now, feed.soon, feed.aware],
  )

  const viewModel = useMemo(
    () => buildCockpitViewModel(allItems, navigate),
    [allItems, navigate],
  )

  return {
    viewModel,
    pipelineStats: feed.pipelineStats,
    isLoading: feed.isLoading,
    totalCount: feed.totalCount,
    snooze: feed.snooze,
  }
}
