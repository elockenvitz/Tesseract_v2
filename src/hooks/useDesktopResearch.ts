/**
 * Desktop Research — data.
 *
 * Split by cost, exactly as Desktop Ideas is:
 *
 *   useResearchScan()            three light aggregate queries for the list
 *   useResearchDetail(assetId)   the deep read, for the ONE selected subject
 *
 * The scan never loads a note body or a price series. It reads timestamps and
 * counts, which is all the list needs to say why something matters. Opening a
 * subject then fetches its sections, its evidence, its price history and its
 * exposure once, and React Query caches it.
 *
 * Every table here is one already proven in earlier stages. No new table, no
 * migration, no service change.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { CORE_SECTIONS, type EvidenceItem, type ResearchSubject, type ThesisSection } from '../lib/desktop-research'
import { largestWeightByAsset, type HoldingRow } from '../lib/portfolio/holdings'

const DAY = 86_400_000
const daysSince = (iso: string | null) =>
  iso && Number.isFinite(Date.parse(iso))
    ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY))
    : null

export function useResearchScan() {
  const { data, isLoading, error } = useQuery<ResearchSubject[]>({
    queryKey: ['desktop-research', 'scan'],
    staleTime: 60_000,
    queryFn: async () => {
      // Deliberately three narrow reads rather than one wide join: the scan
      // needs counts and dates, and pulling note bodies to count them would
      // move megabytes to render a number.
      const [contribs, notes] = await Promise.all([
        supabase.from('asset_contributions')
          .select('asset_id, section, updated_at, assets(id, symbol, company_name)')
          .eq('is_archived', false),
        supabase.from('asset_notes')
          // `title` only. Note bodies are never read by the scan.
          .select('asset_id, created_at, title, assets(id, symbol, company_name)')
          .eq('is_deleted', false),
      ])
      if (contribs.error) throw new Error(contribs.error.message)
      if (notes.error) throw new Error(notes.error.message)

      const byAsset = new Map<string, ResearchSubject>()
      const ensure = (id: string, asset: any): ResearchSubject => {
        let s = byAsset.get(id)
        if (!s) {
          s = {
            assetId: id,
            symbol: asset?.symbol ?? null,
            companyName: asset?.company_name ?? null,
            thesisUpdatedAt: null,
            daysSinceReview: null,
            sectionCount: 0,
            coreSectionCount: 0,
            coreSections: [],
            evidenceCount: 0,
            newestEvidenceAt: null,
            newSinceReview: 0,
          }
          byAsset.set(id, s)
        }
        if (!s.symbol && asset?.symbol) s.symbol = asset.symbol
        if (!s.companyName && asset?.company_name) s.companyName = asset.company_name
        return s
      }

      for (const row of (contribs.data ?? []) as any[]) {
        if (!row.asset_id) continue
        const s = ensure(row.asset_id, row.assets)
        s.sectionCount += 1
        // The review anchor is the newest CORE section only. A refreshed
        // business-model paragraph is not a review of the investment case,
        // and counting it would silently reset the clock.
        if ((CORE_SECTIONS as readonly string[]).includes(row.section)) {
          s.coreSectionCount += 1
          if (!s.coreSections.includes(row.section)) s.coreSections.push(row.section)
          if (!s.thesisUpdatedAt || row.updated_at > s.thesisUpdatedAt) {
            s.thesisUpdatedAt = row.updated_at
          }
        }
      }

      const noteDates = new Map<string, string[]>()
      for (const row of (notes.data ?? []) as any[]) {
        if (!row.asset_id) continue
        const s = ensure(row.asset_id, row.assets)
        s.evidenceCount += 1
        if (!s.newestEvidenceAt || row.created_at > s.newestEvidenceAt) {
          s.newestEvidenceAt = row.created_at
          s.newestEvidenceTitle = row.title ?? null
        }
        const arr = noteDates.get(row.asset_id) ?? []
        arr.push(row.created_at)
        noteDates.set(row.asset_id, arr)
      }

      for (const s of byAsset.values()) {
        s.daysSinceReview = daysSince(s.thesisUpdatedAt)
        if (s.thesisUpdatedAt) {
          s.newSinceReview = (noteDates.get(s.assetId) ?? [])
            .filter(d => d > s.thesisUpdatedAt!).length
        }
      }

      return [...byAsset.values()]
    },
  })

  return { subjects: data ?? [], isLoading, error }
}

/**
 * Does Research have anything to show for this asset?
 *
 * The ONE truth, shared rather than approximated. Research lists a name when
 * it has at least one non-archived contribution or one non-deleted note, and
 * this reads that same population through the same query key -- so it costs
 * nothing once Research has been opened, and it cannot drift from what the
 * workspace will actually render.
 *
 * The cheap alternatives are all wrong. "The idea has an asset_id" is true of
 * every idea; "the asset exists" is true of every asset. Either would offer to
 * show evidence that is not there, which is exactly what "Check the evidence"
 * on DASH was doing.
 *
 * Returns `undefined` while the population is still loading, so a caller can
 * withhold the action rather than promise it and then retract it.
 */
export function useHasResearch(assetId: string | null | undefined): boolean | undefined {
  const { subjects, isLoading } = useResearchScan()
  if (!assetId) return false
  if (isLoading && !subjects.length) return undefined
  return subjects.some(s => s.assetId === assetId)
}

/**
 * One light exposure lookup for the whole scan, never per card.
 *
 * `portfolio_holdings` has NO weight column -- it carries shares, price and
 * cost, and weight is derived against the book's own NAV. This asked for
 * `weight` and therefore returned nothing at all, silently: no error surfaced,
 * every tile simply rendered without a weight. The derivation now lives in
 * `lib/portfolio/holdings`, shared with Portfolio, so there is one definition
 * of what a position weighs.
 *
 * The answer is the LARGEST single-book stake, not a sum. AAPL is 25.3% of
 * Large Cap Growth and 4.0% of Vision Fund 5K; adding those gives 29.3% of
 * nothing. Research asks "does this name matter enough to review?", and the
 * biggest book it matters in is the honest answer to that.
 */
