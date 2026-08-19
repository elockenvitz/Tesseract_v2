/**
 * Content templates for the Ideas feed.
 *
 * A template turns data the app already has — or can fetch — into a card with
 * a claim, a number behind the claim, and a reason it is in front of you. The
 * feed's problem was never rendering; it was that only a handful of kinds
 * existed, so every visit showed the same material in a different order.
 *
 * Each template is a pure function from inputs to cards. No fetching, no React
 * — which is what makes them testable and what stops a template silently
 * becoming a data-loading path. The caller supplies the data; the template
 * decides whether there is anything worth saying.
 *
 * The bar for emitting a card: it must state something specific and true that
 * the reader would not already know from the row itself. "AAPL reports on
 * Thursday" clears it. "AAPL exists" does not — a template that always fires
 * is noise with a template's shape.
 */

export type TemplateKind =
  | 'unusual_move'
  | 'active_risk'
  | 'earnings_ahead'
  | 'earnings_result'
  | 'corporate_action'
  | 'economic'

export interface TemplateCard {
  id: string
  kind: TemplateKind
  /** One line, the claim itself. */
  headline: string
  /** Supporting prose. Two sentences at most — this is a feed, not a memo. */
  body: string
  /** The number the claim rests on, rendered prominently. */
  metric?: string
  metricLabel?: string
  /** Drives ordering within the kind. Higher is more worth showing. */
  score: number
  symbol?: string
  assetId?: string
  /** ISO. Used for "in 3 days" / "yesterday" phrasing at render time. */
  eventDate?: string
  tone?: 'positive' | 'negative' | 'neutral'
}

// ── Inputs ─────────────────────────────────────────────────────────────────

export interface QuoteLike {
  symbol: string
  price: number
  changePercent: number
}

export interface HoldingLike {
  assetId: string
  symbol: string
  /** Portfolio weight, percent. */
  weight: number
  /** Benchmark weight, percent. Null when the name is not in the index. */
  benchmarkWeight: number | null
}

