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
import {
  weightsByAsset, largestWeightByAsset, buildBook, currentRows,
  type HoldingRow, type Book,
} from '../lib/portfolio/holdings'
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

  const { data } = useQuery<Record<string, ScanExposure>>({
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
      const rows = (data ?? []) as unknown as HoldingRow[]
      const byAsset = weightsByAsset(rows)

      // Rank needs the book the stake sits in, so each book is built once and
      // reused across every idea that lands in it.
      const built = new Map<string, Book>()
      const book = (id: string) => {
        let b = built.get(id)
        if (!b) { b = buildBook(id, rows); built.set(id, b) }
        return b
      }

      const out: Record<string, ScanExposure> = {}
      for (const id of ids) {
        const inBooks = byAsset.get(id)
        if (!inBooks?.size) continue
        // The book where this name matters most.
        let best: { portfolioId: string; pct: number } | null = null
        for (const [portfolioId, pct] of inBooks) {
          if (!best || pct > best.pct) best = { portfolioId, pct }
        }
        if (!best) continue

        // Rank against real positions only. Cash is not a position, so a book
        // holding four names and a cash line is "4", not "5".
        const held = book(best.portfolioId).positions
          .filter(p => !p.isCash && p.marketValue > 0)
          .sort((a, b2) => b2.marketValue - a.marketValue)
        const at = held.findIndex(p => p.assetId === id)

        out[id] = {
          pct: best.pct,
          rank: at >= 0 ? at + 1 : null,
          of: held.length,
          // The book's own biggest stake, so a weight is drawn against
          // something real instead of an invented ceiling.
          largestPct: held.length ? (held[0].weightPct ?? best.pct) : best.pct,
          weights: held.slice(0, 40).map(p => p.weightPct ?? 0),
          portfolioId: best.portfolioId,
        }
      }
      return out
    },
  })

  return data ?? {}
}

/**
 * The desk's own framework for every name in the scan, in two queries.
 *
 * ── Why the scan needs this at all ───────────────────────────────────────
 *
 * An Ideas gallery that can only render a symbol, a stance and a sentence is
 * a list of headlines. The question a reader is actually asking while scanning
 * is "which of these is near a price that matters" -- and the desk has already
 * answered it, in `analyst_price_targets`. Reading that per tile would be N
 * queries; reading it for the whole scan is one.
 *
 * Spot comes from the last close in `price_history_cache`, floored to the last
 * few sessions so the read stays small. A name with no recent close simply has
 * no spot, and its tile falls back to the claim -- never to a stale price
 * dressed up as today's.
 *
 * Nothing here is a new source: both tables are ones the detail read already
 * uses, restricted to the assets on screen.
 */
export function useScanFramework(ideas: IdeaRow[]) {
  const ids = useMemo(
    () => [...new Set(ideas.map(i => i.assetId).filter((x): x is string => !!x))].sort(),
    [ideas],
  )
  const symbols = useMemo(
    () => [...new Set(ideas.map(i => i.symbol).filter((x): x is string => !!x))].sort(),
    [ideas],
  )

  const { data } = useQuery<Record<string, ScanFrame>>({
    queryKey: ['desktop-ideas', 'framework', ids.join('|')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // The price floor is no longer "the last few sessions". A card wants to
      // say what the market has done SINCE THE IDEA WAS WRITTEN, so the window
      // has to reach the oldest idea on screen, plus the anchor lookback. It
      // is still one batched read for every symbol at once, and still the same
      // cache entry -- only the floor moved.
      const oldest = ideas.reduce(
        (min, i) => Math.min(min, new Date(i.createdAt).getTime()), Date.now())
      const floor = new Date(oldest - ANCHOR_LOOKBACK_DAYS * 86_400_000)
        .toISOString().slice(0, 10)

      const [targets, closes, cases] = await Promise.all([
        supabase.from('analyst_price_targets')
          .select('id, asset_id, price, is_official, created_at, updated_at, scenarios(name), assets(id, symbol, company_name)')
          .in('asset_id', ids),
        symbols.length
          ? supabase.from('price_history_cache')
              .select('symbol, date, close').in('symbol', symbols).gte('date', floor)
          : Promise.resolve({ data: [] as any[], error: null }),
        // Scenarios that exist but were never priced cannot be seen from
        // `analyst_price_targets` -- an asset with three named cases and no
        // target has no rows there at all. "Three cases named, none priced" is
        // the most useful thing a thin card can say, so it is read directly.
        supabase.from('scenarios').select('asset_id, name').in('asset_id', ids),
        // A note count was the obvious fifth thing to read here and is
        // deliberately not read: `asset_notes` is org-scoped and the scan has
        // no organisation filter to give it, so counting notes would have
        // added an unscoped query to a surface that is not allowed to grow
        // one. The case map says less as a result, and says it honestly.
      ])
      if (targets.error) throw new Error(targets.error.message)

      // The whole series per symbol, oldest first, so a card can find its own
      // anchor: ideas on the same name were written on different days and each
      // one measures from its own.
      const seriesBySymbol = new Map<string, { date: string; close: number }[]>()
      for (const r of ((closes as any).data ?? []) as any[]) {
        const close = Number(r.close)
        if (!Number.isFinite(close) || close <= 0) continue
        const list = seriesBySymbol.get(r.symbol)
        if (list) list.push({ date: r.date, close })
        else seriesBySymbol.set(r.symbol, [{ date: r.date, close }])
      }
      for (const list of seriesBySymbol.values()) list.sort((a, b) => a.date < b.date ? -1 : 1)

      const countBy = (res: any) => {
        const out = new Map<string, number>()
        for (const r of (res?.data ?? []) as any[]) {
          if (r.asset_id) out.set(r.asset_id, (out.get(r.asset_id) ?? 0) + 1)
        }
        return out
      }
      const casesNamed = countBy(cases)
      // The names are already in the rows this query returns, so a card can
      // say WHICH cases were written rather than only how many.
      const caseNames = new Map<string, string[]>()
      for (const r of ((cases as any)?.data ?? []) as any[]) {
        if (!r.asset_id || !r.name) continue
        const list = caseNames.get(r.asset_id)
        if (list) { if (!list.includes(r.name)) list.push(r.name) }
        else caseNames.set(r.asset_id, [r.name])
      }

      const out: Record<string, ScanFrame> = {}
      const rows = (targets.data ?? []) as TargetRow[]

      for (const ladder of selectCurrentLadders(rows)) {
        if (!ladder.valid || ladder.cases.length < 2) continue
        out[ladder.assetId] = {
          ...(out[ladder.assetId] ?? {}),
          ladder: ladder.cases.map(c => ({ name: c.name, price: c.price })),
        }
      }
      // A single official target is a weaker but still real statement of
      // intent, kept for names with no full ladder.
      for (const r of rows) {
        const price = Number((r as any).price)
        if (!(r as any).is_official || !Number.isFinite(price) || price <= 0) continue
        const id = (r as any).asset_id
        if (!id) continue
        out[id] = { ...(out[id] ?? {}), target: price }
      }

      // Case structure exists for every asset on screen, framework or not --
      // it is what the thinnest cards are left with.
      for (const id of ids) {
        const named = casesNamed.get(id) ?? 0
        if (!named) continue
        out[id] = {
          ...(out[id] ?? {}), casesNamed: named, caseNames: caseNames.get(id) ?? [],
        }
      }

      // Spot and the series attach to every name that has closes, not only to
      // the ones with a framework: since-open is exactly the visual for an
      // idea whose desk framework was never written.
      for (const idea of ideas) {
        if (!idea.assetId || !idea.symbol) continue
        const series = seriesBySymbol.get(idea.symbol)
        if (!series?.length) continue
        out[idea.assetId] = {
          ...(out[idea.assetId] ?? {}),
          spot: series[series.length - 1].close,
          closes: series,
        }
      }

      return out
    },
  })

  return data ?? {}
}

