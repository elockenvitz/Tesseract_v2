/**
 * The canonical Asset read.
 *
 * ── One query round, not twenty hooks ────────────────────────────────────
 *
 * The legacy Asset page reaches for eighteen hooks and issues a query per
 * section, several of them N+1 over portfolios. That is the shape this must
 * not reproduce under a new name. Everything here goes out in one
 * `Promise.all` behind one React Query entry, and the only thing focus changes
 * is how far back the price read goes.
 *
 * ── One definition of weight ─────────────────────────────────────────────
 *
 * Positions are derived through `lib/portfolio/holdings`, the same helper
 * Portfolio, Research and Ideas already use: newest snapshot per book, market
 * value over the book's own market value. The legacy Asset page computed
 * `shares x average cost / sum(shares x average cost)` -- weight at cost, a
 * different number for the same position -- and its holdings query referenced
 * an undefined `data`, so in practice it returned nothing at all and every
 * exposure block on that page rendered empty. Both are gone here.
 *
 * ── Nothing is invented ──────────────────────────────────────────────────
 *
 * A book whose NAV cannot be derived yields no weight, and the caller shows
 * shares instead. Spot is the last close in the price cache and is absent when
 * the cache has nothing recent -- never `assets.current_price` standing in for
 * today, which is a stored column with no freshness guarantee.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  buildBook, unrealised,
  type HoldingRow, type Position,
} from '../lib/portfolio/holdings'
import {
  selectCurrentLadders, type TargetRow, type CurrentLadder,
} from '../lib/signals/current-ladder'
import {
  CORE_SECTIONS, type ThesisSection, type EvidenceItem,
} from '../lib/desktop-research/model'
import type { AssetFocus } from '../lib/desktop-asset'

const DAY = 86_400_000

/** Deep enough to anchor a chart at a case written a year ago. */
const DEEP_HISTORY_DAYS = 400
/** Enough to find a last close, and nothing more, when no chart is shown. */
const SHALLOW_HISTORY_DAYS = 12

/** One book's line in this asset, with everything that book can honestly say. */
export interface AssetPosition {
  portfolioId: string
  portfolioName: string
  shares: number
  price: number
  marketValue: number
  /** Null when the book's own market value could not be derived. Never 0. */
  weightPct: number | null
  avgCost: number | null
  unrealisedGain: number | null
  unrealisedPct: number | null
  asOf: string | null
}

export interface AssetLiveIdea {
  id: string
  action: string | null
  stage: string | null
  rationale: string | null
  portfolioName: string | null
}

export interface AssetDecisionRow {
  id: string
  status: string
  action: string | null
  decidedAt: string | null
  portfolioId: string | null
  portfolioName: string | null
  decisionNote: string | null
}

export interface AssetWorkspaceData {
  sections: ThesisSection[]
  evidence: EvidenceItem[]
  /** Newest updated_at across CORE sections. Null when no case is written. */
  caseWrittenAt: string | null
  coreSections: string[]
  history: { date: string; close: number }[]
  spot: number | null
  /** The whole ladder, so FrameworkScale can be reused rather than reshaped. */
  ladder: CurrentLadder | null
  target: number | null
  positions: AssetPosition[]
  liveIdeas: AssetLiveIdea[]
  decisions: AssetDecisionRow[]
}

const EMPTY: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

/** Live means outcome-and-status, never stage: an executed idea still reads 'deciding'. */
const TERMINAL_STATUS = new Set(['rejected', 'cancelled', 'executed', 'archived', 'deleted'])