export interface CoveredAsset {
  id: string
  symbol: string
  companyName?: string | null
  sector?: string | null
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

// ── 1. Unusual movers ──────────────────────────────────────────────────────

/**
 * Names moving hard today, in or adjacent to what the desk follows.
 *
 * "Unusual" is relative to the day's own cross-section rather than an absolute
 * threshold: on a day when everything is down 4%, a name down 4% is not news,
 * and a fixed 3% trigger would fire on all of them. A move counts when it is
 * far from the median of the set *and* large in absolute terms — the second
 * condition stops a flat tape from manufacturing drama out of noise.
 */
export function unusualMovers(
  quotes: QuoteLike[],
  assets: Map<string, CoveredAsset>,
  opts: { minAbs?: number; sigma?: number; limit?: number } = {}
): TemplateCard[] {
  const { minAbs = 3, sigma = 1.5, limit = 4 } = opts
  const usable = quotes.filter(q => Number.isFinite(q.changePercent))
  if (usable.length < 3) return []

  const changes = usable.map(q => q.changePercent).sort((a, b) => a - b)
  const median = changes[Math.floor(changes.length / 2)]
  const deviations = changes.map(c => Math.abs(c - median)).sort((a, b) => a - b)
  // Median absolute deviation, scaled to be comparable to a standard
  // deviation. Robust to the handful of extreme names that are the whole point
  // of the exercise — a plain stdev would be inflated by them and hide them.
  const mad = deviations[Math.floor(deviations.length / 2)] * 1.4826

  return usable
    .map(q => {
      const excess = mad > 0 ? Math.abs(q.changePercent - median) / mad : 0
      return { q, excess }
    })
    .filter(({ q, excess }) => excess >= sigma && Math.abs(q.changePercent) >= minAbs)
    .sort((a, b) => b.excess - a.excess)
    .slice(0, limit)
    .map(({ q, excess }) => {
      const asset = assets.get(q.symbol.toUpperCase())
      const up = q.changePercent >= 0
      return {
        id: `tpl:move:${q.symbol}`,
        kind: 'unusual_move' as const,
        headline: `${q.symbol} ${up ? 'up' : 'down'} ${Math.abs(q.changePercent).toFixed(1)}% today`,
        body: asset
          ? `${asset.companyName || q.symbol} is moving well outside the day's range for names you follow, about ${excess.toFixed(1)}× the typical spread.${asset.sector ? ` Sector: ${asset.sector}.` : ''}`
          : `${q.symbol} sits adjacent to your coverage and is moving well outside the day's range, about ${excess.toFixed(1)}× the typical spread.`,
        metric: pct(q.changePercent),
        metricLabel: 'Today',
        score: excess,
        symbol: q.symbol,
        assetId: asset?.id,
        tone: up ? 'positive' as const : 'negative' as const,
      }
    })
}

// ── 2. Outsized active risk ────────────────────────────────────────────────

/**
 * Positions carrying the most active weight — where the book actually differs
 * from the benchmark, which is the only place it can out- or under-perform.
 *
 * Names absent from the benchmark are the sharpest version of this: the whole
 * position is active weight. That is flagged explicitly rather than folded
 * into the number, because "2% active" reads very differently when the
 * benchmark weight is 1.8% versus zero.
 */
export function outsizedActiveRisk(
  holdings: HoldingLike[],
  opts: { minActive?: number; limit?: number } = {}
): TemplateCard[] {
  const { minActive = 1.5, limit = 3 } = opts
  return holdings
    .map(h => ({ h, active: h.weight - (h.benchmarkWeight ?? 0) }))
    .filter(({ active }) => Math.abs(active) >= minActive)
    .sort((a, b) => Math.abs(b.active) - Math.abs(a.active))
    .slice(0, limit)
    .map(({ h, active }) => {
      const offBench = h.benchmarkWeight == null || h.benchmarkWeight === 0
      const over = active > 0
      return {
        id: `tpl:active:${h.assetId}`,
        kind: 'active_risk' as const,
        headline: `${h.symbol} is your ${over ? 'largest overweight' : 'largest underweight'} at ${pct(active)}`,
        body: offBench
          ? `The position is ${h.weight.toFixed(1)}% of the book and the benchmark does not hold it, so all of it is active risk. Nothing offsets this if the thesis is wrong.`
          : `${h.weight.toFixed(1)}% of the book against ${h.benchmarkWeight!.toFixed(1)}% in the benchmark. This is where the portfolio is expressing a view.`,
        metric: pct(active),
        metricLabel: 'Active weight',
        score: Math.abs(active),
        symbol: h.symbol,
        assetId: h.assetId,
        tone: 'neutral' as const,
      }
    })
}

// ── 3 & 4. Earnings ────────────────────────────────────────────────────────

export interface UpcomingEarningsInput {
  symbol: string
  date: string
  hour?: string
  epsEstimate?: number
  revenueEstimate?: number
}

export function earningsAhead(
  rows: UpcomingEarningsInput[],
  assets: Map<string, CoveredAsset>,
  opts: { withinDays?: number; limit?: number } = {}
): TemplateCard[] {
  const { withinDays = 14, limit = 4 } = opts
  const now = Date.now()
  return rows
    .map(r => ({ r, days: Math.round((new Date(r.date).getTime() - now) / 86400_000) }))
    .filter(({ days }) => days >= 0 && days <= withinDays)
    .sort((a, b) => a.days - b.days)
    .slice(0, limit)
    .map(({ r, days }) => {
      const asset = assets.get(r.symbol.toUpperCase())
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
      const timing = r.hour === 'bmo' ? 'before the open' : r.hour === 'amc' ? 'after the close' : null
      const consensus: string[] = []
      if (r.epsEstimate != null) consensus.push(`EPS consensus $${r.epsEstimate.toFixed(2)}`)
      if (r.revenueEstimate != null) consensus.push(`revenue $${(r.revenueEstimate / 1e9).toFixed(2)}B`)
      return {
        id: `tpl:earn-ahead:${r.symbol}:${r.date}`,
        kind: 'earnings_ahead' as const,
        headline: `${r.symbol} reports ${when}`,
        body: [
          `${asset?.companyName || r.symbol} reports ${when}${timing ? `, ${timing}` : ''}.`,
          consensus.length
            ? `The street is at ${consensus.join(' and ')}.`
            : 'No consensus figures available from the provider.',
          'Worth checking your thesis still holds against what the print is likely to show.',
        ].join(' '),
        metric: consensus.length && r.epsEstimate != null ? `$${r.epsEstimate.toFixed(2)}` : `${days}d`,
        metricLabel: r.epsEstimate != null ? 'EPS consensus' : 'Until report',
        // Sooner is more urgent, and a name you cover outranks one you do not.
        score: (withinDays - days) + (asset ? 5 : 0),
        symbol: r.symbol,
        assetId: asset?.id,
        eventDate: r.date,
        tone: 'neutral' as const,
      }
    })
}

export interface RecentEarningsInput {
  symbol: string
  date: string
  epsActual?: number
  epsEstimate?: number
  surprisePercent?: number
}

export function earningsResult(
  rows: RecentEarningsInput[],
  assets: Map<string, CoveredAsset>,
  quotes: Map<string, QuoteLike>,
  opts: { limit?: number } = {}
): TemplateCard[] {
  const { limit = 4 } = opts
  return rows
    .filter(r => r.epsActual != null && r.epsEstimate != null)
    .map(r => {
      const surprise = r.surprisePercent ?? (
        r.epsEstimate ? ((r.epsActual! - r.epsEstimate!) / Math.abs(r.epsEstimate!)) * 100 : 0
      )
      return { r, surprise }
    })
    .sort((a, b) => Math.abs(b.surprise) - Math.abs(a.surprise))
    .slice(0, limit)
    .map(({ r, surprise }) => {
      const asset = assets.get(r.symbol.toUpperCase())
      const quote = quotes.get(r.symbol.toUpperCase())
      const beat = surprise >= 0
      // The reaction is the interesting half: a beat the market sold is a
      // different story from a beat it bought, and it is the one worth a card.
      const reaction = quote
        ? ` The stock is ${quote.changePercent >= 0 ? 'up' : 'down'} ${Math.abs(quote.changePercent).toFixed(1)}% today.`
        : ''
      const divergent = quote && ((beat && quote.changePercent < 0) || (!beat && quote.changePercent > 0))
      return {
        id: `tpl:earn-result:${r.symbol}:${r.date}`,
        kind: 'earnings_result' as const,
        headline: `${r.symbol} ${beat ? 'beat' : 'missed'} by ${Math.abs(surprise).toFixed(0)}%`,
        body: [
          `${asset?.companyName || r.symbol} reported $${r.epsActual!.toFixed(2)} against $${r.epsEstimate!.toFixed(2)} expected.${reaction}`,
          divergent
            ? 'The reaction runs against the result, which usually means the print was not what the market was actually trading on.'
            : '',
        ].filter(Boolean).join(' '),
        metric: `${surprise >= 0 ? '+' : ''}${surprise.toFixed(0)}%`,
        metricLabel: 'EPS surprise',
        // A divergent reaction is the most informative case, so it outranks a
        // larger surprise that the market simply agreed with.
        score: Math.abs(surprise) + (divergent ? 25 : 0) + (asset ? 5 : 0),
        symbol: r.symbol,
        assetId: asset?.id,
        eventDate: r.date,
        tone: beat ? 'positive' as const : 'negative' as const,
      }
    })
}

// ── 5. Corporate actions ───────────────────────────────────────────────────

export interface CorporateActionInput {
  symbol: string
  type: 'dividend'
  amount?: number
  exDate?: string
  payDate?: string
  frequency?: number
}

export function corporateActions(
  rows: CorporateActionInput[],
  assets: Map<string, CoveredAsset>,
  quotes: Map<string, QuoteLike>,
  opts: { limit?: number } = {}
): TemplateCard[] {
  const { limit = 3 } = opts
  const now = Date.now()
  return rows
    .filter(r => r.amount != null && r.exDate)
    .map(r => ({ r, days: Math.round((new Date(r.exDate!).getTime() - now) / 86400_000) }))
    .filter(({ days }) => days >= -30 && days <= 45)
    .sort((a, b) => Math.abs(a.days) - Math.abs(b.days))
    .slice(0, limit)
    .map(({ r, days }) => {
      const asset = assets.get(r.symbol.toUpperCase())
      const quote = quotes.get(r.symbol.toUpperCase())
      // Annualised yield where we have a price and a frequency — the payment
      // alone means nothing without the price it is paid on.
      const annual = r.frequency && r.amount ? r.amount * r.frequency : null
      const yieldPct = annual && quote?.price ? (annual / quote.price) * 100 : null
      const upcoming = days >= 0
      return {
        id: `tpl:action:${r.symbol}:${r.exDate}`,
        kind: 'corporate_action' as const,
        headline: `${r.symbol} declared a $${r.amount!.toFixed(2)} dividend`,
        body: [
          `${asset?.companyName || r.symbol} goes ex-dividend ${upcoming ? `in ${days} days` : `${Math.abs(days)} days ago`} at $${r.amount!.toFixed(2)} a share.`,
          yieldPct ? `That annualises to roughly ${yieldPct.toFixed(1)}% at the current price.` : '',
        ].filter(Boolean).join(' '),
        metric: yieldPct ? `${yieldPct.toFixed(1)}%` : `$${r.amount!.toFixed(2)}`,
        metricLabel: yieldPct ? 'Annualised yield' : 'Per share',
        score: (45 - Math.abs(days)) + (asset ? 5 : 0),
        symbol: r.symbol,
        assetId: asset?.id,
        eventDate: r.exDate,
        tone: 'neutral' as const,
      }
    })
}

// ── 6. Economic releases ───────────────────────────────────────────────────

export interface EconomicInput {
  event: string
  time: string
  actual?: number | null
  estimate?: number | null
  prior?: number | null
  impact?: string
  unit?: string
}

/**
 * Macro prints, previewed before and read after.
 *
 * Filtered to high-impact releases: a feed that surfaces every regional survey
 * teaches the reader to scroll past the whole category, which costs the prints
 * that do matter.
 */
export function economicReleases(
  rows: EconomicInput[],
  opts: { limit?: number } = {}
): TemplateCard[] {
  const { limit = 3 } = opts
  const now = Date.now()
  return rows
    .filter(r => (r.impact ?? '').toLowerCase().includes('high') || r.estimate != null)
    .map(r => ({ r, days: Math.round((new Date(r.time).getTime() - now) / 86400_000) }))
    .filter(({ days }) => days >= -3 && days <= 14)
    .sort((a, b) => Math.abs(a.days) - Math.abs(b.days))
    .slice(0, limit)
    .map(({ r, days }) => {
      const released = r.actual != null
      const unit = r.unit ? ` ${r.unit}` : ''
      const surprise = released && r.estimate != null ? r.actual! - r.estimate! : null
      return {
        id: `tpl:econ:${r.event}:${r.time}`,
        kind: 'economic' as const,
        headline: released
          ? `${r.event} came in at ${r.actual}${unit}`
          : `${r.event} ${days === 0 ? 'lands today' : days === 1 ? 'lands tomorrow' : `in ${days} days`}`,
        // A missing consensus or prior is stated as missing, never drawn as a
        // dash. "Consensus was —" reads as a number the reader failed to parse,
        // and at metric size an em dash standing in for an absent figure is the
        // placeholder defect the suppression contract exists to catch.
        body: released
          ? [
              r.estimate != null ? `Consensus was ${r.estimate}${unit}.` : 'No consensus was recorded.',
              r.prior != null ? `Prior ${r.prior}${unit}.` : '',
              surprise != null
                ? `That is a ${surprise >= 0 ? 'beat' : 'miss'} of ${Math.abs(surprise).toFixed(1)}${unit}.`
                : '',
            ].filter(Boolean).join(' ')
          : [
              r.estimate != null
                ? `Consensus is ${r.estimate}${unit}${r.prior != null ? ` against a prior of ${r.prior}${unit}` : ''}.`
                : 'No consensus has been recorded for it yet.',
              'Worth knowing which of your positions are exposed before it prints.',
            ].join(' '),
        // Undefined rather than a dash when there is no figure. The builder
        // emits `metric: null` for that, and the card drops the well entirely.
        metric: released
          ? `${r.actual}${unit}`
          : r.estimate != null ? `${r.estimate}${unit}` : undefined,
        metricLabel: released ? 'Actual' : 'Consensus',
        score: (14 - Math.abs(days)) + (released ? 3 : 0),
        eventDate: r.time,
        tone: 'neutral' as const,
      }
    })
}
