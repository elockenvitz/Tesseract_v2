/**
 * Fetches the asset universe + joined screening data (price targets,
 * coverage) and applies a screen's criteria client-side. Returns a
 * shape assignable to the same `unfilteredAssets` array that manual
 * lists produce, so the table can render it unchanged.
 *
 * Per-row list attributes (_statusId, _assignee, _tags, etc.) are
 * intentionally nulled out — screens don't have stable list_item rows.
 *
 * ── Where the screenable fields come from ────────────────────────────
 *
 * Eight of the fields a saved screen can filter on used to be columns on
 * `assets`: priority, process_stage, completeness, thesis, where_different,
 * risks_to_thesis, quick_note and quick_note_updated_at. `assets` is one global
 * row per ticker, so those were a single value shared by every organisation —
 * a screen for "everything at Analysis stage with a thesis" was really
 * screening whatever the last writer in any tenant had set.
 *
 * The universe query is now global reference data only, and the proprietary
 * half arrives as a per-organisation overlay (`asset-overlay.ts`) that is
 * merged onto each row before the criteria run. Saved screens keep working
 * unchanged — the field keys the evaluator reads are identical — but they now
 * evaluate against THIS organisation's research and workflow state.
 *
 * A caller with no organisation gets an empty overlay, so a proprietary
 * criterion matches nothing rather than matching another tenant's data.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { evaluateCriteria } from '../../lib/lists/screen-evaluator'
import type { ScreenCriteria } from '../../lib/lists/screen-types'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { fetchAssetOverlays, applyAssetOverlay } from '../../lib/research/asset-overlay'

interface UseScreenResultsOptions {
  enabled: boolean
  criteria: ScreenCriteria | null | undefined
}

type PriceTargetRow = { asset_id: string; type: 'bull' | 'base' | 'bear'; price: number }

/**
 * The global reference columns the universe query selects. Declared because the
 * shared client is untyped, so a narrowed `.select()` resolves to `never` and
 * every downstream property read becomes an error.
 */
type UniverseAssetRow = {
  id: string
  symbol: string | null
  company_name: string | null
  current_price: number | null
  market_cap: number | null
  sector: string | null
  industry: string | null
  country: string | null
  exchange: string | null
  created_at: string | null
  updated_at: string | null
  created_by: string | null
}
type CoverageRow = { asset_id: string; analyst_name: string; user_id: string }

