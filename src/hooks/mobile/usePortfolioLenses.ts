import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { timeframeMonths } from '../../lib/signals/timeframe'
import { isPriceable, targetIsPlausible } from '../../lib/signals/instruments'

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
  /**
   * Date of the holdings snapshot these weights came from. ISO.
   *
   * Carried because a card that shows a book number must be able to say WHEN
   * the book was true. Stamping it with the current time claimed a freshness
   * the number never had — the same lie the fabricated quote used to tell, and
   * it rendered as "book Aug 18" on weights from an April snapshot.
   */
  asOf: string

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
  /**
   * Every position in the same book carrying the SAME stated conviction,
   * with its weight. Heaviest first, subject included.
   *
   * This is what turns the claim from an assertion into something checkable.
   * "High conviction, 0.4% position" invites the answer "so is everything
   * else" — and if the other five high-conviction names average 4%, it does
   * not. The cohort is the only way to tell those two apart, and neither the
   * weight nor the rating says which one you are looking at.
   *
   * Falls back to every sized position in the book when the conviction cohort
   * would be one name. Measured 2026-08-18, that fallback is the ONLY path
   * that ever runs: `analyst_ratings` carries a conviction for exactly one
   * name per organisation, so no two names in a book share one. "Is 0.4%
   * actually small here" is still answerable from the book's own sizes, and
   * that is a real question, so the pane ranks those instead of vanishing.
   *
   * `cohortBasis` says which it is, and the card labels the pane from it — a
   * ranking against the whole book and a ranking against your high-conviction
   * names are different claims and must not share a caption.
   */
  cohort: { symbol: string; weightPct: number }[]
  cohortBasis: 'conviction' | 'book'
}

/** A target the price has already reached or passed. */
export interface TargetBreach {
  /**
   * Date of the holdings snapshot these weights came from. ISO.
   *
   * Carried because a card that shows a book number must be able to say WHEN
   * the book was true. Stamping it with the current time claimed a freshness
   * the number never had — the same lie the fabricated quote used to tell, and
   * it rendered as "book Aug 18" on weights from an April snapshot.
   */
  asOf: string

  assetId: string
  symbol: string
  companyName: string | null
  price: number
  target: number
  /** How far past the target the price is, as a fraction. */
  overshootPct: number
  /**
   * The scenario this target belongs to — "Bear", "Base", "Bull".
   *
   * Null only where the row has no scenario, which is rare and honest: the
   * card then says "target" rather than inventing a case name.
   */
  caseName: string | null
  /**
   * The whole ladder for this name, so the card can let the reader choose
   * which case they are editing rather than guess.
   */
  cases: { id: string; name: string; price: number }[]
  conviction: string | null
  heldIn: string[]
  /** Ids matching `heldIn`, so a context chip can route to the book. */
  heldInIds: string[]
  /** When the target was stated. ISO. Used for the card's own timestamp — see
   *  StaleTarget.expiredAt for why `new Date()` is not acceptable here. */
  statedAt: string
}

/** A target whose own stated horizon has run out. */
export interface StaleTarget {
  /**
   * Date of the holdings snapshot these weights came from. ISO.
   *
   * Carried because a card that shows a book number must be able to say WHEN
   * the book was true. Stamping it with the current time claimed a freshness
   * the number never had — the same lie the fabricated quote used to tell, and
   * it rendered as "book Aug 18" on weights from an April snapshot.
   */
  asOf: string

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
  /** Ids matching `heldIn`, so a context chip can route to the book. */
  heldInIds: string[]
  /**
   * When the target was stated. ISO.
   *
   * The real date, carried rather than reconstructed. The card used to date its
   * metric with `Date.now() - ageMonths * 30.44 days`, which is a *synthetic*
   * timestamp: it drifts with the reader's clock, it is rounded to whole
   * months, and it rendered in the eyebrow as a bare unexplained day like
   * "Jun 18" that corresponded to nothing anybody had ever entered.
   */
  statedAt: string
  /**
   * When the horizon actually ran out. ISO.
   *
   * The card's timestamp must be the moment the CONDITION became true, not the
   * moment a browser computed it. These cards are derived client-side, so
   * stamping them with `new Date()` made every one of them read "1 minute ago"
   * on every login — which says the feed is generated for you rather than
   * waiting for you, and is false besides: a target expired months ago and
   * nobody was told.
   */
  expiredAt: string
}

