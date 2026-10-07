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
import { useIdeaScan } from '../useDesktopIdeas'
import { workStateFor, type WorkState } from '../../lib/lists/work-state'
import { useHoldingsForAssets, assetIdKey } from '../useHoldingsForAssets'
import { largestWeightByAsset } from '../../lib/portfolio/holdings'
import { useSparklines } from '../useSparklines'
import { useRatingScales, type ConvictionLevel } from '../useAnalystRatings'
import { stateOf, type ResearchState, type ResearchSubject } from '../../lib/desktop-research/model'
import { FINAL_STAGE } from '../../lib/ideas/stage-model'

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
  /**
   * What the Work column should say, in investment priority order.
   *
   * A live idea outranks a research fact — see `workStateFor`. Kept alongside
   * `state` rather than replacing it, because the expansion still needs the
   * raw research state for its own branching.
   */
  work: WorkState
  /**
   * The live idea on this name, if any. Already non-terminal and unparked.
   *
   * Carries what the Decision surface needs — who proposed it, when, at what
   * weight and why — so engaging a recommendation costs no further read.
   */
  idea: {
    id: string
    direction: string | null
    stage: string | null
    portfolioName: string | null
    proposedWeight: number | null
    rationale: string | null
    authorName: string | null
    createdAt: string | null
    conviction: string | null
  } | null
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
  work: { tier: 'clear', label: '', count: 0, secondary: null },
  idea: null,
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
  // Org-wide and cached 60s, shared with Lists home's attention fold — so the
  // Work column learns about live ideas without a query of its own.
  const { ideas } = useIdeaScan()
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

  /**
   * The idea that speaks for a name.
   *
   * Furthest through the lifecycle wins, so a name carrying both an exploratory
   * idea and one awaiting a decision reports the decision. `useIdeaScan` has
   * already dropped terminal and parked rows, so every candidate here is live.
   */
  const ideaByAsset = useMemo(() => {
    const m = new Map<string, NonNullable<ListRowSignal['idea']>>()
    for (const i of ideas ?? []) {
      if (!i.assetId) continue
      const held = m.get(i.assetId)
      const rank = (s: string | null) => (s === FINAL_STAGE ? 2 : 1)
      if (!held || rank(i.stage ?? null) > rank(held.stage)) {
        m.set(i.assetId, {
          id: i.id,
          direction: i.direction ?? null,
          stage: i.stage ?? null,
          portfolioName: i.portfolioName ?? null,
          proposedWeight: i.proposedWeight ?? null,
          rationale: i.thesis ?? null,
          authorName: i.authorName ?? null,
          createdAt: i.createdAt ?? null,
          conviction: i.conviction ?? null,
        })
      }
    }
    return m
  }, [ideas])

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
      const state = subject ? stateOf(subject) : null
      const idea = ideaByAsset.get(id) ?? null
      byAsset.set(id, {
        state,
        subject,
        idea,
        work: workStateFor(idea, state, subject?.newSinceReview ?? 0),
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
      /** Every resolved signal, for aggregates like the list header's pulse. */
      all: [...byAsset.values()],
      /** True once every name in the list was inside the id cap. */
      complete: ids.length >= assetIdKey(assets.map(a => a?.id)).length,
    }
  }, [assets, subjectByAsset, ideaByAsset, ratings, targets, weights, sparklines, colorFor, ids])
}
