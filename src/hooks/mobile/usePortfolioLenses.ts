import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { timeframeMonths } from '../../lib/signals/timeframe'

/**
 * Four questions about the book that no existing screen asks.
 *
 * Everything else in the product reports a portfolio one portfolio at a time,
 * and reports what a position *is*. These ask something instead — is the size
 * consistent with the view, is a name a bigger bet than any single portfolio
 * shows, has the thesis already played out, has the view expired — which is
 * what earns a full screen in a feed rather than a row in a table.
 *
 * All four are computed from data the org already has. Nothing needs a new
 * provider or a new column.
 */

export interface ConvictionGap {
  assetId: string
  symbol: string
  companyName: string | null
  /** Position size as a share of the portfolio it sits in. */
  weightPct: number
  /** Upside to the price target, as a fraction of current price. */
  upsidePct: number
  /**
   * Stated conviction, where one exists.
   *
   * Conviction and upside are different claims and the tile needs both. A
   * high-conviction name with no upside left is a different problem from a
   * low-conviction name trading far below target, and reading either number
   * alone gets both wrong.
   */
  conviction: string | null
  portfolioId: string
  portfolioName: string
  /**
   * `underweight` — the view is strong and the position is not.
   * `overweight`  — the position is large and the view no longer supports it.
   */
  direction: 'underweight' | 'overweight'
  /** How far apart the two are, for ranking. */
  tension: number
}

/** A target the price has already reached or passed. */
export interface TargetBreach {
  assetId: string
  symbol: string
  companyName: string | null
  price: number
  target: number
  /** How far past the target the price is, as a fraction. */
  overshootPct: number
  conviction: string | null
  heldIn: string[]
}

/** A target whose own stated horizon has run out. */
export interface StaleTarget {
  assetId: string
  symbol: string
  companyName: string | null
  target: number
  price: number
  timeframe: string | null
  ageMonths: number
  /** Months past the end of its horizon. */
  overdueMonths: number
  heldIn: string[]
}

export interface CrowdedName {
  assetId: string
  symbol: string
  companyName: string | null
  /** How many portfolios in the org hold it. */
  portfolioCount: number
  /** Total value across those portfolios. */
  totalValue: number
  /** The heaviest single weight it takes in any one of them. */
  maxWeightPct: number
  portfolioNames: string[]
}

export interface PortfolioLenses {
  conviction: ConvictionGap[]
  crowded: CrowdedName[]
  breaches: TargetBreach[]
  stale: StaleTarget[]
}

interface HoldingRow {
  portfolio_id: string
  asset_id: string
  shares: number | null
  price: number | null
  /** Snapshot date. Only the newest per portfolio is a current position. */
  date: string | null
  assets: { symbol: string | null; company_name: string | null } | null
  portfolios: { name: string | null } | null
}

interface TargetInfo {
  price: number
  timeframe: string | null
  rolling: boolean
  createdAt: string
}

/**
 * Conviction is a mosaic, not one number.
 *
 * `analyst_ratings.conviction` is what the analyst says; the gap to the price
 * target is what their own numbers imply. They disagree often, and the
 * disagreement is the signal — high conviction with no upside left means
 * either the target needs raising or the position needs trimming, and neither
 * field says that on its own.
 */
const CONVICTION_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

const STRONG_UPSIDE = 0.25
const WEAK_UPSIDE = 0.05
/** Below this a position is too small to be worth flagging either way. */
const MIN_WEIGHT_PCT = 0.5
/** A target this far past its own horizon has stopped being a view. */
const OVERDUE_MONTHS = 2