export interface CrowdedName {
  /**
   * Date of the holdings snapshot these weights came from. ISO.
   *
   * Carried because a card that shows a book number must be able to say WHEN
   * the book was true. Stamping it with the current time claimed a freshness
   * the number never had — the same lie the fabricated quote used to tell, and
   * it rendered as "book Aug 18" on weights from an April snapshot.
   */
  asOf: string

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
  /**
   * The weight it takes in each book that holds it, heaviest first.
   *
   * `maxWeightPct` alone collapses the finding. "Six books hold it, the
   * heaviest at 7.2%" is compatible with five token positions beside one real
   * bet, and with six books that all believe the same thing — opposite
   * situations with opposite responses. The spread is the claim; the maximum
   * is one point on it.
   */
  weightsByPortfolio: { name: string; weightPct: number; valueUsd: number }[]
}

/**
 * A position of real size that nobody has ever priced.
 *
 * The other three target lenses all need a target to exist before they can say
 * anything, so the book's least-examined names were structurally invisible to
 * this hook: a 4% position with no price target produced no conviction gap (no
 * upside to compute), no breach and no expiry. The absence was the finding, and
 * nothing was looking for it.
 */
export interface UntargetedPosition {
  /** Date of the holdings snapshot this weight came from. ISO. */
  asOf: string
  assetId: string
  symbol: string
  companyName: string | null
  /** Size in the heaviest book that holds it. */
  weightPct: number
  portfolioName: string
  /** The holdings mark. NOT a live quote: it seeds the tuner, nothing else. */
  price: number
  heldIn: string[]
  /** Ids matching `heldIn`, so a context chip can route to the book. */
  heldInIds: string[]
  /** Stated conviction, where one exists. A rated name with no number on it is
   *  a sharper contradiction than an unrated one. */
  conviction: string | null
}