export function useResearchExposure(subjects: ResearchSubject[]) {
  const ids = useMemo(
    () => [...new Set(subjects.map(s => s.assetId))].sort(),
    [subjects],
  )
  const { data } = useQuery<Record<string, number>>({
    queryKey: ['desktop-research', 'exposure', ids.join('|')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Every row of every book that holds one of these assets: a weight
      // cannot be computed from one position alone, because the denominator is
      // the whole book.
      const { data: mine, error } = await supabase.from('portfolio_holdings')
        .select('portfolio_id').in('asset_id', ids)
      if (error) throw new Error(error.message)
      const portfolioIds = [...new Set(((mine ?? []) as any[]).map(r => r.portfolio_id))]
      if (!portfolioIds.length) return {}

      const { data, error: e2 } = await supabase.from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, cost, date')
        .in('portfolio_id', portfolioIds)
      if (e2) throw new Error(e2.message)

      const all = largestWeightByAsset((data ?? []) as unknown as HoldingRow[])
      const out: Record<string, number> = {}
      for (const id of ids) if (all[id] != null) out[id] = all[id]
      return out
    },
  })
  return data ?? {}
}

export interface ResearchDetail {
  sections: ThesisSection[]
  evidence: EvidenceItem[]
  history?: { date: string; close: number }[]
  spot?: number
  weightPct?: number
  portfolioName?: string
  /**
   * A live idea on this name, if one exists.
   *
   * Only so Research can offer to open it. Liveness is outcome/status and
   * never stage -- an executed idea still reads 'deciding', and offering to
   * "review" finished work is the D4.2 mistake.
   */
  liveIdea?: { id: string; action: string | null; maturityLabel: string | null }
}

const TERMINAL_STATUS = new Set(['rejected', 'cancelled', 'executed', 'archived', 'deleted'])

const HISTORY_DAYS = 400

export function useResearchDetail(subject: ResearchSubject | null) {
  const assetId = subject?.assetId ?? null
  const symbol = subject?.symbol ?? null
  const anchor = subject?.thesisUpdatedAt ?? null

  const { data, isLoading } = useQuery<ResearchDetail>({
    queryKey: ['desktop-research', 'detail', assetId],
    enabled: !!assetId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const floor = new Date(Date.now() - HISTORY_DAYS * DAY).toISOString().slice(0, 10)
      const [contribs, notes, history, holdings, ideas] = await Promise.all([
        supabase.from('asset_contributions')
          .select('section, content, supporting_detail, updated_at, users:created_by(first_name, last_name, email)')
          .eq('asset_id', assetId!).eq('is_archived', false),
        supabase.from('asset_notes')
          .select('id, title, content, created_at, is_shared, users:created_by(first_name, last_name, email)')
          .eq('asset_id', assetId!).eq('is_deleted', false)
          .order('created_at', { ascending: false }),
        symbol
          ? supabase.from('price_history_cache')
              .select('date, close').eq('symbol', symbol).gte('date', floor)
              .order('date', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        // Same fix as the scan: read the books that hold it, then derive.
        supabase.from('portfolio_holdings')
          .select('portfolio_id, portfolios(name)').eq('asset_id', assetId!),
        supabase.from('trade_queue_items')
          .select('id, action, stage, status, outcome')
          .eq('asset_id', assetId!).eq('visibility_tier', 'active')
          .order('updated_at', { ascending: false }).limit(5),
      ])

      const name = (u: any) =>
        u ? ([u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || null) : null

      const out: ResearchDetail = {
        sections: (contribs.data ?? []).map((r: any): ThesisSection => ({
          section: r.section,
          content: r.content ?? null,
          supportingDetail: r.supporting_detail ?? null,
          updatedAt: r.updated_at,
          authorName: name(r.users),
        })),
        evidence: (notes.data ?? []).map((r: any): EvidenceItem => ({
          id: r.id,
          title: r.title ?? null,
          content: r.content ?? null,
          createdAt: r.created_at,
          authorName: name(r.users),
          isShared: !!r.is_shared,
          // Two real timestamps compared. Not a support/challenge claim.
          isNewSinceReview: !!anchor && r.created_at > anchor,
        })),
      }

      const series = (history.data ?? [])
        .map((r: any) => ({ date: r.date, close: Number(r.close) }))
        .filter(p => Number.isFinite(p.close))
      if (series.length >= 2) { out.history = series; out.spot = series[series.length - 1].close }

      const books = [...new Set(((holdings.data ?? []) as any[]).map(h => h.portfolio_id))]
      for (const h of (holdings.data ?? []) as any[]) {
        if (!out.portfolioName && h.portfolios?.name) out.portfolioName = h.portfolios.name
      }
      if (books.length) {
        const { data: rows } = await supabase.from('portfolio_holdings')
          .select('portfolio_id, asset_id, shares, price, cost, date')
          .in('portfolio_id', books)
        const w = largestWeightByAsset((rows ?? []) as unknown as HoldingRow[])[assetId!]
        if (w != null && w > 0) out.weightPct = w
      }

      const live = ((ideas as any).data ?? []).find((q: any) =>
        q.outcome == null && !TERMINAL_STATUS.has(String(q.status ?? '')))
      if (live) {
        out.liveIdea = {
          id: live.id,
          action: live.action ?? null,
          maturityLabel: live.stage ? String(live.stage).replace(/_/g, ' ') : null,
        }
      }

      return out
    },
  })

  return { detail: data, isLoading }
}