const personName = (u: any): string | null =>
  u ? ([u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || null) : null

/**
 * Focus decides depth, not content.
 *
 * A chart anchored at the case is only drawn where the composition shows one,
 * so a reader opening AAPL to check its weight does not pull four hundred
 * closes to render nothing.
 */
function historyDaysFor(focus: AssetFocus): number {
  return focus === 'research' || focus === 'framework' || focus === 'position'
    ? DEEP_HISTORY_DAYS
    : SHALLOW_HISTORY_DAYS
}

export function useAssetWorkspace(
  assetId: string | null,
  symbol: string | null,
  focus: AssetFocus = 'overview',
) {
  const days = historyDaysFor(focus)
  /*
   * An asset is shared across organisations; the thesis, evidence, targets and
   * ideas recorded against it are not. Every read below filtered on `asset_id`
   * alone, and RLS on these four tables is not organisation-aware, so the
   * workspace showed another organisation's work on the same name.
   */
  const { currentOrgId } = useOrganization()

  const { data, isLoading, error } = useQuery<AssetWorkspaceData>({
    queryKey: ['asset-workspace', assetId, symbol, days, currentOrgId],
    enabled: !!assetId && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      const floor = new Date(Date.now() - days * DAY).toISOString().slice(0, 10)

      const [contribs, notes, history, mine, targets, ideas, decisions] = await Promise.all([
        supabase.from('asset_contributions')
          .select('section, content, supporting_detail, updated_at, users:created_by(first_name, last_name, email)')
          .eq('organization_id', currentOrgId!)
          .eq('asset_id', assetId!).eq('is_archived', false),
        supabase.from('asset_notes')
          .select('id, title, content, created_at, is_shared, users:created_by(first_name, last_name, email)')
          .eq('organization_id', currentOrgId!)
          .eq('asset_id', assetId!).eq('is_deleted', false)
          .order('created_at', { ascending: false }),
        symbol
          ? supabase.from('price_history_cache')
              .select('date, close').eq('symbol', symbol).gte('date', floor)
              .order('date', { ascending: true })
          : Promise.resolve({ data: [] as any[], error: null }),
        // Which books hold it. The second read below needs the whole of those
        // books, because a weight is a share of the book's own market value.
        supabase.from('portfolio_holdings')
          .select('portfolio_id').eq('asset_id', assetId!),
        supabase.from('analyst_price_targets')
          .select('id, asset_id, price, is_official, created_at, updated_at, scenarios(name), assets(id, symbol, company_name)')
          .eq('organization_id', currentOrgId!)
          .eq('asset_id', assetId!),
        supabase.from('trade_queue_items')
          .select('id, action, stage, status, outcome, rationale, portfolios(name)')
          .eq('organization_id', currentOrgId!)
          .eq('asset_id', assetId!)
          .order('updated_at', { ascending: false }).limit(8),
        // Decisions reach the asset through the idea they were raised on, so
        // the embed is inner-joined and filtered rather than fetched wide.
        supabase.from('decision_requests')
          .select('id, status, requested_action, reviewed_at, decision_note, portfolio_id, portfolios(name), trade_queue_items!inner(asset_id)')
          .eq('trade_queue_items.asset_id', assetId!)
          .order('created_at', { ascending: false }).limit(8),
      ])

      if (contribs.error) throw new Error(contribs.error.message)

      const out: AssetWorkspaceData = { ...EMPTY, sections: [], evidence: [], positions: [] }

      /* ------------------------------------------------------------ case */
      out.sections = ((contribs.data ?? []) as any[]).map((r): ThesisSection => ({
        section: r.section,
        content: r.content ?? null,
        supportingDetail: r.supporting_detail ?? null,
        updatedAt: r.updated_at,
        authorName: personName(r.users),
      }))
      const core = out.sections.filter(s => (CORE_SECTIONS as readonly string[]).includes(s.section))
      out.coreSections = core.map(s => s.section)
      // The review anchor is the newest CORE section only. A refreshed
      // business-model paragraph is not a review of the investment case.
      out.caseWrittenAt = core.reduce<string | null>(
        (newest, s) => (!newest || s.updatedAt > newest ? s.updatedAt : newest), null)

      out.evidence = ((notes.data ?? []) as any[]).map((r): EvidenceItem => ({
        id: r.id,
        title: r.title ?? null,
        content: r.content ?? null,
        createdAt: r.created_at,
        authorName: personName(r.users),
        isShared: !!r.is_shared,
        isNewSinceReview: !!out.caseWrittenAt && r.created_at > out.caseWrittenAt,
      }))

      /* ----------------------------------------------------------- price */
      out.history = (((history as any).data ?? []) as any[])
        .map(r => ({ date: r.date, close: Number(r.close) }))
        .filter(p => Number.isFinite(p.close) && p.close > 0)
      out.spot = out.history.length ? out.history[out.history.length - 1].close : null

      /* ------------------------------------------------------- framework */
      const targetRows = (targets.data ?? []) as TargetRow[]
      const ladder = selectCurrentLadders(targetRows).find(l => l.valid && l.cases.length >= 2)
      if (ladder) out.ladder = ladder
      const official = targetRows.find((t: any) => t.is_official && Number((t as any).price) > 0)
      if (official) out.target = Number((official as any).price)

      /* ------------------------------------------------------- positions */
      const books = [...new Set(((mine.data ?? []) as any[]).map(r => r.portfolio_id))]
      if (books.length) {
        const { data: bookRows } = await supabase.from('portfolio_holdings')
          .select('portfolio_id, asset_id, shares, price, cost, date, assets(symbol, company_name, sector), portfolios(name)')
          .in('portfolio_id', books)
        const rows = (bookRows ?? []) as unknown as HoldingRow[]

        // Names come off the raw rows: `buildBook` returns positions, not the
        // portfolio record they belong to.
        const nameOf = new Map<string, string>()
        for (const r of (bookRows ?? []) as any[]) {
          if (r.portfolio_id && r.portfolios?.name) nameOf.set(r.portfolio_id, r.portfolios.name)
        }

        for (const portfolioId of books) {
          const book = buildBook(portfolioId, rows)
          const line = book.positions.find(p => p.assetId === assetId)
          if (!line) continue
          out.positions.push(toAssetPosition(line, nameOf.get(portfolioId) ?? 'Portfolio', book.totalValue))
        }
        // Largest stake first: the book this matters most in leads.
        out.positions.sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0) || b.marketValue - a.marketValue)
      }

      /* ----------------------------------------------------------- ideas */
      out.liveIdeas = ((ideas.data ?? []) as any[])
        .filter(r => r.outcome == null && !TERMINAL_STATUS.has(r.status ?? ''))
        .map(r => ({
          id: r.id,
          action: r.action ?? null,
          stage: r.stage ?? null,
          rationale: r.rationale ?? null,
          portfolioName: r.portfolios?.name ?? null,
        }))

      /* ------------------------------------------------------- decisions */
      out.decisions = ((decisions.data ?? []) as any[]).map(r => ({
        id: r.id,
        status: r.status ?? 'pending',
        action: r.requested_action ?? null,
        decidedAt: r.reviewed_at ?? null,
        portfolioId: r.portfolio_id ?? null,
        portfolioName: r.portfolios?.name ?? null,
        decisionNote: r.decision_note ?? null,
      }))

      return out
    },
  })

  return { data: data ?? EMPTY, isLoading, error: error as Error | null }
}

