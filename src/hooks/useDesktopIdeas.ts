/**
 * Desktop Ideas — data.
 *
 * Two hooks, deliberately split by cost:
 *
 *   useIdeaScan()          one light query for the whole list
 *   useIdeaDetail(assetId) the deep read, for the ONE selected Idea
 *
 * The scan never triggers a per-card fetch. Opening an Idea fetches its
 * history, ladder, exposure and research once, and React Query caches it, so
 * moving AMZN → CROX → MCD → NVDA and back is one read each, not N.
 *
 * Every source here is one D3.2 already proved against production. No new
 * table, no migration.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { selectCurrentLadders, type TargetRow } from '../lib/signals/current-ladder'
import { maturityOf, type IdeaEnrichment, type IdeaRow } from '../lib/desktop-ideas'

/** Stages that mean the Idea is finished with, one way or another. */
const CLOSED = new Set(['rejected', 'cancelled', 'executed', 'archived', 'deleted', 'approved'])

export function useIdeaScan() {
  const { data, isLoading, error } = useQuery<IdeaRow[]>({
    queryKey: ['desktop-ideas', 'scan'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          id, asset_id, portfolio_id, action, stage, rationale, conviction, urgency,
          proposed_weight, decision_outcome, visibility_tier, created_by, created_at, updated_at,
          assets(id, symbol, company_name),
          portfolios(id, name),
          users!trade_queue_items_created_by_fkey(id, first_name, last_name, email)
        `)
        .eq('visibility_tier', 'active')
        .order('updated_at', { ascending: false })
        .limit(200)

      if (error) throw new Error(error.message)

      return (data ?? [])
        .filter((r: any) => !CLOSED.has(r.stage))
        .map((r: any): IdeaRow => ({
          id: r.id,
          assetId: r.asset_id ?? null,
          symbol: r.assets?.symbol ?? null,
          companyName: r.assets?.company_name ?? null,
          direction: r.action ?? null,
          stage: r.stage ?? null,
          maturity: maturityOf(r.stage),
          conviction: r.conviction ?? null,
          thesis: r.rationale ?? null,
          urgency: r.urgency ?? null,
          proposedWeight: r.proposed_weight != null ? Number(r.proposed_weight) : null,
          portfolioId: r.portfolio_id ?? null,
          portfolioName: r.portfolios?.name ?? null,
          createdBy: r.created_by ?? null,
          authorName: nameOf(r.users),
          createdAt: r.created_at,
          updatedAt: r.updated_at ?? null,
          decisionOutcome: r.decision_outcome ?? null,
        }))
    },
  })

  return { ideas: data ?? [], isLoading, error }
}

function nameOf(u: any): string | null {
  if (!u) return null
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.email || null
}

/**
 * Light exposure for the whole scan.
 *
 * One query, not one per card. Weight is the only enrichment the scan needs —
 * it drives materiality in the ranking and the one metric worth showing on a
 * compact tile. Everything heavier waits for selection.
 */
export function useScanExposure(ideas: IdeaRow[]) {
  const ids = useMemo(
    () => [...new Set(ideas.map(i => i.assetId).filter((x): x is string => !!x))].sort(),
    [ideas],
  )

  const { data } = useQuery<Record<string, number>>({
    queryKey: ['desktop-ideas', 'exposure', ids.join('|')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolio_holdings')
        .select('asset_id, weight')
        .in('asset_id', ids)

      const out: Record<string, number> = {}
      for (const row of (data ?? []) as any[]) {
        const raw = Number(row.weight)
        if (!Number.isFinite(raw) || raw <= 0) continue
        // Some rows store fractions, some percents; <= 1 is read as a fraction.
        const pct = raw <= 1 ? raw * 100 : raw
        out[row.asset_id] = (out[row.asset_id] ?? 0) + pct
      }
      return out
    },
  })

  return data ?? {}
}

const HISTORY_DAYS = 400

/** The deep read, for one selected Idea only. */
export function useIdeaDetail(idea: IdeaRow | null) {
  const assetId = idea?.assetId ?? null
  const symbol = idea?.symbol ?? null

  const { data, isLoading } = useQuery<IdeaEnrichment>({
    queryKey: ['desktop-ideas', 'detail', assetId],
    enabled: !!assetId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const floor = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10)

      const [history, targets, holdings, research] = await Promise.all([
        symbol
          ? supabase.from('price_history_cache')
              .select('date, close').eq('symbol', symbol).gte('date', floor)
              .order('date', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('analyst_price_targets')
          .select('id, asset_id, price, is_official, created_at, updated_at, scenarios(name), assets(id, symbol, company_name)')
          .eq('asset_id', assetId!),
        supabase.from('portfolio_holdings')
          .select('weight, market_value, portfolios(name)').eq('asset_id', assetId!),
        supabase.from('asset_notes')
          .select('id').eq('asset_id', assetId!).eq('is_deleted', false),
      ])

      const out: IdeaEnrichment = {}

      const series = (history.data ?? [])
        .map((r: any) => ({ date: r.date, close: Number(r.close) }))
        .filter(p => Number.isFinite(p.close))
      if (series.length >= 2) {
        out.history = series
        out.spot = series[series.length - 1].close
      }

      const ladders = selectCurrentLadders((targets.data ?? []) as TargetRow[])
      const valid = ladders.find(l => l.valid)
      if (valid) {
        out.ladder = {
          cases: valid.cases.map(c => ({ name: c.name, price: c.price })),
          updatedAt: valid.updatedAt,
        }
      }
      // A single official target is a weaker but still real statement of
      // intent, so it is kept even when there is no full ladder.
      const official = (targets.data ?? []).find((t: any) => t.is_official && Number(t.price) > 0)
      if (official) out.target = Number((official as any).price)

      let weight = 0
      for (const h of (holdings.data ?? []) as any[]) {
        const raw = Number(h.weight)
        if (Number.isFinite(raw) && raw > 0) weight += raw <= 1 ? raw * 100 : raw
        const mv = Number(h.market_value)
        if (Number.isFinite(mv)) out.marketValue = (out.marketValue ?? 0) + mv
      }
      if (weight > 0) out.weightPct = weight

      const count = (research.data ?? []).length
      if (count) out.researchCount = count

      return out
    },
  })

  return { detail: data, isLoading }
}
