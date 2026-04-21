/**
 * Fetches the asset universe + joined screening data (price targets,
 * coverage) and applies a screen's criteria client-side. Returns a
 * shape assignable to the same `unfilteredAssets` array that manual
 * lists produce, so the table can render it unchanged.
 *
 * Per-row list attributes (_statusId, _assignee, _tags, etc.) are
 * intentionally nulled out — screens don't have stable list_item rows.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { evaluateCriteria } from '../../lib/lists/screen-evaluator'
import type { ScreenCriteria } from '../../lib/lists/screen-types'

interface UseScreenResultsOptions {
  enabled: boolean
  criteria: ScreenCriteria | null | undefined
}

type PriceTargetRow = { asset_id: string; type: 'bull' | 'base' | 'bear'; price: number }
type CoverageRow = { asset_id: string; analyst_name: string; user_id: string }

export function useScreenResults({ enabled, criteria }: UseScreenResultsOptions) {
  const { data: allAssets = [], isLoading: isLoadingAssets } = useQuery({
    queryKey: ['screen-asset-universe'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select(`
          id, symbol, company_name, current_price, market_cap,
          sector, industry, country, exchange,
          priority, process_stage, completeness,
          thesis, where_different, risks_to_thesis, quick_note, quick_note_updated_at,
          created_at, updated_at, created_by
        `)
        .order('symbol', { ascending: true })
      if (error) throw error
      return data ?? []
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

  const { data: coverage = [] } = useQuery({
    queryKey: ['screen-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('asset_id, analyst_name, user_id')
      if (error) throw error
      return (data ?? []) as CoverageRow[]
    },
    enabled,
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
  const enriched = useMemo(() => allAssets.map(a => {
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
  }), [allAssets, joined])

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