export interface PortfolioLenses {
  conviction: ConvictionGap[]
  crowded: CrowdedName[]
  breaches: TargetBreach[]
  stale: StaleTarget[]
  untargeted: UntargetedPosition[]
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
/**
 * Where "nobody has priced this yet" stops being a reasonable answer.
 *
 * Well above MIN_WEIGHT_PCT on purpose. Starter positions and residual tails
 * routinely carry no target and flagging them would produce a card per name on
 * a long book, which is the filler problem the feed has already been through
 * once. At 2% of a portfolio the absence is a decision nobody made.
 */
const UNTARGETED_MIN_PCT = 2

/**
 * How many positions a portfolio needs before a weight means anything.
 *
 * ── Weights that are correct and still wrong ──────────────────────────────
 *
 * Measured against production 2026-08-19: of 36 portfolios on their latest
 * snapshot, several hold ONE position and several hold two. Every price and
 * share count is populated, so the arithmetic is exact — and it produces
 * "MNST is 51.7% of Vision Fund 10K" and "CAT is 100% of Tech & Consumer
 * Growth". Both are true. Both read as a broken calculation, and neither is a
 * finding: in a two-position portfolio every position is enormous by
 * construction, so "this is a large position" carries no information at all.
 *
 * This is `insufficient_coverage` in the contract's own vocabulary — a source
 * too sparse for the claim to mean anything — applied to the denominator
 * rather than to a missing row. Five is where a share stops being an artifact
 * of how few things are in the list.
 *
 * Deliberately NOT a cap on the weight itself. Suppressing "over 40%" would
 * hide the genuine concentration this product exists to surface; what is
 * suppressed is the portfolio too small for a percentage to describe.
 */
const MIN_POSITIONS_FOR_WEIGHT = 5


export function usePortfolioLenses(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<PortfolioLenses>({
    queryKey: ['portfolio-lenses', currentOrgId],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const empty: PortfolioLenses = { conviction: [], crowded: [], breaches: [], stale: [], untargeted: [] }

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
      // And how many positions that denominator is spread across, because a
      // weight is ALSO meaningless when the answer is "two". See
      // MIN_POSITIONS_FOR_WEIGHT.
      const positionCount = new Map<string, number>()
      for (const h of holdings) {
        totals.set(h.portfolio_id, (totals.get(h.portfolio_id) ?? 0) + value(h))
        positionCount.set(h.portfolio_id, (positionCount.get(h.portfolio_id) ?? 0) + 1)
      }
      /** True when this portfolio can support a "% of the portfolio" claim. */
      const weightIsMeaningful = (portfolioId: string) =>
        (positionCount.get(portfolioId) ?? 0) >= MIN_POSITIONS_FOR_WEIGHT

      const byAsset = new Map<string, { rows: HoldingRow[]; portfolios: Set<string> }>()
      for (const h of holdings) {
        if (!h.asset_id) continue
        const e = byAsset.get(h.asset_id) ?? { rows: [], portfolios: new Set<string>() }
        e.rows.push(h)
        e.portfolios.add(h.portfolio_id)
        byAsset.set(h.asset_id, e)
      }

      /** The newest snapshot date across the rows in play. */
      const snapshotAsOf = (() => {
        const dates = holdings.map(h => (h as unknown as { date?: string | null }).date).filter(Boolean) as string[]
        // Indexed, not `.at(-1)` — the app tsconfig targets a lib without it,
        // so that line was a type error outside the gated card surface.
        const sorted = dates.sort()
        return sorted.length ? new Date(sorted[sorted.length - 1]).toISOString() : new Date().toISOString()
      })()

      const heldIn = (assetId: string) =>
        Array.from(new Set(
          (byAsset.get(assetId)?.rows ?? [])
            .map(h => h.portfolios?.name)
            .filter(Boolean) as string[]
        ))

      /**
       * The ids behind those names, in the same order.
       *
       * Kept as a parallel array rather than folded into `heldIn` so the many
       * existing readers of `heldIn` keep working unchanged. Deduplicated by
       * NAME, matching `heldIn` exactly, so index N of one always corresponds to
       * index N of the other — two books sharing a name would otherwise desync
       * the arrays and route a chip to the wrong portfolio.
       */
      const heldInIds = (assetId: string) => {
        const seenName = new Set<string>()
        const out: string[] = []
        for (const h of byAsset.get(assetId)?.rows ?? []) {
          const name = h.portfolios?.name
          if (!name || seenName.has(name)) continue
          seenName.add(name)
          out.push(h.portfolio_id)
        }
        return out
      }

      // ── Crowding ──────────────────────────────────────────────────────────
      const crowded: CrowdedName[] = []
      for (const [assetId, e] of byAsset) {
        if (e.portfolios.size < 2) continue
        // Cash is in every book by construction, so "held across more of the
        // book than any one portfolio shows" is trivially true of it and means
        // nothing. Crowding is a claim about concentrated exposure to one
        // thesis, and cash is the absence of a thesis.
        if (!isPriceable(e.rows[0]?.assets?.symbol)) continue

        // One entry per BOOK, not per row. `e.rows` is already reduced to the
        // newest snapshot per portfolio upstream, but a portfolio that holds
        // the name in two lots would otherwise appear twice on the chart as
        // two smaller positions.
        const byPortfolio = new Map<string, { name: string; weightPct: number; valueUsd: number }>()
        for (const h of e.rows) {
          const t = totals.get(h.portfolio_id) ?? 0
          if (t <= 0) continue
          const prev = byPortfolio.get(h.portfolio_id)
          const pct = (value(h) / t) * 100
          byPortfolio.set(h.portfolio_id, {
            name: h.portfolios?.name ?? 'Portfolio',
            weightPct: (prev?.weightPct ?? 0) + pct,
            // Weight and money are different facts and the card needs both. A
            // 25% weight in a small book can be far less exposure than 4% in a
            // large one, and "crowded" is a claim about the firm's money.
            valueUsd: (prev?.valueUsd ?? 0) + value(h),
          })
        }
        const weightsByPortfolio = [...byPortfolio.values()]
          .sort((a, b) => b.weightPct - a.weightPct)

        crowded.push({
          assetId,
          symbol: e.rows[0].assets?.symbol ?? '?',
          companyName: e.rows[0].assets?.company_name ?? null,
          portfolioCount: e.portfolios.size,
          totalValue: e.rows.reduce((n, h) => n + value(h), 0),
          maxWeightPct: weightsByPortfolio[0]?.weightPct ?? 0,
          weightsByPortfolio,
          portfolioNames: heldIn(assetId),
          asOf: snapshotAsOf,
        })
      }
      crowded.sort((a, b) => b.portfolioCount - a.portfolioCount || b.totalValue - a.totalValue)

      /**
       * Every position in one book carrying one stated conviction.
       *
       * Built lazily and cached, because a portfolio with six high-conviction
       * names would otherwise rebuild the same list six times — once per card.
       *
       * Scoped to the portfolio, never across the org. A name's weight is a
       * share of ITS book, so putting two portfolios' weights on one axis
       * compares fractions of different denominators — the same category error
       * as summing across snapshot dates.
       */
      const cohortCache = new Map<string, { symbol: string; weightPct: number }[]>()
      const weightsIn = (portfolioId: string, stated: string | null) => {
        const key = `${portfolioId}:${stated ?? '*'}`
        const hit = cohortCache.get(key)
        if (hit) return hit
        const total = totals.get(portfolioId) ?? 0
        const out: { symbol: string; weightPct: number }[] = []
        if (total > 0) {
          for (const h of holdings) {
            if (h.portfolio_id !== portfolioId) continue
            if (stated && (convictionOf.get(h.asset_id) ?? null) !== stated) continue
            const w = (value(h) / total) * 100
            if (!Number.isFinite(w) || w <= 0) continue
            out.push({ symbol: h.assets?.symbol ?? '?', weightPct: w })
          }
          out.sort((a, b) => b.weightPct - a.weightPct)
        }
        cohortCache.set(key, out)
        return out
      }

      /**
       * Prefer the conviction cohort; fall back to the book.
       *
       * A cohort of one is the subject looking at itself, which answers
       * nothing. Today that is every case — one rated name per org — so this
       * always returns the book, and the basis flag makes the card say so
       * rather than captioning a book-wide ranking as a conviction peer group.
       */
      const cohortOf = (portfolioId: string, stated: string | null) => {
        const byConviction = stated ? weightsIn(portfolioId, stated) : []
        return byConviction.length > 1
          ? { cohort: byConviction, cohortBasis: 'conviction' as const }
          : { cohort: weightsIn(portfolioId, null), cohortBasis: 'book' as const }
      }

      // ── Targets and conviction ────────────────────────────────────────────
      // analyst_price_targets rather than price_targets: it is the table the
      // product actually writes to, and it carries the horizon — which is what
      // makes "this view has expired" answerable at all.
      const assetIds = Array.from(byAsset.keys()).slice(0, 500)
      const [{ data: targets }, { data: ratings }] = await Promise.all([
        supabase
          .from('analyst_price_targets')
          .select('id, asset_id, price, timeframe, is_rolling, is_official, created_at, scenarios:scenario_id(name)')
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
      /**
       * Targets dropped for being nowhere near the tape, kept for the log.
       *
       * A target more than 3x from the price is an artifact rather than a view:
       * entered against a pre-split share count, typed into the wrong field, or
       * never revisited across a corporate action. GOOGL ($1,605 against $344),
       * AMZN ($90 against $259) and PLTR ($50 against $172) are all in this
       * bucket today, and each would otherwise render a confident card claiming
       * a return nobody believes.
       *
       * They are dropped from the target lenses ONLY. The position still exists
       * and still shows up under crowding or size; what is suppressed is the
       * arithmetic that treats a broken number as a stated view.
       */
      const implausibleTargets: string[] = []
      /**
       * Every case per asset, not just the one that ranked first.
       *
       * A target IS a case — every row in `analyst_price_targets` belongs to a
       * scenario — so a card that lets somebody edit "the target" without
       * saying which, and without letting them pick, is asking them to change
       * a number whose identity they cannot see. Carrying the whole ladder is
       * what makes the case selectable on the card.
       */
      const allCases = new Map<string, { id: string; name: string; price: number }[]>()
      for (const t of (targets ?? []) as any[]) {
        const p0 = Number(t.price)
        if (!t.asset_id || !Number.isFinite(p0) || p0 <= 0) continue
        const list = allCases.get(t.asset_id) ?? []
        list.push({ id: t.id, name: (t.scenarios?.name ?? 'Target') as string, price: p0 })
        allCases.set(t.asset_id, list)
      }
      for (const t of (targets ?? []) as any[]) {
        if (!t.asset_id || target.has(t.asset_id)) continue
        const p = Number(t.price)
        if (!Number.isFinite(p) || p <= 0) continue

        const e = byAsset.get(t.asset_id)
        const mark = e ? Number(e.rows[0]?.price) || 0 : 0
        if (mark > 0 && !targetIsPlausible(p, mark)) {
          implausibleTargets.push(
            `${e?.rows[0]?.assets?.symbol ?? t.asset_id}: target ${p} vs mark ${mark}`)
          continue
        }

        target.set(t.asset_id, {
          price: p,
          timeframe: t.timeframe ?? null,
          rolling: !!t.is_rolling,
          createdAt: t.created_at,
          /**
           * WHICH target this is.
           *
           * Every row in `analyst_price_targets` belongs to a scenario — Bear,
           * Base, Bull — so there is no such thing as "the" target, only the
           * case that ranked first here (official, then most recent). A card
           * saying "target reached" without naming the case is asking the
           * reader to guess which of their three numbers the price passed.
           */
          caseName: (t.scenarios?.name ?? null) as string | null,
        })
      }
      if (implausibleTargets.length) {
        // Loud in the console rather than silent: this is a research-data
        // problem to be fixed at the source, and a suppression nobody can see
        // is indistinguishable from a lens that stopped working.
        console.warn(
          `[lenses] ${implausibleTargets.length} price target(s) suppressed as implausible:`,
          implausibleTargets,
        )
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

        /**
         * Which case counts as a target REACHED.
         *
         * ── The bug this replaces ────────────────────────────────────────
         *
         * It compared against `t.price` — whichever single row ranked first
         * (official, then most recent). On a name with a ladder that is
         * routinely the BEAR case, and a price above the bear case is not an
         * achievement, it is Tuesday. Reported on AMZN: "it says the target is
         * reached, based on the bear case".
         *
         * A ladder is ordered bear < base < bull, and each case means
         * something different. Passing the LOWEST is the downside scenario not
         * happening; passing one above it is the thesis playing out. So the
         * lowest case never triggers a reach — it is the floor, not a goal.
         *
         * Of the cases that do qualify, the HIGHEST one the price has passed
         * is the honest headline: a price through the bull case has also
         * passed the base, and reporting the base would understate it.
         *
         * A name with a single case has no floor to exclude, so that one still
         * counts — there is no ladder to reason about.
         */
        const ladder = [...(allCases.get(assetId) ?? [])].sort((a, b) => a.price - b.price)
        const reachable = ladder.length > 1 ? ladder.slice(1) : ladder
        const passed = reachable.filter(c => price >= c.price)
        const hit = passed.length ? passed[passed.length - 1] : null

        // The thesis played out and nothing in the product says so. Either the
        // target is raised or the position is a hold with no stated upside —
        // both are decisions, and neither happens if nobody is told.
        if (hit) {
          breaches.push({
            assetId, symbol, companyName,
            price, target: hit.price,
            caseName: hit.name ?? null,
            cases: ladder,
            overshootPct: (price - hit.price) / hit.price,
            statedAt: t.createdAt,
            conviction: convictionOf.get(assetId) ?? null,
            heldIn: heldIn(assetId),
            heldInIds: heldInIds(assetId),
            asOf: snapshotAsOf,
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
              statedAt: t.createdAt,
              // statedAt + the horizon it declared. Computed, not guessed.
              expiredAt: new Date(
                new Date(t.createdAt).getTime() + months * 30.44 * 86_400_000,
              ).toISOString(),
              heldIn: heldIn(assetId),
              heldInIds: heldInIds(assetId),
              asOf: snapshotAsOf,
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
        // Same reason as untargeted: "sized smaller than your view" is a claim
        // about a share of a portfolio, and a portfolio of two has no shares
        // worth describing.
        if (!weightIsMeaningful(h.portfolio_id)) continue

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
          asOf: snapshotAsOf,
          direction: isUnder ? 'underweight' : 'overweight',
          // Underweights rank on upside forgone, overweights on size at risk.
          tension: isUnder ? Math.max(upsidePct * 100, rank * 20) : weightPct,
          ...cohortOf(h.portfolio_id, stated),
        })
      }
      conviction.sort((a, b) => b.tension - a.tension)

      /**
       * ── Sized, and never priced ──────────────────────────────────────────
       *
       * Every other lens above starts from `target.get(assetId)` and gives up
       * when there isn't one, which made the book's unexamined names the one
       * thing this hook could not see. A position carrying real weight that
       * nobody has ever put a number on is the largest unstated decision in a
       * portfolio, and it was structurally invisible.
       *
       * The bar is deliberately higher than MIN_WEIGHT_PCT. Small positions
       * routinely have no target and that is fine — a starter position is not a
       * governance failure. `UNTARGETED_MIN_PCT` is where "we have not got to it
       * yet" stops being a reasonable answer.
       */
      const untargeted: UntargetedPosition[] = []
      const seenUntargeted = new Set<string>()
      for (const h of holdings) {
        if (!h.asset_id || target.has(h.asset_id)) continue
        // Cash has no price target and never will. It sits in 29 of this org's
        // portfolios, so without this the largest single category of card in
        // the feed was "cash is a real position with no price on it" — true,
        // unanswerable, and repeated 29 times. Size claims about cash are still
        // legitimate and are made elsewhere.
        if (!isPriceable(h.assets?.symbol)) continue
        // A two-position portfolio makes every position look enormous, so the
        // size that justifies this card would be an artifact of the list length.
        if (!weightIsMeaningful(h.portfolio_id)) continue
        const total = totals.get(h.portfolio_id) ?? 0
        const price = Number(h.price) || 0
        if (price <= 0 || total <= 0) continue

        const weightPct = (value(h) / total) * 100
        if (weightPct < UNTARGETED_MIN_PCT) continue

        // One card per name, on the book that holds most of it. The same asset
        // across four portfolios is one gap, not four, and listing it four
        // times would bury every other finding under the widest-held names.
        const prev = untargeted.find(u => u.assetId === h.asset_id)
        if (prev) {
          if (weightPct > prev.weightPct) {
            prev.weightPct = weightPct
            prev.portfolioName = h.portfolios?.name ?? 'Portfolio'
            prev.price = price
          }
          continue
        }
        if (seenUntargeted.has(h.asset_id)) continue
        seenUntargeted.add(h.asset_id)

        untargeted.push({
          assetId: h.asset_id,
          symbol: h.assets?.symbol ?? '?',
          companyName: h.assets?.company_name ?? null,
          weightPct,
          portfolioName: h.portfolios?.name ?? 'Portfolio',
          price,
          heldIn: heldIn(h.asset_id),
          heldInIds: heldInIds(h.asset_id),
          conviction: convictionOf.get(h.asset_id) ?? null,
          asOf: snapshotAsOf,
        })
      }
      // Biggest unpriced bet first. Size is the whole ranking here: there is no
      // second signal, because the absence of one is the finding.
      untargeted.sort((a, b) => b.weightPct - a.weightPct)

      return {
        conviction: conviction.slice(0, 12),
        crowded: crowded.slice(0, 12),
        breaches: breaches.slice(0, 12),
        stale: stale.slice(0, 12),
        untargeted: untargeted.slice(0, 12),
      }
    },
  })
}
