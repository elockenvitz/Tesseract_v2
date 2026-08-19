import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { isPriceable } from '../../lib/signals/instruments'

export type DerivedInsightKind =
  | 'stale_research'
  | 'large_unreviewed'
  | 'no_thesis'
  | 'concentration'

export interface DerivedInsight {
  id: string
  kind: DerivedInsightKind
  /** What the user should notice, as a statement of fact. */
  headline: string
  /** The evidence. Always concrete and checkable. */
  body: string
  assetId: string
  symbol: string
  companyName?: string | null
  portfolioName?: string | null
  weightPct?: number | null
  daysSinceActivity?: number | null
  /**
   * ISO of the last research touch, where there was one.
   *
   * `daysSinceActivity` is a count and cannot be put on an axis. The card's
   * whole claim is about a GAP — between when somebody last wrote and now — and
   * a gap is a thing you draw, not a thing you count at the reader.
   */
  lastTouchedAt?: string | null
  /** Higher sorts earlier. Derived from position size and staleness. */
  score: number
}

const DAY_MS = 86_400_000

/**
 * Observations derived from the user's actual positions.
 *
 * The feed has to stay useful when the team has posted nothing new. The wrong
 * answer is canned prompts — the app already tried that, and an "AI Insight"
 * asking "what are your biggest risks?" is filler that erodes trust in every
 * other card. The right answer is to say something true the user did not have
 * to ask for: this position is large and nobody has written about it in three
 * months.
 *
 * Every insight here cites a real position, a real weight and a real date, so
 * it can be checked and acted on. Nothing is generated prose.
 *
 * Volume scales with the size of the book, which is what makes the feed
 * effectively endless without repeating: a 60-position portfolio yields tens
 * of genuine observations, and they change as research activity changes.
 */
export function useDerivedInsights() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  return useQuery<DerivedInsight[]>({
    queryKey: ['derived-insights', user?.id, currentOrgId],
    queryFn: async () => {
      // Without an org there is nothing safe to show: these queries would
      // otherwise return positions from every organisation the user belongs to
      // and present them as the current book.
      if (!user || !currentOrgId) return []

      const { data: positions } = await supabase
        .from('portfolio_holdings_positions')
        .select('asset_id, weight_pct, portfolio_id, assets(id, symbol, company_name), portfolios(name)')
        .eq('organization_id', currentOrgId)
        .not('asset_id', 'is', null)
        .order('weight_pct', { ascending: false })
        .limit(120)

      const rows = (positions ?? []) as any[]
      if (!rows.length) return []

      const assetIds = Array.from(new Set(rows.map(r => r.asset_id))).slice(0, 120)

      // Most recent research touch per asset, across the places research
      // actually lands. One round-trip each rather than per-asset queries.
      // Scoped too: research activity from another organisation must not make
      // a position here look freshly covered.
      const [notes, thoughts, contributions] = await Promise.all([
        supabase.from('asset_notes').select('asset_id, created_at')
          .eq('organization_id', currentOrgId).in('asset_id', assetIds),
        supabase.from('quick_thoughts').select('asset_id, created_at')
          .eq('organization_id', currentOrgId).in('asset_id', assetIds),
        supabase.from('asset_contributions').select('asset_id, updated_at')
          .eq('organization_id', currentOrgId).in('asset_id', assetIds),
      ])

      const lastTouch = new Map<string, number>()
      const note = (assetId: string | null, when: string | null) => {
        if (!assetId || !when) return
        const t = new Date(when).getTime()
        if (!Number.isFinite(t)) return
        const prev = lastTouch.get(assetId)
        if (prev == null || t > prev) lastTouch.set(assetId, t)
      }
      for (const r of (notes.data ?? []) as any[]) note(r.asset_id, r.created_at)
      for (const r of (thoughts.data ?? []) as any[]) note(r.asset_id, r.created_at)
      for (const r of (contributions.data ?? []) as any[]) note(r.asset_id, r.updated_at)

      const out: DerivedInsight[] = []
      const seen = new Set<string>()

      for (const row of rows) {
        const asset = row.assets
        if (!asset?.id || seen.has(asset.id)) continue
        // "CASH_USD has no research" is not a coverage gap, it is a category
        // error. Every insight below is a claim about written work on a
        // security; cash is a book line with no thesis to be missing.
        if (!isPriceable(asset.symbol)) continue
        seen.add(asset.id)

        const weight = row.weight_pct != null ? Number(row.weight_pct) : null
        const touched = lastTouch.get(asset.id)
        const days = touched != null ? Math.floor((Date.now() - touched) / DAY_MS) : null
        const portfolioName = row.portfolios?.name ?? null

        // Weight drives importance: a stale 4% position matters more than a
        // stale 20bp one, and the user's attention is the scarce resource.
        const weightScore = weight != null ? Math.min(weight / 5, 1) : 0.2

        if (touched == null) {
          out.push({
            id: `insight-nothesis-${asset.id}`,
            kind: 'no_thesis',
            headline: `${asset.symbol} has no research`,
            body: `${asset.symbol}${weight != null ? ` is ${weight.toFixed(2)}% of ${portfolioName ?? 'the book'}` : ' is held'}, and there are no notes, thoughts or contributions recorded against it.`,
            assetId: asset.id,
            symbol: asset.symbol,
            companyName: asset.company_name,
            portfolioName,
            weightPct: weight,
            daysSinceActivity: null,
            lastTouchedAt: null,
            score: 0.75 + weightScore * 0.25,
          })
          continue
        }

        if (days != null && days >= 30) {
          out.push({
            id: `insight-stale-${asset.id}`,
            kind: 'stale_research',
            // A claim, not a label. "AAPL — 179d stale" is a table cell with a
            // dash in it; the number belongs in the metric well, which is where
            // the card already puts it. The span is bucketed rather than
            // printed, because the headline states WHAT is true and the metric
            // carries how much.
            headline: days >= 180
              ? `Nobody has written on ${asset.symbol} in half a year`
              : days >= 60
                ? `Nobody has written on ${asset.symbol} in months`
                : `${asset.symbol} has gone quiet for over a month`,
            body: `Nothing has been written on ${asset.symbol}${weight != null ? `, currently ${weight.toFixed(2)}% of ${portfolioName ?? 'the book'}` : ''}, since ${new Date(touched).toLocaleDateString()}.`,
            assetId: asset.id,
            symbol: asset.symbol,
            companyName: asset.company_name,
            portfolioName,
            weightPct: weight,
            daysSinceActivity: days,
            lastTouchedAt: new Date(touched).toISOString(),
            score: Math.min(days / 120, 1) * 0.6 + weightScore * 0.4,
          })
          continue
        }

        // Large positions are worth periodically re-examining even when they
        // are being actively written about.
        if (weight != null && weight >= 4) {
          out.push({
            id: `insight-large-${asset.id}`,
            kind: 'large_unreviewed',
            headline: `${asset.symbol} is ${weight.toFixed(2)}% of ${portfolioName ?? 'the book'}`,
            body: `One of the larger positions. Last research activity was ${days} day${days === 1 ? '' : 's'} ago, so it is worth confirming the thesis still holds at this size.`,
            assetId: asset.id,
            symbol: asset.symbol,
            companyName: asset.company_name,
            portfolioName,
            weightPct: weight,
            daysSinceActivity: days,
            lastTouchedAt: new Date(touched).toISOString(),
            score: weightScore * 0.8,
          })
        }
      }

      return out.sort((a, b) => b.score - a.score)
    },
    enabled: !!user && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
  })
}