export function useScreenResults({ enabled, criteria }: UseScreenResultsOptions) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  const { data: allAssets = [], isLoading: isLoadingAssets } = useQuery({
    queryKey: ['screen-asset-universe'],
    queryFn: async () => {
      // Global reference columns only. The eight proprietary ones this used to
      // request are revoked from `authenticated` at the column level, so asking
      // for them is not merely wrong — it fails the whole query.
      const { data, error } = await supabase
        .from('assets')
        .select(`
          id, symbol, company_name, current_price, market_cap,
          sector, industry, country, exchange,
          created_at, updated_at, created_by
        `)
        .order('symbol', { ascending: true })
      if (error) throw error
      return (data ?? []) as UniverseAssetRow[]
    },
    enabled,
    staleTime: 60_000
  })

  const { data: priceTargets = [] } = useQuery({
    queryKey: ['screen-price-targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_targets')
        .select('asset_id, type, price')
      if (error) throw error
      return (data ?? []) as PriceTargetRow[]
    },
    enabled,
    staleTime: 60_000
  })

  // Coverage feeds three screen criteria (has_coverage, analyst_name,
  // coverage_count), so it is as much a per-organisation overlay as research is
  // — an analyst-name screen matching another firm's analysts is the same
  // defect in a different column. This query was unscoped and relying on RLS
  // alone; organization_id is NOT NULL on all production rows, so filtering is
  // exact rather than best-effort.
  const { data: coverage = [] } = useQuery({
    queryKey: ['screen-coverage', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('asset_id, analyst_name, user_id')
        .eq('organization_id', currentOrgId!)
      if (error) throw error
      return (data ?? []) as CoverageRow[]
    },
    enabled: enabled && !!currentOrgId,
    staleTime: 60_000
  })

  // This organisation's research and workflow state for the same universe.
  // Keyed on the org so switching organisations refetches rather than showing
  // the previous tenant's overlay from cache.
  const { data: overlays } = useQuery({
    queryKey: ['screen-asset-overlay', currentOrgId, allAssets.length, priceTargets.length],
    queryFn: () => fetchAssetOverlays(allAssets.map(a => a.id), currentOrgId, priceTargets),
    enabled: enabled && !!currentOrgId && allAssets.length > 0,
    staleTime: 60_000
  })

  // Build per-asset aggregates from the joined data
  const joined = useMemo(() => {
    const targetsByAsset = new Map<string, PriceTargetRow[]>()
    for (const t of priceTargets) {
      const arr = targetsByAsset.get(t.asset_id) ?? []
      arr.push(t)
      targetsByAsset.set(t.asset_id, arr)
    }
    const coverageByAsset = new Map<string, CoverageRow[]>()
    for (const c of coverage) {
      const arr = coverageByAsset.get(c.asset_id) ?? []
      arr.push(c)
      coverageByAsset.set(c.asset_id, arr)
    }
    return { targetsByAsset, coverageByAsset }
  }, [priceTargets, coverage])

  // Enrich each asset with screening-friendly derived fields
  const enriched = useMemo(() => allAssets.map(globalAsset => {
    // Global reference row + this organisation's overlay, merged explicitly.
    // No overlay (no org, or nothing recorded) leaves every proprietary field
    // null, which is what makes a screen on another tenant's research return
    // nothing rather than something.
    const a = applyAssetOverlay(globalAsset, overlays?.get(globalAsset.id))
    const targets = joined.targetsByAsset.get(a.id) ?? []
    const bull = targets.find(t => t.type === 'bull')
    const base = targets.find(t => t.type === 'base')
    const bear = targets.find(t => t.type === 'bear')
    const cov = joined.coverageByAsset.get(a.id) ?? []

    const price = typeof a.current_price === 'number' ? a.current_price : null
    const upsidePct = (targetPrice: number | undefined) =>
      (targetPrice != null && price != null && price > 0)
        ? ((targetPrice - price) / price) * 100
        : null

    return {
      ...a,
      _bullTargetPrice: bull?.price ?? null,
      _baseTargetPrice: base?.price ?? null,
      _bearTargetPrice: bear?.price ?? null,
      _bullUpsidePct: upsidePct(bull?.price),
      _baseUpsidePct: upsidePct(base?.price),
      _bearUpsidePct: upsidePct(bear?.price),
      _hasAnyTarget: targets.length > 0 ? 'yes' : null,
      _hasBullTarget: bull ? 'yes' : null,
      _hasBaseTarget: base ? 'yes' : null,
      _hasBearTarget: bear ? 'yes' : null,
      _analystNames: cov.map(c => c.analyst_name).join(', ') || null,
      _hasCoverage: cov.length > 0 ? 'yes' : null,
      _coverageCount: cov.length
    }
  }), [allAssets, joined, overlays])

  const matching = useMemo(() => {
    if (!enabled || !criteria) return []
    return enriched.filter(a => evaluateCriteria(a, criteria))
  }, [enriched, criteria, enabled])

  // Shape to match unfilteredAssets contract in ListTab.
  const assets = useMemo(() => matching.map(a => ({
    ...a,
    _rowId: `screen:${a.id}`,
    _sortOrder: null,
    _addedAt: null,
    _addedBy: null,
    _addedByUser: null,
    _listNotes: null,
    _listGroupId: null,
    _assigneeId: null,
    _assignee: null,
    _statusId: null,
    _status: null,
    _dueDate: null,
    _isFlagged: false,
    _tags: [] as Array<{ id: string; name: string; color: string }>
  })), [matching])

  return {
    assets,
    isLoading: isLoadingAssets,
    rawCount: allAssets.length,
    matchCount: matching.length
  }
}
