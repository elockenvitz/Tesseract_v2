/**
 * Desktop Portfolio — data.
 *
 * Split by cost, as Ideas and Research are:
 *
 *   usePortfolioList()          the books this user can see, and their role
 *   useBook(portfolioId)        holdings + derived weights for ONE book
 *   useBookFrames(book)         four narrow reads that make the scan honest
 *   usePositionDetail(position) the deep read, for the ONE selected position
 *
 * `useBookFrames` is the one place a scan-time read is more than a count, and
 * it is still four queries for the whole book rather than four per position:
 * thesis anchors, evidence dates, current ladders, live idea tracks. Without
 * them the scan could only say "AAPL 25.3%", which is a fact nobody needs a
 * product to tell them. With them it says the 25.3% has no written case.
 *
 * Price history and note bodies are NEVER loaded for the scan. They are loaded
 * for the selected position only.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { buildBook, currentRows, type Book, type HoldingRow, type Position } from '../lib/portfolio/holdings'
import { selectCurrentLadders, type TargetRow } from '../lib/signals/current-ladder'
import { CORE_SECTIONS } from '../lib/desktop-research'
import { EMPTY_FRAME, type PositionFrame } from '../lib/desktop-portfolio/model'
import { latestBenchmarkRows } from '../lib/holdings/latest-benchmark'

const DAY = 86_400_000
const daysSince = (iso: string | null) =>
  iso && Number.isFinite(Date.parse(iso))
    ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY))
    : null

export interface PortfolioSummary {
  id: string
  name: string
  /** 'pm' where portfolio_team says so, else 'analyst'. Never assumed. */
  role: 'pm' | 'analyst' | null
}

/**
 * The books this user can see.
 *
 * RLS scopes the rows; the role comes from `portfolio_team`, mapping BOTH
 * spellings production carries -- 'pm' (22 rows) and 'Portfolio Manager' (19)
 * -- because reading only one silently demotes half the PMs in the system.
 */
export function usePortfolioList() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  const { data, isLoading } = useQuery<PortfolioSummary[]>({
    queryKey: ['desktop-portfolio', 'list', currentOrgId, user?.id],
    enabled: !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [pf, team] = await Promise.all([
        supabase.from('portfolios')
          .select('id, name, is_active')
          .eq('organization_id', currentOrgId!)
          .order('name'),
        user?.id
          ? supabase.from('portfolio_team').select('portfolio_id, role').eq('user_id', user.id)
          : Promise.resolve({ data: [] as any[], error: null }),
      ])
      if (pf.error) throw new Error(pf.error.message)

      const roles = new Map<string, 'pm' | 'analyst'>()
      for (const r of ((team as any).data ?? []) as any[]) {
        const raw = String(r.role ?? '').trim().toLowerCase()
        roles.set(r.portfolio_id, raw === 'pm' || raw === 'portfolio manager' ? 'pm' : 'analyst')
      }

      return ((pf.data ?? []) as any[])
        .filter(p => p.is_active !== false)
        .map(p => ({ id: p.id, name: p.name ?? 'Untitled', role: roles.get(p.id) ?? null }))
    },
  })

  return { portfolios: data ?? [], isLoading }
}

/**
 * One book.
 *
 * The embed asks `assets` for global reference columns ONLY. `thesis`,
 * `where_different`, `risks_to_thesis`, `priority`, `process_stage` and
 * `workflow_id` are revoked from `authenticated` at the column level, and
 * requesting one of them fails the WHOLE holdings query rather than blanking a
 * field -- the failure mode the legacy PortfolioTab documents.
 */
export function useBook(portfolioId: string | null) {
  const { data, isLoading } = useQuery<Book | null>({
    queryKey: ['desktop-portfolio', 'book', portfolioId],
    enabled: !!portfolioId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, cost, date, assets(id, symbol, company_name, sector, industry)')
        .eq('portfolio_id', portfolioId!)
        .order('date', { ascending: false, nullsFirst: false })
      if (error) throw new Error(error.message)
      return buildBook(portfolioId!, (data ?? []) as unknown as HoldingRow[])
    },
  })

  return { book: data ?? null, isLoading }
}