export function usePortfolioLenses(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<PortfolioLenses>({
    queryKey: ['portfolio-lenses', currentOrgId],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const empty: PortfolioLenses = { conviction: [], crowded: [], breaches: [], stale: [] }

      const { data: holdingsRaw } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price, date, assets(symbol, company_name), portfolios!inner(name, organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
        // Newest first, so the per-portfolio latest date is the first row seen
        // and a truncating limit drops the OLDEST rows rather than an arbitrary
        // slice. Unordered, `limit` cut a nondeterministic set.
        .order('date', { ascending: false, nullsFirst: false })
        .limit(5000)

      const all = (holdingsRaw ?? []) as unknown as HoldingRow[]
      if (!all.length) return empty

      /**
       * One snapshot per portfolio — the newest — and nothing else.
       *
       * This table is a series of dated snapshots, not a position list. Summing
       * every row for the denominator inflated each portfolio's total by the
       * number of dates it holds: measured at 36x on Tech & Consumer Growth and
       * 27x on Vision Fund 10K. Every weight was therefore up to 36 times too
       * small, and because MIN_WEIGHT_PCT rejects anything under 0.5%, the
       * conviction cards silently produced nothing at all rather than producing
       * something visibly wrong.
       *
       * The same collapse — counting distinct assets across all dates as though
       * they were current positions — is what made Vision Fund 10K look like a
       * 29-name portfolio when its latest snapshot holds 2.
       */
      const latestDate = new Map<string, string>()
      for (const h of all) {
        const d = (h as unknown as { date?: string | null }).date ?? ''
        const seen = latestDate.get(h.portfolio_id)
        if (!seen || d > seen) latestDate.set(h.portfolio_id, d)
      }
      const holdings = all.filter(
        h => ((h as unknown as { date?: string | null }).date ?? '') === latestDate.get(h.portfolio_id),
      )
      if (!holdings.length) return empty

      const value = (h: HoldingRow) => (Number(h.shares) || 0) * (Number(h.price) || 0)

      // Portfolio totals first: a weight is meaningless without its denominator.
      const totals = new Map<string, number>()
      for (const h of holdings) {
        totals.set(h.portfolio_id, (totals.get(h.portfolio_id) ?? 0) + value(h))
      }

      const byAsset = new Map<string, { rows: HoldingRow[]; portfolios: Set<string> }>()
      for (const h of holdings) {
        if (!h.asset_id) continue
        const e = byAsset.get(h.asset_id) ?? { rows: [], portfolios: new Set<string>() }
        e.rows.push(h)
        e.portfolios.add(h.portfolio_id)
        byAsset.set(h.asset_id, e)
      }

      const heldIn = (assetId: string) =>
        Array.from(new Set(
          (byAsset.get(assetId)?.rows ?? [])
            .map(h => h.portfolios?.name)
            .filter(Boolean) as string[]
        ))

      // ── Crowding ──────────────────────────────────────────────────────────
      const crowded: CrowdedName[] = []
      for (const [assetId, e] of byAsset) {
        if (e.portfolios.size < 2) continue
        crowded.push({
          assetId,
          symbol: e.rows[0].assets?.symbol ?? '?',
          companyName: e.rows[0].assets?.company_name ?? null,
          portfolioCount: e.portfolios.size,
          totalValue: e.rows.reduce((n, h) => n + value(h), 0),
          maxWeightPct: Math.max(...e.rows.map(h => {
            const t = totals.get(h.portfolio_id) ?? 0
            return t > 0 ? (value(h) / t) * 100 : 0
          })),
          portfolioNames: heldIn(assetId),
        })
      }
      crowded.sort((a, b) => b.portfolioCount - a.portfolioCount || b.totalValue - a.totalValue)

      // ── Targets and conviction ────────────────────────────────────────────
      // analyst_price_targets rather than price_targets: it is the table the
      // product actually writes to, and it carries the horizon — which is what
      // makes "this view has expired" answerable at all.
      const assetIds = Array.from(byAsset.keys()).slice(0, 500)
      const [{ data: targets }, { data: ratings }] = await Promise.all([
        supabase
          .from('analyst_price_targets')
          .select('asset_id, price, timeframe, is_rolling, is_official, created_at')
          .eq('organization_id', currentOrgId!)
          .in('asset_id', assetIds)
          .order('is_official', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('analyst_ratings')
          .select('asset_id, conviction, created_at')
          .in('asset_id', assetIds)
          .order('created_at', { ascending: false }),
      ])

      // Official first, then most recent. An older or unofficial target is a
      // superseded view, not a second opinion.
      const target = new Map<string, TargetInfo>()
      for (const t of (targets ?? []) as any[]) {
        if (!t.asset_id || target.has(t.asset_id)) continue
        const p = Number(t.price)
        if (!Number.isFinite(p) || p <= 0) continue
        target.set(t.asset_id, {
          price: p,
          timeframe: t.timeframe ?? null,
          rolling: !!t.is_rolling,
          createdAt: t.created_at,
        })
      }

      const convictionOf = new Map<string, string>()
      for (const r of (ratings ?? []) as any[]) {
        if (!r.asset_id || convictionOf.has(r.asset_id) || !r.conviction) continue
        convictionOf.set(r.asset_id, String(r.conviction).toLowerCase())
      }

      // ── Target reached, and target expired ────────────────────────────────
      const breaches: TargetBreach[] = []
      const stale: StaleTarget[] = []
      const now = Date.now()

      for (const [assetId, e] of byAsset) {
        const t = target.get(assetId)
        if (!t) continue
        const price = Number(e.rows[0].price) || 0
        if (price <= 0) continue
        const symbol = e.rows[0].assets?.symbol ?? '?'
        const companyName = e.rows[0].assets?.company_name ?? null

        // The thesis played out and nothing in the product says so. Either the
        // target is raised or the position is a hold with no stated upside —
        // both are decisions, and neither happens if nobody is told.
        if (price >= t.price) {
          breaches.push({
            assetId, symbol, companyName,
            price, target: t.price,
            overshootPct: (price - t.price) / t.price,
            conviction: convictionOf.get(assetId) ?? null,
            heldIn: heldIn(assetId),
          })
        }

        // A rolling target re-bases continuously and by definition never
        // expires, so flagging it as overdue would be wrong.
        const months = timeframeMonths(t.timeframe)
        if (!t.rolling && months) {
          const ageMonths = (now - new Date(t.createdAt).getTime()) / (30.44 * 86400_000)
          const overdue = ageMonths - months
          if (Number.isFinite(overdue) && overdue >= OVERDUE_MONTHS) {
            stale.push({
              assetId, symbol, companyName,
              target: t.price, price,
              timeframe: t.timeframe,
              ageMonths: Math.round(ageMonths),
              overdueMonths: Math.round(overdue),
              heldIn: heldIn(assetId),
            })
          }
        }
      }
      breaches.sort((a, b) => b.overshootPct - a.overshootPct)
      stale.sort((a, b) => b.overdueMonths - a.overdueMonths)

      // ── Conviction against size ───────────────────────────────────────────
      const conviction: ConvictionGap[] = []
      for (const h of holdings) {
        const t = target.get(h.asset_id)
        const price = Number(h.price) || 0
        const total = totals.get(h.portfolio_id) ?? 0
        if (price <= 0 || total <= 0) continue

        const weightPct = (value(h) / total) * 100
        if (weightPct < MIN_WEIGHT_PCT) continue

        const stated = convictionOf.get(h.asset_id) ?? null
        const rank = stated ? (CONVICTION_RANK[stated] ?? 0) : 0
        const upsidePct = t ? (t.price - price) / price : 0
        // Needs at least one of the two signals to say anything at all.
        if (!t && !rank) continue

        // The mosaic: either a strong stated conviction or a large implied
        // upside makes the underweight case. A "high" rating on a 0.4%
        // position is as much a mismatch as a 30% upside on one, and neither
        // field alone would catch both.
        const isUnder = (upsidePct >= STRONG_UPSIDE || rank >= 3) && weightPct < 2
        // Overweight needs both to be weak — a big position with a stale
        // target but genuine high conviction is not obviously wrong.
        const isOver = !!t && upsidePct <= WEAK_UPSIDE && rank <= 2 && weightPct >= 4
        if (!isUnder && !isOver) continue

        conviction.push({
          assetId: h.asset_id,
          symbol: h.assets?.symbol ?? '?',
          companyName: h.assets?.company_name ?? null,
          weightPct,
          upsidePct,
          conviction: stated,
          portfolioId: h.portfolio_id,
          portfolioName: h.portfolios?.name ?? 'Portfolio',
          direction: isUnder ? 'underweight' : 'overweight',
          // Underweights rank on upside forgone, overweights on size at risk.
          tension: isUnder ? Math.max(upsidePct * 100, rank * 20) : weightPct,
        })
      }
      conviction.sort((a, b) => b.tension - a.tension)

      return {
        conviction: conviction.slice(0, 12),
        crowded: crowded.slice(0, 12),
        breaches: breaches.slice(0, 12),
        stale: stale.slice(0, 12),
      }
    },
  })
}
