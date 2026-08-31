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
import { largestWeightByAsset, currentRows, type HoldingRow } from '../lib/portfolio/holdings'
import { maturityOf, type IdeaEnrichment, type IdeaRow } from '../lib/desktop-ideas'

/**
 * What "finished" actually means on a trade idea.
 *
 * NOT the stage. `stage` is the research pipeline and is never cleared when an
 * idea completes -- moveTradeIdea sets `outcome` and leaves `stage: 'deciding'`
 * behind. Filtering CLOSED against `stage`, as this did, removed nothing at
 * all, so executed and rejected ideas were being listed as open work.
 *
 * `outcome` is authoritative; `status` is its legacy mirror and is checked too
 * because production has rows where the two disagree.
 */
const TERMINAL_STATUS = new Set(['rejected', 'cancelled', 'executed', 'archived', 'deleted'])

function isTerminal(row: { outcome?: string | null; status?: string | null }): boolean {
  return row.outcome != null || TERMINAL_STATUS.has(row.status ?? '')
}

export function useIdeaScan() {
  const { data, isLoading, error } = useQuery<IdeaRow[]>({
    queryKey: ['desktop-ideas', 'scan'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          id, asset_id, portfolio_id, action, stage, status, outcome, rationale, conviction, urgency,
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
        .filter((r: any) => !isTerminal(r))
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
      // There is no weight column on `portfolio_holdings`; weight is derived
      // against the book's own market value, in lib/portfolio/holdings. Two
      // queries because the denominator is the whole book: which books hold
      // these names, then every line in those books.
      const { data: mine, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id')
        .in('asset_id', ids)
      if (error) throw new Error(error.message)

      const books = [...new Set(((mine ?? []) as any[]).map(r => r.portfolio_id))]
      if (!books.length) return {}

      const { data, error: e2 } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, cost, date')
        .in('portfolio_id', books)
      if (e2) throw new Error(e2.message)

      // The largest single-book stake, not a sum: an idea's exposure question
      // is "how much does this matter in the book it matters most in".
      const all = largestWeightByAsset((data ?? []) as unknown as HoldingRow[])
      const out: Record<string, number> = {}
      for (const id of ids) if (all[id] != null) out[id] = all[id]
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
        // `portfolio_holdings` carries shares, price and cost -- there is no
        // weight or market_value column, so asking for them returned nothing
        // and every idea rendered without exposure. Weight is derived against
        // the book's own NAV, in lib/portfolio/holdings, shared with Portfolio
        // and Research so one definition serves all three.
        supabase.from('portfolio_holdings')
          .select('portfolio_id').eq('asset_id', assetId!),
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

      // The largest single-book stake, not a sum across books: 25.3% of one
      // fund plus 4.0% of another is not 29.3% of anything.
      const books = [...new Set(((holdings.data ?? []) as any[]).map(h => h.portfolio_id))]
      if (books.length) {
        const { data: bookRows } = await supabase.from('portfolio_holdings')
          .select('portfolio_id, asset_id, shares, price, cost, date')
          .in('portfolio_id', books)
        const rows = (bookRows ?? []) as unknown as HoldingRow[]
        const w = largestWeightByAsset(rows)[assetId!]
        if (w != null && w > 0) out.weightPct = w
        const mine = currentRows(rows).find(r => r.asset_id === assetId)
        const mv = mine ? (Number(mine.shares) || 0) * (Number(mine.price) || 0) : 0
        if (mv > 0) out.marketValue = mv
      }

      const count = (research.data ?? []).length
      if (count) out.researchCount = count

      return out
    },
  })

  return { detail: data, isLoading }
}
