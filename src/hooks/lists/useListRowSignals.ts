/**
 * Everything a collapsed list row needs, read once for the whole list.
 *
 * A list is virtualised and can hold hundreds of names, so nothing here may be
 * per-row: five hooks for the table, not five hooks per line. Each source is
 * the canonical one already used elsewhere —
 *
 *   • work state    `useResearchScan` + `stateOf` (the real research lifecycle,
 *                   not list task metadata). It already folds in the
 *                   `thesis.reviewed` clock via `useThesisReviews`.
 *   • position      `useHoldingsForAssets` + `largestWeightByAsset`
 *   • sparkline     `useSparklines`
 *   • rating scales `useRatingScales`
 *
 * Ratings and price targets are the exception: there is no reusable batched
 * read for either. The pattern is currently inlined in `usePortfolioLenses`,
 * `useGlobalDecisionEngine`, `useDecisionEngine` and `useTodayEnrichment`, each
 * with its own shape. The two queries below are that read, parameterised by
 * asset id — a fifth copy would have been the wrong move, and a sixth is not
 * needed.
 *
 * RLS posture: unchanged. `analyst_ratings` and `analyst_price_targets` are
 * both org-scoped and already policy-gated on org membership; these reads add
 * the same `organization_id` filter the existing call sites use and request no
 * column that was not already readable. No policy is widened.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useResearchScan } from '../useDesktopResearch'
import { useHoldingsForAssets, assetIdKey } from '../useHoldingsForAssets'
import { largestWeightByAsset } from '../../lib/portfolio/holdings'
import { useSparklines } from '../useSparklines'
import { useRatingScales, type ConvictionLevel } from '../useAnalystRatings'
import { stateOf, type ResearchState, type ResearchSubject } from '../../lib/desktop-research/model'

/**
 * How many names one list read will resolve.
 *
 * `.in()` goes into the query string, so an unbounded list would eventually
 * produce a request no proxy accepts. Rows past the cap render without these
 * signals rather than failing the whole read — the same tradeoff
 * `usePortfolioLenses` makes at 500.
 */
const MAX_IDS = 300

export interface ListRowSignal {
  /** Research-lifecycle state, or null when this asset is not in the scan. */
  state: ResearchState | null
  subject: ResearchSubject | null
  /** Largest single-book weight, in percent. Absent when unheld. */
  weightPct: number | null
  closes: number[] | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: ConvictionLevel | null
  targetPrice: number | null
}

const EMPTY: ListRowSignal = {
  state: null, subject: null, weightPct: null, closes: null,
  ratingValue: null, ratingColor: null, conviction: null, targetPrice: null,
}

interface RatingRow {
  asset_id: string
  rating_value: string
  rating_scale_id: string
  conviction: ConvictionLevel | null
  is_official: boolean | null
  updated_at: string
}

interface TargetRow {
  asset_id: string
  price: number | string | null
  is_official: boolean | null
  updated_at: string
}

/**
 * Official wins; otherwise the most recently touched row.
 *
 * Rows arrive newest-first, so the first row for an asset is already the
 * newest — it is only displaced by an official one.
 */
function pickPerAsset<T extends { asset_id: string; is_official?: boolean | null }>(
  rows: T[],
): Map<string, T> {
  const out = new Map<string, T>()
  for (const row of rows) {
    const held = out.get(row.asset_id)
    if (!held) { out.set(row.asset_id, row); continue }
    if (row.is_official && !held.is_official) out.set(row.asset_id, row)
  }
  return out
}

function useBatchedRatings(ids: string[]) {
  const { currentOrgId } = useOrganization()
  const key = ids.join('|')
  return useQuery({
    queryKey: ['list-row-signals', 'ratings', currentOrgId, key],
    enabled: !!currentOrgId && ids.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analyst_ratings')
        .select('asset_id, rating_value, rating_scale_id, conviction, is_official, updated_at')
        .eq('organization_id', currentOrgId!)
        .in('asset_id', ids)
        .order('updated_at', { ascending: false })
      if (error) throw new Error(error.message)
      return pickPerAsset((data ?? []) as RatingRow[])
    },
  })
}

function useBatchedTargets(ids: string[]) {
  const { currentOrgId } = useOrganization()
  const key = ids.join('|')
  return useQuery({
    queryKey: ['list-row-signals', 'targets', currentOrgId, key],
    enabled: !!currentOrgId && ids.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analyst_price_targets')
        .select('asset_id, price, is_official, updated_at')
        .eq('organization_id', currentOrgId!)
        .in('asset_id', ids)
        .order('updated_at', { ascending: false })
      if (error) throw new Error(error.message)
      return pickPerAsset((data ?? []) as TargetRow[])
    },
  })
}

/**
 * @param assets the list's rows, as `ListTab` maps them (needs `id`, `symbol`)
 */
export function useListRowSignals(assets: Array<{ id?: string | null; symbol?: string | null }>) {
  // Sorted + de-duped, so scrolling and re-filtering reuse one cache entry
  // instead of issuing a fresh query per render order.
  const ids = useMemo(
    () => assetIdKey(assets.map(a => a?.id)).slice(0, MAX_IDS),
    [assets],
  )
  const symbols = useMemo(
    () => [...new Set(assets.map(a => a?.symbol).filter((s): s is string => !!s))].sort(),
    [assets],
  )

  const { subjects } = useResearchScan()
  const { rows: holdingRows } = useHoldingsForAssets(ids)
  const sparklines = useSparklines(symbols)
  const { scales } = useRatingScales()
  const { data: ratings } = useBatchedRatings(ids)
  const { data: targets } = useBatchedTargets(ids)

  const subjectByAsset = useMemo(() => {
    const m = new Map<string, ResearchSubject>()
    for (const s of subjects ?? []) m.set(s.assetId, s)
    return m
  }, [subjects])

  const weights = useMemo(() => largestWeightByAsset(holdingRows), [holdingRows])

  /** value → colour, from whatever scale the rating was recorded against. */
  const colorFor = useMemo(() => {
    const m = new Map<string, string>()
    for (const scale of scales ?? []) {
      for (const v of scale.values ?? []) m.set(`${scale.id}:${v.value}`, v.color)
    }
    return m
  }, [scales])

  return useMemo(() => {
    const byAsset = new Map<string, ListRowSignal>()
    for (const asset of assets) {
      const id = asset?.id
      if (!id) continue
      const subject = subjectByAsset.get(id) ?? null
      const rating = ratings?.get(id) ?? null
      const target = targets?.get(id) ?? null
      const targetPrice = target?.price == null ? null : Number(target.price)
      byAsset.set(id, {
        state: subject ? stateOf(subject) : null,
        subject,
        weightPct: weights[id] ?? null,
        closes: (asset?.symbol && sparklines[asset.symbol]?.closes) || null,
        ratingValue: rating?.rating_value ?? null,
        ratingColor: rating
          ? colorFor.get(`${rating.rating_scale_id}:${rating.rating_value}`) ?? null
          : null,
        conviction: rating?.conviction ?? null,
        targetPrice: Number.isFinite(targetPrice) ? targetPrice : null,
      })
    }
    return {
      /** Never null — an unknown asset reads as "nothing known", not a crash. */
      signalFor: (assetId?: string | null) =>
        (assetId && byAsset.get(assetId)) || EMPTY,
      /** True once every name in the list was inside the id cap. */
      complete: ids.length >= assetIdKey(assets.map(a => a?.id)).length,
    }
  }, [assets, subjectByAsset, ratings, targets, weights, sparklines, colorFor, ids])
}
