/**
 * useExpectedValue — Probability-weighted expected value from analyst price targets.
 *
 * Extracts the EV formula previously inline in ProbabilityDistributionModal
 * into a reusable hook so other features (e.g. rating divergence badges)
 * can consume EV without duplicating the computation.
 *
 * Supports view scoping:
 * - firm scope (viewScopeType='firm'): uses ALL targets for the asset (no userId filter)
 * - user scope (viewScopeType='user'): uses only the specified user's targets
 */

import { useMemo } from 'react'
import { useAnalystPriceTargets } from './useAnalystPriceTargets'
import { useAuth } from './useAuth'

export type ViewScopeType = 'firm' | 'user'

export interface ViewScope {
  type: ViewScopeType
  /** Set when type='user'. The user whose view we're looking at. */
  userId?: string
}

interface UseExpectedValueOptions {
  assetId: string
  currentPrice?: number
  /** View scope — defaults to current user's view */
  viewScope?: ViewScope
}

interface UseExpectedValueResult {
  /** Probability-weighted expected price, or null if insufficient data */
  expectedPrice: number | null
  /** (evPrice - currentPrice) / currentPrice, or null */
  expectedReturn: number | null
  /** True when at least one target has price > 0 AND probability != null */
  hasData: boolean
  isLoading: boolean
}

export function useExpectedValue({
  assetId,
  currentPrice,
  viewScope,
}: UseExpectedValueOptions): UseExpectedValueResult {
  const { user } = useAuth()

  // Determine userId filter based on view scope:
  // - firm: no userId filter (fetch all targets)
  // - user: filter to that user's targets
  // - default (no scope): current user
  const targetUserId = viewScope
    ? viewScope.type === 'firm' ? undefined : (viewScope.userId ?? user?.id)
    : user?.id

  const { priceTargets, isLoading } = useAnalystPriceTargets({
    assetId,
    userId: targetUserId,
  })

  return useMemo(() => {
    if (isLoading) return { expectedPrice: null, expectedReturn: null, hasData: false, isLoading: true }

    // Filter to targets with a real price and assigned probability
    const withProb = (priceTargets || []).filter(
      (pt) => pt.price > 0 && pt.probability != null
    )

    if (withProb.length === 0) {
      return { expectedPrice: null, expectedReturn: null, hasData: false, isLoading: false }
    }

    const totalProb = withProb.reduce((sum, pt) => sum + (pt.probability ?? 0), 0)
    if (totalProb <= 0) {
      return { expectedPrice: null, expectedReturn: null, hasData: false, isLoading: false }
    }

    const expectedPrice =
      withProb.reduce((sum, pt) => sum + pt.price * (pt.probability ?? 0), 0) / totalProb

    const expectedReturn =
      currentPrice && currentPrice > 0
        ? (expectedPrice - currentPrice) / currentPrice
        : null

    return { expectedPrice, expectedReturn, hasData: true, isLoading: false }
  }, [priceTargets, currentPrice, isLoading])
}