/**
 * The price the desk recorded when each idea was created.
 *
 * One batched read keyed by the ideas on screen. It covers a minority of them
 * -- most ideas predate the snapshot being taken -- but where it exists it is
 * better evidence than any close we could pick, because it is the number the
 * desk itself wrote down rather than one inferred from the tape.
 */
export function useScanOpenPrice(ideas: IdeaRow[]) {
  const ids = useMemo(() => ideas.map(i => i.id).sort(), [ideas])

  const { data } = useQuery<Record<string, number>>({
    queryKey: ['desktop-ideas', 'open-price', ids.join('|')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('decision_price_snapshots')
        .select('trade_queue_item_id, snapshot_price, snapshot_type, created_at')
        .in('trade_queue_item_id', ids)
      if (error) throw new Error(error.message)

      // Earliest snapshot per idea: the one taken when it was created, not a
      // later re-snapshot taken at decision time.
      const first = new Map<string, { at: string; price: number }>()
      for (const r of (data ?? []) as any[]) {
        const price = Number(r.snapshot_price)
        if (!Number.isFinite(price) || price <= 0) continue
        const held = first.get(r.trade_queue_item_id)
        if (!held || r.created_at < held.at) {
          first.set(r.trade_queue_item_id, { at: r.created_at, price })
        }
      }
      return Object.fromEntries([...first].map(([k, v]) => [k, v.price]))
    },
  })

  return data ?? {}
}

/** Ladder rungs and today's price for one name, as the scan knows them. */
export interface ScanFrame {
  ladder?: { name: string; price: number }[]
  target?: number
  spot?: number
  /** Every close from the anchor floor to today, oldest first. */
  closes?: { date: string; close: number }[]
  /** Scenarios named on the asset, whether or not anyone priced them. */
  casesNamed?: number
  caseNames?: string[]
}

/**
 * What the book already holds of this name, and how that ranks.
 *
 * A weight on its own is not interpretable -- 25% is enormous in a fifty-name
 * book and unremarkable in a four-name one. The rank and the position count
 * are what make it readable, and both come from holdings already fetched.
 */
export interface ScanExposure {
  pct: number
  /** Position by market value in that book, largest first. */
  rank: number | null
  of: number
  /** The largest single position in that book, as the scale to draw against. */
  largestPct: number
  /**
   * Every position's weight in that book, largest first.
   *
   * The card drew a single bar of `pct / largestPct`, which is 100% full for
   * the largest position in any book -- a progress bar for something that is
   * not progress, telling the reader nothing at the exact moment they most
   * wanted to know something. The shape of the book answers the real question
   * ("how concentrated is this, and where do I sit in it"), and it was already
   * sorted in hand one line above where the old field was assembled.
   *
   * Capped, because a bar per position stops being legible long before a book
   * stops having positions, and 40 hairlines already state the shape.
   */
  weights: number[]
  portfolioId: string
}

/** Spot is only spot if it is recent. Beyond this the tile shows no price. */
/**
 * How far before an idea's creation date we will look for its opening price.
 *
 * Seven calendar days covers a long weekend plus a holiday. Beyond that the
 * price is not the price when the idea was written, and the card says nothing
 * rather than something close enough.
 */
const ANCHOR_LOOKBACK_DAYS = 7

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