/**
 * A book's line, with a weight only where the book's NAV was derivable.
 *
 * `buildBook` returns 0 for a book whose market value is zero, which would
 * render as "0.0% of the book" -- a claim, not an absence. Null instead, and
 * the caller shows shares.
 */
function toAssetPosition(p: Position, portfolioName: string, bookValue: number): AssetPosition {
  const pnl = unrealised(p)
  return {
    portfolioId: p.portfolioId,
    portfolioName,
    shares: p.shares,
    price: p.price,
    marketValue: p.marketValue,
    weightPct: bookValue > 0 ? p.weightPct : null,
    avgCost: p.avgCost,
    unrealisedGain: pnl?.gain ?? null,
    unrealisedPct: pnl?.pct ?? null,
    asOf: p.asOf,
  }
}

/** The book the reader arrived from, then the largest stake, then nothing. */
export function primaryPosition(
  positions: AssetPosition[],
  portfolioId: string | null,
): AssetPosition | null {
  if (portfolioId) return positions.find(p => p.portfolioId === portfolioId) ?? null
  return positions[0] ?? null
}

/** Every other book, in the order they were derived. */
export function otherPositions(
  positions: AssetPosition[],
  primary: AssetPosition | null,
): AssetPosition[] {
  return primary ? positions.filter(p => p.portfolioId !== primary.portfolioId) : positions
}

/** The largest weight across books, for scaling a bar against the field. */
export function useMaxWeight(positions: AssetPosition[]): number {
  return useMemo(
    () => positions.reduce((m, p) => Math.max(m, p.weightPct ?? 0), 0),
    [positions],
  )
}