/**
 * What is known about every line in the book, beyond the holding.
 *
 * Four reads for the whole book, never per position. Each is narrow: dates and
 * counts for the thesis and evidence, priced rungs for the ladder, and the
 * portfolio's own idea tracks. No note bodies, no price history, no contribution
 * content.
 */
export function useBookFrames(book: Book | null) {
  const assetIds = useMemo(
    () => [...new Set((book?.positions ?? []).filter(p => !p.isCash).map(p => p.assetId))].sort(),
    [book],
  )
  const portfolioId = book?.portfolioId ?? null

  const { data, isFetching } = useQuery<Record<string, PositionFrame>>({
    // The ids themselves, not their count: two books with the same number of
    // lines would otherwise share one cache entry.
    queryKey: ['desktop-portfolio', 'frames', portfolioId, assetIds.join('|')],
    enabled: !!portfolioId && assetIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const [contribs, notes, targets, tracks] = await Promise.all([
        supabase.from('asset_contributions')
          .select('asset_id, section, updated_at')
          .in('asset_id', assetIds).eq('is_archived', false),
        supabase.from('asset_notes')
          .select('asset_id, created_at')
          .in('asset_id', assetIds).eq('is_deleted', false),
        supabase.from('analyst_price_targets')
          .select('id, asset_id, scenario_id, price, is_official, created_at, updated_at, user_id, timeframe, reasoning, scenarios(name), assets(id, symbol, company_name)')
          .in('asset_id', assetIds),
        supabase.from('trade_idea_portfolios')
          .select('portfolio_id, decision_outcome, trade_queue_items!inner(id, asset_id, action, stage, status, outcome, visibility_tier)')
          .eq('portfolio_id', portfolioId!),
      ])

      const frames: Record<string, PositionFrame> = {}
      const frame = (id: string) => (frames[id] ??= { ...EMPTY_FRAME })

      // The review anchor is the newest CORE section only -- identical to
      // Research, so the two surfaces can never disagree about whether a
      // thesis is stale.
      for (const r of ((contribs.data ?? []) as any[])) {
        if (!(CORE_SECTIONS as readonly string[]).includes(r.section)) continue
        const f = frame(r.asset_id)
        if (!f.thesisUpdatedAt || r.updated_at > f.thesisUpdatedAt) f.thesisUpdatedAt = r.updated_at
      }
      const noteDates = new Map<string, string[]>()
      for (const r of ((notes.data ?? []) as any[])) {
        const f = frame(r.asset_id)
        f.evidenceCount += 1
        const arr = noteDates.get(r.asset_id) ?? []
        arr.push(r.created_at)
        noteDates.set(r.asset_id, arr)
      }
      for (const [assetId, f] of Object.entries(frames)) {
        f.daysSinceReview = daysSince(f.thesisUpdatedAt)
        if (f.thesisUpdatedAt) {
          f.newEvidence = (noteDates.get(assetId) ?? []).filter(d => d > f.thesisUpdatedAt!).length
        }
      }

      // The ladder comes from the ONE shared selector, so Portfolio, the feed
      // and Review Cases all describe the same framework. TargetRow already
      // takes the nested shape, so the rows pass straight through.
      for (const ladder of selectCurrentLadders((targets.data ?? []) as unknown as TargetRow[])) {
        frame(ladder.assetId).ladder = ladder
      }

      // Liveness is outcome/status, never stage. `stage` is historical
      // maturity and is never cleared, so an executed idea still reads
      // 'deciding' -- the D4.2 finding, not repeated here.
      for (const r of ((tracks.data ?? []) as any[])) {
        const q = r.trade_queue_items
        if (!q?.asset_id || q.visibility_tier !== 'active') continue
        const terminal = q.outcome != null || TERMINAL_STATUS.has(String(q.status ?? ''))
        const f = frame(q.asset_id)
        const awaiting = !terminal && r.decision_outcome == null
        // Keep the most actionable track when a name carries several.
        if (!f.liveIdea || (awaiting && !f.liveIdea.awaitingDecision)) {
          f.liveIdea = { id: q.id, action: q.action ?? null, stage: q.stage ?? null, awaitingDecision: awaiting }
        }
      }

      return frames
    },
  })

  /*
   * `pending` is reported alongside the frames so the gallery can wait.
   *
   * Every tile's height comes from what its frame carries -- a ladder, a
   * timeline, a reason -- so rendering the grid before the frames land draws
   * twenty-three short tiles and then re-lays every one of them out when they
   * arrive. That reflow is the second half of the hitch a reader sees, and it
   * cannot be reserved away per tile because the height varies per position.
   */
  return { frames: data ?? {}, pending: !data && isFetching }
}

