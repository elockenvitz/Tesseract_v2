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
          .select('asset_id, created_at, assets(id, symbol, company_name)')
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

/** One light exposure lookup for the whole scan, never per card. */
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
      const { data } = await supabase.from('portfolio_holdings')
        .select('asset_id, weight').in('asset_id', ids)
      const out: Record<string, number> = {}
      for (const r of (data ?? []) as any[]) {
        const raw = Number(r.weight)
        if (!Number.isFinite(raw) || raw <= 0) continue
        out[r.asset_id] = (out[r.asset_id] ?? 0) + (raw <= 1 ? raw * 100 : raw)
      }
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
}

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
      const [contribs, notes, history, holdings] = await Promise.all([
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
        supabase.from('portfolio_holdings')
          .select('weight, portfolios(name)').eq('asset_id', assetId!),
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

      let w = 0
      for (const h of (holdings.data ?? []) as any[]) {
        const raw = Number(h.weight)
        if (Number.isFinite(raw) && raw > 0) w += raw <= 1 ? raw * 100 : raw
        if (!out.portfolioName && h.portfolios?.name) out.portfolioName = h.portfolios.name
      }
      if (w > 0) out.weightPct = w

      return out
    },
  })

  return { detail: data, isLoading }
}
