import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { isPriceable } from '../../lib/signals/instruments'
import { loadDispositions } from '../../lib/signals/dispositions'
import {
  DAY_MS, STALE_DAYS, judgmentTouches, staleContextFor, staleCopy,
} from '../../lib/signals/stale-signal'
import type { StaleContext } from '../../lib/signals/stale-signal'

/**
 * Re-exported so the hook stays the single import site for feed code, while
 * the rule itself remains reachable without Supabase. See `stale-signal.ts`.
 */
export type { StaleContext, StaleContextKind } from '../../lib/signals/stale-signal'
export { judgmentTouches, staleContextFor, staleCopy } from '../../lib/signals/stale-signal'

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
  /** The book's id, so the card's chip can navigate rather than just name it. */
  portfolioId?: string | null
  weightPct?: number | null
  daysSinceActivity?: number | null
  /**
   * Why this is worth raising. Present on `stale_research` only.
   *
   * Absent means the signal did not qualify and should not have been built —
   * the builder treats a missing context as a card with nothing to say.
   */
  context?: StaleContext
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

/**
 * A close more than this far before the touch is not a baseline FOR the touch.
 * It also bounds the price window, so the two uses have to stay the same number.
 */
const BASELINE_TOLERANCE_DAYS = 30

/** Paging limits. `PRICE_PAGE` is the project's PostgREST `max_rows`. */
const MAX_PRICE_SYMBOLS = 40
const PRICE_PAGE = 1000
const MAX_PRICE_PAGES = 8

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

      /**
       * A structured judgment IS engagement.
       *
       * Somebody who tapped "Thesis intact" last Tuesday revisited the
       * investment. Surfacing a stale-attention card at them because no PROSE
       * was written would punish using the feed as designed — the whole point
       * of the judgment layer is that thinking can be recorded without writing.
       *
       * Read from the local disposition store rather than `audit_events`: it is
       * synchronous, always present, and covers every card kind including the
       * ones the audit entity constraint cannot take. A judgment recorded on
       * another device is missed, which costs one repeated card and no
       * correctness.
       */
      for (const t of judgmentTouches(loadDispositions(user.id) as any)) {
        note(t.entityId, t.at)
      }

      /**
       * The names that could possibly qualify, decided before any price is read.
       *
       * `lastTouch` has to exist first: the price question is "has it moved
       * since somebody last looked", so there is nothing to ask about a name
       * that was written up last week. Narrowing here is not an optimisation,
       * it is what makes the query answerable at all — see the paging note.
       */
      const candidates: { symbol: string; touched: number }[] = []
      const candidateSeen = new Set<string>()
      for (const row of rows) {
        const asset = row.assets
        const sym = String(asset?.symbol ?? '').toUpperCase()
        if (!asset?.id || !sym || candidateSeen.has(sym)) continue
        if (!isPriceable(asset.symbol)) continue
        const touched = lastTouch.get(asset.id)
        if (touched == null) continue
        if (Math.floor((Date.now() - touched) / DAY_MS) < STALE_DAYS) continue
        candidateSeen.add(sym)
        candidates.push({ symbol: sym, touched })
        if (candidates.length >= MAX_PRICE_SYMBOLS) break
      }

      /** symbol -> closes, newest first. Empty when nothing qualifies. */
      const priceBySymbol = new Map<string, { t: number; close: number }[]>()

      if (candidates.length) {
        /**
         * Bounded by date and paged, because the obvious query is wrong here.
         *
         * PostgREST caps this project at 1000 rows, so a single
         * `.order('date').limit(1000)` over N symbols returns the most recent
         * ~1000 rows ACROSS ALL OF THEM — about eight trading days at this
         * candidate count. Every baseline lookup is 30+ days back by
         * construction, so it would find nothing, `moveSince` would return null
         * every time, and the price-move path would silently never fire. The
         * signal would look implemented and be dead.
         *
         * So: floor the window at the oldest touch (minus the baseline
         * tolerance) rather than pulling whole histories, and page the rest
         * with fixed parallel offsets. The secondary sort on `symbol` is
         * load-bearing for the same reason as in `usePriceHistory` — `range()`
         * needs a totally ordered set or the pages overlap and gap.
         */
        const floor = new Date(
          Math.min(...candidates.map(c => c.touched)) - BASELINE_TOLERANCE_DAYS * DAY_MS,
        ).toISOString().slice(0, 10)
        const symbols = candidates.map(c => c.symbol)

        const { count } = await supabase
          .from('price_history_cache')
          .select('symbol', { count: 'exact', head: true })
          .in('symbol', symbols)
          .gte('date', floor)

        const pages = Math.min(Math.ceil((count ?? 0) / PRICE_PAGE), MAX_PRICE_PAGES)
        const responses = await Promise.all(
          Array.from({ length: pages }, (_, i) =>
            supabase
              .from('price_history_cache')
              .select('symbol, date, close')
              .in('symbol', symbols)
              .gte('date', floor)
              .order('date', { ascending: false })
              .order('symbol', { ascending: true })
              .range(i * PRICE_PAGE, (i + 1) * PRICE_PAGE - 1)),
        )

        for (const res of responses) {
          for (const r of (res.data ?? []) as any[]) {
            const c = Number(r.close)
            const t = new Date(r.date).getTime()
            if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(t)) continue
            const sym = String(r.symbol).toUpperCase()
            const list = priceBySymbol.get(sym) ?? []
            list.push({ t, close: c })
            priceBySymbol.set(sym, list)
          }
        }
      }

      /**
       * How far the price has travelled since a moment, or null.
       *
       * Null when there is no close at or before that moment, or no recent one.
       * Returning null rather than a best guess is the point: a card claiming
       * "moved 16%" off a fabricated baseline is worse than no card. A capped
       * page read lands here too, as a missing baseline and so as no card.
       */
      const moveSince = (symbol: string, since: number): number | null => {
        const list = priceBySymbol.get(symbol.toUpperCase())
        if (!list || list.length < 2) return null
        const latest = list[0]
        // Nearest close at or before `since`. The list is newest-first.
        const base = list.find(p => p.t <= since)
        if (!base || base.close <= 0) return null
        // A baseline from long before the touch is not a baseline for it.
        if (since - base.t > BASELINE_TOLERANCE_DAYS * DAY_MS) return null
        return ((latest.close - base.close) / base.close) * 100
      }

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
        const portfolioId = (row as any).portfolio_id ?? (row.portfolios as any)?.id ?? null

        // Weight drives importance: a stale 4% position matters more than a
        // stale 20bp one, and the user's attention is the scarce resource.
        const weightScore = weight != null ? Math.min(weight / 5, 1) : 0.2

        if (touched == null) {
          out.push({
            id: `insight-nothesis-${asset.id}`,
            kind: 'no_thesis',
            headline: `${asset.symbol} has no research`,
            body: `${asset.symbol}${weight != null ? ` is ${weight.toFixed(2)}% of ${portfolioName ?? 'the portfolio'}` : ' is held'}, and there are no notes, thoughts or contributions recorded against it.`,
            assetId: asset.id,
            symbol: asset.symbol,
            companyName: asset.company_name,
            portfolioName,
            portfolioId,
            weightPct: weight,
            daysSinceActivity: null,
            lastTouchedAt: null,
            score: 0.75 + weightScore * 0.25,
          })
          continue
        }

        /**
         * Silence PLUS a reason. Never silence alone.
         *
         * The old rule was `days >= 30` and nothing else, which is a fact about
         * the product rather than about the investment. What earns a screen is
         * that something changed and the recorded view did not follow.
         */
        if (days != null && days >= STALE_DAYS && touched != null) {
          const context = staleContextFor({
            days,
            movePct: moveSince(asset.symbol, touched),
            weightPct: weight,
          })

          // No reason to revisit, no card. This is the whole phase in one line.
          if (context) {
            const copy = staleCopy({ symbol: asset.symbol, context, portfolioName })
            out.push({
              id: `insight-stale-${asset.id}`,
              kind: 'stale_research',
              headline: copy.headline,
              body: copy.body,
              assetId: asset.id,
              symbol: asset.symbol,
              companyName: asset.company_name,
              portfolioName,
            portfolioId,
              weightPct: weight,
              daysSinceActivity: days,
              lastTouchedAt: new Date(touched).toISOString(),
              context,
              // A price move outranks size-alone, and both scale with weight.
              score: (context.kind === 'price_move' ? 0.7 : 0.4)
                + weightScore * 0.3
                + Math.min(days / 365, 1) * 0.1,
            })
          }
          continue
        }

        // Large positions are worth periodically re-examining even when they
        // are being actively written about.
        if (weight != null && weight >= 4) {
          out.push({
            id: `insight-large-${asset.id}`,
            kind: 'large_unreviewed',
            headline: `${asset.symbol} is ${weight.toFixed(2)}% of ${portfolioName ?? 'the portfolio'}`,
            body: `One of the larger positions. Last research activity was ${days} day${days === 1 ? '' : 's'} ago, so it is worth confirming the thesis still holds at this size.`,
            assetId: asset.id,
            symbol: asset.symbol,
            companyName: asset.company_name,
            portfolioName,
            portfolioId,
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

export { insightSignalType } from '../../lib/signals/insight-type'