const TERMINAL_STATUS = new Set(['rejected', 'cancelled', 'executed', 'archived', 'deleted'])

export interface PositionDetail {
  history?: { date: string; close: number }[]
  sections: { section: string; content: string | null; updatedAt: string; authorName: string | null }[]
  /**
   * The OTHER books that hold this asset.
   *
   * Named, with their own share count -- never with a weight. A weight needs
   * that book's NAV, which this read does not carry, and showing this book's
   * percentage beside another book's name is exactly the confusion an asset
   * held at 25.3% in one fund and 4.0% in another produces.
   */
  alsoHeldIn: { portfolioId: string; portfolioName: string; shares: number }[]
}

const HISTORY_DAYS = 400

/** The deep read, for the one selected position only. */
export function usePositionDetail(position: Position | null) {
  const assetId = position?.assetId ?? null
  const symbol = position?.symbol ?? null
  const isCash = position?.isCash ?? false

  const { data, isLoading } = useQuery<PositionDetail>({
    queryKey: ['desktop-portfolio', 'position', position?.portfolioId, assetId],
    enabled: !!assetId && !isCash,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const floor = new Date(Date.now() - HISTORY_DAYS * DAY).toISOString().slice(0, 10)
      const [history, contribs, everywhere] = await Promise.all([
        symbol
          ? supabase.from('price_history_cache').select('date, close')
              .eq('symbol', symbol).gte('date', floor).order('date', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('asset_contributions')
          .select('section, content, updated_at, users:created_by(first_name, last_name, email)')
          .eq('asset_id', assetId!).eq('is_archived', false),
        supabase.from('portfolio_holdings')
          .select('portfolio_id, asset_id, shares, price, cost, date, portfolios(name)')
          .eq('asset_id', assetId!),
      ])

      const out: PositionDetail = { sections: [], alsoHeldIn: [] }

      const series = ((history.data ?? []) as any[])
        .map(r => ({ date: r.date, close: Number(r.close) }))
        .filter(p => Number.isFinite(p.close))
      if (series.length >= 2) out.history = series

      const name = (u: any) =>
        u ? ([u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || null) : null
      out.sections = ((contribs.data ?? []) as any[]).map(r => ({
        section: r.section, content: r.content ?? null,
        updatedAt: r.updated_at, authorName: name(r.users),
      }))

      // Reduced to the newest row per book first: this table is dated, so a
      // book uploaded twice would otherwise appear twice.
      const others = currentRows((everywhere.data ?? []) as unknown as HoldingRow[])
        .filter(r => r.portfolio_id !== position!.portfolioId)
      const seen = new Map<string, { portfolioId: string; portfolioName: string; shares: number }>()
      for (const r of others) {
        const nm = (r as any).portfolios?.name
        if (!nm) continue
        seen.set(r.portfolio_id, {
          portfolioId: r.portfolio_id,
          portfolioName: nm,
          shares: Number(r.shares) || 0,
        })
      }
      out.alsoHeldIn = [...seen.values()].sort((a, b) => a.portfolioName.localeCompare(b.portfolioName))

      return out
    },
  })

  return { detail: data, isLoading }
}

/**
 * The book against the index it is measured by.
 *
 * ── What this can honestly say, and what it cannot ───────────────────────
 *
 * `portfolio_benchmark_weights` holds an index file per portfolio: today one
 * date, 483 names, read through `latestBenchmarkRows` so it stays correct the
 * moment that table becomes a dated series.
 *
 * What it does NOT hold is a benchmark return series. There is no index level
 * anywhere in this schema, so "the fund is up 4.2% against the benchmark's
 * 3.1%" cannot be stated without inventing one of those numbers, and this
 * hook does not try.
 *
 * What it can state exactly is the thing a manager is actually asked about:
 * the ACTIVE positions. A weight the book holds that the index does not is a
 * decision somebody made, its size is the size of that decision, and paired
 * with the name's own move it is the contribution that decision has produced.
 * All three come from data already on the page.
 */
export interface ActiveWeight {
  assetId: string
  symbol: string | null
  companyName: string | null
  /** The book's weight. */
  weightPct: number
  /** The index's weight, zero where the name is not in it. */
  benchPct: number
  /** Book minus index. The decision. */
  activePct: number
}

export function useActiveWeights(book: Book | null) {
  const portfolioId = book?.portfolioId ?? null

  const { data } = useQuery<Record<string, number>>({
    queryKey: ['desktop-portfolio', 'benchmark', portfolioId],
    enabled: !!portfolioId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_benchmark_weights')
        // `as_of_date` is selected so the newest file can be isolated. The
        // table can hold only one date today -- UNIQUE (portfolio_id,
        // asset_id) forbids a second -- but the moment that is relaxed for
        // historical active weights, an unfiltered read merges index files
        // across dates. See `lib/holdings/latest-benchmark`.
        .select('asset_id, weight, portfolio_id, as_of_date')
        .eq('portfolio_id', portfolioId as string)
      if (error) throw new Error(error.message)
      const rows = latestBenchmarkRows((data ?? []) as never[]) as unknown as
        { asset_id: string; weight: number | null }[]
      const out: Record<string, number> = {}
      for (const r of rows) if (r.asset_id) out[r.asset_id] = Number(r.weight ?? 0)
      return out
    },
  })

  /*
   * Names the index holds and the book does not have no row in `positions`,
   * so their symbol has to be looked up. Without it the largest underweights
   * -- often the most consequential decisions in the book -- draw as "Not
   * held" with no way to tell which name is meant.
   */
  const unheld = useMemo(() => {
    if (!book || !data) return []
    const held = new Set(book.positions.map(p => p.assetId))
    return Object.entries(data)
      .filter(([id, w]) => !held.has(id) && w >= 0.25)
      .map(([id]) => id)
      .sort()
  }, [book, data])

  const { data: names } = useQuery<Record<string, { symbol: string | null; name: string | null }>>({
    queryKey: ['desktop-portfolio', 'bench-names', unheld.join('|')],
    enabled: unheld.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets').select('id, symbol, company_name').in('id', unheld)
      if (error) throw new Error(error.message)
      const out: Record<string, { symbol: string | null; name: string | null }> = {}
      for (const r of (data ?? []) as { id: string; symbol: string | null; company_name: string | null }[]) {
        out[r.id] = { symbol: r.symbol, name: r.company_name }
      }
      return out
    },
  })

  return useMemo<ActiveWeight[]>(() => {
    if (!book || !data) return []
    const held = book.positions.filter(p => !p.isCash)
    const seen = new Set(held.map(p => p.assetId))

    const rows: ActiveWeight[] = held.map(p => ({
      assetId: p.assetId,
      symbol: p.symbol,
      companyName: p.companyName,
      weightPct: p.weightPct,
      benchPct: data[p.assetId] ?? 0,
      activePct: p.weightPct - (data[p.assetId] ?? 0),
    }))

    /*
     * The names the index holds and the book does not.
     *
     * These are decisions too -- and they are the half a holdings-only view
     * cannot see. A manager who owns none of the largest index constituent
     * has taken a position on it exactly as much as one who doubled it, and
     * a list that only knows about things you own can never say so.
     *
     * Only the ones large enough to be a decision rather than rounding.
     */
    for (const [assetId, w] of Object.entries(data)) {
      if (seen.has(assetId) || w < 0.25) continue
      rows.push({
        assetId,
        symbol: names?.[assetId]?.symbol ?? null,
        companyName: names?.[assetId]?.name ?? null,
        weightPct: 0, benchPct: w, activePct: -w,
      })
    }

    return rows.sort((a, b) => Math.abs(b.activePct) - Math.abs(a.activePct))
  }, [book, data, names])
}
